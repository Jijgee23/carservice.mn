import Link from "next/link";
import type { ReactNode } from "react";
import { requireUser } from "@/lib/auth";
import { canCreate, userRoleLabel } from "@/lib/auth/roles";
import {
  ORDER_PAYMENT_METHOD_LABEL,
  ORDER_STATUS_BADGE,
  ORDER_STATUS_LABEL,
  INTERNAL_COST_LABEL,
  formatTugrik,
  type OrderStatus,
} from "@/lib/orders";
import { APPOINTMENT_STATUS_BADGE, APPOINTMENT_STATUS_LABEL } from "@/lib/appointments";
import { customerLabel } from "@/lib/customers";
import { DatePicker } from "@/app/_components/date-picker";
import { Sparkline } from "@/app/_components/sparkline";
import { IncomeBarChart } from "./income-bar-chart";
import { CashOverview } from "./cash-overview";
import { type Trend, loadOverviewData } from "@/lib/overview";
import { loadDashboardFocus, type DashboardFocus } from "@/lib/dashboard-focus";
import { INCOME_QUICK_RANGES, type IncomeRangeKey } from "./income-range";
import { formatDaysLeft } from "@/lib/subscription";
import type { AppointmentStatus } from "@/app/generated/prisma/client";

export const metadata = {
  title: "Хяналтын самбар",
};

const TZ = "Asia/Ulaanbaatar";
/** Багцын хугацаа дуусахаас өмнө анхааруулах хоног. */
const SUBSCRIPTION_WARN_DAYS = 14;

function incomeRangeHref(key: IncomeRangeKey): string {
  return key === "week" ? "/dashboard" : `/dashboard?range=${key}`;
}

function fmtTime(d: Date): string {
  return d.toLocaleTimeString("mn-MN", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false });
}

