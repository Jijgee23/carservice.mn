// P7-B0 — moved from app/dashboard/reports/data.ts so the web dashboard page,
// the web export route, and the mobile-facing API routes
// (app/api/v1/reports/**) share one loader. Behaviour is unchanged: same
// two-wave Prisma query plan, same branch scoping via
// `workingBranchScopeId`, same local-date `fmt` semantics.
import { customerLabel } from "@/lib/customers";
import {
  ITEM_KIND_LABEL,
  ORDER_STATUS_LABEL,
  type ItemKind,
  type OrderStatus,
} from "@/lib/orders";
import { mergeInternalSplit } from "@/lib/orders/order-internal";
import { prisma } from "@/lib/prisma";
import { buildIncomeSeries, type ResolvedIncomeRange } from "@/app/dashboard/income-range";
import type { IncomePoint } from "@/app/dashboard/income-chart";
import { bookingDateKey } from "@/lib/booking-time";

export type Range = { from: Date; to: Date; label: string; key: string };

const STATUS_ORDER: OrderStatus[] = [
  "SCHEDULED",
  "IN_PROGRESS",
  "COMPLETED",
  "CANCELLED",
];
const KIND_ORDER: ItemKind[] = ["LABOR", "DIAGNOSTIC", "PART", "FEE"];

export type ReportRangeParamError = { field: string; message: string };

// Bounded span for the API routes (D-based: reports cover a tenant's own
// history, not a data-export tool — 366 days comfortably covers "this year"
// plus a leap day while keeping the two Prisma query waves in
// `loadReportData` cheap). The web dashboard has no such cap (it is
// operator-driven, not machine-callable), so this only applies to
// `app/api/v1/reports*`.
export const MAX_REPORT_RANGE_DAYS = 366;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Validates the `from`/`to` query params for `app/api/v1/reports` and
 * `app/api/v1/reports/export`: both optional, but if present must be
 * YYYY-MM-DD, `from <= to`, and span at most `MAX_REPORT_RANGE_DAYS` days.
 * Returns the first field error, or `null` when the params are valid (or
 * absent — `parseRange` then falls back to its own default).
 */
export function validateReportRangeParams(searchParams: {
  from?: string | null;
  to?: string | null;
}): ReportRangeParamError | null {
  const from = searchParams.from ?? undefined;
  const to = searchParams.to ?? undefined;

  for (const [field, value] of [["from", from], ["to", to]] as const) {
    if (value != null && !DATE_RE.test(value)) {
      return { field, message: `${field} нь YYYY-MM-DD хэлбэртэй байна.` };
    }
  }

  // A lone `from`/`to` such as 2026-13-45 passes DATE_RE but is not a real date: reject it too (it would crash the query).
  for (const [field, value] of [["from", from], ["to", to]] as const) {
    if (value != null && Number.isNaN(new Date(`${value}T00:00:00`).getTime())) {
      return { field, message: "Огноо буруу байна." };
    }
  }

  if (from && to) {
    const fromDate = new Date(`${from}T00:00:00`);
    const toDate = new Date(`${to}T00:00:00`);
    if (fromDate.getTime() > toDate.getTime()) {
      return { field: "to", message: "to нь from-оос хойш байх ёстой." };
    }
    const spanDays =
      Math.round((toDate.getTime() - fromDate.getTime()) / (24 * 60 * 60 * 1000)) + 1;
    if (spanDays > MAX_REPORT_RANGE_DAYS) {
      return {
        field: "to",
        message: `Хугацааны муж хэт урт байна (дээд тал нь ${MAX_REPORT_RANGE_DAYS} хоног).`,
      };
    }
  }

  return null;
}

// Report days are Asia/Ulaanbaatar business days (fixed +08:00), never the
// deployment host's zone — on a UTC host the old local-midnight bounds shifted
// every report window by 8 hours and exports disagreed with the screen.
const BUSINESS_OFFSET = "+08:00";
const labelDate = (d: Date) =>
  d.toLocaleDateString("mn-MN", { timeZone: "Asia/Ulaanbaatar" });

