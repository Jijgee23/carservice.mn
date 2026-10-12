import { jsonError, jsonOk, requireApiUser } from "@/lib/api";
import { hasPermission } from "@/lib/auth/roles";
import { updatePaymentAccount } from "@/lib/payment-account-service";
import { PaymentAccountError } from "@/lib/payment-accounts";
import { requireActiveSubscriptionApi } from "@/lib/subscription-server";

// PATCH /api/v1/payment-accounts/[id] { name?, accountNumber?, terminalId?, merchantId?, isTest?, isActive? } -> { account } — cash.manage.
// No DELETE: accounts are deactivated, never removed (spec P7). `type` is immutable.
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireApiUser(req);
  if (auth.response) return auth.response;
  if (!hasPermission(auth.user, "cash.manage")) return jsonError(403, "Танд кассыг удирдах эрх байхгүй.", { code: "CASH_MANAGE_FORBIDDEN" });
  const locked = await requireActiveSubscriptionApi(auth.user);
  if (locked) return locked;
  let body: unknown;
  try { body = await req.json(); } catch { return jsonError(400, "JSON body шаардлагатай."); }
  if (body == null || typeof body !== "object" || Array.isArray(body)) return jsonError(400, "JSON object шаардлагатай.");
  const { id } = await ctx.params;
  try {
    const account = await updatePaymentAccount({ actor: auth.user, id, data: body });
    return jsonOk({ account });
  } catch (error) {
    if (error instanceof PaymentAccountError) {
      return jsonError(error.status, error.message, { code: error.code, fieldErrors: error.fieldErrors });
    }
    console.error("[payment-accounts/[id]] update failed");
    return jsonError(500, "Серверийн алдаа гарлаа. Дахин оролдоно уу.");
  }
}