function fmtShortDateTime(d: Date): string {
  return d.toLocaleString("mn-MN", {
    timeZone: TZ,
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

type AttentionItem = {
  key: string;
  count: number;
  label: string;
  hint: string;
  href: string;
  tone: "danger" | "warn" | "accent";
};

function attentionItems(focus: DashboardFocus): AttentionItem[] {
  const { orders, appointments, reviews, access } = focus;
  const items: AttentionItem[] = [];
  if (access.orders) {
    items.push(
      {
        key: "overdue",
        count: orders.overdue,
        label: "Хугацаа хэтэрсэн ажил",
        hint: "Дуусах хугацаа өнгөрсөн",
        href: "/dashboard/orders/in-progress",
        tone: "danger",
      },
      {
        key: "ready",
        count: orders.ready,
        label: "Дуусгахад бэлэн",
        hint: "Бүх ажил дууссан — хуудсаа хаана уу",
        href: "/dashboard/orders/in-progress",
        tone: "accent",
      },
    );
  }
  if (access.appointments) {
    items.push({
      key: "pending",
      count: appointments.pending,
      label: "Хариу хүлээж буй цаг",
      hint: "Онлайн захиалгыг баталгаажуулна уу",
      href: "/dashboard/appointments?status=PENDING",
      tone: "warn",
    });
  }
  if (access.orders) {
    items.push(
      {
        key: "stale",
        count: orders.staleScheduled,
        label: "Эхлээгүй хоцорсон хуудас",
        hint: "Товлосон өдөр өнгөрсөн",
        href: "/dashboard/orders?status=SCHEDULED",
        tone: "warn",
      },
      {
        key: "diagnostics",
        count: orders.unfilledDiagnostics,
        label: "Бөглөөгүй оношилгоо",
        hint: "Хийгдэж буй хуудаснууд дээр",
        href: "/dashboard/orders?status=IN_PROGRESS",
        tone: "warn",
      },
      {
        key: "unpaid",
        count: orders.receivable.count,
        label: "Төлөгдөөгүй хуудас",
        hint: `Нийт ${formatTugrik(orders.receivable.total.toString())}`,
        href: "/dashboard/orders?unpaid=1",
        tone: "warn",
      },
    );
  }
  if (access.reviews) {
    items.push({
      key: "reviews",
      count: reviews.unreplied,
      label: "Хариулаагүй үнэлгээ",
      hint: "Үйлчлүүлэгчийн сэтгэгдэлд хариулна уу",
      href: "/dashboard/reviews",
      tone: "accent",
    });
  }
  return items.filter((i) => i.count > 0);
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string; from?: string; to?: string }>;
}) {
  const user = await requireUser();
  const params = await searchParams;

  const [overview, focus] = await Promise.all([
    loadOverviewData({ ...user, orderAccess: user }, params),
    loadDashboardFocus(user),
  ]);
  const {
    incomeRange,
    branchCount,
    employeeCount,
    customerCount,
    vehicleCount,
    activeSub,
    recentlyUpdatedOrders,
    income,
    internalCost,
    orderTrend,
    completedTrend,
  } = overview;
  const incomeUp = income.changePct == null ? true : income.changePct >= 0;
  const attention = attentionItems(focus);
  const today = new Intl.DateTimeFormat("mn-MN", {
    timeZone: TZ,
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "long",
  }).format(new Date());
  const subscriptionWarn =
    activeSub?.expiresAt && activeSub.daysLeft <= SUBSCRIPTION_WARN_DAYS ? activeSub : null;
  const { orders, appointments, payments, reviews, access } = focus;
  const openOrders = orders.scheduled + orders.inProgress;

  return (
    <div className="p-4 sm:p-6 flex flex-col gap-6">
      {/* Толгой: мэндчилгээ + үндсэн үйлдлүүд */}
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <p className="font-plex-mono text-[11px] uppercase tracking-[0.12em] text-[var(--oc-muted3)]">{today}</p>
          <h1 className="mt-1 text-2xl font-semibold text-[var(--oc-ink)]">Сайн байна уу, {user.firstName}!</h1>
          <p className="mt-0.5 text-sm text-[var(--oc-muted3)]">
            {user.tenant.name} · {userRoleLabel(user)}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {canCreate(user, "appointments") ? (
            <Link
              href="/dashboard/appointments/new"
              className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--oc-line)] px-3.5 py-2 text-sm font-medium text-[var(--oc-ink2)] transition-colors hover:border-[var(--oc-line2)] hover:text-[var(--oc-ink)]"
            >
              + Цаг захиалга
            </Link>
          ) : null}
          {canCreate(user, "orders") ? (
            <Link
              href="/dashboard/orders/new"
              className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--oc-accent)] px-3.5 py-2 text-sm font-semibold text-[var(--oc-on-accent)] transition-colors hover:bg-[var(--oc-accent-hi)]"
            >
              + Засварын хуудас
            </Link>
          ) : null}
        </div>
      </header>

      {subscriptionWarn ? (
        <Link
          href="/dashboard/settings/subscription"
          className="flex flex-wrap items-center justify-between gap-2 rounded-[10px] border border-[var(--oc-warn)]/30 bg-[var(--oc-warn)]/[0.08] px-4 py-3 text-sm transition-colors hover:bg-[var(--oc-warn)]/[0.12]"
        >
          <span className="text-[var(--oc-ink2)]">
            Багцын хугацаа{" "}
            <strong className="text-[var(--oc-warn)]">{formatDaysLeft(subscriptionWarn.daysLeft)}</strong>{" "}
            ({subscriptionWarn.expiresAt?.toLocaleDateString("mn-MN", { timeZone: TZ })})
          </span>
          <span className="font-medium text-[var(--oc-warn)]">Багц сунгах →</span>
        </Link>
      ) : null}

      {/* Анхаарах */}
      <section aria-labelledby="attention-title">
        <h2 id="attention-title" className="sr-only">
          Анхаарах
        </h2>
        {attention.length === 0 ? (
          <div className="flex items-center gap-3 rounded-[10px] border border-[var(--oc-ok)]/25 bg-[var(--oc-ok)]/[0.07] px-4 py-3 text-sm">
            <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-[var(--oc-ok)]/20 text-[var(--oc-ok)]">✓</span>
            <span className="text-[var(--oc-ink2)]">Анхаарах зүйл алга — бүх ажил хэвийн явж байна.</span>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {attention.map((a) => (
              <AttentionCard key={a.key} item={a} />
            ))}
          </div>
        )}
      </section>

      {/* Гол үзүүлэлтүүд */}
      <section aria-label="Гол үзүүлэлтүүд" className="grid grid-cols-2 gap-3 md:grid-cols-3 2xl:grid-cols-6">
        {access.orders ? (
          <>
            <Kpi
              label="Идэвхтэй хуудас"
              value={openOrders.toLocaleString("mn-MN")}
              sub={`${orders.inProgress} хийгдэж буй · ${orders.scheduled} товлосон`}
              href="/dashboard/orders"
              trend={orderTrend}
            />
            <Kpi
              label="Өнөөдөр нээсэн"
              value={orders.createdToday.toLocaleString("mn-MN")}
              sub="шинэ засварын хуудас"
              href="/dashboard/orders"
            />
            <Kpi
              label="Энэ сар дуусгасан"
              value={orders.monthCompleted.toLocaleString("mn-MN")}
              sub={
                orders.monthAverage
                  ? `Дундаж ${formatTugrik(orders.monthAverage.toFixed(0))}`
                  : "Дундаж дүн —"
              }
              href="/dashboard/orders?status=COMPLETED"
              trend={completedTrend}
            />
          </>
        ) : null}
        {access.payments ? (
          <Kpi
            label="Өнөөдөр хүлээн авсан"
            value={formatTugrik(payments.total.toString())}
            sub={`${payments.count} төлбөр`}
            tone="ok"
          />
        ) : null}
        {access.orders ? (
          <Kpi
            label="Авлага"
            value={formatTugrik(orders.receivable.total.toString())}
            sub={`${orders.receivable.count} хуудас төлөгдөөгүй`}
            href="/dashboard/orders?unpaid=1"
            tone={orders.receivable.total.gt(0) ? "warn" : undefined}
          />
        ) : null}
        {access.reviews ? (
          <Kpi
            label="Үйлчлүүлэгчийн үнэлгээ"
            value={reviews.average != null ? `★ ${reviews.average.toFixed(1)}` : "—"}
            sub={`${reviews.count} үнэлгээ`}
            href="/dashboard/reviews"
          />
        ) : null}
      </section>

      {/* Өнөөдөр + мөнгө */}
      <section className="grid gap-6 lg:grid-cols-3">
        <div className="flex min-w-0 flex-col gap-6 lg:col-span-2">
          {access.appointments ? <TodayAppointments items={appointments.today} /> : null}
          {access.orders ? <WorkInProgress focus={focus} /> : null}
        </div>
        <div className="flex min-w-0 flex-col gap-6">
          <CashOverview user={user} compact />
          {access.payments ? <PaymentsToday focus={focus} /> : null}
          {access.orders && orders.receivable.count > 0 ? <ReceivableAgingCard focus={focus} /> : null}
        </div>
      </section>

      {/* Гүйцэтгэлийн орлого */}
      <section className="rounded-[10px] border border-[var(--oc-line)] bg-[var(--oc-panel)] p-4 sm:p-6 lg:p-8">
        <div className="flex flex-wrap items-start justify-between gap-4 mb-5">
          <div>
            <h2 className="font-semibold text-[var(--oc-ink)] mb-1">Гүйцэтгэлийн орлого</h2>
            <p className="text-xs text-[var(--oc-muted3)]">
              {incomeRange.label} · дууссан засварын хуудсын дүн (хүлээн авсан мөнгө биш)
            </p>
          </div>
          <div className="text-right">
            <div className="font-plex-mono text-2xl sm:text-3xl font-semibold text-[var(--oc-ink)] leading-none">
              {formatTugrik(income.total)}
            </div>
            {income.changePct != null ? (
              <div
                title="Өмнөх ижил урттай үетэй харьцуулав"
                className={`mt-1.5 inline-flex items-center gap-1 font-plex-mono text-xs font-medium px-2 py-0.5 rounded-full ${incomeUp
                  ? "bg-[var(--oc-ok)]/15 text-[var(--oc-ok)]"
                  : "bg-red-500/15 text-red-300 light:text-red-700"
                  }`}
              >
                <span>{incomeUp ? "▲" : "▼"}</span>
                <span className="tabular-nums">
                  {Math.abs(income.changePct).toFixed(1)}%
                </span>
                <span className="text-[var(--oc-muted3)]">өмнөх үе</span>
              </div>
            ) : null}
            <div
              title="Дотоод засварын дүн орлогод орохгүй"
              className="mt-2 text-xs text-[var(--oc-muted3)]"
            >
              {INTERNAL_COST_LABEL}:{" "}
              <span className="font-plex-mono text-[var(--oc-ink2)]">
                {formatTugrik(internalCost.toString())}
              </span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap mb-6">
          {INCOME_QUICK_RANGES.map((q) => {
            const active = incomeRange.key === q.key;
            return (
              <Link
                key={q.key}
                href={incomeRangeHref(q.key)}
                className={`text-xs px-3 py-1.5 rounded-lg transition-colors ${active
                  ? "bg-[var(--oc-accent)]/15 text-[var(--oc-accent)] border border-[var(--oc-accent)]/30"
                  : "text-[var(--oc-muted3)] hover:text-[var(--oc-ink2)] border border-[var(--oc-line)] hover:border-[var(--oc-line2)]"
                  }`}
              >
                {q.label}
              </Link>
            );
          })}

          <form
            className="flex flex-col sm:flex-row sm:ml-auto items-stretch sm:items-center gap-2 w-full sm:w-auto"
            action="/dashboard"
          >
            <DatePicker
              mode="range"
              fromName="from"
              toName="to"
              defaultValue={{ from: params.from ?? "", to: params.to ?? "" }}
              className="w-full sm:w-[15rem]"
            />
            <button
              type="submit"
              className="text-xs bg-[var(--oc-accent)] hover:bg-[var(--oc-accent-hi)] transition-colors px-5 py-3 text-left text-sm rounded-lg font-medium text-[var(--oc-on-accent)] shrink-0 w-full sm:w-auto"
            >
              Шүүх
            </button>
          </form>
        </div>

        <IncomeBarChart points={income.points} />
      </section>

      {/* Сүүлд шинэчлэгдсэн + бааз */}
      <section className="grid gap-6 lg:grid-cols-3">
        <Panel
          className="lg:col-span-2"
          title="Сүүлд шинэчлэгдсэн"
          action={<PanelLink href="/dashboard/orders">Бүгдийг үзэх →</PanelLink>}
          flush
        >
          {recentlyUpdatedOrders.length === 0 ? (
            <Empty>Засварын хуудас алга байна.</Empty>
          ) : (
            <div className="divide-y divide-[var(--oc-line)]">
              {recentlyUpdatedOrders.map((o) => {
                const status = o.status as OrderStatus;
                return (
                  <Link
                    key={o.id}
                    href={`/dashboard/orders/${o.id}`}
                    className="flex items-center gap-4 px-5 py-3 text-[13px] transition-colors hover:bg-white/[0.02] sm:px-6"
                  >
                    <span className="w-14 shrink-0 font-plex-mono text-[var(--oc-ink2)]">#{o.number}</span>
                    <span className="min-w-0 flex-1 truncate text-[var(--oc-muted2)]">
                      {customerLabel(o.customer)}
                      <span className="text-[var(--oc-muted4)]"> · {o.vehicle.plate}</span>
                    </span>
                    <span
                      className={`hidden shrink-0 rounded-full px-2 py-0.5 font-plex-mono text-[11px] sm:inline ${ORDER_STATUS_BADGE[status]}`}
                    >
                      {ORDER_STATUS_LABEL[status]}
                    </span>
                    <span className="w-[7.5rem] shrink-0 text-right font-plex-mono text-xs text-[var(--oc-muted3)]">
                      {fmtShortDateTime(o.updatedAt)}
                    </span>
                  </Link>
                );
              })}
            </div>
          )}
        </Panel>

        <Panel title="Бааз">
          <div className="divide-y divide-[var(--oc-line)] text-sm">
            <BaseRow label="Үйлчлүүлэгч" value={customerCount} href="/dashboard/customers" />
            <BaseRow label="Машин" value={vehicleCount} href="/dashboard/vehicles" />
            <BaseRow label="Ажилтан" value={employeeCount} href="/dashboard/employees" />
            {branchCount > 1 ? <BaseRow label="Салбар" value={branchCount} href="/dashboard/branches" /> : null}
          </div>
        </Panel>
      </section>
    </div>
  );
}

