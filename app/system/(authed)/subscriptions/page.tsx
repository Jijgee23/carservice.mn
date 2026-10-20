import Link from "next/link";
import { PageHeader } from "@/app/_components/page-header";
import { Pagination } from "@/app/_components/pagination";
import { requireSuperAdmin } from "@/lib/auth/system";
import { formatTugrik } from "@/lib/orders";
import { buildMeta, getPageInfo } from "@/lib/pagination";
import { prisma } from "@/lib/prisma";
import {
  BILLING_PERIOD_LABEL,
  PLAN_LABEL,
  SUBSCRIPTION_PAYMENT_METHOD_LABEL,
  SUBSCRIPTION_PAYMENT_STATUS_BADGE,
  SUBSCRIPTION_PAYMENT_STATUS_LABEL,
  SUBSCRIPTION_STATUS_BADGE,
  SUBSCRIPTION_STATUS_LABEL,
} from "@/lib/subscription";
import {
  filtersToParams,
  parseSubscriptionHistoryFilters,
  PAYMENT_STATUSES,
  paymentWhere,
  SUBSCRIPTION_STATUSES,
  subscriptionWhere,
} from "@/lib/subscription-history";

export const metadata = {
  title: "Subscription түүх",
};

const TH = "text-left font-plex-mono text-[10.5px] uppercase tracking-[0.08em] text-[var(--oc-muted3)] font-medium px-4 py-3";
const TD = "px-4 py-3 text-xs";

function fmt(d: Date | null | undefined): string {
  if (!d) return "—";
  return d.toLocaleString("mn-MN", { hour12: false, timeZone: "Asia/Ulaanbaatar" });
}

function fmtDay(d: Date | null | undefined): string {
  if (!d) return "—";
  return d.toLocaleDateString("mn-MN", { timeZone: "Asia/Ulaanbaatar" });
}

function TenantCell({ t }: { t: { id: string; name: string; isTest: boolean } }) {
  return (
    <td className={`${TD} text-sm`}>
      <Link href={`/system/tenants/${t.id}`} className="text-[var(--oc-ink2)] hover:text-[var(--oc-accent)] transition-colors">
        {t.name}
      </Link>
      {t.isTest ? (
        <span className="ml-1.5 align-middle text-[10px] px-1.5 py-0.5 rounded-full bg-sky-500/15 text-sky-300 border border-sky-500/25 light:bg-sky-100 light:border-sky-300 light:text-sky-700">
          Тест
        </span>
      ) : null}
    </td>
  );
}

