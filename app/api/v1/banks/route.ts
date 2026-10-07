import { jsonError, jsonOk, requireApiUser } from "@/lib/api";
import { getTenantBanks } from "@/lib/tenant-banks";

// GET /api/v1/banks — fixed bank list + this tenant's enabled codes.
// Any authenticated staff user (pickers need it); managing is PUT /banks/enabled.
export async function GET(req: Request) {
  const auth = await requireApiUser(req);
  if (auth.response) return auth.response;
  try {
    return jsonOk(await getTenantBanks(auth.user.tenantId));
  } catch {
    console.error("[banks] load failed");
    return jsonError(500, "Серверийн алдаа гарлаа. Дахин оролдоно уу.");
  }
}
