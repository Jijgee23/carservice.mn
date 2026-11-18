// Contract — POST /api/v1/system/auth/refresh  { refreshToken }
// Шинэ access (1 цаг) + шинэ refresh token (ротаци). Хуучин refreshToken нэг л удаа хүчинтэй.
// 200: { accessToken, accessTokenExpiresInSeconds, refreshToken, refreshTokenExpiresInSeconds, refreshTokenExpiresAt }
// 401: { reason: "invalid" | "expired" | "reused" } — дахин нэвтэрнэ. Нэвтрэх шаардлагагүй. Rate limit 30/мин (IP).

import { enforceRateLimit, jsonError, jsonOk } from "@/lib/api";
import { passwordFingerprint, signSystemApiToken, SYSTEM_ACCESS_TOKEN_SECONDS } from "@/lib/auth/system-api";
import { rotateSystemRefreshToken, SYSTEM_REFRESH_MAX_AGE_SECONDS } from "@/lib/auth/system-refresh-token";
import { ipOrNull } from "@/lib/rate-limit";
import { setBypassContext } from "@/lib/tenant-context";

export async function POST(req: Request) {
  const limited = enforceRateLimit(req, "system-api-refresh", { limit: 30, windowMs: 60_000 });
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

  const result = await rotateSystemRefreshToken(refreshToken.trim(), { userAgent: req.headers.get("user-agent"), ip: ipOrNull(req.headers) });
  if (!result.ok) {
    const message =
      result.reason === "expired"
        ? "Refresh token-ийн хугацаа дууссан."
        : result.reason === "reused"
          ? "Refresh token аль хэдийн ашиглагдсан. Дахин нэвтэрнэ үү."
          : "Refresh token хүчингүй.";
    return jsonError(401, message, { reason: result.reason });
  }
  return jsonOk({
    accessToken: await signSystemApiToken({ adminId: result.adminId, email: result.email, pv: passwordFingerprint(result.passwordHash) }),
    accessTokenExpiresInSeconds: SYSTEM_ACCESS_TOKEN_SECONDS,
    refreshToken: result.token,
    refreshTokenExpiresInSeconds: SYSTEM_REFRESH_MAX_AGE_SECONDS,
    refreshTokenExpiresAt: result.expiresAt.toISOString(),
  });
}
