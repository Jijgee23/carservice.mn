import { notFound } from "next/navigation";
import {
  cancelSubscriptionAction,
  createSubscriptionAction,
  extendSubscriptionAction,
} from "@/app/_actions/system-subscriptions";
import {
  activateTenantAction,
  deleteTenantAction,
  suspendTenantAction,
} from "@/app/_actions/system-tenants";
import { DatePicker } from "@/app/_components/date-picker";
import { PageHeader } from "@/app/_components/page-header";
import { ConfirmForm } from "@/app/_components/confirm-form";
import { requireSuperAdmin } from "@/lib/auth/system";
import { formatTugrik } from "@/lib/orders";
import { prisma } from "@/lib/prisma";
import {
  PLAN_LABEL,
  SUBSCRIPTION_STATUS_BADGE,
  SUBSCRIPTION_STATUS_LABEL,
  formatDaysLeft,
  resolveActiveSubscription,
} from "@/lib/subscription";
import { SubscriptionPaymentCreateForm } from "./subscription-payment-create-form";
import { SubscriptionPaymentRow } from "./subscription-payment-row";

export const metadata = {
  title: "Байгууллагын дэлгэрэнгүй",
};

export default async function SystemTenantDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireSuperAdmin();
  const { id } = await params;

  const tenant = await prisma.tenant.findUnique({
    where: { id },
    include: {
      _count: {
        select: {
          users: true,
          branches: true,
          customers: true,
          tenantVehicles: true,
          services: true,
          serviceOrders: true,
        },
      },
      users: {
        where: { isOwner: true },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          email: true,
          phone: true,
          isOwner: true,
          createdAt: true,
        },
      },
    },
  });

  if (!tenant) notFound();

  const [revenueAgg, subscriptions, subscriptionPayments] = await Promise.all([
    prisma.serviceOrder.aggregate({
      where: { tenantId: tenant.id, status: "COMPLETED", isInternal: false },
      _sum: { totalAmount: true },
      _count: { _all: true },
    }),
    prisma.subscription.findMany({
      where: { tenantId: tenant.id },
      orderBy: { createdAt: "desc" },
      include: {
        createdBy: { select: { firstName: true, lastName: true } },
      },
    }),
    prisma.subscriptionPayment.findMany({
      where: { tenantId: tenant.id },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        plan: true,
        period: true,
        amount: true,
        method: true,
        status: true,
        createdAt: true,
        paidAt: true,
      },
    }),
  ]);
  const revenue = Number.parseFloat(
    revenueAgg._sum.totalAmount?.toString() ?? "0",
  );
  const activeSub = resolveActiveSubscription(
    subscriptions.map((s) => ({
      id: s.id,
      plan: s.plan,
      status: s.status,
      startsAt: s.startsAt,
      endsAt: s.endsAt,
    })),
  );

  const today = new Date();
  const todayISO = today.toISOString().slice(0, 10);

  return (
    <div className="p-6 sm:p-8 max-w-6xl">
      <PageHeader
        title={tenant.name}
        description={`#${tenant.registerNumber} · ${tenant.email}`}
        actions={
          tenant.suspended ? (
            <span className="text-xs px-3 py-1.5 rounded-full bg-[var(--oc-warn)]/15 text-[var(--oc-warn)] border border-[var(--oc-warn)]/25">
              Зогссон
            </span>
          ) : (
            <span className="text-xs px-3 py-1.5 rounded-full bg-emerald-500/15 text-emerald-400 border border-emerald-500/25 light:bg-emerald-100 light:border-emerald-300 light:text-emerald-700">
              Идэвхтэй
            </span>
          )
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 mb-8">
        <BigStat label="Салбар" value={tenant._count.branches} />
        <BigStat label="Ажилтан" value={tenant._count.users} />
        <BigStat label="Үйлчлүүлэгч" value={tenant._count.customers} />
        <BigStat label="Машин" value={tenant._count.tenantVehicles} />
        <BigStat label="Үйлчилгээ" value={tenant._count.services} />
        <BigStat label="Засварын хуудас" value={tenant._count.serviceOrders} />
        <BigStat
          label="Дуусгасан"
          value={revenueAgg._count._all}
          color="text-emerald-400 light:text-emerald-700"
        />
        <BigStat
          label="Орлого"
          value={formatTugrik(revenue)}
          accent
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2 flex flex-col gap-6">
          <section className="rounded-[10px] border border-[var(--oc-line)] bg-[var(--oc-panel)] p-6">
            <h2 className="font-semibold text-[var(--oc-ink)] mb-4">Үндсэн мэдээлэл</h2>
            <dl className="grid sm:grid-cols-2 gap-4 text-sm">
              <Row label="Нэр" value={tenant.name} />
              <Row label="Регистр" value={tenant.registerNumber} />
              <Row label="Slug" value={tenant.slug} mono />
              <Row label="Багц" value={tenant.plan} />
              <Row label="Gmail" value={tenant.email} />
              <Row label="Утас 1" value={tenant.phone1} />
              {tenant.phone2 ? (
                <Row label="Утас 2" value={tenant.phone2} />
              ) : null}
              <Row
                label="Бүртгүүлсэн"
                value={tenant.createdAt.toLocaleString("mn-MN", { hour12: false })}
              />
            </dl>
          </section>

          <section className="rounded-[10px] border border-[var(--oc-line)] bg-[var(--oc-panel)] overflow-hidden">
            <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--oc-line2)]">
              <div>
                <h2 className="font-semibold text-[var(--oc-ink)]">Subscription түүх</h2>
                <p className="text-xs text-[var(--oc-muted3)] mt-0.5">
                  Нийт {subscriptions.length} бичлэг
                </p>
              </div>
            </div>
            {subscriptions.length === 0 ? (
              <div className="px-6 py-8 text-sm text-[var(--oc-muted3)] text-center">
                Subscription түүх алга.
              </div>
            ) : (
              <div className="overflow-auto">
                <table className="w-full min-w-[680px]">
                  <thead>
                    <tr className="border-b border-[var(--oc-line2)]">
                      {[
                        "Багц",
                        "Статус",
                        "Эхэлсэн",
                        "Дуусах",
                        "Дүн",
                        "Үүсгэсэн",
                        "",
                      ].map((h) => (
                        <th
                          key={h}
                          className="text-left text-xs text-[var(--oc-muted3)] font-medium px-5 py-3"
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {subscriptions.map((s) => {
                      const canCancel =
                        s.status === "TRIAL" || s.status === "ACTIVE";
                      return (
                        <tr
                          key={s.id}
                          className="border-b border-[var(--oc-line2)] last:border-0"
                        >
                          <td className="px-5 py-3 text-sm text-[var(--oc-ink2)]">
                            {PLAN_LABEL[s.plan]}
                          </td>
                          <td className="px-5 py-3">
                            <span
                              className={`text-xs px-2 py-0.5 rounded-full ${SUBSCRIPTION_STATUS_BADGE[s.status]}`}
                            >
                              {SUBSCRIPTION_STATUS_LABEL[s.status]}
                            </span>
                          </td>
                          <td className="px-5 py-3 text-xs text-[var(--oc-muted)]">
                            {s.startsAt.toLocaleDateString("mn-MN")}
                          </td>
                          <td className="px-5 py-3 text-xs text-[var(--oc-muted)]">
                            {s.endsAt
                              ? s.endsAt.toLocaleDateString("mn-MN")
                              : "—"}
                          </td>
                          <td className="px-5 py-3 text-xs text-[var(--oc-ink2)]">
                            {s.amount
                              ? formatTugrik(s.amount.toString())
                              : "—"}
                          </td>
                          <td className="px-5 py-3 text-xs text-[var(--oc-muted3)]">
                            {s.createdBy
                              ? `${s.createdBy.firstName} ${s.createdBy.lastName}`
                              : "Систем"}
                          </td>
                          <td className="px-5 py-3 text-right">
                            {canCancel ? (
                              <ConfirmForm
                                action={cancelSubscriptionAction}
                                message="Энэ subscription-ийг цуцлах уу?"
                              >
                                <input
                                  type="hidden"
                                  name="id"
                                  value={tenant.id}
                                />
                                <input
                                  type="hidden"
                                  name="subscriptionId"
                                  value={s.id}
                                />
                                <button
                                  type="submit"
                                  className="text-xs text-red-400 hover:text-red-300 light:text-red-600 light:hover:text-red-700 px-2 py-1 rounded-md hover:bg-red-500/10 transition-colors"
                                >
                                  Цуцлах
                                </button>
                              </ConfirmForm>
                            ) : null}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="rounded-[10px] border border-[var(--oc-line)] bg-[var(--oc-panel)] overflow-hidden">
            <div className="px-6 py-4 border-b border-[var(--oc-line2)]">
              <h2 className="font-semibold text-[var(--oc-ink)]">Төлбөрийн бүртгэл</h2>
              <p className="text-xs text-[var(--oc-muted3)] mt-0.5">
                Багцын төлбөр (QPay эсвэл гар аргаар — банк шилжүүлэг, бэлэн) —
                төлөгдсөн эсэхийг тэмдэглэх, түүхийг харах.
              </p>
            </div>
            {subscriptionPayments.length === 0 ? (
              <div className="px-6 py-8 text-sm text-[var(--oc-muted3)] text-center">
                Төлбөрийн бүртгэл алга.
              </div>
            ) : (
              <div className="overflow-auto">
                <table className="w-full min-w-[720px]">
                  <thead>
                    <tr className="border-b border-[var(--oc-line2)]">
                      {[
                        "Багц",
                        "Хугацаа",
                        "Дүн",
                        "Арга",
                        "Төлөв",
                        "Огноо",
                        "",
                      ].map((h) => (
                        <th
                          key={h}
                          className="text-left text-xs text-[var(--oc-muted3)] font-medium px-5 py-3"
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {subscriptionPayments.map((p) => (
                      <SubscriptionPaymentRow
                        key={p.id}
                        payment={{ ...p, amount: p.amount.toString() }}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div className="px-6 py-5 border-t border-[var(--oc-line2)] bg-[var(--oc-panel2)]">
              <h3 className="font-plex-mono text-xs uppercase tracking-[0.1em] text-[var(--oc-muted3)] mb-3">
                Гар аргаар төлбөр бүртгэх
              </h3>
              <SubscriptionPaymentCreateForm
                tenantId={tenant.id}
                defaultPlan={tenant.plan}
              />
            </div>
          </section>

          <section className="rounded-[10px] border border-[var(--oc-line)] bg-[var(--oc-panel)] p-6">
            <h2 className="font-semibold text-[var(--oc-ink)] mb-4">Админ (OWNER)</h2>
            {tenant.users.length === 0 ? (
              <p className="text-sm text-[var(--oc-muted3)]">Админ алга байна.</p>
            ) : (
              <ul className="divide-y divide-[var(--oc-line2)]">
                {tenant.users.map((u) => (
                  <li key={u.id} className="py-3 first:pt-0 last:pb-0">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <div className="text-sm font-medium text-[var(--oc-ink2)]">
                          {u.lastName} {u.firstName}
                        </div>
                        <div className="text-xs text-[var(--oc-muted3)]">
                          {u.email} · {u.phone}
                        </div>
                      </div>
                      <span className="text-xs px-2 py-0.5 rounded-full bg-[var(--oc-accent)]/15 text-[var(--oc-accent)] border border-[var(--oc-accent)]/30">
                        Админ
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <aside className="flex flex-col gap-6">
          <section className="rounded-[10px] border border-[var(--oc-line)] bg-[var(--oc-panel)] p-5">
            <h2 className="font-semibold text-[var(--oc-ink)] mb-1 text-sm">Одоогийн багц</h2>
            {activeSub ? (
              <div className="text-xs text-[var(--oc-muted3)] mb-4">
                <div>
                  <span className="text-[var(--oc-muted)]">
                    {PLAN_LABEL[activeSub.subscription.plan]}
                  </span>{" "}
                  ·{" "}
                  <span
                    className={`px-1.5 py-0.5 rounded ${SUBSCRIPTION_STATUS_BADGE[activeSub.subscription.status]}`}
                  >
                    {SUBSCRIPTION_STATUS_LABEL[activeSub.subscription.status]}
                  </span>
                </div>
                {activeSub.expiresAt ? (
                  <div className="mt-1">
                    {activeSub.expiresAt.toLocaleDateString("mn-MN")} —{" "}
                    {formatDaysLeft(activeSub.daysLeft)}
                  </div>
                ) : null}
              </div>
            ) : (
              <p className="text-xs text-[var(--oc-muted3)] mb-4">Идэвхтэй багц алга.</p>
            )}

            {activeSub ? (
              <ConfirmForm enabled={false} message=""
                action={extendSubscriptionAction}
                className="flex items-center gap-2 mb-4"
              >
                <input type="hidden" name="id" value={tenant.id} />
                <input
                  type="hidden"
                  name="subscriptionId"
                  value={activeSub.subscription.id}
                />
                <input
                  type="number"
                  name="addDays"
                  min={1}
                  defaultValue={14}
                  className="auth-input !py-1.5 !text-sm w-20"
                />
                <span className="text-xs text-[var(--oc-muted3)]">хоног</span>
                <button
                  type="submit"
                  className="text-xs bg-[var(--oc-panel2)] hover:bg-white/[0.08] border border-[var(--oc-line)] px-3 py-1.5 rounded-lg transition-colors text-[var(--oc-ink2)]"
                >
                  Сунгах
                </button>
              </ConfirmForm>
            ) : null}

            <h3 className="font-plex-mono text-xs uppercase tracking-[0.1em] text-[var(--oc-muted3)] mb-2">
              Шинэ subscription
            </h3>
            <form action={createSubscriptionAction} className="space-y-2">
              <input type="hidden" name="id" value={tenant.id} />
              <div className="grid grid-cols-2 gap-2">
                <select
                  name="plan"
                  defaultValue={tenant.plan}
                  className="auth-input !py-2 !text-sm"
                >
                  <option value="FREE" className="bg-[var(--surface)]">
                    FREE
                  </option>
                  <option value="BUSINESS" className="bg-[var(--surface)]">
                    BUSINESS
                  </option>
                  <option value="ENTERPRISE" className="bg-[var(--surface)]">
                    ENTERPRISE
                  </option>
                </select>
                <select
                  name="status"
                  defaultValue="ACTIVE"
                  className="auth-input !py-2 !text-sm"
                >
                  <option value="ACTIVE" className="bg-[var(--surface)]">
                    ACTIVE
                  </option>
                  <option value="TRIAL" className="bg-[var(--surface)]">
                    TRIAL
                  </option>
                </select>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="text-[10px] text-[var(--oc-muted3)]">
                  Эхэлсэн
                  <DatePicker
                    name="startsAt"
                    defaultValue={todayISO}
                    className="mt-1"
                  />
                </div>
                <div className="text-[10px] text-[var(--oc-muted3)]">
                  Дуусах
                  <DatePicker name="endsAt" className="mt-1" />
                </div>
              </div>
              <input
                type="text"
                name="amount"
                inputMode="decimal"
                placeholder="Дүн (заавал биш)"
                className="auth-input !py-2 !text-sm"
              />
              <textarea
                name="notes"
                rows={2}
                placeholder="Тэмдэглэл (заавал биш)"
                className="auth-input resize-none !py-2 !text-sm"
              />
              <button
                type="submit"
                className="w-full bg-[var(--oc-accent)] hover:bg-[var(--oc-accent-hi)] text-[var(--oc-on-accent)] transition-colors py-2 rounded-xl text-sm font-medium"
              >
                Subscription нэмэх
              </button>
            </form>
          </section>

          {tenant.suspended ? (
            <form
              action={activateTenantAction}
              className="rounded-[10px] border border-emerald-500/20 bg-[var(--oc-panel)] p-5"
            >
              <h2 className="font-semibold mb-1 text-sm text-emerald-300 light:text-emerald-700">
                Сэргээх
              </h2>
              <p className="text-xs text-[var(--oc-muted3)] mb-4">
                Хэрэглэгчид нэвтэрч чадахгүй байна.
              </p>
              <input type="hidden" name="id" value={tenant.id} />
              <button
                type="submit"
                className="w-full bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-300 border border-emerald-500/30 transition-colors py-2.5 rounded-xl text-sm font-medium light:bg-emerald-100 light:hover:bg-emerald-200 light:border-emerald-300 light:text-emerald-700"
              >
                Идэвхжүүлэх
              </button>
            </form>
          ) : (
            <ConfirmForm
              action={suspendTenantAction}
              className="rounded-[10px] border border-[var(--oc-warn)]/20 bg-[var(--oc-panel)] p-5"
              message="Энэ байгууллагыг түр зогсоох уу? Хэрэглэгчид нэвтэрч чадахгүй болно."
            >
              <h2 className="font-semibold mb-1 text-sm text-[var(--oc-warn)]">
                Түр зогсоох
              </h2>
              <p className="text-xs text-[var(--oc-muted3)] mb-4">
                Үйлчлүүлэгчид нэвтэрч чадахгүй болно. Өгөгдөл хадгалагдсаар үлдэнэ.
              </p>
              <input type="hidden" name="id" value={tenant.id} />
              <button
                type="submit"
                className="w-full bg-[var(--oc-warn)]/15 hover:bg-[var(--oc-warn)]/25 text-[var(--oc-warn)] border border-[var(--oc-warn)]/30 transition-colors py-2.5 rounded-xl text-sm font-medium"
              >
                Зогсоох
              </button>
            </ConfirmForm>
          )}

          <ConfirmForm
            title="Байгууллагыг бүрмөсөн устгах"
            message={`«${tenant.name}» болон түүний БҮХ өгөгдөл бүрмөсөн устана. Сэргээх боломжгүй.`}
            confirmLabel="Бүрмөсөн устгах"
            action={deleteTenantAction}
            className="rounded-[10px] border border-red-500/30 bg-[var(--oc-panel)] p-5"
          >
            <h2 className="font-semibold mb-1 text-sm text-red-300 light:text-red-700">
              Бүрэн устгах
            </h2>
            <p className="text-xs text-[var(--oc-muted3)] mb-4">
              БҮХ өгөгдөл (засварын хуудас, машин, сэлбэг, ажилтан) устана.
              Сэргээх боломжгүй. Доор байгууллагын нэрийг бичнэ үү:
            </p>
            <input type="hidden" name="id" value={tenant.id} />
            <input
              type="text"
              name="confirmName"
              required
              placeholder={tenant.name}
              className="auth-input mb-3 !text-xs"
            />
            <button
              type="submit"
              className="w-full bg-red-500/20 hover:bg-red-500/30 text-red-300 border border-red-500/40 transition-colors py-2.5 rounded-xl text-sm font-medium light:bg-red-100 light:hover:bg-red-200 light:border-red-300 light:text-red-700"
            >
              Устгах
            </button>
          </ConfirmForm>
        </aside>
      </div>
    </div>
  );
}

function Row({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div>
      <dt className="text-xs text-[var(--oc-muted3)]">{label}</dt>
      <dd
        className={`mt-0.5 text-[var(--oc-ink2)] ${mono ? "font-mono text-xs" : ""}`}
      >
        {value}
      </dd>
    </div>
  );
}

function BigStat({
  label,
  value,
  accent = false,
  color,
}: {
  label: string;
  value: number | string;
  accent?: boolean;
  color?: string;
}) {
  return (
    <div
      className={`rounded-xl border bg-[var(--oc-panel)] p-4 ${
        accent ? "border-[var(--oc-accent)]/30" : "border-[var(--oc-line)]"
      }`}
    >
      <div
        className={`text-xl font-bold ${
          color ?? (accent ? "text-[var(--oc-accent)]" : "text-[var(--oc-ink)]")
        }`}
      >
        {value}
      </div>
      <div className="text-xs text-[var(--oc-muted3)] mt-1">{label}</div>
    </div>
  );
}
