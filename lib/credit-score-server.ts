import "server-only";

import { Prisma } from "@/app/generated/prisma/client";
import {
  type CreditBlockSettings,
  type CreditMetrics,
  computeCreditScore,
  decideCreditBlock,
} from "@/lib/credit-score";
import { createNotification, notifySuperAdmins } from "@/lib/notifications";
import { prisma } from "@/lib/prisma";
import { setBypassContext } from "@/lib/tenant-context";

const DAY_MS = 24 * 60 * 60 * 1000;
/** Ажиллагааны үзүүлэлтийн цонх (цаг захиалга, засвар). */
export const CREDIT_OPS_WINDOW_DAYS = 90;
/** Үнэлгээний цонх. */
export const CREDIT_RATING_WINDOW_DAYS = 365;
/** Хугацаандаа дуусгасанд тооцох зай. */
const ON_TIME_GRACE_MS = 60 * 60 * 1000;

export async function getCreditSettings(): Promise<CreditBlockSettings> {
  setBypassContext();
  const row = await prisma.platformSetting.findUnique({
    where: { id: "default" },
    select: { creditAutoBlock: true, creditBlockThreshold: true, creditBlockMode: true },
  });
  return {
    autoBlock: row?.creditAutoBlock ?? true,
    threshold: row?.creditBlockThreshold ?? 40,
    mode: row?.creditBlockMode ?? "HIDE",
  };
}

/** Тенантын credit-ийн түүхий үзүүлэлтүүд (bypass context-д дуудна). */
export async function loadCreditMetrics(tenantId: string, now = new Date()): Promise<CreditMetrics> {
  const opsFrom = new Date(now.getTime() - CREDIT_OPS_WINDOW_DAYS * DAY_MS);
  const ratingFrom = new Date(now.getTime() - CREDIT_RATING_WINDOW_DAYS * DAY_MS);

  const [ratings, confirmed, rejected, completed, cancelled, finished] = await Promise.all([
    prisma.review.aggregate({
      // Зөвхөн засвартай (баталгаажсан) үнэлгээ — засваргүй үнэлгээгээр блоклуулахаас сэргийлнэ.
      where: { tenantId, hidden: false, orderId: { not: null }, createdAt: { gte: ratingFrom } },
      _sum: { rating: true },
      _count: { _all: true },
    }),
    // Онлайн (үйлчлүүлэгчийн апп/вэбээс) цаг захиалгыг баталсан: CONFIRMED, эсвэл
    // батлагдсаны дараа ирээгүй (NO_SHOW — засварын газрын буруу биш).
    prisma.appointment.count({
      where: { tenantId, accountId: { not: null }, createdAt: { gte: opsFrom }, status: { in: ["CONFIRMED", "NO_SHOW"] } },
    }),
    prisma.appointment.count({
      where: { tenantId, accountId: { not: null }, createdAt: { gte: opsFrom }, status: "REJECTED" },
    }),
    prisma.serviceOrder.count({
      where: { tenantId, isInternal: false, createdAt: { gte: opsFrom }, status: "COMPLETED" },
    }),
    prisma.serviceOrder.count({
      where: { tenantId, isInternal: false, createdAt: { gte: opsFrom }, status: "CANCELLED" },
    }),
    prisma.serviceOrder.findMany({
      where: {
        tenantId,
        isInternal: false,
        status: "COMPLETED",
        completedAt: { gte: opsFrom },
        expectedFinishAt: { not: null },
      },
      select: { completedAt: true, expectedFinishAt: true },
    }),
  ]);

  const onTime = finished.filter(
    (o) => o.completedAt && o.expectedFinishAt && o.completedAt.getTime() <= o.expectedFinishAt.getTime() + ON_TIME_GRACE_MS,
  ).length;

  return {
    ratingSum: ratings._sum.rating ?? 0,
    ratingCount: ratings._count._all,
    bookingConfirmed: confirmed,
    bookingRejected: rejected,
    ordersCompleted: completed,
    ordersCancelled: cancelled,
    onTime,
    onTimeTotal: finished.length,
  };
}

