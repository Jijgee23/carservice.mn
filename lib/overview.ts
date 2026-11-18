// P7-B1 — dashboard home aggregate, extracted from `app/dashboard/page.tsx`
// so both the web page and `GET /api/v1/overview` call the exact same
// loader. Query shape, branch scoping and tenant-wide counts are unchanged
// from the original inline `Promise.all` — only moved.

import { Prisma } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { orderReadWhere, type OrderAccessUser } from "@/lib/auth/order-access";
import { workingBranchScopeId } from "@/lib/auth/roles";
import {
  RECEIVABLE_ORDER_SELECT,
  RECEIVABLE_ORDER_WHERE,
  sumReceivable,
} from "@/lib/orders/order-receivable";
import { resolveActiveSubscription } from "@/lib/subscription";
import { dailyTrend, type Trend } from "@/app/dashboard/trend";
import {
  type IncomeRangeKey,
  buildIncomeSeries,
  resolveIncomeRange,
  type ResolvedIncomeRange,
} from "@/app/dashboard/income-range";

export { dailyTrend, type Trend };

/**
 * The subset of the caller's identity the loader needs. The web page's
 * `requireUser()` result satisfies this directly (it carries
 * `workingBranchId`); an API-token actor has no such field, so route callers
 * thread the header-resolved branch scope through explicitly (mirroring
 * `app/api/v1/appointments/route.ts`'s `resolveWorkingBranch` pattern) —
 * `undefined`/`null` there means unscoped, same as `workingBranchScopeId`'s
 * own contract.
 */
export type OverviewUser = {
  tenantId: string;
  workingBranchId?: string | null;
  /**
   * Order read-access identity (id/isOwner/role). When given, the receivable is
   * limited by `orderReadWhere` so the card equals what the user can see in the
   * orders list (own-scope users: only their assigned orders). Omit = unscoped.
   */
  orderAccess?: OrderAccessUser;
};

export type OverviewParams = {
  range?: string;
  from?: string;
  to?: string;
};

/**
 * Аль хэсгийг ТООЦООЛОХ вэ. Нүүр дэлгэцийн «дүр» (lib/dashboard-persona.ts) орлого, «Бааз»-ыг
 * харуулдаггүй бол тэдгээрийн query-г огт ажиллуулахгүй (хамгийн хүнд нь хугацааны бүх дууссан
 * захиалгыг татдаг). Алгассан хэсэг: тоо 0, жагсаалт хоосон — дуудагч харуулдаггүй тул хамаагүй.
 * Анхдагч: бүгд true (GET /api/v1/overview өмнөх шигээ).
 */
export type OverviewInclude = {
  /** Орлого (хугацааны дууссан захиалга), дотоод зардал. */
  income?: boolean;
  /** Бааз: салбар/ажилтан/үйлчлүүлэгч/машины тоо ба тэдгээрийн 14 хоногийн хандлага, дараа төлбөрт машин. */
  base?: boolean;
};

/**
 * Loads every aggregate the dashboard home renders. Branch-scoped where the
 * original page scoped orders/income by `workingBranchScopeId`; tenant-wide
 * for entity counts (branches, employees, customers, vehicles) — unchanged.
 */
