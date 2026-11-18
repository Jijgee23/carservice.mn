import { enforceRateLimit, jsonError, jsonOk } from "@/lib/api";
import { revokeAccountRefreshToken } from "@/lib/auth/account-refresh-token";
import { setBypassContext } from "@/lib/tenant-context";

// POST /api/v1/app/auth/logout  { refreshToken } → { ok: true }. Энэ төхөөрөмжийн refresh token-ыг revoke хийнэ
// (idempotent: олдохгүй/аль хэдийн revoke хийсэн ч 200). Access token хугацаа дуустал (≤ 1 цаг) хүчинтэй хэвээр
// байж болно — апп өөрөө хоёуланг нь устгана. Push төхөөрөмжийг DELETE /api/v1/app/devices/{deviceId}-ээр хасна.
export async function POST(req: Request) {
  const limited = enforceRateLimit(req, "app-logout", { limit: 30, windowMs: 60_000 });
  if (limited) return limited;
  setBypassContext();

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError(400, "Body нь JSON байх ёстой.");
  }
  const refreshToken = body && typeof body === "object" ? (body as { refreshToken?: unknown }).refreshToken : undefined;
  if (typeof refreshToken !== "string" || !refreshToken.trim()) {
    return jsonError(400, "refreshToken-ийг текстээр илгээнэ үү.");
  }
  await revokeAccountRefreshToken(refreshToken.trim());
  return jsonOk({ ok: true });
}