export default async function SystemSubscriptionsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireSuperAdmin();
  const sp = await searchParams;
  const f = parseSubscriptionHistoryFilters(sp);
  const pageParam = Array.isArray(sp.page) ? sp.page[0] : sp.page;
  const { page, pageSize, skip, take } = getPageInfo(pageParam);
  const tenantSelect = { select: { id: true, name: true, isTest: true } } as const;

  // Нийт дүн — тест тенант (isTest) орохгүй (системийн статистиктай адил).
  const realPaid = { AND: [paymentWhere(f), { status: "PAID" as const, tenant: { isTest: false } }] };

  const [rows, total, paidAgg, pendingCount] =
    f.tab === "payments"
      ? await Promise.all([
          prisma.subscriptionPayment.findMany({
            where: paymentWhere(f),
            orderBy: { createdAt: "desc" },
            skip,
            take,
            select: {
              id: true,
              plan: true,
              period: true,
              amount: true,
              method: true,
              status: true,
              createdAt: true,
              paidAt: true,
              qpayPaymentId: true,
              tenant: tenantSelect,
            },
          }),
          prisma.subscriptionPayment.count({ where: paymentWhere(f) }),
          prisma.subscriptionPayment.aggregate({ where: realPaid, _sum: { amount: true }, _count: { _all: true } }),
          prisma.subscriptionPayment.count({ where: { ...paymentWhere(f), status: "PENDING" } }),
        ])
      : await Promise.all([
          prisma.subscription.findMany({
            where: subscriptionWhere(f),
            orderBy: { createdAt: "desc" },
            skip,
            take,
            select: {
              id: true,
              plan: true,
              status: true,
              startsAt: true,
              endsAt: true,
              amount: true,
              notes: true,
              createdAt: true,
              tenant: tenantSelect,
              createdBy: { select: { firstName: true, lastName: true } },
            },
          }),
          prisma.subscription.count({ where: subscriptionWhere(f) }),
          prisma.subscriptionPayment.aggregate({ where: realPaid, _sum: { amount: true }, _count: { _all: true } }),
          prisma.subscription.count({ where: { ...subscriptionWhere(f), status: { in: ["ACTIVE", "TRIAL"] } } }),
        ]);
  const meta = buildMeta(total, page, pageSize);
  const params = filtersToParams(f);
  const exportQs = new URLSearchParams(params).toString();
  const statuses = f.tab === "payments" ? PAYMENT_STATUSES : SUBSCRIPTION_STATUSES;
  const statusLabel: Record<string, string> =
    f.tab === "payments" ? SUBSCRIPTION_PAYMENT_STATUS_LABEL : SUBSCRIPTION_STATUS_LABEL;

  return (
    <div className="p-6 sm:p-8 max-w-screen">
      <PageHeader
        title="Subscription түүх"
        description="Бүх байгууллагын эрх (багцын хугацаа) болон багцын төлбөрийн түүх."
        actions={
          <a href={`/system/subscriptions/export?${exportQs}`} className="text-sm px-4 py-2 rounded-lg border border-[var(--oc-line)] text-[var(--oc-ink2)] hover:border-[var(--oc-accent)] hover:text-[var(--oc-accent)] transition-colors">
            Excel татах
          </a>
        }
      />

      <div className="grid gap-4 sm:grid-cols-3 mb-6">
        <div className="rounded-[10px] border border-[var(--oc-line)] bg-[var(--oc-panel)] p-4">
          <div className="text-xs text-[var(--oc-muted3)]">Төлөгдсөн орлого (шүүлтүүрээр, тестгүй)</div>
          <div className="mt-1 font-plex-mono text-xl font-semibold text-[var(--oc-ink)]">
            {formatTugrik(paidAgg._sum.amount?.toString() ?? "0")}
          </div>
        </div>
        <div className="rounded-[10px] border border-[var(--oc-line)] bg-[var(--oc-panel)] p-4">
          <div className="text-xs text-[var(--oc-muted3)]">Төлөгдсөн төлбөр</div>
          <div className="mt-1 font-plex-mono text-xl font-semibold text-[var(--oc-ink)]">{paidAgg._count._all}</div>
        </div>
        <div className="rounded-[10px] border border-[var(--oc-line)] bg-[var(--oc-panel)] p-4">
          <div className="text-xs text-[var(--oc-muted3)]">{f.tab === "payments" ? "Хүлээгдэж буй нэхэмжлэл" : "Идэвхтэй / туршилт эрх"}</div>
          <div className="mt-1 font-plex-mono text-xl font-semibold text-[var(--oc-ink)]">{pendingCount}</div>
        </div>
      </div>

      <div className="rounded-[10px] border border-[var(--oc-line)] bg-[var(--oc-panel)] overflow-hidden">
        <div className="flex flex-wrap items-center gap-3 px-4 py-3 border-b border-[var(--oc-line)]">
          <div className="inline-flex rounded-lg border border-[var(--oc-line)] p-1">
            {(
              [
                ["subscriptions", "Эрх"],
                ["payments", "Төлбөр"],
              ] as const
            ).map(([key, label]) => (
              <Link
                key={key}
                href={`/system/subscriptions?tab=${key}`}
                className={`px-3.5 py-1.5 text-sm rounded-md transition-colors ${
                  f.tab === key
                    ? "bg-[var(--oc-accent)] text-[var(--oc-on-accent)] font-medium"
                    : "text-[var(--oc-muted2)] hover:text-[var(--oc-ink2)]"
                }`}
              >
                {label}
              </Link>
            ))}
          </div>

          <form className="flex flex-wrap items-center gap-2 flex-1" method="get">
            <input type="hidden" name="tab" value={f.tab} />
            <input
              name="q"
              defaultValue={f.q}
              placeholder="Байгууллага, регистр, имэйл"
              className="compact-input !py-1.5 w-full sm:w-56"
            />
            <select name="plan" defaultValue={f.plan} className="compact-input !py-1.5 !w-auto">
              <option value="">Бүх багц</option>
              {(["FREE", "BUSINESS", "ENTERPRISE"] as const).map((p) => (
                <option key={p} value={p}>
                  {PLAN_LABEL[p]}
                </option>
              ))}
            </select>
            <select name="status" defaultValue={f.status} className="compact-input !py-1.5 !w-auto">
              <option value="">Бүх төлөв</option>
              {statuses.map((s) => (
                <option key={s} value={s}>
                  {statusLabel[s]}
                </option>
              ))}
            </select>
            <input type="date" name="from" defaultValue={f.from} aria-label="Эхлэх огноо" className="compact-input !py-1.5 !w-auto" />
            <span className="text-[var(--oc-muted3)] text-xs">—</span>
            <input type="date" name="to" defaultValue={f.to} aria-label="Дуусах огноо" className="compact-input !py-1.5 !w-auto" />
            <button type="submit" className="text-sm px-3.5 py-1.5 rounded-lg bg-[var(--oc-accent)] text-[var(--oc-on-accent)] font-medium">
              Шүүх
            </button>
            {f.q || f.plan || f.status || f.from || f.to ? (
              <Link href={`/system/subscriptions?tab=${f.tab}`} className="text-xs text-[var(--oc-muted3)] hover:text-[var(--oc-ink2)] underline underline-offset-2">
                Цэвэрлэх
              </Link>
            ) : null}
          </form>
        </div>

        {rows.length === 0 ? (
          <div className="px-5 py-12 text-center text-sm text-[var(--oc-muted3)]">Бичлэг олдсонгүй.</div>
        ) : f.tab === "payments" ? (
          <div className="overflow-auto">
            <table className="w-full min-w-[980px]">
              <thead>
                <tr className="border-b border-[var(--oc-line)]">
                  {["Огноо", "Байгууллага", "Багц", "Хугацаа", "Дүн", "Арга", "Төлөв", "Төлсөн", "QPay гүйлгээ"].map((h) => (
                    <th key={h} className={TH}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--oc-line)]">
                {(rows as Extract<typeof rows[number], { period: unknown }>[]).map((p) => (
                  <tr key={p.id} className="hover:bg-white/[0.02] transition-colors">
                    <td className={`${TD} font-plex-mono text-[var(--oc-muted2)]`}>{fmt(p.createdAt)}</td>
                    <TenantCell t={p.tenant} />
                    <td className={`${TD} text-[var(--oc-ink2)]`}>{PLAN_LABEL[p.plan]}</td>
                    <td className={`${TD} text-[var(--oc-muted2)]`}>{BILLING_PERIOD_LABEL[p.period]}</td>
                    <td className={`${TD} font-plex-mono text-[var(--oc-ink2)]`}>{formatTugrik(p.amount.toString())}</td>
                    <td className={`${TD} text-[var(--oc-muted2)]`}>{SUBSCRIPTION_PAYMENT_METHOD_LABEL[p.method]}</td>
                    <td className={TD}>
                      <span className={`px-2 py-0.5 rounded-full ${SUBSCRIPTION_PAYMENT_STATUS_BADGE[p.status]}`}>
                        {SUBSCRIPTION_PAYMENT_STATUS_LABEL[p.status]}
                      </span>
                    </td>
                    <td className={`${TD} font-plex-mono text-[var(--oc-muted2)]`}>{fmt(p.paidAt)}</td>
                    <td className={`${TD} font-plex-mono text-[var(--oc-muted3)]`}>{p.qpayPaymentId ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="overflow-auto">
            <table className="w-full min-w-[980px]">
              <thead>
                <tr className="border-b border-[var(--oc-line)]">
                  {["Үүсгэсэн", "Байгууллага", "Багц", "Төлөв", "Эхэлсэн", "Дуусах", "Дүн", "Тэмдэглэл", "Хэн"].map((h) => (
                    <th key={h} className={TH}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--oc-line)]">
                {(rows as Extract<typeof rows[number], { startsAt: unknown }>[]).map((s) => (
                  <tr key={s.id} className="hover:bg-white/[0.02] transition-colors">
                    <td className={`${TD} font-plex-mono text-[var(--oc-muted2)]`}>{fmt(s.createdAt)}</td>
                    <TenantCell t={s.tenant} />
                    <td className={`${TD} text-[var(--oc-ink2)]`}>{PLAN_LABEL[s.plan]}</td>
                    <td className={TD}>
                      <span className={`px-2 py-0.5 rounded-full ${SUBSCRIPTION_STATUS_BADGE[s.status]}`}>
                        {SUBSCRIPTION_STATUS_LABEL[s.status]}
                      </span>
                    </td>
                    <td className={`${TD} font-plex-mono text-[var(--oc-muted2)]`}>{fmtDay(s.startsAt)}</td>
                    <td className={`${TD} font-plex-mono text-[var(--oc-muted2)]`}>{fmtDay(s.endsAt)}</td>
                    <td className={`${TD} font-plex-mono text-[var(--oc-ink2)]`}>{s.amount ? formatTugrik(s.amount.toString()) : "—"}</td>
                    <td className={`${TD} text-[var(--oc-muted3)] max-w-[260px]`}>{s.notes ?? "—"}</td>
                    <td className={`${TD} text-[var(--oc-muted3)]`}>
                      {s.createdBy ? `${s.createdBy.firstName} ${s.createdBy.lastName}` : "Систем"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {meta.totalPages > 1 ? (
        <Pagination page={meta.page} totalPages={meta.totalPages} total={meta.total} params={params} className="mt-4" />
      ) : null}
    </div>
  );
}