export async function loadOverviewData(
  user: OverviewUser,
  params: OverviewParams = {},
  include: OverviewInclude = {},
) {
  const withIncome = include.income !== false;
  const withBase = include.base !== false;
  const incomeRange = resolveIncomeRange(params);

  // 14-day window for the stat-card trend sparklines.
  const now = new Date();
  const trendStart = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() - 13,
  );
  const recentWhere = {
    tenantId: user.tenantId,
    createdAt: { gte: trendStart },
  };
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  // Салбараар хязгаарлагдсан ажилтны хувьд захиалга/орлогын тоог салбараар нь шүүнэ.
  const scopeBranchId = workingBranchScopeId({
    workingBranchId: user.workingBranchId ?? undefined,
  });
  const orderBranchFilter = scopeBranchId ? { branchId: scopeBranchId } : {};
  // Зөвхөн ӨӨРИЙН хуудас харах эрхтэй ажилтан (orders.viewOwn) бусдын хуудас, дүнг нүүр дэлгэцээс
  // харахгүй — жагсаалт (orders/page.tsx)-тай ижил orderReadWhere.
  const orderRead = user.orderAccess ? orderReadWhere(user.orderAccess) : {};

  const [
    branchCount,
    employeeCount,
    customerCount,
    vehicleCount,
    openOrderCount,
    completedThisMonth,
    incomeOrders,
    internalCostSums,
    subscriptions,
    orderDates,
    completedDates,
    customerDates,
    vehicleDates,
    branchDates,
    employeeDates,
    recentlyUpdatedOrders,
    postpaidVehicleCount,
    receivableOrders,
    todayOrderCount,
  ] = await Promise.all([
    withBase ? prisma.branch.count({ where: { tenantId: user.tenantId } }) : Promise.resolve(0),
    withBase ? prisma.user.count({ where: { tenantId: user.tenantId, deletedAt: null } }) : Promise.resolve(0),
    withBase ? prisma.customer.count({ where: { tenantId: user.tenantId } }) : Promise.resolve(0),
    withBase ? prisma.tenantVehicle.count({ where: { tenantId: user.tenantId } }) : Promise.resolve(0),
    prisma.serviceOrder.count({
      where: {
        tenantId: user.tenantId,
        ...orderBranchFilter,
        ...orderRead,
        status: { in: ["SCHEDULED", "IN_PROGRESS"] },
      },
    }),
    prisma.serviceOrder.count({
      where: {
        tenantId: user.tenantId,
        ...orderBranchFilter,
        ...orderRead,
        status: "COMPLETED",
        completedAt: {
          gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
        },
      },
    }),
    withIncome ? prisma.serviceOrder.findMany({
      where: {
        tenantId: user.tenantId,
        ...orderBranchFilter,
        ...orderRead,
        status: "COMPLETED",
        // Дотоод засвар орлогод орохгүй — «Дотоод зардал»-д тусад нь.
        isInternal: false,
        completedAt: { gte: incomeRange.fetchFrom, lte: incomeRange.to },
      },
      select: { completedAt: true, totalAmount: true },
    }) : Promise.resolve([] as Array<{ completedAt: Date | null; totalAmount: Prisma.Decimal }>),
    withIncome ? prisma.serviceOrder.aggregate({
      where: {
        tenantId: user.tenantId,
        ...orderBranchFilter,
        ...orderRead,
        status: "COMPLETED",
        isInternal: true,
        completedAt: { gte: incomeRange.from, lte: incomeRange.to },
      },
      _sum: { totalAmount: true },
    }) : Promise.resolve({ _sum: { totalAmount: null } as { totalAmount: Prisma.Decimal | null } }),
    prisma.subscription.findMany({
      where: { tenantId: user.tenantId },
      orderBy: { startsAt: "desc" },
      select: {
        id: true,
        plan: true,
        status: true,
        startsAt: true,
        endsAt: true,
      },
    }),
    prisma.serviceOrder.findMany({
      where: { ...recentWhere, ...orderBranchFilter, ...orderRead },
      select: { createdAt: true },
    }),
    prisma.serviceOrder.findMany({
      where: {
        tenantId: user.tenantId,
        ...orderBranchFilter,
        ...orderRead,
        status: "COMPLETED",
        completedAt: { gte: trendStart },
      },
      select: { completedAt: true },
    }),
    withBase ? prisma.customer.findMany({
      where: recentWhere,
      select: { createdAt: true },
    }) : Promise.resolve([] as Array<{ createdAt: Date }>),
    withBase ? prisma.tenantVehicle.findMany({
      where: recentWhere,
      select: { createdAt: true },
    }) : Promise.resolve([] as Array<{ createdAt: Date }>),
    withBase ? prisma.branch.findMany({
      where: recentWhere,
      select: { createdAt: true },
    }) : Promise.resolve([] as Array<{ createdAt: Date }>),
    withBase ? prisma.user.findMany({
      where: recentWhere,
      select: { createdAt: true },
    }) : Promise.resolve([] as Array<{ createdAt: Date }>),
    prisma.serviceOrder.findMany({
      where: { tenantId: user.tenantId, ...orderBranchFilter, ...orderRead },
      orderBy: { updatedAt: "desc" },
      take: 5,
      select: {
        id: true,
        number: true,
        status: true,
        updatedAt: true,
        customer: { select: { fullName: true, phone: true } },
        vehicle: { select: { plate: true } },
        items: { select: { status: true, kind: true } },
      },
    }),
    withBase ? prisma.tenantVehicle.count({
      where: { tenantId: user.tenantId, isPostpaid: true },
    }) : Promise.resolve(0),
    // Авлага: бүх дууссан (дотоод биш) захиалгын төлөгдөөгүй үлдэгдэл — дараа төлбөрт эсэхээс үл хамаарна.
    prisma.serviceOrder.findMany({
      where: {
        tenantId: user.tenantId,
        ...orderBranchFilter,
        ...(user.orderAccess ? orderReadWhere(user.orderAccess) : {}),
        ...RECEIVABLE_ORDER_WHERE,
      },
      select: RECEIVABLE_ORDER_SELECT,
    }),
    prisma.serviceOrder.count({
      where: { tenantId: user.tenantId, createdAt: { gte: todayStart }, ...orderRead },
    }),
  ]);
  const activeSub = resolveActiveSubscription(subscriptions);

  const receivable = sumReceivable(receivableOrders);

  const income = buildIncomeSeries(incomeOrders, incomeRange);
  // Сонгосон хугацааны дууссан дотоод засварын нийт дүн (орлогын мужтай ижил).
  const internalCost = new Prisma.Decimal(internalCostSums._sum.totalAmount ?? 0);

  // Per-card growth/decline trends.
  const orderTrend = dailyTrend(orderDates.map((o) => o.createdAt));
  const completedTrend = dailyTrend(completedDates.map((o) => o.completedAt));
  const customerTrend = dailyTrend(customerDates.map((c) => c.createdAt));
  const vehicleTrend = dailyTrend(vehicleDates.map((v) => v.createdAt));
  const branchTrend = dailyTrend(branchDates.map((b) => b.createdAt));
  const employeeTrend = dailyTrend(employeeDates.map((e) => e.createdAt));

  return {
    incomeRange,
    branchCount,
    employeeCount,
    customerCount,
    vehicleCount,
    openOrderCount,
    completedThisMonth,
    subscriptions,
    activeSub,
    recentlyUpdatedOrders,
    postpaidVehicleCount,
    receivable,
    todayOrderCount,
    income,
    internalCost,
    orderTrend,
    completedTrend,
    customerTrend,
    vehicleTrend,
    branchTrend,
    employeeTrend,
  };
}

export type OverviewData = Awaited<ReturnType<typeof loadOverviewData>>;
export type { IncomeRangeKey, ResolvedIncomeRange };