export function parseRange(searchParams: { from?: string; to?: string }): Range {
  const now = new Date();
  const startOfThisMonth = new Date(
    `${bookingDateKey(now).slice(0, 7)}-01T00:00:00${BUSINESS_OFFSET}`,
  );

  if (searchParams.from || searchParams.to) {
    const from = searchParams.from
      ? new Date(`${searchParams.from}T00:00:00${BUSINESS_OFFSET}`)
      : startOfThisMonth;
    const to = searchParams.to
      ? new Date(`${searchParams.to}T23:59:59.999${BUSINESS_OFFSET}`)
      : now;
    return {
      from,
      to,
      label: `${labelDate(from)} – ${labelDate(to)}`,
      key: "custom",
    };
  }

  return {
    from: startOfThisMonth,
    to: now,
    label: "Энэ сар",
    key: "this-month",
  };
}

// Business-day YYYY-MM-DD (Asia/Ulaanbaatar). toISOString() is UTC and the
// host's local getters depend on its zone — both slid midnight to the
// previous day and made the range one day off.
export function fmt(d: Date): string {
  return bookingDateKey(d);
}

function daySpan(from: Date, to: Date): number {
  const DAY_MS = 24 * 60 * 60 * 1000;
  const dayNo = (d: Date) => Date.parse(`${bookingDateKey(d)}T00:00:00Z`) / DAY_MS;
  return Math.round(dayNo(to) - dayNo(from)) + 1;
}

export type ReportData = {
  totalRevenue: number;
  /** Дууссан дотоод засварын нийт дүн — орлогод ороогүй. */
  internalCost: number;
  completedCount: number;
  avgTicket: number;
  activeCount: number;
  statusRows: { status: OrderStatus; label: string; count: number; pct: number }[];
  kindRows: { kind: ItemKind; label: string; total: number; pct: number }[];
  branchRows: { id: string; name: string; revenue: number; internalCost: number; count: number }[];
  techRows: { id: string; name: string; revenue: number; internalCost: number; count: number }[];
  // Нэг ажлын мөр (Ажил/Оношилгоо) дунджаар хэдэн минутад гүйцэтгэгддэгийг —
  // харах: lib/orders.ts-ийн serviceItemTimingPatch (ServiceItem.startedAt/
  // completedAt). Зөвхөн энэ өөрчлөлтөөс өмнө дууссан хуучин мөрүүд
  // (`startedAt` байхгүй, нөхөн бөглөөгүй) тооцооноос хасагдана; шууд
  // PENDING→COMPLETED болсон мөр одоо startedAt = completedAt (0 минут)
  // болж тооцогдоно.
  avgJobDurationMinutes: number;
  jobDurationRows: { id: string; name: string; count: number; avgMinutes: number }[];
  customerRows: {
    id: string;
    name: string;
    phone: string;
    revenue: number;
    count: number;
  }[];
  partRows: {
    id: string;
    name: string;
    sku: string;
    unit: string;
    qty: number;
    revenue: number;
  }[];
  income: { points: IncomePoint[]; changePct: number | null };
};

/**
 * `scopeBranchId` is resolved by the caller, not here: the web dashboard
 * (cookie session) scopes by `workingBranchScopeId` (the operator's chosen
 * "working branch"), while the mobile-facing API (bearer-token session, no
 * such concept) scopes by `branchScopeId` (the staff member's assigned
 * branch) — see the doc comments on those two functions in
 * `lib/auth/roles.ts` for why they are not interchangeable. Passing the
 * already-resolved id keeps this loader itself un-forked between the two
 * callers.
 */
