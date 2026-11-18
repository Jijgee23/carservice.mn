import { enforceRateLimit, jsonError, jsonOk } from "@/lib/api";
import { ACCOUNT_ACCESS_TOKEN_SECONDS, signExpiringAccountApiToken } from "@/lib/auth/account-api-token";
import { ACCOUNT_REFRESH_TOKEN_MAX_AGE_SECONDS, rotateAccountRefreshToken } from "@/lib/auth/account-refresh-token";
import { ipOrNull } from "@/lib/rate-limit";
import { setBypassContext } from "@/lib/tenant-context";

// POST /api/v1/app/auth/refresh  { refreshToken } → шинэ хугацаатай accessToken + шинэ refreshToken (ротаци).
// Хуучин refreshToken нэг л удаа хүчинтэй. Нэвтрэх шаардлагагүй (access token дууссан үед дууддаг).
// 200 { accessToken, accessTokenExpiresInSeconds, refreshToken, refreshTokenExpiresInSeconds, refreshTokenExpiresAt }
// 401 { reason: "invalid" | "expired" | "reused" } — апп дахин нэвтэрнэ. "reused" = хулгайн шинжтэй, бүх төхөөрөмж гарсан.
// Нууц үг солих/устгах, аккаунт хаах/устгах/сэргээхэд бүх refresh token автоматаар хүчингүй болно.
export async function POST(req: Request) {
  const limited = enforceRateLimit(req, "app-refresh", { limit: 30, windowMs: 60_000 });
  if (limited) return limited;
  // Account глобал (tenant-гүй) объект.
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

  const result = await rotateAccountRefreshToken(refreshToken.trim(), { userAgent: req.headers.get("user-agent"), ip: ipOrNull(req.headers) });
  if (!result.ok) {
    const message =
      result.reason === "expired"
        ? "Refresh token-ийн хугацаа дууссан."
        : result.reason === "reused"
          ? "Refresh token аль хэдийн ашиглагдсан. Дахин нэвтэрнэ үү."
          : "Refresh token хүчингүй.";
    return jsonError(401, message, { reason: result.reason });
  }

  const accessToken = await signExpiringAccountApiToken({ accountId: result.accountId, phone: result.phone, tv: result.tokenVersion });
  return jsonOk({
    accessToken,
    accessTokenExpiresInSeconds: ACCOUNT_ACCESS_TOKEN_SECONDS,
    refreshToken: result.token,
    refreshTokenExpiresInSeconds: ACCOUNT_REFRESH_TOKEN_MAX_AGE_SECONDS,
    refreshTokenExpiresAt: result.expiresAt.toISOString(),
  });
}
