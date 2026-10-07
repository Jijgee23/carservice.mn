import { jsonError, jsonOk } from "@/lib/api";
import { resolveWorkingBranch } from "@/lib/auth/api-branch";
import { cashErrorResponse, readJsonObject, requireCashApiUser } from "@/lib/cash/http";
import { voidPostpaidSettlement } from "@/lib/cash/settlement";
import { requireActiveSubscriptionApi } from "@/lib/subscription-server";

// POST /api/v1/cash/settlements/{id}/void  { reason }  -> { settlement: SettlementDetail }
// Permission: cash.manage AND orders.closeUnpaidPostpaid. Whole settlement only.
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireCashApiUser(req);
  if (auth.response) return auth.response;
  const locked = await requireActiveSubscriptionApi(auth.user);
  if (locked) return locked;
  const body = await readJsonObject(req);
  if (!body) return jsonError(400, "JSON object шаардлагатай.");
  const { id } = await ctx.params;
  const scopeResult = await resolveWorkingBranch(req, auth.user);
  if (scopeResult.response) return scopeResult.response;
  try {
    const settlement = await voidPostpaidSettlement({ actor: auth.user, scope: scopeResult.branchId, settlementId: id, reason: body.reason });
    return jsonOk({ settlement });
  } catch (error) {
    return cashErrorResponse("settlements.void", error);
  }
}
