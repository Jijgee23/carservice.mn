import { checkUserActive } from "@/lib/auth/active";
import { enforceRateLimit, jsonError, jsonOk } from "@/lib/api";
import {
  ACCESS_TOKEN_MAX_AGE_SECONDS,
  signApiToken,
} from "@/lib/auth/api-token";
import {
  REFRESH_TOKEN_MAX_AGE_SECONDS,
  rotateRefreshToken,
} from "@/lib/auth/refresh-token";
import { prisma } from "@/lib/prisma";
import { setBypassContext } from "@/lib/tenant-context";
import { ipOrNull } from "@/lib/rate-limit";

/**
 * POST /api/v1/auth/refresh
 * Body: { refreshToken: string }
 *
 * Хуучин refresh token-ыг шалгаж, шинэ access + refresh token хослолыг буцаана
 * (rotation). Хуучин token revoke болсон бол бүх token-ыг revoke хийж 401 буцаана.
 */
export async function POST(req: Request) {
  // Token rotate/lookup хараахан хэрэглэгч тодорхойгүй үед хийгддэг.
  setBypassContext();

  const limited = enforceRateLimit(req, "api-refresh", {
    limit: 30,
    windowMs: 60_000,
  });
  if (limited) return limited;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError(400, "Body нь JSON байх ёстой.");
  }

  if (!body || typeof body !== "object") {
    return jsonError(400, "refreshToken шаардлагатай.");
  }
  const { refreshToken } = body as { refreshToken?: unknown };
  if (typeof refreshToken !== "string" || !refreshToken.trim()) {
    return jsonError(400, "refreshToken-ийг текстээр илгээнэ үү.");
  }

  const userAgent = req.headers.get("user-agent");
  const ip = ipOrNull(req.headers);

  const result = await rotateRefreshToken(refreshToken.trim(), {
    userAgent,
    ip,
  });

  if (!result.ok) {
    const message =
      result.reason === "expired"
        ? "Refresh token-ийн хугацаа дууссан."
        : result.reason === "reused"
          ? "Refresh token аль хэдийн ашиглагдсан. Дахин нэвтэрнэ үү."
          : "Refresh token хүчингүй.";
    return jsonError(401, message, { reason: result.reason });
  }

  // Tenant болон эрхийг шинээр уншиж шалгана (suspended эсвэл устсан бол хаалт)
  const user = await prisma.user.findUnique({
    where: { id: result.userId },
    select: {
      id: true,
      tenantId: true,
      isOwner: true,
      isActive: true,
      activeUntil: true,
      deactivatedAt: true,
      lockedAt: true,
      tenant: { select: { suspended: true } },
    },
  });
  if (!user) return jsonError(401, "Хэрэглэгч олдсонгүй.");
  if (user.tenant.suspended) {
    return jsonError(403, "Таны байгууллага түр хугацаагаар зогссон байна.");
  }
  // Same gates as /auth/login — otherwise a deactivated, expired or locked
  // employee could keep refreshing forever. 403 ends the app session.
  if (user.lockedAt) {
    return jsonError(
      403,
      "Хэт олон удаа буруу оролдсон тул аккаунт түгжигдсэн. Нууц үгээ сэргээнэ үү.",
    );
  }
  // Refresh нууц үгийн баталгаагүй тул deactivatedAt-ийг цэвэрлэхгүй — зөвхөн
  // татгалзана; сэргээх нь /auth/login-оор л болно.
  const active = checkUserActive({
    isActive: user.isActive,
    activeUntil: user.activeUntil,
    deactivatedAt: user.deactivatedAt,
  });
  if (!active.ok) return jsonError(403, active.message);

  // D-180: embed the newly-rotated refresh token's id (not the raw token or
  // its hash) so `/me/sessions` and password-change can identify this device.
  const accessToken = await signApiToken({
    userId: user.id,
    tenantId: user.tenantId,
    isOwner: user.isOwner,
    refreshTokenId: result.id,
  });

  return jsonOk({
    accessToken,
    accessTokenExpiresInSeconds: ACCESS_TOKEN_MAX_AGE_SECONDS,
    expiresInSeconds: ACCESS_TOKEN_MAX_AGE_SECONDS,
    refreshToken: result.token,
    refreshTokenExpiresInSeconds: REFRESH_TOKEN_MAX_AGE_SECONDS,
    refreshTokenExpiresAt: result.expiresAt.toISOString(),
  });
}
