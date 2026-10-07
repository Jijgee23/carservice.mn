import { resolveWorkingBranch } from "@/lib/auth/api-branch";
import { jsonOk } from "@/lib/api";
import { cashErrorResponse, requireCashApiUser } from "@/lib/cash/http";
import { listEligiblePostpaidOrders } from "@/lib/cash/settlement";

// GET /api/v1/cash/settlements/eligible?customerId=&branchId=
// -> { orders: [{ id, number, plate, completedAt, totalAmount, paidAmount, outstanding }], total }
// Postpaid COMPLETED orders of that customer in that branch with outstanding > 0 (money as decimal strings).
export async function GET(req: Request) {
  const auth = await requireCashApiUser(req);
  if (auth.response) return auth.response;
  const scopeResult = await resolveWorkingBranch(req, auth.user);
  if (scopeResult.response) return scopeResult.response;
  const params = new URL(req.url).searchParams;
  try {
    const result = await listEligiblePostpaidOrders({ actor: auth.user, scope: scopeResult.branchId, customerId: params.get("customerId"), branchId: params.get("branchId") });
    return jsonOk(result);
  } catch (error) {
    return cashErrorResponse("settlements.eligible", error);
  }
}
