import { NextResponse } from "next/server";
import { verifyCronSecret } from "@/lib/cron-auth";
import { prisma } from "@/lib/prisma";
import { setBypassContext } from "@/lib/tenant-context";

/**
 * Хугацаа дууссан subscription-уудыг автоматаар EXPIRED болгоно.
 *
 * `endsAt <= now` бөгөөд статус нь TRIAL/ACTIVE байгаа бүх subscription-ыг
 * EXPIRED болгоно. Өөр идэвхтэй төлбөртэй багцгүй болсон тенантын `plan`-ыг
 * FREE болгоно (FREE үргэлж үнэгүй — түгжихгүй, лимит нь л буурна).
 *
 * Мөн PENDING SubscriptionPayment-ийг 30 минутаас илүү уртассан үед CANCELLED
 * болгоно — QPay invoice бүр төгсөж байгааг тэмдэглэхэд хэрэгтэй.
 *
 * Cron шууд гадуурх (Vercel cron, QStash, cron-job.org) дуудна. Bearer secret
 * шалгаж нэвтрэхгүй бол 401.
 *
 * Setup: env-д `CRON_SECRET=<random>` тогтоо. Vercel Cron-аас дуудаж байгаа бол
 * `Authorization: Bearer <CRON_SECRET>` нэмж тавина.
 */
export async function POST(req: Request) {
  return run(req);
}

// GET-ыг бас зөвшөөрөв (зарим cron service зөвхөн GET дэмждэг — secret нь
// GET-д ч Authorization header-ээр ирнэ, URL-ээр биш, S17-аас хойш).
export async function GET(req: Request) {
  return run(req);
}

async function run(req: Request) {
  const denied = verifyCronSecret(req);
  if (denied) return denied;
  // Бүх tenant дундуур bulk update хийдэг cron тул RLS-г тойрч гарна.
  setBypassContext();

  const now = new Date();

  // EXPIRED болох гэж буй subscription-уудын тенантууд — доор FREE рүү буулгана.
  const expiringTenantIds = (
    await prisma.subscription.findMany({
      where: { status: { in: ["TRIAL", "ACTIVE"] }, endsAt: { lte: now } },
      select: { tenantId: true },
      distinct: ["tenantId"],
    })
  ).map((s) => s.tenantId);

  const [expiredSubs, expiredPayments] = await Promise.all([
    prisma.subscription.updateMany({
      where: {
        status: { in: ["TRIAL", "ACTIVE"] },
        endsAt: { lte: now },
      },
      data: { status: "EXPIRED" },
    }),
    prisma.subscriptionPayment.updateMany({
      where: {
        status: "PENDING",
        createdAt: { lte: new Date(now.getTime() - 30 * 60 * 1000) },
      },
      data: { status: "CANCELLED" },
    }),
  ]);

  // Төлбөртэй багц дууссан ба өөр идэвхтэй төлбөртэй багцгүй тенантыг FREE
  // рүү буулгана — түгжихгүй, зөвхөн лимит нь FREE-ийнх болно. Зөвхөн энэ
  // удаа subscription нь дууссан тенантуудад хамаарна (super admin-ий
  // subscription-гүйгээр гараар тавьсан багцад хүрэхгүй).
  const downgraded =
    expiringTenantIds.length === 0
      ? { count: 0 }
      : await prisma.tenant.updateMany({
          where: {
            id: { in: expiringTenantIds },
            plan: { not: "FREE" },
            subscriptions: {
              none: {
                plan: { not: "FREE" },
                status: { in: ["TRIAL", "ACTIVE"] },
                startsAt: { lte: now },
                OR: [{ endsAt: null }, { endsAt: { gt: now } }],
              },
            },
          },
          data: { plan: "FREE" },
        });

  return NextResponse.json({
    ok: true,
    expiredSubscriptions: expiredSubs.count,
    downgradedToFree: downgraded.count,
    cancelledPendingPayments: expiredPayments.count,
    ranAt: now.toISOString(),
  });
}
