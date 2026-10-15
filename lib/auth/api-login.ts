/**
 * Мобайл API-ийн нэвтрэлт амжилттай болсон үед буцаах хариу (access + refresh
 * token + хэрэглэгчийн мэдээлэл). Нууц үгээр нэвтрэх (`/auth/login`) болон
 * аккаунт идэвхжүүлэх (`/auth/activate`) хоёул ижил payload буцаахын тулд энд
 * нэгтгэв — хоёр газар салангид бичигдэж зөрөхөөс сэргийлнэ.
 */

import {
  ACCESS_TOKEN_MAX_AGE_SECONDS,
  signApiToken,
} from "@/lib/auth/api-token";
import { createHash } from "node:crypto";
import type { LoginDevice } from "@/lib/auth/login-device";
import {
  REFRESH_TOKEN_MAX_AGE_SECONDS,
  issueRefreshToken,
} from "@/lib/auth/refresh-token";
import { registerDevice } from "@/lib/devices";
import { prisma } from "@/lib/prisma";

/**
 * Push бүртгэл (тусдаа POST /devices дуудалт шаардлагагүй): аппын install id (body.deviceId) ирсэн бол түүгээр,
 * үгүй бол ижил FCM token-той Device-ээр, эсвэл token-оос тогтвортой id үүсгэнэ. registerDevice эзнийг энэ
 * ажилтанд шилжүүлж, token-ийг өөр мөрөөс цэвэрлэнэ. Буцаах Device.id-г session-д холбож, logout устгана.
 */
async function registerLoginDevice(userId: string, device: LoginDevice): Promise<string> {
  // The app's own install id wins (same key its POST /devices token refresh uses → one phone, one row).
  const existing = device.deviceId
    ? null
    : await prisma.device.findFirst({ where: { firebaseToken: device.fcm }, select: { deviceId: true } });
  const deviceId = device.deviceId ?? existing?.deviceId ?? `fcm-${createHash("sha256").update(device.fcm).digest("hex").slice(0, 32)}`;
  const row = await registerDevice({ userId }, { deviceId, platform: device.type, firebaseToken: device.fcm, model: device.model, os: device.os });
  return row.id;
}

export type ApiLoginUser = {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  phone: string;
  isOwner: boolean;
  tenantId: string;
  branchId: string | null;
  tenant: { id: string; name: string };
  role: { id: string; name: string; permissions: unknown } | null;
};

function requestMeta(req: Request): {
  userAgent: string | null;
  ip: string | null;
} {
  const userAgent = req.headers.get("user-agent");
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    null;
  return { userAgent, ip };
}

/**
 * Access token (богино настай) + refresh token (DB-д бүртгэгдсэн) үүсгэж,
 * клиентэд буцаах JSON объектыг бүрдүүлнэ.
 */
export async function buildApiLoginResponse(
  user: ApiLoginUser,
  req: Request,
  /** POST /auth/login: the device / location to record on the session and the FCM token to register. */
  device?: LoginDevice | null,
): Promise<Record<string, unknown>> {
  const { userAgent, ip } = requestMeta(req);
  // D-180: the refresh token is issued first so its id can be embedded in
  // the access token as `refreshTokenId` (`rtid` claim) below.
  const {
    id: refreshTokenId,
    token: refreshToken,
    expiresAt: refreshExpiresAt,
  } = await issueRefreshToken({
    userId: user.id,
    userAgent,
    ip,
    device: device
      ? {
          deviceType: device.type,
          deviceModel: device.model,
          deviceOs: device.os,
          latitude: device.latitude,
          longitude: device.longitude,
          pushDeviceId: await registerLoginDevice(user.id, device),
        }
      : null,
  });

  const accessToken = await signApiToken({
    userId: user.id,
    tenantId: user.tenantId,
    isOwner: user.isOwner,
    refreshTokenId,
  });

  return {
    accessToken,
    accessTokenExpiresInSeconds: ACCESS_TOKEN_MAX_AGE_SECONDS,
    // Backwards-compat alias
    expiresInSeconds: ACCESS_TOKEN_MAX_AGE_SECONDS,
    refreshToken,
    refreshTokenExpiresInSeconds: REFRESH_TOKEN_MAX_AGE_SECONDS,
    refreshTokenExpiresAt: refreshExpiresAt.toISOString(),
    user: {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      phone: user.phone,
      isOwner: user.isOwner,
      role: user.role
        ? {
            id: user.role.id,
            name: user.role.name,
            permissions: user.role.permissions,
          }
        : null,
      branchId: user.branchId,
      tenant: { id: user.tenant.id, name: user.tenant.name },
    },
  };
}