// ---- Хэсгүүд ---------------------------------------------------------------

function TodayAppointments({ items }: { items: DashboardFocus["appointments"]["today"] }) {
  return (
    <Panel
      title="Өнөөдрийн цаг захиалга"
      subtitle={items.length > 0 ? `${items.length} цаг` : undefined}
      action={<PanelLink href="/dashboard/appointments/calendar">Хуваарь →</PanelLink>}
      flush
    >
      {items.length === 0 ? (
        <Empty>Өнөөдөр цаг захиалга алга.</Empty>
      ) : (
        <ul className="divide-y divide-[var(--oc-line)]">
          {items.slice(0, 8).map((a) => {
            const status = a.status as AppointmentStatus;
            return (
              <li key={a.id} className="flex items-center gap-4 px-5 py-3 text-[13px] sm:px-6">
                <span className="w-12 shrink-0 font-plex-mono font-semibold tabular-nums text-[var(--oc-ink)]">
                  {fmtTime(a.requestedAt)}
                </span>
                <span className="min-w-0 flex-1 truncate text-[var(--oc-ink2)]">
                  {a.name}
                  {a.plate ? <span className="font-plex-mono text-[var(--oc-muted3)]"> · {a.plate}</span> : null}
                  {a.masterName ? <span className="text-[var(--oc-muted4)]"> · {a.masterName}</span> : null}
                </span>
                {a.converted ? (
                  <span className="shrink-0 rounded-full bg-[var(--oc-ok)]/15 px-2 py-0.5 font-plex-mono text-[11px] text-[var(--oc-ok)]">
                    Хуудас нээсэн
                  </span>
                ) : a.arrived ? (
                  <span className="shrink-0 rounded-full bg-sky-500/15 px-2 py-0.5 font-plex-mono text-[11px] text-sky-300 light:text-sky-700">
                    Ирсэн
                  </span>
                ) : (
                  <span
                    className={`shrink-0 rounded-full px-2 py-0.5 font-plex-mono text-[11px] ${APPOINTMENT_STATUS_BADGE[status]}`}
                  >
                    {APPOINTMENT_STATUS_LABEL[status]}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {items.length > 8 ? (
        <div className="border-t border-[var(--oc-line)] px-5 py-2.5 text-xs text-[var(--oc-muted3)] sm:px-6">
          +{items.length - 8} цаг —{" "}
          <Link href="/dashboard/appointments/calendar" className="text-[var(--oc-accent)] hover:text-[var(--oc-accent-hi)]">
            хуваарь харах
          </Link>
        </div>
      ) : null}
    </Panel>
  );
}

function WorkInProgress({ focus }: { focus: DashboardFocus }) {
  const { orders } = focus;
  return (
    <Panel
      title="Хийгдэж буй ажил"
      subtitle={orders.inProgress > 0 ? `${orders.inProgress} хуудас` : undefined}
      action={<PanelLink href="/dashboard/orders/in-progress">Явц харах →</PanelLink>}
      flush
    >
      {orders.inProgress === 0 ? (
        <Empty>Одоогоор хийгдэж буй ажил алга.</Empty>
      ) : (
        <>
          {orders.workload.length > 0 ? (
            <div className="flex flex-wrap gap-2 border-b border-[var(--oc-line)] px-5 py-3 sm:px-6">
              {orders.workload.map((w) => (
                <span
                  key={w.id || "none"}
                  className="inline-flex items-center gap-1.5 rounded-full border border-[var(--oc-line)] px-2.5 py-1 text-xs text-[var(--oc-ink2)]"
                >
                  {w.name}
                  <span className="font-plex-mono font-semibold tabular-nums text-[var(--oc-ink)]">{w.count}</span>
                  {w.overdue > 0 ? (
                    <span className="font-plex-mono text-[10px] text-red-400 light:text-red-600">{w.overdue} хэтэрсэн</span>
                  ) : null}
                </span>
              ))}
            </div>
          ) : null}
          <ul className="divide-y divide-[var(--oc-line)]">
            {orders.top.map((o) => (
              <li key={o.id}>
                <Link
                  href={`/dashboard/orders/${o.id}`}
                  className="block px-5 py-3 text-[13px] transition-colors hover:bg-white/[0.02] sm:px-6"
                >
                  <div className="flex items-center gap-3">
                    <span className="w-14 shrink-0 font-plex-mono text-[var(--oc-ink2)]">#{o.number}</span>
                    <span className="min-w-0 flex-1 truncate text-[var(--oc-ink2)]">
                      {o.customerName}
                      <span className="font-plex-mono text-[var(--oc-muted3)]"> · {o.plate}</span>
                      {o.masterName ? <span className="text-[var(--oc-muted4)]"> · {o.masterName}</span> : null}
                    </span>
                    {o.overdue ? (
                      <span className="shrink-0 rounded-full bg-red-500/15 px-2 py-0.5 font-plex-mono text-[11px] text-red-300 light:text-red-700">
                        Хэтэрсэн
                      </span>
                    ) : o.work.ready ? (
                      <span className="shrink-0 rounded-full bg-[var(--oc-ok)]/15 px-2 py-0.5 font-plex-mono text-[11px] text-[var(--oc-ok)]">
                        Дуусгахад бэлэн
                      </span>
                    ) : o.expectedFinishAt ? (
                      <span className="shrink-0 font-plex-mono text-[11px] text-[var(--oc-muted3)]">
                        ~{fmtTime(o.expectedFinishAt)}
                      </span>
                    ) : null}
                  </div>
                  <div className="mt-2 flex items-center gap-2">
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/[0.06]">
                      <div
                        className={`h-full rounded-full ${o.work.percent >= 100 ? "bg-emerald-500" : o.overdue ? "bg-red-500" : "bg-[var(--oc-accent)]"}`}
                        style={{ width: `${o.work.percent}%` }}
                      />
                    </div>
                    <span className="w-14 shrink-0 text-right font-plex-mono text-[11px] tabular-nums text-[var(--oc-muted3)]">
                      {o.work.done}/{o.work.active}
                    </span>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </Panel>
  );
}

function PaymentsToday({ focus }: { focus: DashboardFocus }) {
  const { payments } = focus;
  const total = Number(payments.total.toString());
  return (
    <Panel title="Өнөөдрийн төлбөр" subtitle="Хүлээн авсан мөнгө, аргаар">
      <div className="font-plex-mono text-2xl font-semibold tabular-nums text-[var(--oc-ink)]">
        {formatTugrik(payments.total.toString())}
      </div>
      {payments.byMethod.length === 0 ? (
        <p className="mt-2 text-sm text-[var(--oc-muted3)]">Өнөөдөр төлбөр бүртгэгдээгүй.</p>
      ) : (
        <ul className="mt-4 flex flex-col gap-3">
          {payments.byMethod.map((m) => {
            const amount = Number(m.amount.toString());
            const pct = total > 0 ? Math.round((amount / total) * 100) : 0;
            return (
              <li key={m.method}>
                <div className="flex items-center justify-between gap-2 text-sm">
                  <span className="text-[var(--oc-ink2)]">
                    {ORDER_PAYMENT_METHOD_LABEL[m.method] ?? m.method}
                    <span className="ml-1.5 text-xs text-[var(--oc-muted4)]">{m.count}</span>
                  </span>
                  <span className="font-plex-mono tabular-nums text-[var(--oc-ink)]">{formatTugrik(m.amount.toString())}</span>
                </div>
                <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-white/[0.06]">
                  <div className="h-full rounded-full bg-[var(--oc-accent)]" style={{ width: `${pct}%` }} />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}

function ReceivableAgingCard({ focus }: { focus: DashboardFocus }) {
  const { receivable } = focus.orders;
  const labels = ["0–30 хоног", "31–60 хоног", "60+ хоног"];
  return (
    <Panel
      title="Авлагын насжилт"
      subtitle={`${receivable.count} хуудас · ${formatTugrik(receivable.total.toString())}`}
      action={<PanelLink href="/dashboard/orders?unpaid=1">Жагсаалт →</PanelLink>}
    >
      <dl className="flex flex-col gap-2.5 text-sm">
        {receivable.buckets.map((amount, i) => (
          <div key={labels[i]} className="flex items-center justify-between gap-2">
            <dt className="text-[var(--oc-muted3)]">{labels[i]}</dt>
            <dd
              className={`font-plex-mono tabular-nums ${
                i === 2 && amount.gt(0) ? "text-red-400 light:text-red-600" : "text-[var(--oc-ink)]"
              }`}
            >
              {formatTugrik(amount.toString())}
            </dd>
          </div>
        ))}
      </dl>
    </Panel>
  );
}

// ---- Үндсэн UI блокууд -----------------------------------------------------

const ATTENTION_TONE: Record<AttentionItem["tone"], { dot: string; count: string }> = {
  danger: { dot: "bg-red-500", count: "text-red-400 light:text-red-600" },
  warn: { dot: "bg-[var(--oc-warn)]", count: "text-[var(--oc-warn)]" },
  accent: { dot: "bg-[var(--oc-accent)]", count: "text-[var(--oc-accent)]" },
};

function AttentionCard({ item }: { item: AttentionItem }) {
  const tone = ATTENTION_TONE[item.tone];
  return (
    <Link
      href={item.href}
      className="group flex items-center gap-3 rounded-[10px] border border-[var(--oc-line)] bg-[var(--oc-panel)] px-4 py-3 transition-colors hover:border-[var(--oc-line2)] hover:bg-[var(--oc-panel2)]"
    >
      <span className={`h-2 w-2 shrink-0 rounded-full ${tone.dot}`} aria-hidden />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-[var(--oc-ink)]">{item.label}</span>
        <span className="block truncate text-xs text-[var(--oc-muted3)]">{item.hint}</span>
      </span>
      <span className={`font-plex-mono text-xl font-semibold tabular-nums ${tone.count}`}>{item.count}</span>
      <span className="font-plex-mono text-[var(--oc-muted3)] transition-colors group-hover:text-[var(--oc-accent)]">→</span>
    </Link>
  );
}

function Kpi({
  label,
  value,
  sub,
  href,
  trend,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  href?: string;
  trend?: Trend;
  tone?: "warn" | "ok";
}) {
  const pct = trend?.changePct ?? null;
  const dir = pct == null ? null : pct > 0 ? "up" : pct < 0 ? "down" : "flat";
  const valueClass =
    tone === "warn"
      ? "text-[var(--oc-warn)]"
      : tone === "ok"
        ? "text-emerald-400 light:text-emerald-600"
        : "text-[var(--oc-ink)]";
  const inner = (
    <div className="flex h-full flex-col gap-2 rounded-[10px] border border-[var(--oc-line)] bg-[var(--oc-panel)] p-4 transition-colors group-hover:border-[var(--oc-line2)] group-hover:bg-[var(--oc-panel2)]">
      <div className="flex items-start justify-between gap-2">
        <span title={label} className="truncate font-plex-mono text-[10.5px] uppercase tracking-[0.1em] text-[var(--oc-muted3)]">
          {label}
        </span>
        {pct != null ? (
          <span
            title="Сүүлийн 7 хоногийг өмнөх 7 хоногтой харьцуулав"
            className={`inline-flex shrink-0 items-center gap-0.5 rounded-full px-1.5 py-0.5 font-plex-mono text-[10px] font-medium ${
              dir === "up"
                ? "bg-[var(--oc-ok)]/15 text-[var(--oc-ok)]"
                : dir === "down"
                  ? "bg-red-500/15 text-red-300 light:text-red-700"
                  : "bg-white/[0.06] text-[var(--oc-muted3)]"
            }`}
          >
            <span>{dir === "up" ? "▲" : dir === "down" ? "▼" : "—"}</span>
            <span className="tabular-nums">{Math.abs(pct).toFixed(0)}%</span>
          </span>
        ) : null}
      </div>
      <div className={`truncate font-plex-mono text-xl font-semibold tabular-nums sm:text-2xl ${valueClass}`}>{value}</div>
      {sub ? <div className="truncate text-xs text-[var(--oc-muted3)]">{sub}</div> : null}
      {trend ? <Sparkline data={trend.spark} up={pct == null || pct >= 0} className="mt-auto h-7" /> : null}
    </div>
  );
  return href ? (
    <Link href={href} className="group block h-full">
      {inner}
    </Link>
  ) : (
    <div className="group h-full">{inner}</div>
  );
}

function Panel({
  title,
  subtitle,
  action,
  flush = false,
  className = "",
  children,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
  /** Агуулга ирмэг хүртэл (жагсаалт) — дотор padding-гүй. */
  flush?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={`min-w-0 overflow-hidden rounded-[10px] border border-[var(--oc-line)] bg-[var(--oc-panel)] ${className}`}>
      <div
        className={`flex items-center justify-between gap-3 ${
          flush ? "border-b border-[var(--oc-line)] px-5 py-4 sm:px-6" : "px-4 pt-4 sm:px-5 sm:pt-5"
        }`}
      >
        <div className="min-w-0">
          <h2 className="font-semibold text-[var(--oc-ink)]">{title}</h2>
          {subtitle ? <p className="mt-0.5 truncate text-xs text-[var(--oc-muted3)]">{subtitle}</p> : null}
        </div>
        {action}
      </div>
      <div className={flush ? "" : "px-4 pb-4 pt-3 sm:px-5 sm:pb-5"}>{children}</div>
    </div>
  );
}

function PanelLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      className="shrink-0 font-plex-mono text-[11px] text-[var(--oc-accent)] transition-colors hover:text-[var(--oc-accent-hi)]"
    >
      {children}
    </Link>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="px-5 py-8 text-center text-sm text-[var(--oc-muted3)]">{children}</p>;
}

function BaseRow({ label, value, href }: { label: string; value: number; href: string }) {
  return (
    <Link href={href} className="group flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
      <span className="text-[var(--oc-muted3)] transition-colors group-hover:text-[var(--oc-ink2)]">{label}</span>
      <span className="font-plex-mono tabular-nums text-[var(--oc-ink)]">{value.toLocaleString("mn-MN")}</span>
    </Link>
  );
}
