import { resolveWorkingBranch } from "@/lib/auth/api-branch";
import { jsonOk } from "@/lib/api";
import { cashErrorResponse, requireCashApiUser } from "@/lib/cash/http";
import { getSettlement } from "@/lib/cash/settlement";

// GET /api/v1/cash/settlements/{id} -> { settlement: SettlementDetail }  (orders + amounts, ledger entry)
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireCashApiUser(req);
  if (auth.response) return auth.response;
  const { id } = await ctx.params;
  const scopeResult = await resolveWorkingBranch(req, auth.user);
  if (scopeResult.response) return scopeResult.response;
  try {
    const settlement = await getSettlement({ actor: auth.user, scope: scopeResult.branchId, settlementId: id });
    return jsonOk({ settlement });
  } catch (error) {
    return cashErrorResponse("settlements.get", error);
  }
}
