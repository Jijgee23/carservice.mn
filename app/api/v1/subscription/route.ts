// Contract — GET /api/v1/subscription (багцын төлөв + модуль + сунгах үнэ)
//
// GET /api/v1/subscription
//   Эрх: нэвтэрсэн бүх ажилтан. Багц дууссан/түгжигдсэн үед ч нээлттэй
//   (requireActiveSubscriptionApi дууддаггүй — вэбийн «Багц» хуудастай адил).
//   Модулийн хаалтгүй (API_MODULE_PATHS-д ороогүй).
//   200: {
//     plan: "FREE"|"BUSINESS"|"ENTERPRISE", status, locked, isTrial,
//     daysLeft: number|null, expiresAt: ISO|null, expiringSoon, warnDays,
//     hasPendingPayment,                         // (хуучин талбарууд — өөрчлөгдөөгүй)
//     modules: PlanModuleCode[],                 // тенантын одоогийн багцад нээлттэй модулиуд
//                                                // (lib/plan-modules-server getEnabledModules —
//                                                // вэбийн ModuleGate/requireApiUser-тэй ижил эх сурвалж)
//     moduleCatalog: [{ code, label, description }],   // бүх модуль (MODULE_LIMIT_CODES дарааллаар)
//     planModules: { FREE: code[], BUSINESS: code[], ENTERPRISE: code[] },
//     prices: [{ id, plan, period, periodLabel, amount: string, currency, notes,
//                features: string[] }],      // QPay-ээр авах (self-serve) идэвхтэй үнэ
//     pendingPayment: { id, plan, period, amount, currency, qrImage, qrText,
//                       urls, createdAt } | null,   // зөвхөн эзэмшигчид (бусдад null)
//     payments: [{ id, plan, period, amount, method, status, createdAt, paidAt }],  // сүүлийн 50
//     canManage: boolean                         // = isOwner (QPay төлөх, үнийн санал илгээх)
//   }
//   Алдаа: 401.

import { jsonOk, requireApiUser } from "@/lib/api";
import type { Plan } from "@/app/generated/prisma/enums";
import { MODULE_LIMIT_CODES, PLAN_LIMIT_META } from "@/lib/plan-limits";
import { planFeatureLines } from "@/lib/plan-modules";
import { getEnabledModules } from "@/lib/plan-modules-server";
import { prisma } from "@/lib/prisma";
import { BILLING_PERIOD_LABEL, SELF_SERVE_PLANS } from "@/lib/subscription";
import { toSubscriptionQPayPaymentDto } from "@/lib/subscription-payments";
import { getSubscriptionState } from "@/lib/subscription-server";

const PLANS: Plan[] = ["FREE", "BUSINESS", "ENTERPRISE"];

/**
 * GET /api/v1/subscription — нэвтэрсэн ажилтны тенантын одоогийн багцын төлөв,
 * нээлттэй модулиуд (апп багцад ороогүй дэлгэцийг нуух), сунгах үнэ, хүлээгдэж
 * буй QPay төлбөр.
 */
export async function GET(req: Request) {
  const auth = await requireApiUser(req);
  if (auth.response) return auth.response;
  const { tenantId, isOwner } = auth.user;

  const [state, tenant, prices, pending, payments] = await Promise.all([
    getSubscriptionState(tenantId),
    prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { plan: true },
    }),
    // Зөвхөн тогтсон үнэтэй (QPay-ээр авах) багцууд — ENTERPRISE тохиролцоно.
    prisma.planPrice.findMany({
      where: { isActive: true, plan: { in: [...SELF_SERVE_PLANS] } },
      orderBy: [{ plan: "asc" }, { period: "asc" }],
    }),
    isOwner
      ? prisma.subscriptionPayment.findFirst({
          where: { tenantId, status: "PENDING" },
          orderBy: { createdAt: "desc" },
          select: {
            id: true,
            plan: true,
            period: true,
            amount: true,
            currency: true,
            qrImage: true,
            qrText: true,
            qpayUrls: true,
            createdAt: true,
          },
        })
      : Promise.resolve(null),
    prisma.subscriptionPayment.findMany({
      where: { tenantId },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: { id: true, plan: true, period: true, amount: true, method: true, status: true, createdAt: true, paidAt: true },
    }),
  ]);

  const plan = tenant?.plan ?? state.active?.subscription.plan ?? "FREE";
  const planModuleSets = await Promise.all(PLANS.map((p) => getEnabledModules(p)));
  const modulesByPlan = Object.fromEntries(
    PLANS.map((p, i) => [p, MODULE_LIMIT_CODES.filter((c) => planModuleSets[i]!.has(c))]),
  ) as Record<Plan, string[]>;

  return jsonOk({
    plan,
    // Төлбөртэй subscription-гүй = үнэгүй FREE багц, хугацаагүй идэвхтэй.
    status: state.active?.subscription.status ?? "ACTIVE",
    locked: state.locked,
    isTrial: state.active?.isTrial ?? false,
    daysLeft: Number.isFinite(state.active?.daysLeft ?? NaN)
      ? state.active!.daysLeft
      : null,
    expiresAt: state.active?.expiresAt ?? null,
    expiringSoon: state.expiringSoon,
    warnDays: state.warnDays,
    hasPendingPayment: state.hasPendingPayment,
    modules: modulesByPlan[plan],
    moduleCatalog: MODULE_LIMIT_CODES.map((code) => ({
      code,
      label: PLAN_LIMIT_META[code].label,
      description: PLAN_LIMIT_META[code].description,
    })),
    planModules: modulesByPlan,
    prices: prices.map((p) => ({
      id: p.id,
      plan: p.plan,
      period: p.period,
      periodLabel: BILLING_PERIOD_LABEL[p.period],
      amount: p.amount.toString(),
      currency: p.currency,
      notes: p.notes,
      features: planFeatureLines(planModuleSets[PLANS.indexOf(p.plan)]!),
    })),
    pendingPayment: pending ? toSubscriptionQPayPaymentDto(pending) : null,
    payments: payments.map((p) => ({ ...p, amount: p.amount.toString() })),
    canManage: isOwner,
  });
}