export async function loadReportData(
  user: { tenantId: string },
  range: Range,
  scopeBranchId: string | null,
): Promise<ReportData> {
  const branchFilter = scopeBranchId ? { branchId: scopeBranchId } : {};

  const completedWhere = {
    tenantId: user.tenantId,
    ...branchFilter,
    status: "COMPLETED" as const,
    completedAt: { gte: range.from, lte: range.to },
  };

  // Орлогын тооцоо: дотоод засвар орлогод орохгүй (ажлын тоонд л орно) —
  // дүн нь тусдаа `internalCost`-д.
  const revenueWhere = { ...completedWhere, isInternal: false };
  const internalWhere = { ...completedWhere, isInternal: true };

  const allInRangeWhere = {
    tenantId: user.tenantId,
    ...branchFilter,
    OR: [
      { completedAt: { gte: range.from, lte: range.to } },
      { createdAt: { gte: range.from, lte: range.to } },
    ],
  };

  // 1-р давалгаа — нэгтгэлүүд (lookup entity-гүйгээр).
  const [
    revenueAgg,
    internalAgg,
    completedCount,
    revenueCount,
    statusCounts,
    byBranch,
    byTech,
    kindTotals,
    topCustomers,
    topPartsRaw,
    trendOrders,
    itemDurationRows,
  ] = await Promise.all([
    prisma.serviceOrder.aggregate({
      where: revenueWhere,
      _sum: { totalAmount: true },
    }),
    prisma.serviceOrder.aggregate({
      where: internalWhere,
      _sum: { totalAmount: true },
    }),
    prisma.serviceOrder.count({ where: completedWhere }),
    prisma.serviceOrder.count({ where: revenueWhere }),
    prisma.serviceOrder.groupBy({
      by: ["status"],
      where: allInRangeWhere,
      _count: { _all: true },
    }),
    prisma.serviceOrder.groupBy({
      by: ["branchId", "isInternal"],
      where: completedWhere,
      _sum: { totalAmount: true },
      _count: { _all: true },
    }),
    prisma.serviceOrder.groupBy({
      by: ["assignedToId", "isInternal"],
      where: { ...completedWhere, assignedToId: { not: null } },
      _sum: { totalAmount: true },
      _count: { _all: true },
    }),
    prisma.serviceItem.groupBy({
      by: ["kind"],
      where: {
        order: revenueWhere,
      },
      _sum: { total: true },
    }),
    prisma.serviceOrder.groupBy({
      by: ["customerId"],
      // `_sum.totalAmount` NULL байвал Postgres DESC эрэмбэд хамгийн эхэнд
      // гаргадаг тул null дүнтэй захиалгыг хасна (aggregate orderBy `nulls`
      // дэмждэггүй).
      where: { ...revenueWhere, totalAmount: { not: null } },
      _sum: { totalAmount: true },
      _count: { _all: true },
      orderBy: [{ _sum: { totalAmount: "desc" } }, { customerId: "asc" }],
      take: 5,
    }),
    prisma.serviceItem.groupBy({
      by: ["serviceId"],
      where: {
        order: revenueWhere,
        serviceId: { not: null },
        service: { type: "GOODS" },
      },
      _sum: { quantity: true, total: true },
      _count: { _all: true },
      orderBy: { _sum: { total: "desc" } },
      take: 5,
    }),
    prisma.serviceOrder.findMany({
      where: revenueWhere,
      select: { completedAt: true, totalAmount: true },
    }),
    // `_avg`/`groupBy`-аар шууд хийж болохгүй (Prisma хоёр багана хоорондын
    // зөрүүг aggregate хийж чадахгүй) тул түүхий мөрүүдийг татаж доор JS
    // талд боловсруулна.
    prisma.serviceItem.findMany({
      where: {
        order: { tenantId: user.tenantId, ...branchFilter },
        status: "COMPLETED",
        kind: { in: ["LABOR", "DIAGNOSTIC"] },
        startedAt: { not: null },
        completedAt: { gte: range.from, lte: range.to },
      },
      select: { serviceId: true, kind: true, startedAt: true, completedAt: true },
    }),
  ]);

  // Мөрийн гүйцэтгэх хугацаа (минут) — нийт дундаж (LABOR+DIAGNOSTIC) болон
  // зөвхөн LABOR-ийг ажлын төрлөөр (serviceId) бүлэглэсэн эрэмбэ.
  // PENDING→COMPLETED шууд шилжсэн мөр (startedAt === completedAt, 0 минут)
  // бодит хугацаа биш тул дунджид ОРУУЛАХГҮЙ (`mins > 0`).
  const jobDurationsMinutes = itemDurationRows
    .map((r) => (r.completedAt!.getTime() - r.startedAt!.getTime()) / 60000)
    .filter((mins) => mins > 0);
  const avgJobDurationMinutes =
    jobDurationsMinutes.length > 0
      ? Math.round(
          jobDurationsMinutes.reduce((a, b) => a + b, 0) / jobDurationsMinutes.length,
        )
      : 0;

  const laborMinutesByService = new Map<string, number[]>();
  for (const r of itemDurationRows) {
    if (r.kind !== "LABOR" || !r.serviceId) continue;
    const mins = (r.completedAt!.getTime() - r.startedAt!.getTime()) / 60000;
    if (mins <= 0) continue;
    const arr = laborMinutesByService.get(r.serviceId) ?? [];
    arr.push(mins);
    laborMinutesByService.set(r.serviceId, arr);
  }
  const jobServiceIds = [...laborMinutesByService.keys()];

  // 2-р давалгаа — зөвхөн дээрх нэгтгэлд гарч ирсэн ID-уудыг л нэрлэхийн тулд
  // татна. Өмнө нь бүх салбар/ажилтан/үйлчлүүлэгч/сэлбэгийг татдаг байсан нь
  // том tenant дээр удаан байсныг (top-5 гаргахад мянга мянган мөр) зассан.
  const branchIds = [...new Set(byBranch.map((r) => r.branchId))].filter((id): id is string => Boolean(id));
  const techIds = [...new Set(byTech.map((r) => r.assignedToId))].filter((id): id is string => Boolean(id));
  const customerIds = topCustomers
    .map((r) => r.customerId)
    .filter((id): id is string => Boolean(id));
  // "Топ сэлбэг" (GOODS) болон "ажлын дундаж хугацаа" (LABOR) хоёулаа
  // Service.name/code хэрэгтэй тул нэг lookup batch-д нэгтгэнэ.
  const partIds = [
    ...new Set([
      ...topPartsRaw.map((r) => r.serviceId).filter((id): id is string => Boolean(id)),
      ...jobServiceIds,
    ]),
  ];

  const [branchesMap, techsMap, customersMap, partsMap] = await Promise.all([
    branchIds.length
      ? prisma.branch.findMany({
          where: { tenantId: user.tenantId, id: { in: branchIds } },
          select: { id: true, name: true },
        })
      : [],
    techIds.length
      ? prisma.user.findMany({
          where: { tenantId: user.tenantId, id: { in: techIds } },
          select: { id: true, firstName: true, lastName: true },
        })
      : [],
    customerIds.length
      ? prisma.customer.findMany({
          where: { tenantId: user.tenantId, id: { in: customerIds } },
          select: { id: true, fullName: true, phone: true },
        })
      : [],
    partIds.length
      ? prisma.service.findMany({
          where: { tenantId: user.tenantId, id: { in: partIds } },
          select: {
            id: true,
            code: true,
            name: true,
            unit: { select: { name: true } },
          },
        })
      : [],
  ]);

  const branchById = new Map(branchesMap.map((b) => [b.id, b]));
  const userById = new Map(techsMap.map((u) => [u.id, u]));
  const customerById = new Map(customersMap.map((c) => [c.id, c]));
  const partById = new Map(partsMap.map((p) => [p.id, p]));

  const totalRevenue = Number.parseFloat(
    revenueAgg._sum.totalAmount?.toString() ?? "0",
  );
  const internalCost = Number.parseFloat(
    internalAgg._sum.totalAmount?.toString() ?? "0",
  );
  // Дундаж дүн зөвхөн орлого үүсгэсэн (дотоод биш) захиалгаар.
  const avgTicket = revenueCount > 0 ? totalRevenue / revenueCount : 0;

  const statusCountMap = Object.fromEntries(
    statusCounts.map((s) => [s.status, s._count._all]),
  ) as Partial<Record<OrderStatus, number>>;
  const totalInRange = statusCounts.reduce((a, s) => a + s._count._all, 0);

  const statusRows = STATUS_ORDER.map((status) => {
    const count = statusCountMap[status] ?? 0;
    return {
      status,
      label: ORDER_STATUS_LABEL[status],
      count,
      pct: totalInRange > 0 ? Math.round((count / totalInRange) * 100) : 0,
    };
  });

  const activeCount =
    (statusCountMap.SCHEDULED ?? 0) + (statusCountMap.IN_PROGRESS ?? 0);

  // Branch breakdown
  const branchRows = mergeInternalSplit(
    byBranch.map((r) => ({ key: r.branchId, isInternal: r.isInternal, amount: r._sum.totalAmount, count: r._count._all })),
  )
    .map((r) => ({
      id: r.key,
      name: branchById.get(r.key)?.name ?? "—",
      revenue: r.revenue,
      internalCost: r.internalCost,
      count: r.count,
    }))
    .sort((a, b) => b.revenue - a.revenue);

  // Technician breakdown
  const techRows = mergeInternalSplit(
    byTech.map((r) => ({ key: r.assignedToId ?? "—", isInternal: r.isInternal, amount: r._sum.totalAmount, count: r._count._all })),
  )
    .map((r) => {
      const u = r.key !== "—" ? userById.get(r.key) : null;
      return {
        id: r.key,
        name: u ? `${u.lastName} ${u.firstName}` : "Хариуцагчгүй",
        revenue: r.revenue,
        internalCost: r.internalCost,
        count: r.count,
      };
    })
    .sort((a, b) => b.revenue - a.revenue);

  // Kind breakdown
  const kindTotalsRaw = KIND_ORDER.map((k) => {
    const found = kindTotals.find((kt) => kt.kind === k);
    return {
      kind: k,
      total: Number.parseFloat(found?._sum.total?.toString() ?? "0"),
    };
  });
  const kindTotal = kindTotalsRaw.reduce((a, r) => a + r.total, 0) || 1;
  const kindRows = kindTotalsRaw.map((r) => ({
    ...r,
    label: ITEM_KIND_LABEL[r.kind],
    pct: Math.round((r.total / kindTotal) * 100),
  }));

  // Top customers
  const customerRows = topCustomers.map((r) => {
    const c = customerById.get(r.customerId);
    return {
      id: r.customerId,
      name: c ? customerLabel(c) : "—",
      phone: c?.phone ?? "",
      revenue: Number.parseFloat(r._sum.totalAmount?.toString() ?? "0"),
      count: r._count._all,
    };
  });

  // Top parts (services of type GOODS)
  const partRows = topPartsRaw
    .filter((r) => r.serviceId)
    .map((r) => {
      const p = partById.get(r.serviceId!);
      return {
        id: r.serviceId!,
        name: p?.name ?? "—",
        sku: p?.code ?? "",
        unit: p?.unit?.name ?? "",
        qty: Number.parseFloat(r._sum.quantity?.toString() ?? "0"),
        revenue: Number.parseFloat(r._sum.total?.toString() ?? "0"),
      };
    });

  // Ажлын дундаж хугацаа (зөвхөн LABOR, тоогоор эрэмбэлж эхний 5)
  const jobDurationRows = [...laborMinutesByService.entries()]
    .map(([serviceId, minutesList]) => ({
      id: serviceId,
      name: partById.get(serviceId)?.name ?? "—",
      count: minutesList.length,
      avgMinutes: Math.round(
        minutesList.reduce((a, b) => a + b, 0) / minutesList.length,
      ),
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  const incomeRange: ResolvedIncomeRange = {
    key: "custom",
    from: range.from,
    to: range.to,
    fetchFrom: range.from,
    bucket: daySpan(range.from, range.to) > 45 ? "week" : "day",
    label: range.label,
  };
  const incomeSeries = buildIncomeSeries(trendOrders, incomeRange);

  return {
    totalRevenue,
    internalCost,
    completedCount,
    avgTicket,
    activeCount,
    statusRows,
    kindRows,
    branchRows,
    techRows,
    customerRows,
    partRows,
    avgJobDurationMinutes,
    jobDurationRows,
    income: { points: incomeSeries.points, changePct: incomeSeries.changePct },
  };
}
