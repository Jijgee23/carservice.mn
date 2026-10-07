import { jsonError, jsonOk } from "@/lib/api";
import { resolveWorkingBranch } from "@/lib/auth/api-branch";
import { voidCashEntry } from "@/lib/cash/ledger";
import { cashErrorResponse, readJsonObject, requireCashApiUser } from "@/lib/cash/http";
import { requireActiveSubscriptionApi } from "@/lib/subscription-server";

// POST /api/v1/cash/entries/{id}/void  { reason }  -> { entry: CashEntry }
// Entries are never edited or deleted. Auto entries -> 422 CASH_SYSTEM_ENTRY.
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
    const entry = await voidCashEntry({ actor: auth.user, scope: scopeResult.branchId, entryId: id, reason: body.reason });
    return jsonOk({ entry });
  } catch (error) {
    return cashErrorResponse("entries.void", error);
  }
}
