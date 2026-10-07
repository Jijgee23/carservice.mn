import { jsonError, jsonOk } from "@/lib/api";
import { resolveWorkingBranch } from "@/lib/auth/api-branch";
import { cashErrorResponse, readJsonObject, requireCashApiUser } from "@/lib/cash/http";
import { closeCashSession } from "@/lib/cash/session";
import { requireActiveSubscriptionApi } from "@/lib/subscription-server";

// POST /api/v1/cash/sessions/[id]/close  { countedCash, methodCounts?: [{ method, bank?, counted? }], note? } -> 200 { session: CashSession (CLOSED) }
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireCashApiUser(req);
  if (auth.response) return auth.response;
  const locked = await requireActiveSubscriptionApi(auth.user);
  if (locked) return locked;
  const body = await readJsonObject(req);
  if (!body) return jsonError(400, "JSON object шаардлагатай.");
  const scopeResult = await resolveWorkingBranch(req, auth.user);
  if (scopeResult.response) return scopeResult.response;
  const { id } = await ctx.params;
  try {
    const session = await closeCashSession({ actor: auth.user, scope: scopeResult.branchId, sessionId: id, countedCash: body.countedCash, methodCounts: body.methodCounts, note: body.note });
    return jsonOk({ session });
  } catch (error) {
    return cashErrorResponse("sessions.close", error);
  }
}
