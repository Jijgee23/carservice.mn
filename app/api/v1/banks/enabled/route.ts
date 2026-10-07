import { jsonError, jsonOk, requireApiUser } from "@/lib/api";
import { hasPermission } from "@/lib/auth/roles";
import { requireActiveSubscriptionApi } from "@/lib/subscription-server";
import { setTenantEnabledBanks, TenantBanksError } from "@/lib/tenant-banks";

// PUT /api/v1/banks/enabled { enabledBanks: string[] } — permission: cash.manage.
export async function PUT(req: Request) {
  const auth = await requireApiUser(req);
  if (auth.response) return auth.response;
  if (!hasPermission(auth.user, "cash.manage")) return jsonError(403, "Танд кассыг удирдах эрх байхгүй.", { code: "CASH_MANAGE_FORBIDDEN" });
  const locked = await requireActiveSubscriptionApi(auth.user);
  if (locked) return locked;
  let body: unknown;
  try { body = await req.json(); } catch { return jsonError(400, "JSON body шаардлагатай."); }
  if (body == null || typeof body !== "object" || Array.isArray(body)) return jsonError(400, "JSON object шаардлагатай.");
  try {
    const payload = await setTenantEnabledBanks({ actor: auth.user, enabledBanks: (body as Record<string, unknown>).enabledBanks });
    return jsonOk(payload);
  } catch (error) {
    if (error instanceof TenantBanksError) return jsonError(error.status, error.message, { code: error.code });
    console.error("[banks/enabled] update failed");
    return jsonError(500, "Серверийн алдаа гарлаа. Дахин оролдоно уу.");
  }
}
