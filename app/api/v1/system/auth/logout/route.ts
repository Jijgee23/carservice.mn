// Contract — POST /api/v1/system/auth/logout  { refreshToken } → { ok: true }
// Энэ төхөөрөмжийн refresh token-ыг revoke (idempotent). Access token ≤ 1 цагт өөрөө дуусна; апп хоёуланг устгана.

import { enforceRateLimit, jsonError, jsonOk } from "@/lib/api";
import { revokeSystemRefreshToken } from "@/lib/auth/system-refresh-token";
import { setBypassContext } from "@/lib/tenant-context";

export async function POST(req: Request) {
  const limited = enforceRateLimit(req, "system-api-logout", { limit: 30, windowMs: 60_000 });
  if (limited) return limited;
  setBypassContext();

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError(400, "Body нь JSON байх ёстой.");
  }
  const refreshToken = body && typeof body === "object" ? (body as { refreshToken?: unknown }).refreshToken : undefined;
  if (typeof refreshToken !== "string" || !refreshToken.trim()) return jsonError(400, "refreshToken-ийг текстээр илгээнэ үү.");
  await revokeSystemRefreshToken(refreshToken.trim());
  return jsonOk({ ok: true });
}
