import { requireUser } from "@/lib/auth";
import { formatTugrik } from "@/lib/orders";
import { prisma } from "@/lib/prisma";
import type { QPayBankUrl } from "@/lib/qpay";
import {
  PLAN_LABEL,
  SUBSCRIPTION_STATUS_BADGE,
  SUBSCRIPTION_STATUS_LABEL,
  formatDaysLeft,
  resolveActiveSubscription,
  BILLING_PERIOD_LABEL,
  SUBSCRIPTION_PAYMENT_METHOD_LABEL,
  SUBSCRIPTION_PAYMENT_STATUS_BADGE,
  SUBSCRIPTION_PAYMENT_STATUS_LABEL,
  SELF_SERVE_PLANS,
} from "@/lib/subscription";
import { planFeatureLines } from "@/lib/plan-modules";
import { getEnabledModules } from "@/lib/plan-modules-server";
import { PlanCheckout } from "./plan-checkout";

export const metadata = {
  title: "Багц / Subscription",
};

function fmtDate(d: Date | null | undefined): string {
  if (!d) return "—";
  return d.toLocaleString("mn-MN", { hour12: false });
}

export default async function SubscriptionPage() {
  const user = await requireUser();
  const isOwner = user.isOwner;

  const [subscriptions, planPrices, pendingPayment, payments, businessModules] = await Promise.all([
    prisma.subscription.findMany({
      where: { tenantId: user.tenantId },
      orderBy: { createdAt: "desc" },
      include: {
        createdBy: { select: { firstName: true, lastName: true, email: true } },
      },
    }),
    // Зөвхөн тогтсон үнэтэй (QPay-ээр авах) багцууд — ENTERPRISE тохиролцоно.
    prisma.planPrice.findMany({
      where: { isActive: true, plan: { in: [...SELF_SERVE_PLANS] } },
      orderBy: [{ plan: "asc" }, { period: "asc" }],
    }),
    prisma.subscriptionPayment.findFirst({
      where: { tenantId: user.tenantId, status: "PENDING" },
      orderBy: { createdAt: "desc" },
    }),
    // Төлбөрийн түүх (QPay нэхэмжлэл, гараар баталгаажуулсан) — сүүлийн 50.
    prisma.subscriptionPayment.findMany({
      where: { tenantId: user.tenantId },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: { id: true, plan: true, period: true, amount: true, method: true, status: true, createdAt: true, paidAt: true },
    }),
    // QPay-ээр авах багц (BUSINESS)-ийн модулиуд — картын «юу багтсан» жагсаалт.
    getEnabledModules("BUSINESS"),
  ]);

  const active = resolveActiveSubscription(
    subscriptions.map((s) => ({
      id: s.id,
      plan: s.plan,
      status: s.status,
      startsAt: s.startsAt,
      endsAt: s.endsAt,
    })),
  );

  return (
    <div className="p-4 sm:p-6 max-w-full flex-1 flex flex-col min-h-0 w-full">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-[var(--oc-ink)]">Багц / Subscription</h1>
        <p className="text-sm text-[var(--oc-muted3)] mt-1">
          Тенантынхаа багц, хугацаа, төлбөрийн түүх.
        </p>
      </div>

      <div className="grid gap-6">
        {isOwner ? (
          <section className="rounded-[10px] border border-[var(--oc-line)] bg-[var(--oc-panel)] p-5 sm:p-6">
            <h2 className="font-semibold text-[var(--oc-ink)] mb-1">
              {pendingPayment ? "QPay төлбөр" : "Багц ахиулах / сунгах"}
            </h2>
            <p className="text-xs text-[var(--oc-muted3)] mb-5">
              {pendingPayment
                ? "QR-аар төлсний дараа багц автоматаар идэвхжинэ."
                : "Бизнес багцыг сонгож QPay-ээр төлнө үү. Хугацаа дуусахад үнэгүй FREE багц руу шилжинэ."}
            </p>
            <PlanCheckout
              prices={planPrices.map((p) => ({
                id: p.id,
                plan: p.plan,
                period: p.period,
                amount: p.amount.toString(),
                currency: p.currency,
                notes: p.notes,
                features: planFeatureLines(businessModules),
              }))}
              pending={
                pendingPayment
                  ? {
                      id: pendingPayment.id,
                      qrImage: pendingPayment.qrImage,
                      urls: Array.isArray(pendingPayment.qpayUrls)
                        ? (pendingPayment.qpayUrls as unknown as QPayBankUrl[])
                        : [],
                      amount: pendingPayment.amount.toString(),
                      currency: pendingPayment.currency,
                      plan: pendingPayment.plan,
                      period: pendingPayment.period,
                    }
                  : null
              }
            />
          </section>
        ) : null}

        <section className="rounded-[10px] border border-[var(--oc-line)] bg-[var(--oc-panel)] p-5 sm:p-6">
          <h2 className="font-semibold text-[var(--oc-ink)] mb-4">Одоогийн төлөв</h2>
          {active ? (
            <div className="grid gap-4 sm:grid-cols-3">
              <div>
                <div className="text-xs text-[var(--oc-muted3)]">Багц</div>
                <div className="mt-1 text-lg font-semibold text-[var(--oc-ink)]">
                  {PLAN_LABEL[active.subscription.plan]}
                </div>
              </div>
              <div>
                <div className="text-xs text-[var(--oc-muted3)]">Статус</div>
                <div className="mt-1">
                  <span
                    className={`text-xs px-2.5 py-1 rounded-full ${SUBSCRIPTION_STATUS_BADGE[active.subscription.status]}`}
                  >
                    {SUBSCRIPTION_STATUS_LABEL[active.subscription.status]}
                  </span>
                </div>
              </div>
              <div>
                <div className="text-xs text-[var(--oc-muted3)]">Хугацаа</div>
                <div className="mt-1 text-sm text-[var(--oc-ink2)]">
                  {active.expiresAt ? (
                    <>
                      {fmtDate(active.expiresAt)}
                      <div className="text-xs text-[var(--oc-muted3)]">
                        {formatDaysLeft(active.daysLeft)}
                      </div>
                    </>
                  ) : (
                    "—"
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-3">
              <div>
                <div className="text-xs text-[var(--oc-muted3)]">Багц</div>
                <div className="mt-1 text-lg font-semibold text-[var(--oc-ink)]">
                  {/* Subscription-гүй үед tenant.plan-ыг харуулна (ихэвчлэн FREE;
                      super admin гараар тавьсан багц ч байж болно). */}
                  {PLAN_LABEL[user.tenant.plan]}
                </div>
              </div>
              <div>
                <div className="text-xs text-[var(--oc-muted3)]">Статус</div>
                <div className="mt-1">
                  <span className={`text-xs px-2.5 py-1 rounded-full ${SUBSCRIPTION_STATUS_BADGE.ACTIVE}`}>
                    {user.tenant.plan === "FREE" ? "Үнэгүй" : SUBSCRIPTION_STATUS_LABEL.ACTIVE}
                  </span>
                </div>
              </div>
              <div>
                <div className="text-xs text-[var(--oc-muted3)]">Хугацаа</div>
                <div className="mt-1 text-sm text-[var(--oc-ink2)]">Хугацаагүй</div>
              </div>
            </div>
          )}
        </section>

        <section className="rounded-[10px] border border-[var(--oc-line)] bg-[var(--oc-panel)] overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--oc-line)]">
            <div>
              <h2 className="font-semibold text-[var(--oc-ink)]">Түүх</h2>
              <p className="text-xs text-[var(--oc-muted3)] mt-0.5">
                Нийт {subscriptions.length} бичлэг
              </p>
            </div>
          </div>
          {subscriptions.length === 0 ? (
            <div className="px-5 py-10 text-center text-sm text-[var(--oc-muted3)]">
              Subscription түүх алга.
            </div>
          ) : (
            <div className="overflow-auto">
              <table className="w-full min-w-[720px]">
                <thead>
                  <tr className="border-b border-[var(--oc-line)]">
                    {[
                      "Багц",
                      "Статус",
                      "Эхэлсэн",
                      "Дуусах",
                      "Дүн",
                      "Тэмдэглэл",
                      "Үүсгэсэн",
                    ].map((h) => (
                      <th
                        key={h}
                        className="text-left font-plex-mono text-[10.5px] uppercase tracking-[0.08em] text-[var(--oc-muted3)] font-medium px-5 py-3"
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--oc-line)]">
                  {subscriptions.map((s) => (
                    <tr
                      key={s.id}
                      className="hover:bg-white/[0.02] transition-colors"
                    >
                      <td className="px-5 py-3 text-sm text-[var(--oc-ink)]">
                        {PLAN_LABEL[s.plan]}
                      </td>
                      <td className="px-5 py-3">
                        <span
                          className={`text-xs px-2 py-0.5 rounded-full ${SUBSCRIPTION_STATUS_BADGE[s.status]}`}
                        >
                          {SUBSCRIPTION_STATUS_LABEL[s.status]}
                        </span>
                      </td>
                      <td className="px-5 py-3 font-plex-mono text-xs text-[var(--oc-muted2)]">
                        {fmtDate(s.startsAt)}
                      </td>
                      <td className="px-5 py-3 font-plex-mono text-xs text-[var(--oc-muted2)]">
                        {fmtDate(s.endsAt)}
                      </td>
                      <td className="px-5 py-3 font-plex-mono text-xs text-[var(--oc-ink2)]">
                        {formatTugrik(s.amount?.toString())}
                      </td>
                      <td className="px-5 py-3 text-xs text-[var(--oc-muted3)] max-w-[260px]">
                        {s.notes ?? "—"}
                      </td>
                      <td className="px-5 py-3 text-xs text-[var(--oc-muted4)]">
                        {s.createdBy
                          ? `${s.createdBy.firstName} ${s.createdBy.lastName}`
                          : "Систем"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="rounded-[10px] border border-[var(--oc-line)] bg-[var(--oc-panel)] overflow-hidden">
          <div className="px-5 py-4 border-b border-[var(--oc-line)]">
            <h2 className="font-semibold text-[var(--oc-ink)]">Төлбөрийн түүх</h2>
            <p className="text-xs text-[var(--oc-muted3)] mt-0.5">
              Багцын төлбөрийн нэхэмжлэл, төлөлт{payments.length === 50 ? " · сүүлийн 50" : ` · нийт ${payments.length}`}
            </p>
          </div>
          {payments.length === 0 ? (
            <div className="px-5 py-10 text-center text-sm text-[var(--oc-muted3)]">Төлбөрийн түүх алга.</div>
          ) : (
            <div className="overflow-auto">
              <table className="w-full min-w-[720px]">
                <thead>
                  <tr className="border-b border-[var(--oc-line)]">
                    {["Огноо", "Багц", "Хугацаа", "Дүн", "Арга", "Төлөв", "Төлсөн"].map((h) => (
                      <th
                        key={h}
                        className="text-left font-plex-mono text-[10.5px] uppercase tracking-[0.08em] text-[var(--oc-muted3)] font-medium px-5 py-3"
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--oc-line)]">
                  {payments.map((p) => (
                    <tr key={p.id} className="hover:bg-white/[0.02] transition-colors">
                      <td className="px-5 py-3 font-plex-mono text-xs text-[var(--oc-muted2)]">{fmtDate(p.createdAt)}</td>
                      <td className="px-5 py-3 text-sm text-[var(--oc-ink)]">{PLAN_LABEL[p.plan]}</td>
                      <td className="px-5 py-3 text-xs text-[var(--oc-muted2)]">{BILLING_PERIOD_LABEL[p.period]}</td>
                      <td className="px-5 py-3 font-plex-mono text-xs text-[var(--oc-ink2)]">{formatTugrik(p.amount.toString())}</td>
                      <td className="px-5 py-3 text-xs text-[var(--oc-muted2)]">{SUBSCRIPTION_PAYMENT_METHOD_LABEL[p.method]}</td>
                      <td className="px-5 py-3">
                        <span className={`text-xs px-2 py-0.5 rounded-full ${SUBSCRIPTION_PAYMENT_STATUS_BADGE[p.status]}`}>
                          {SUBSCRIPTION_PAYMENT_STATUS_LABEL[p.status]}
                        </span>
                      </td>
                      <td className="px-5 py-3 font-plex-mono text-xs text-[var(--oc-muted2)]">{fmtDate(p.paidAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
