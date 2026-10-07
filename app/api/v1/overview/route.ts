// Contract — GET /api/v1/overview (P7-B1)
//
// GET /api/v1/overview
//   Auth only (no extra permission code — matches the web dashboard home,
//   which every authenticated staff member sees).
//   Query: none. Optional `range`/`from`/`to` are accepted purely to mirror
//   the web page's income-range picker (same defaults as `resolveIncomeRange`
//   when omitted); unknown params are rejected.
//   200: { overview: OverviewDto }
//   Errors: 401, 422 (VALIDATION for an unknown param).
//
// Dates are serialized as ISO strings, Decimal/Prisma.Decimal values as
// plain decimal strings — `JSON.stringify` cannot serialize `Decimal`
// sensibly on its own.

import { prisma } from "@/lib/prisma";
import { findOrderIdsWithLockedPayment } from "@/lib/cash/session-attach";
import { jsonError, jsonOk, requireApiUser } from "@/lib/api";
import { rejectUnknownParams } from "@/lib/list-query-params";
import { resolveWorkingBranch } from "@/lib/auth/api-branch";
import { loadOverviewData } from "@/lib/overview";

const ALLOWED_PARAMS = ["range", "from", "to"] as const;

export async function GET(req: Request) {
  const auth = await requireApiUser(req);
  if (auth.response) return auth.response;

  const { searchParams } = new URL(req.url);
  const unknown = rejectUnknownParams(searchParams, ALLOWED_PARAMS);
  if (unknown) {
    return jsonError(422, unknown.message, {
      code: "VALIDATION",
      fieldErrors: { [unknown.field]: unknown.message },
    });
  }

  const scopeResult = await resolveWorkingBranch(req, auth.user);
  if (scopeResult.response) return scopeResult.response;

  const data = await loadOverviewData(
    {
      tenantId: auth.user.tenantId,
      orderAccess: auth.user,
      ...(scopeResult.branchId ? { workingBranchId: scopeResult.branchId } : {}),
    },
    {
      range: searchParams.get("range") ?? undefined,
      from: searchParams.get("from") ?? undefined,
      to: searchParams.get("to") ?? undefined,
    },
  );

  const lockedOrderIds = await findOrderIdsWithLockedPayment(prisma, auth.user.tenantId, data.recentlyUpdatedOrders.map((o) => o.id));
  return jsonOk({
    overview: {
      incomeRange: {
        key: data.incomeRange.key,
        from: data.incomeRange.from.toISOString(),
        to: data.incomeRange.to.toISOString(),
        label: data.incomeRange.label,
      },
      counts: {
        branches: data.branchCount,
        employees: data.employeeCount,
        customers: data.customerCount,
        vehicles: data.vehicleCount,
        openOrders: data.openOrderCount,
        completedThisMonth: data.completedThisMonth,
        todayOrders: data.todayOrderCount,
      },
      trends: {
        orders: data.orderTrend,
        completed: data.completedTrend,
        customers: data.customerTrend,
        vehicles: data.vehicleTrend,
        branches: data.branchTrend,
        employees: data.employeeTrend,
      },
      income: {
        total: data.income.total,
        changePct: data.income.changePct,
        points: data.income.points,
      },
      // Сонгосон хугацааны дууссан дотоод засварын нийт дүн (орлогод орохгүй).
      internalCost: data.internalCost.toString(),
      subscription: data.activeSub
        ? {
            plan: data.activeSub.subscription.plan,
            status: data.activeSub.subscription.status,
            expiresAt: data.activeSub.expiresAt?.toISOString() ?? null,
            daysLeft: data.activeSub.daysLeft,
          }
        : null,
      planLimits: data.planLimits,
      postpaid: {
        vehicleCount: data.postpaidVehicleCount,
        // Field name kept for compatibility. QA #11: value is now the outstanding balance of ALL
        // completed non-internal orders (postpaid or not), not postpaid-only.
        receivable: data.receivable.toString(),
      },
      recentlyUpdatedOrders: data.recentlyUpdatedOrders.map((o) => ({
        id: o.id,
        hasLockedPayment: lockedOrderIds.has(o.id),
        number: o.number,
        status: o.status,
        updatedAt: o.updatedAt.toISOString(),
        customerName: o.customer.fullName,
        vehiclePlate: o.vehicle.plate,
        items: o.items.map((it) => ({ status: it.status, kind: it.kind })),
      })),
    },
  });
}