export type CreditRecomputeResult = {
  tenantId: string;
  score: number;
  event: "blocked" | "unblocked" | null;
};

/**
 * Нэг тенантын оноог дахин тооцож хадгална, блокын төлөвийг шинэчилж, өөрчлөлт
 * гарвал эзэд болон систем админд мэдэгдэнэ. Тест тенант (isTest) алгасна.
 */
export async function recomputeTenantCredit(
  tenantId: string,
  settings?: CreditBlockSettings,
  now = new Date(),
): Promise<CreditRecomputeResult | null> {
  setBypassContext();
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: {
      id: true,
      name: true,
      isTest: true,
      suspended: true,
      creditAdjustment: true,
      creditHidden: true,
      creditSuspended: true,
      creditExempt: true,
    },
  });
  if (!tenant || tenant.isTest) return null;

  const cfg = settings ?? (await getCreditSettings());
  const breakdown = computeCreditScore(await loadCreditMetrics(tenantId, now), tenant.creditAdjustment);
  const decision = decideCreditBlock(breakdown.score, tenant, cfg);

  await prisma.tenant.update({
    where: { id: tenantId },
    data: {
      creditScore: breakdown.score,
      creditBreakdown: breakdown as unknown as Prisma.InputJsonValue,
      creditUpdatedAt: now,
      ...decision.next,
    },
  });

  if (decision.event) await notifyCreditEvent(tenant.id, tenant.name, decision.event, breakdown.score, cfg);
  return { tenantId, score: breakdown.score, event: decision.event };
}

async function notifyCreditEvent(
  tenantId: string,
  tenantName: string,
  event: "blocked" | "unblocked",
  score: number,
  cfg: CreditBlockSettings,
): Promise<void> {
  const owners = await prisma.user.findMany({
    where: { tenantId, isOwner: true, isActive: true, deletedAt: null },
    select: { id: true },
  });
  const how =
    cfg.mode === "SUSPEND"
      ? "систем түр зогсоогдлоо"
      : "үйлчлүүлэгчийн апп, онлайн захиалгаас түр нуугдлаа";
  const body =
    event === "blocked"
      ? `Credit score ${score} (босго ${cfg.threshold}) тул ${how}. Үйлчилгээний чанараа сайжруулбал автоматаар сэргэнэ.`
      : `Credit score ${score} болж сэргэсэн тул блок цуцлагдлаа.`;
  for (const o of owners) {
    try {
      await createNotification({
        type: event === "blocked" ? "credit_blocked" : "credit_unblocked",
        recipient: { userId: o.id },
        tenantId,
        input: { body },
      });
    } catch (e) {
      console.warn("[notify] credit:", e);
    }
  }
  if (event === "blocked") {
    try {
      await notifySuperAdmins({
        type: "credit_blocked_admin",
        input: { tenantId, body: `"${tenantName}" — credit score ${score} (босго ${cfg.threshold}), ${how}.` },
      });
    } catch (e) {
      console.warn("[notify] credit admin:", e);
    }
  }
}

/** Бүх (тест бус) тенантын оноог дахин тооцно — өдөр тутмын cron. */
export async function recomputeAllCredit(now = new Date()): Promise<CreditRecomputeResult[]> {
  setBypassContext();
  const cfg = await getCreditSettings();
  const tenants = await prisma.tenant.findMany({ where: { isTest: false }, select: { id: true } });
  const results: CreditRecomputeResult[] = [];
  for (const t of tenants) {
    try {
      const r = await recomputeTenantCredit(t.id, cfg, now);
      if (r) results.push(r);
    } catch (e) {
      console.error("[credit] recompute failed:", t.id, e);
    }
  }
  return results;
}
