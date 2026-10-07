import { jsonError, jsonOk } from "@/lib/api";
import { serializeCashType, updateCashType } from "@/lib/cash/types";
import { cashErrorResponse, readJsonObject, requireCashApiUser } from "@/lib/cash/http";
import { requireActiveSubscriptionApi } from "@/lib/subscription-server";

// PATCH /api/v1/cash/types/{id} { name?, isActive? } -> { type: CashType }
// System types (systemKey != null) -> 422 CASH_TYPE_SYSTEM.
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireCashApiUser(req);
  if (auth.response) return auth.response;
  const locked = await requireActiveSubscriptionApi(auth.user);
  if (locked) return locked;
  const body = await readJsonObject(req);
  if (!body) return jsonError(400, "JSON object шаардлагатай.");
  const { id } = await ctx.params;
  try {
    const type = await updateCashType({ actor: auth.user, typeId: id, name: body.name, isActive: body.isActive });
    return jsonOk({ type: serializeCashType(type) });
  } catch (error) {
    return cashErrorResponse("types.update", error);
  }
}
