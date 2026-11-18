// System realm-ийн нэвтрэлтийн хариуны token хэсэг + admin DTO — login, refresh, нууц үг солих нэг цэгээр.

import { passwordFingerprint, signSystemApiToken, SYSTEM_ACCESS_TOKEN_SECONDS, type SystemApiAdmin } from "./system-api";
import { permissionsForKind, type SystemAdminKind } from "./system-permissions";
import { issueSystemRefreshToken, SYSTEM_REFRESH_MAX_AGE_SECONDS } from "./system-refresh-token";
import { ipOrNull } from "@/lib/rate-limit";

export type SystemTokenFields = {
  accessToken: string;
  accessTokenExpiresInSeconds: number;
  refreshToken: string;
  refreshTokenExpiresInSeconds: number;
  refreshTokenExpiresAt: string;
};

export async function issueSystemTokens(
  admin: { id: string; email: string; passwordHash: string },
  req: Request,
): Promise<SystemTokenFields> {
  const refresh = await issueSystemRefreshToken({
    adminId: admin.id,
    userAgent: req.headers.get("user-agent"),
    ip: ipOrNull(req.headers),
  });
  return {
    accessToken: await signSystemApiToken({ adminId: admin.id, email: admin.email, pv: passwordFingerprint(admin.passwordHash) }),
    accessTokenExpiresInSeconds: SYSTEM_ACCESS_TOKEN_SECONDS,
    refreshToken: refresh.token,
    refreshTokenExpiresInSeconds: SYSTEM_REFRESH_MAX_AGE_SECONDS,
    refreshTokenExpiresAt: refresh.expiresAt.toISOString(),
  };
}

/** Апп-д харуулах admin: нууц үгийн хэш, түгжээ зэргийг ХЭЗЭЭ Ч оруулахгүй (whitelist). */
export function systemAdminDto(admin: { id: string; email: string; firstName: string; lastName: string; kind: SystemAdminKind }): SystemApiAdmin {
  return {
    id: admin.id,
    email: admin.email,
    firstName: admin.firstName,
    lastName: admin.lastName,
    kind: admin.kind,
    permissions: permissionsForKind(admin.kind),
  };
}
