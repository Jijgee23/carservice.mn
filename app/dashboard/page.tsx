import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { userRoleLabel } from "@/lib/auth/roles";
import {
  ORDER_STATUS_BADGE,
  ORDER_STATUS_LABEL,
  INTERNAL_COST_LABEL,
  formatTugrik,
  type OrderStatus,
} from "@/lib/orders";
import { DatePicker } from "@/app/_components/date-picker";
import { Sparkline } from "@/app/_components/sparkline";
import { IncomeBarChart } from "./income-bar-chart";
import { PlanUsageRing } from "./plan-usage-ring";
import { type Trend, loadOverviewData } from "@/lib/overview";
import { INCOME_QUICK_RANGES, type IncomeRangeKey } from "./income-range";
import {
  PLAN_LABEL,
  SUBSCRIPTION_STATUS_BADGE,
  SUBSCRIPTION_STATUS_LABEL,
  formatDaysLeft,
} from "@/lib/subscription";

export const metadata = {
  title: "Хяналтын самбар",
};

function incomeRangeHref(key: IncomeRangeKey): string {
  return key === "week" ? "/dashboard" : `/dashboard?range=${key}`;
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string; from?: string; to?: string }>;
}) {
  const user = await requireUser();

  const params = await searchParams;

  const {
    incomeRange,
    branchCount,
    employeeCount,
    customerCount,
    vehicleCount,
    openOrderCount,
    completedThisMonth,
    activeSub,
    recentlyUpdatedOrders,
    postpaidVehicleCount,
    receivable,
    todayOrderCount,
    planLimits,
    income,
    internalCost,
    orderTrend,
    completedTrend,
    customerTrend,
    vehicleTrend,
    branchTrend,
    employeeTrend,
  } = await loadOverviewData(
    { ...user, tenantPlan: user.tenant.plan, orderAccess: user },
    params,
  );
  const incomeUp = income.changePct == null ? true : income.changePct >= 0;

  // Статистик карт хэдэн ширхэг байгаагаас хамааруулж xl цонхон дээр яг тэр
  // тоогоор багана үүсгэнэ — ингэснээр (Авлага карт нэмэгдсэн ч) бүгд нэг
  // мөрөнд багтана, сүүлчийн мөр дутуу (1 картаар) үлдэхгүй.
  const statCardCount = 6 + (postpaidVehicleCount > 0 || receivable.gt(0) ? 1 : 0);

  return (
    <div className="p-4 sm:p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-[var(--oc-ink)]">
          Сайн байна уу, {user.firstName}!
        </h1>
        <p className="text-sm text-[var(--oc-muted3)] mt-1">
          {user.tenant.name} · {userRoleLabel(user)}
        </p>
      </div>

      <div
        className={`grid grid-cols-2 gap-px overflow-hidden rounded-[10px] border border-[var(--oc-line)] bg-[var(--oc-line)] lg:grid-cols-3 ${
          statCardCount === 7 ? "xl:grid-cols-7" : "xl:grid-cols-6"
        }`}
      >
        <StatCard
          label="Идэвхтэй засварын хуудас"
          value={openOrderCount}
          href="/dashboard/orders"
          trend={orderTrend}
        />
        <StatCard
          label="Энэ сар дуусгасан"
          value={completedThisMonth}
          href="/dashboard/orders?status=COMPLETED"
          trend={completedTrend}
        />
        <StatCard
          label="Үйлчлүүлэгч"
          value={customerCount}
          href="/dashboard/customers"
          trend={customerTrend}
        />
        <StatCard
          label="Машин"
          value={vehicleCount}
          href="/dashboard/vehicles"
          trend={vehicleTrend}
        />
        <StatCard
          label="Салбар"
          value={branchCount}
          href="/dashboard/branches"
          trend={branchTrend}
        />
        <StatCard
          label="Ажилтан"
          value={employeeCount}
          href="/dashboard/employees"
          trend={employeeTrend}
        />
        {postpaidVehicleCount > 0 || receivable.gt(0) ? (
          <StatCard
            label="Авлага (төлөгдөөгүй)"
            value={formatTugrik(receivable.toString())}
            href="/dashboard/orders?unpaid=1"
            tone={receivable.gt(0) ? "warn" : "ok"}
          />
        ) : null}
      </div>

      <section className="mt-6 rounded-[10px] border border-[var(--oc-line)] bg-[var(--oc-panel)] p-4 sm:p-6 lg:p-8">
        <div className="flex flex-wrap items-start justify-between gap-4 mb-5">
          <div>
            <h2 className="font-semibold text-[var(--oc-ink)] mb-1">Багцын хэрэглээ</h2>
            <p className="text-xs text-[var(--oc-muted3)]">
              {PLAN_LABEL[user.tenant.plan]} багцын лимитүүд одоогийн хэрэглээтэй харьцуулав
            </p>
          </div>
          <Link
            href="/dashboard/settings/subscription"
            className="font-plex-mono text-[11px] text-[var(--oc-accent)] hover:text-[var(--oc-accent-hi)] transition-colors shrink-0"
          >
            Багц удирдах →
          </Link>
        </div>
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-6">
          <PlanUsageRing
            label="Өнөөдрийн засвар"
            current={todayOrderCount}
            limit={planLimits.daily_orders}
            href="/dashboard/orders"
          />
          <PlanUsageRing
            label="Машин"
            current={vehicleCount}
            limit={planLimits.max_vehicles}
            href="/dashboard/vehicles"
          />
          <PlanUsageRing
            label="Ажилтан"
            current={employeeCount}
            limit={planLimits.max_users}
            href="/dashboard/employees"
          />
          <PlanUsageRing
            label="Салбар"
            current={branchCount}
            limit={planLimits.max_branches}
            href="/dashboard/branches"
          />
        </div>
      </section>

      <section className="mt-6 rounded-[10px] border border-[var(--oc-line)] bg-[var(--oc-panel)] p-4 sm:p-6 lg:p-8">
        <div className="flex flex-wrap items-start justify-between gap-4 mb-5">
          <div>
            <h2 className="font-semibold text-[var(--oc-ink)] mb-1">Орлогын явц</h2>
            <p className="text-xs text-[var(--oc-muted3)]">{incomeRange.label}</p>
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

      <section className="mt-6 grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2 flex flex-col gap-6">
          <div className="rounded-[10px] border border-[var(--oc-line)] bg-[var(--oc-panel)] p-5 sm:p-6 lg:p-8">
            <h2 className="font-semibold text-[var(--oc-ink)] mb-1">Хурдан үйлдлүүд</h2>
            <p className="text-sm text-[var(--oc-muted3)] mb-6">Дарж шууд эхэлнэ.</p>
            <div className="grid sm:grid-cols-2 gap-3">
              <QuickAction
                href="/dashboard/orders/new"
                title="Шинэ засварын хуудас авах"
                desc="Үйлчилгээний ажлыг бүртгэж эхлэх"
              />
              <QuickAction
                href="/dashboard/customers/new"
                title="Үйлчлүүлэгч нэмэх"
                desc="Шинэ харилцагчийг бүртгэх"
              />
              <QuickAction
                href="/dashboard/vehicles/new"
                title="Машин бүртгэх"
                desc="Машины мэдээлэл, эзэмшигчийг бүртгэх"
              />
              <QuickAction
                href="/dashboard/employees/new"
                title="Ажилтан нэмэх"
                desc="Мастер, кассчин, менежерийг урих"
              />
            </div>
          </div>

          <div className="rounded-[10px] border border-[var(--oc-line)] bg-[var(--oc-panel)] overflow-hidden">
            <div className="flex items-center justify-between px-5 sm:px-6 lg:px-8 py-4 border-b border-[var(--oc-line)]">
              <h2 className="font-semibold text-[var(--oc-ink)]">Сүүлд шинэчлэгдсэн</h2>
              <Link
                href="/dashboard/orders"
                className="font-plex-mono text-[11px] text-[var(--oc-accent)] hover:text-[var(--oc-accent-hi)] transition-colors"
              >
                Бүгдийг үзэх →
              </Link>
            </div>
            {recentlyUpdatedOrders.length === 0 ? (
              <p className="text-sm text-[var(--oc-muted3)] py-8 text-center">
                Засварын хуудас алга байна.
              </p>
            ) : (
              <div className="divide-y divide-[var(--oc-line)]">
                {recentlyUpdatedOrders.map((o) => {
                  const status = o.status as OrderStatus;
                  // Сэлбэг (PART) мөрүүд явцгүй тул тооцоололд оролцохгүй.
                  const activeItems = o.items.filter(
                    (it) => it.status !== "CANCELLED" && it.kind !== "PART",
                  );
                  const completedCount = activeItems.filter(
                    (it) => it.status === "COMPLETED",
                  ).length;
                  const percent =
                    activeItems.length > 0
                      ? Math.round((completedCount / activeItems.length) * 100)
                      : 0;
                  return (
                    <Link
                      key={o.id}
                      href={`/dashboard/orders/${o.id}`}
                      className="block px-5 sm:px-6 lg:px-8 py-3.5 text-[13px] hover:bg-white/[0.02] transition-colors"
                    >
                      <div className="flex items-center gap-4">
                        <span className="font-plex-mono text-[var(--oc-ink2)] shrink-0 w-14">
                          #{o.number}
                        </span>
                        <span className="text-[var(--oc-muted2)] flex-1 min-w-0 truncate">
                          {o.customer.fullName}
                          <span className="text-[var(--oc-muted4)]"> · {o.vehicle.plate}</span>
                        </span>
                        <span
                          className={`hidden sm:inline shrink-0 rounded-full px-2 py-0.5 font-plex-mono text-[11px] ${ORDER_STATUS_BADGE[status]}`}
                        >
                          {ORDER_STATUS_LABEL[status]}
                        </span>
                        <span className="font-plex-mono text-[var(--oc-muted3)] text-xs shrink-0 w-[7.5rem] text-right">
                          {o.updatedAt.toLocaleString("mn-MN", {
                            month: "short",
                            day: "2-digit",
                            hour: "2-digit",
                            minute: "2-digit",
                            hour12: false,
                          })}
                        </span>
                      </div>
                      <div className="mt-2 flex items-center gap-2">
                        <div className="flex-1 h-1.5 rounded-full bg-white/[0.06] overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-[width] duration-300 ${
                              percent >= 100 ? "bg-emerald-500" : "bg-[var(--oc-accent)]"
                            }`}
                            style={{ width: `${percent}%` }}
                          />
                        </div>
                        <span
                          className={`font-plex-mono text-[11px] tabular-nums shrink-0 w-9 text-right ${
                            percent >= 100
                              ? "text-emerald-400 light:text-emerald-600"
                              : "text-[var(--oc-muted3)]"
                          }`}
                        >
                          {percent}%
                        </span>
                      </div>
                    </Link>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        <div className="rounded-[10px] border border-[var(--oc-line)] bg-[var(--oc-panel)] p-5 sm:p-6 lg:p-8">
          <h2 className="font-semibold text-[var(--oc-ink)] mb-4">Байгууллагын мэдээлэл</h2>
          <dl className="space-y-3 text-sm">
            <InfoRow label="Нэр" value={user.tenant.name} />
            <InfoRow label="Регистр" value={user.tenant.registerNumber} />
            <InfoRow label="Имэйл" value={user.tenant.email} />
            <InfoRow label="Утас" value={user.tenant.phone1} />
            {user.tenant.phone2 ? (
              <InfoRow label="Утас 2" value={user.tenant.phone2} />
            ) : null}
            <div className="pt-2 border-t border-[var(--oc-line)]">
              <div className="flex items-center justify-between">
                <span className="text-[var(--oc-muted3)]">Багц</span>
                <span
                  className={`font-plex-mono text-xs px-2.5 py-1 rounded-full ${activeSub
                    ? SUBSCRIPTION_STATUS_BADGE[activeSub.subscription.status]
                    : "bg-[var(--oc-accent)]/15 text-[var(--oc-accent)] border border-[var(--oc-accent)]/30"
                    }`}
                >
                  {activeSub
                    ? PLAN_LABEL[activeSub.subscription.plan]
                    : user.tenant.plan}
                  {activeSub
                    ? ` · ${SUBSCRIPTION_STATUS_LABEL[activeSub.subscription.status]}`
                    : ""}
                </span>
              </div>
              {activeSub?.expiresAt ? (
                <div className="mt-2 flex items-center justify-between text-xs">
                  <span className="text-[var(--oc-muted3)]">Хугацаа</span>
                  <span className="text-[var(--oc-ink2)] text-right">
                    {activeSub.expiresAt.toLocaleDateString("mn-MN")}
                    <span
                      className={`block text-[10px] ${activeSub.daysLeft <= 3
                        ? "text-red-300 light:text-red-700"
                        : "text-[var(--oc-muted3)]"
                        }`}
                    >
                      {formatDaysLeft(activeSub.daysLeft)}
                    </span>
                  </span>
                </div>
              ) : null}
              <Link
                href="/dashboard/settings/subscription"
                className="mt-3 inline-flex items-center justify-center w-full rounded-lg bg-[var(--oc-accent)] hover:bg-[var(--oc-accent-hi)] transition-colors py-2.5 text-xs font-semibold text-[var(--oc-on-accent)]"
              >
                Багц сунгах
              </Link>
            </div>
          </dl>
        </div>
      </section>
    </div>
  );
}

function StatCard({
  label,
  value,
  href,
  trend,
  tone,
}: {
  label: string;
  value: number | string;
  href?: string;
  trend?: Trend;
  tone?: "warn" | "ok";
}) {
  const pct = trend?.changePct ?? null;
  // Чиглэл: өссөн/буурсан/өөрчлөлтгүй — өнгө, сумыг бодит утгаар ялгана.
  const dir = pct == null ? null : pct > 0 ? "up" : pct < 0 ? "down" : "flat";
  const up = pct == null ? true : pct >= 0;
  const toneClass =
    tone === "warn"
      ? "text-[var(--oc-warn)]"
      : tone === "ok"
        ? "text-emerald-400 light:text-emerald-600"
        : "text-[var(--oc-ink)]";
  const inner = (
    <div className="group bg-[var(--oc-panel)] hover:bg-[var(--oc-panel2)] transition-colors p-3 sm:p-4 flex flex-col gap-2.5 sm:gap-3 h-full">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div
            title={label}
            className="font-plex-mono text-[10.5px] uppercase tracking-[0.1em] text-[var(--oc-muted3)] truncate"
          >
            {label}
          </div>
          <div className={`font-plex-mono text-xl sm:text-2xl font-semibold mt-1 tabular-nums ${toneClass}`}>
            {typeof value === "number" ? value.toLocaleString("mn-MN") : value}
          </div>
        </div>
        {pct != null ? (
          <span
            title="Сүүлийн 7 хоногийг өмнөх 7 хоногтой харьцуулав"
            className={`shrink-0 inline-flex items-center gap-0.5 font-plex-mono text-[10px] font-medium px-1.5 py-0.5 rounded-full ${dir === "up"
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
      {trend ? <Sparkline data={trend.spark} up={up} className="h-8" /> : null}
    </div>
  );
  return href ? (
    <Link href={href} className="block h-full">
      {inner}
    </Link>
  ) : (
    inner
  );
}

function QuickAction({
  href,
  title,
  desc,
}: {
  href: string;
  title: string;
  desc: string;
}) {
  return (
    <Link
      href={href}
      className="group rounded-[10px] border border-[var(--oc-line)] hover:border-[var(--oc-line2)] hover:bg-[var(--oc-panel2)] transition-colors p-5 flex items-center justify-between gap-3"
    >
      <div className="min-w-0">
        <div className="font-semibold text-[var(--oc-ink2)] group-hover:text-[var(--oc-accent)] transition-colors">
          {title}
        </div>
        <div className="text-sm text-[var(--oc-muted3)] mt-0.5">{desc}</div>
      </div>
      <span className="font-plex-mono text-[var(--oc-muted3)] group-hover:text-[var(--oc-accent)] transition-colors shrink-0">
        →
      </span>
    </Link>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-[var(--oc-muted3)]">{label}</span>
      <span className="text-[var(--oc-ink2)] truncate text-right">{value}</span>
    </div>
  );
}
