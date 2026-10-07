import { jsonOk } from "@/lib/api";
import { resolveWorkingBranch } from "@/lib/auth/api-branch";
import { cashErrorResponse, requireCashApiUser } from "@/lib/cash/http";
import { getCurrentSession, resolveSessionBranch } from "@/lib/cash/session";

// GET /api/v1/cash/sessions/current?branchId=  (branchId optional when the working branch is pinned)
// -> { branchId, session: CashSession | null }   // session = the branch's open session with live expectedCash
export async function GET(req: Request) {
  const auth = await requireCashApiUser(req);
  if (auth.response) return auth.response;
  const scopeResult = await resolveWorkingBranch(req, auth.user);
  if (scopeResult.response) return scopeResult.response;
  const requested = new URL(req.url).searchParams.get("branchId");
  try {
    const branchId = resolveSessionBranch(auth.user, scopeResult.branchId, requested);
    const session = await getCurrentSession({ actor: auth.user, scope: scopeResult.branchId, branchId });
    return jsonOk({ branchId, session });
  } catch (error) {
    return cashErrorResponse("sessions.current", error);
  }
}
