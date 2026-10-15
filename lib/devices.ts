import type { Device } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/prisma";

export const DEVICE_PLATFORMS = ["WEB", "ANDROID", "IOS"] as const;
export type DevicePlatform = (typeof DEVICE_PLATFORMS)[number];

export type DeviceInput = {
  deviceId: string;
  platform: DevicePlatform;
  firebaseToken?: string | null;
  name?: string | null;
  model?: string | null;
  os?: string | null;
};

type DeviceOwner = {
  userId?: string | null;
  accountId?: string | null;
  superAdminId?: string | null;
};

/**
 * Клиентээс ирсэн body-г шалгаж DeviceInput болгоно (web action + мобайл API
 * хоёулаа ашиглана).
 */
export function parseDeviceInput(
  body: unknown,
): { ok: true; data: DeviceInput } | { ok: false; error: string } {
  if (!body || typeof body !== "object") {
    return { ok: false, error: "Буруу өгөгдөл." };
  }
  const b = body as Record<string, unknown>;
  const deviceId = typeof b.deviceId === "string" ? b.deviceId.trim() : "";
  if (!deviceId) return { ok: false, error: "deviceId шаардлагатай." };

  const platform =
    typeof b.platform === "string" ? b.platform.toUpperCase() : "";
  if (!(DEVICE_PLATFORMS as readonly string[]).includes(platform)) {
    return { ok: false, error: "platform нь WEB/ANDROID/IOS байх ёстой." };
  }

  const str = (v: unknown) =>
    typeof v === "string" && v.trim() ? v.trim() : null;

  return {
    ok: true,
    data: {
      deviceId,
      platform: platform as DevicePlatform,
      firebaseToken: str(b.firebaseToken),
      name: str(b.name),
      model: str(b.model),
      os: str(b.os),
    },
  };
}

/**
 * Төхөөрөмжийг бүртгэх/шинэчлэх. `deviceId`-аар upsert хийж, эзнийг (User эсвэл
 * Account) одоогийн нэвтэрсэн этгээдээр тогтооно (нэг install дээр өөр хүн
 * нэвтэрвэл эзэн дамжина).
 */
export async function registerDevice(
  owner: DeviceOwner,
  input: DeviceInput,
): Promise<Device> {
  const data = {
    platform: input.platform,
    firebaseToken: input.firebaseToken ?? null,
    name: input.name ?? null,
    model: input.model ?? null,
    os: input.os ?? null,
    userId: owner.userId ?? null,
    accountId: owner.accountId ?? null,
    superAdminId: owner.superAdminId ?? null,
    lastSeenAt: new Date(),
  };
  // Нэг FCM token нэг л эзэнтэй байна: өөр мөрөнд (жнь logout хийгээгүй
  // хуваалцсан төхөөрөмж) үлдсэн ижил token-ийг цэвэрлэнэ — эс бөгөөс тэр
  // төхөөрөмж хоёр өөр хэрэглэгчийн push-ийг хүлээн авна.
  if (data.firebaseToken) {
    await prisma.device.updateMany({
      where: { firebaseToken: data.firebaseToken, NOT: { deviceId: input.deviceId } },
      data: { firebaseToken: null },
    });
  }
  return await prisma.device.upsert({
    where: { deviceId: input.deviceId },
    create: { deviceId: input.deviceId, ...data },
    update: data,
  });
}

/** Төхөөрөмжийг бүртгэлээс хасах (logout / push идэвхгүй болгох). */
export async function removeDevice(
  owner: DeviceOwner,
  deviceId: string,
): Promise<void> {
  await prisma.device.deleteMany({
    where: {
      deviceId,
      ...(owner.userId ? { userId: owner.userId } : {}),
      ...(owner.accountId ? { accountId: owner.accountId } : {}),
      ...(owner.superAdminId ? { superAdminId: owner.superAdminId } : {}),
    },
  });
}

/** Push илгээхэд — User-тэй холбоотой FCM token-ууд. */
export async function getFirebaseTokensForUser(
  userId: string,
): Promise<string[]> {
  const rows = await prisma.device.findMany({
    where: { userId, firebaseToken: { not: null } },
    select: { firebaseToken: true },
  });
  return rows.map((r) => r.firebaseToken).filter((t): t is string => Boolean(t));
}

/**
 * Push илгээхэд — Account-тай холбоотой FCM token-ууд.
 *
 * `account.isActive: true` шүүлт нь backstop: client логоут дээр device
 * устгах дуудлага (`DELETE /devices/:id`) амжилтгүй болсон ч (жишээ нь
 * token-г эхлээд цэвэрлээд дараа нь 401-той тулгарсан тохиолдол), эсвэл
 * account хаагдсаны дараа device мөр устаагүй үлдсэн ч, идэвхгүй болсон
 * account руу push цаашид очихгүй.
 */
export async function getFirebaseTokensForAccount(
  accountId: string,
): Promise<string[]> {
  const rows = await prisma.device.findMany({
    where: {
      accountId,
      firebaseToken: { not: null },
      account: { isActive: true },
    },
    select: { firebaseToken: true },
  });
  return rows.map((r) => r.firebaseToken).filter((t): t is string => Boolean(t));
}

/** Push илгээхэд — SuperAdmin-тай холбоотой FCM token-ууд. */
export async function getFirebaseTokensForSuperAdmin(
  superAdminId: string,
): Promise<string[]> {
  const rows = await prisma.device.findMany({
    where: { superAdminId, firebaseToken: { not: null } },
    select: { firebaseToken: true },
  });
  return rows.map((r) => r.firebaseToken).filter((t): t is string => Boolean(t));
}
