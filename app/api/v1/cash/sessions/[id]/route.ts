import { jsonOk } from "@/lib/api";
import { resolveWorkingBranch } from "@/lib/auth/api-branch";
import { cashErrorResponse, requireCashApiUser } from "@/lib/cash/http";
import { getSessionDetail } from "@/lib/cash/session";

// GET /api/v1/cash/sessions/[id]
// -> { session, entries: CashEntry[] (live), voidedEntries: CashEntry[], postCloseVoids: { count, incomeAmount, expenseAmount, netAmount, entries } }
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireCashApiUser(req);
  if (auth.response) return auth.response;
  const scopeResult = await resolveWorkingBranch(req, auth.user);
  if (scopeResult.response) return scopeResult.response;
  const { id } = await ctx.params;
  try {
    return jsonOk(await getSessionDetail({ actor: auth.user, scope: scopeResult.branchId, sessionId: id }));
  } catch (error) {
    return cashErrorResponse("sessions.detail", error);
  }
}
