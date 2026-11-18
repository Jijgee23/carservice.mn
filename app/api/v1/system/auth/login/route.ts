// Contract — POST /api/v1/system/auth/login
//
// System realm (платформын админ / «System ажилтан») мобайл нэвтрэлт. Body: { email, password }.
// 200: { admin: { id, email, firstName, lastName, kind: "ROOT" | "STAFF", permissions: string[] },
//        accessToken (1 цаг), accessTokenExpiresInSeconds, refreshToken (90 хоног, ротаци), refreshTokenExpiresInSeconds,
//        refreshTokenExpiresAt }
// Хамгаалалт: IP 20/15мин, имэйл 5/15мин (rate limit, нэг төрлийн 429), 5 буруу оролдлого → 15 минут түгжих (хугацаат),
// имэйл бүртгэлтэй эсэхийг алдааны мессеж, хугацаагаар ялгахгүй (нэг төрлийн 401, bcrypt цаг тэнцүүлсэн).
// Errors: 400 (хэлбэр), 401 (имэйл/нууц үг буруу), 403 (идэвхгүй админ — нууц үг зөв үед л), 429.

import { randomBytes } from "node:crypto";
import { jsonError, jsonOk } from "@/lib/api";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { clearSystemLoginFailures, isSystemLocked, recordSystemFailedLogin } from "@/lib/auth/system-lockout";
import { issueSystemTokens, systemAdminDto } from "@/lib/auth/system-session-issue";
import { consumeRateLimit, ipFromHeaders, LOGIN_WINDOW_MS, RATE_LIMITED_MESSAGE } from "@/lib/rate-limit";
import { prisma } from "@/lib/prisma";
import { setBypassContext } from "@/lib/tenant-context";

// Бүртгэлгүй имэйлд ч bcrypt-ийг ажиллуулж хариултын хугацааг тэнцүүлнэ (имэйл илрүүлэхээс сэргийлнэ).
let dummyHash: Promise<string> | null = null;
const getDummyHash = () => (dummyHash ??= hashPassword(randomBytes(16).toString("hex")));

const isEmail = (v: string) => v.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);

export async function POST(req: Request) {
  setBypassContext();

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError(400, "JSON body шаардлагатай.");
  }
  const rec = body && typeof body === "object" ? (body as { email?: unknown; password?: unknown }) : {};
  const email = typeof rec.email === "string" ? rec.email.trim() : "";
  const password = typeof rec.password === "string" ? rec.password : "";
  if (!isEmail(email)) return jsonError(400, "Имэйл буруу.", { code: "VALIDATION", fieldErrors: { email: "Имэйл буруу." } });
  if (!password || password.length > 200) return jsonError(400, "Нууц үгээ оруулна уу.", { code: "VALIDATION", fieldErrors: { password: "Нууц үгээ оруулна уу." } });

  const ip = ipFromHeaders(req.headers);
  const byIp = consumeRateLimit(`system-api-login-ip:${ip}`, { limit: 20, windowMs: LOGIN_WINDOW_MS });
  const byEmail = consumeRateLimit(`system-api-login:${email.toLowerCase()}`, { limit: 5, windowMs: LOGIN_WINDOW_MS });
  if (!byIp.ok || !byEmail.ok) return jsonError(429, RATE_LIMITED_MESSAGE);

  // Утасны гар ихэвчлэн эхний үсгийг том болгодог тул том/жижиг үсгийг ялгахгүй хайна.
  const admin = await prisma.superAdmin.findFirst({ where: { email: { equals: email, mode: "insensitive" } } });
  if (admin && isSystemLocked(admin.lockedUntil, new Date())) {
    // Түгжээтэй үед ч нууц үгийг шалгахгүй; rate limit-тэй ижил 429 (имэйл илрүүлэхгүй).
    return jsonError(429, RATE_LIMITED_MESSAGE);
  }

  const ok = await verifyPassword(password, admin ? admin.passwordHash : await getDummyHash());
  if (!admin || !ok) {
    if (admin) await recordSystemFailedLogin(admin.id);
    return jsonError(401, "Имэйл эсвэл нууц үг буруу.", { code: "INVALID_CREDENTIALS" });
  }
  if (!admin.isActive) return jsonError(403, "Энэ admin эрх идэвхгүй болсон байна.", { code: "ADMIN_INACTIVE" });

  await clearSystemLoginFailures(admin.id);
  const tokens = await issueSystemTokens(admin, req);
  return jsonOk({ admin: systemAdminDto(admin), ...tokens });
}
