import { Prisma } from "@/app/generated/prisma/client";
import { findOrderIdsWithLockedPayment } from "@/lib/cash/session-attach";
import { jsonError, jsonOk, requireApiUser } from "@/lib/api";
import { resolveWorkingBranch } from "@/lib/auth/api-branch";
import { orderReadWhere } from "@/lib/auth/order-access";
import { buildMeta } from "@/lib/pagination";
import { prisma } from "@/lib/prisma";
import { PAID_AT_SELECT, withPaidInFull } from "@/lib/orders/order-payment-totals";
import {
  buildPostpaidAggregateWhere,
  buildPostpaidHistoryWhere,
  buildPostpaidVisibleOrdersWhere,
  parsePostpaidQuery,
  serializePostpaidVehicleAggregates,
} from "@/lib/orders/order-postpaid-query";

const HISTORY_SELECT = {
  id: true,
  number: true,
  status: true,
  paymentStatus: true,
  scheduledAt: true,
  completedAt: true,
  createdAt: true,
  totalAmount: true,
  paidAmount: true,
  plateSnapshot: true,
  vinSnapshot: true,
  ...PAID_AT_SELECT,
  customer: { select: { id: true, fullName: true, phone: true } },
  vehicle: { select: { id: true, plate: true, make: true, model: true } },
  branch: { select: { id: true, name: true } },
} satisfies Prisma.ServiceOrderSelect;

function decimalOrNull(value: Prisma.Decimal | null): string | null {
  return value?.toString() ?? null;
}

export async function GET(req: Request) {
  const auth = await requireApiUser(req);
  if (auth.response) return auth.response;

  const parsed = parsePostpaidQuery(new URL(req.url).searchParams);
  if (!parsed.ok) return jsonError(400, parsed.message, { field: parsed.field });

  const scopeResult = await resolveWorkingBranch(req, auth.user);
  if (scopeResult.response) return scopeResult.response;

  const scope = {
    tenantId: auth.user.tenantId,
    workingBranchId: scopeResult.branchId,
    readWhere: orderReadWhere(auth.user),
  };
  const visibleOrdersWhere = buildPostpaidVisibleOrdersWhere(scope);
  const aggregateWhere = buildPostpaidAggregateWhere(scope);
  const historyWhere = buildPostpaidHistoryWhere(parsed.value, scope);

  // TenantVehicle has no direct ServiceOrder relation. Discover vehicle IDs
  // through the fully scoped order predicate first, so even the vehicle-link
  // list cannot reveal a postpaid vehicle outside branch/viewOwn access.
  const visibleVehicleRows = await prisma.serviceOrder.findMany({
    where: visibleOrdersWhere,
    distinct: ["vehicleId"],
    select: { vehicleId: true },
  });
  const visibleVehicleIds = visibleVehicleRows.map((row) => row.vehicleId);

  const [links, sums, historyOrders, filteredTotal] = await Promise.all([
    prisma.tenantVehicle.findMany({
      where: {
        tenantId: auth.user.tenantId,
        isPostpaid: true,
        vehicleId: { in: visibleVehicleIds },
      },
      orderBy: { createdAt: "desc" },
      select: {
        vehicle: { select: { id: true, plate: true, make: true, model: true } },
        customer: { select: { id: true, fullName: true, phone: true } },
      },
    }),
    prisma.serviceOrder.groupBy({
      by: ["vehicleId"],
      where: aggregateWhere,
      _count: { _all: true },
      _sum: { totalAmount: true, paidAmount: true },
    }),
    prisma.serviceOrder.findMany({
      where: historyWhere,
      orderBy: [{ scheduledAt: "desc" }, { createdAt: "desc" }, { id: "desc" }],
      skip: parsed.value.skip,
      take: parsed.value.take,
      select: HISTORY_SELECT,
    }),
    prisma.serviceOrder.count({ where: historyWhere }),
  ]);

  const vehicles = serializePostpaidVehicleAggregates(links, sums);
  const lockedOrderIds = await findOrderIdsWithLockedPayment(prisma, auth.user.tenantId, historyOrders.map((o) => o.id));
  const orders = historyOrders.map(withPaidInFull).map((order) => ({
    id: order.id,
    hasLockedPayment: lockedOrderIds.has(order.id),
    number: order.number,
    status: order.status,
    paymentStatus: order.paymentStatus,
    scheduledAt: order.scheduledAt?.toISOString() ?? null,
    completedAt: order.completedAt?.toISOString() ?? null,
    createdAt: order.createdAt.toISOString(),
    totalAmount: decimalOrNull(order.totalAmount),
    paidAmount: decimalOrNull(order.paidAmount),
    paidInFullBeforeCompletion: order.paidInFullBeforeCompletion,
    plateSnapshot: order.plateSnapshot,
    vinSnapshot: order.vinSnapshot,
    customer: order.customer,
    vehicle: order.vehicle,
    branch: order.branch,
  }));

  const zero = new Prisma.Decimal(0);
  const summary = vehicles.reduce(
    (result, vehicle) => ({
      orderCount: result.orderCount + vehicle.orderCount,
      totalAmount: result.totalAmount.plus(vehicle.totalAmount),
      paidAmount: result.paidAmount.plus(vehicle.paidAmount),
      balanceAmount: result.balanceAmount.plus(vehicle.balanceAmount),
    }),
    { orderCount: 0, totalAmount: zero, paidAmount: zero, balanceAmount: zero },
  );

  return jsonOk({
    vehicles,
    summary: {
      orderCount: summary.orderCount,
      totalAmount: summary.totalAmount.toString(),
      paidAmount: summary.paidAmount.toString(),
      balanceAmount: summary.balanceAmount.toString(),
    },
    orders,
    pagination: buildMeta(
      filteredTotal,
      parsed.value.page,
      parsed.value.pageSize,
    ),
  });
}
