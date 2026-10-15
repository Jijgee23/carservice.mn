import { enforceRateLimit, jsonError, jsonOk } from "@/lib/api";
import { checkUserActive } from "@/lib/auth/active";
import { buildApiLoginResponse } from "@/lib/auth/api-login";
import { parseLoginDevice } from "@/lib/auth/login-device";
import { IDENTIFIER_ERROR, loginIdentifierFromBody } from "@/lib/auth/login-identifier";
import { verifyPassword } from "@/lib/auth/password";
import { prisma } from "@/lib/prisma";
import { setBypassContext } from "@/lib/tenant-context";

const MAX_LOGIN_ATTEMPTS = 5;

/**
 * POST /api/v1/auth/login
 *   { identifier, password, type: "ios" | "android", fcm, model, os, loc?: { lat, lng } } → access/refresh token
 *
 * `identifier` — имэйл эсвэл утасны дугаар (99112233, 9911-2233, +976...); хуучин `email` / `phone` түлхүүр ч хүчинтэй.
 * type / fcm / model / os заавал (хаанаас, ямар төхөөрөмжөөс нэвтэрснийг session-д хадгална, fcm-ээр push бүртгэнэ);
 * loc заавал биш.
 */
export async function POST(req: Request) {
  // Нэвтрэхээс өмнө — session/tenant хараахан байхгүй.
  setBypassContext();

  // IP-ийн түвшний throttle (brute-force-ийн нэмэлт давхарга).
  const limited = enforceRateLimit(req, "api-login", {
    limit: 10,
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
    return jsonError(400, "Нэвтрэх нэр (имэйл/утас), нууц үг шаардлагатай.");
  }
  const { password } = body as { password?: unknown };
  if (typeof password !== "string" || !password) {
    return jsonError(400, "Нууц үгээ текстээр илгээнэ үү.");
  }
  const id = loginIdentifierFromBody(body);
  if (!id) return jsonError(400, IDENTIFIER_ERROR);
  const parsedDevice = parseLoginDevice(body);
  if (!parsedDevice.ok) {
    return jsonError(400, Object.values(parsedDevice.fieldErrors)[0], { code: "VALIDATION", fieldErrors: parsedDevice.fieldErrors });
  }

  const user = await prisma.user.findUnique({
    where: id,
    include: {
      tenant: { select: { id: true, name: true, suspended: true } },
      role: { select: { id: true, name: true, permissions: true } },
    },
  });
  if (!user) return jsonError(401, "Нэвтрэх нэр эсвэл нууц үг буруу.");

  // Аккаунт түгжигдсэн эсэх (web login-тэй ижил DB-backed lockout).
  if (user.lockedAt) {
    return jsonError(
      423,
      "Хэт олон удаа буруу оролдсон тул аккаунт түгжигдсэн. Нууц үгээ сэргээнэ үү.",
    );
  }

  // Идэвхжээгүй (нууц үгээ үүсгээгүй) ажилтан — эхлээд анхны нэвтрэлт хийх ёстой.
  if (!user.verified || !user.passwordHash) {
    return jsonError(
      403,
      "Энэ аккаунт идэвхжээгүй байна. Веб дээр анхны нэвтрэлт хийж нууц үгээ үүсгэнэ үү.",
    );
  }

  const ok = await verifyPassword(password, user.passwordHash);
  if (!ok) {
    const nextAttempts = user.failedLoginAttempts + 1;
    const willLock = nextAttempts >= MAX_LOGIN_ATTEMPTS;
    await prisma.user.update({
      where: { id: user.id },
      data: {
        failedLoginAttempts: nextAttempts,
        lockedAt: willLock ? new Date() : undefined,
      },
    });
    if (willLock) {
      return jsonError(
        423,
        "Хэт олон удаа буруу оролдсон тул аккаунт түгжигдсэн. Нууц үгээ сэргээнэ үү.",
      );
    }
    return jsonError(401, "Нэвтрэх нэр эсвэл нууц үг буруу.");
  }

  if (user.tenant.suspended) {
    return jsonError(403, "Таны байгууллага түр хугацаагаар зогссон байна.");
  }

  // Нууц үг зөв бол өөрөө хаасан бүртгэлийг сэргээнэ. isActive=false
  // (админ хаалт) энэ замаар хэзээ ч цэвэрлэгдэхгүй.
  let reactivated = false;
  if (user.isActive && user.deactivatedAt) {
    await prisma.user.update({ where: { id: user.id }, data: { deactivatedAt: null } });
    user.deactivatedAt = null;
    reactivated = true;
  }

  // Идэвхгүй / хугацаа дууссан ажилтан нэвтрэхгүй (web login-тэй ижил).
  const active = checkUserActive({
    isActive: user.isActive,
    activeUntil: user.activeUntil,
    deactivatedAt: user.deactivatedAt,
  });
  if (!active.ok) {
    return jsonError(403, active.message);
  }

  // Амжилттай — алдааны тоологчийг тэглэнэ.
  if (user.failedLoginAttempts > 0 || user.lockedAt) {
    await prisma.user.update({
      where: { id: user.id },
      data: { failedLoginAttempts: 0, lockedAt: null },
    });
  }

  return jsonOk({ ...(await buildApiLoginResponse(user, req, parsedDevice.device)), reactivated });
}
