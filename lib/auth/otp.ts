/**
 * OTP — 6 оронтой нэг удаагийн код. Signup, нууц үг солих/сэргээх үед хэрэглэнэ.
 *
 * Аюулгүй байдлын зарчмууд:
 *  - Раw кодыг DB-д хадгалахгүй (sha256 hex).
 *  - issueOtp() үед тухайн (email, type)-ийн өмнөх consumed биш бүх OTP-ийг
 *    revoke хийнэ ("invalidate previous").
 *  - verifyOtp() буруу баталгаажуулалт бүрт `attempts` нэмж, 5 болсон үед
 *    OTP-ийг хүчингүй болгоно (brute force-аас сэргийлнэ).
 *  - Хугацаа дуусгавар нь 10 минут.
 */

import { createHash, randomInt } from "node:crypto";
import { Prisma } from "@/app/generated/prisma/client";
import { normalizePhone } from "@/lib/phone";
import { prisma } from "@/lib/prisma";
import { consumeRateLimit } from "@/lib/rate-limit";

// OTP issuance throttle — SMS bombing / cost abuse-аас сэргийлнэ.
const OTP_ISSUE_WINDOW_MS = 10 * 60_000; // 10 минут
const OTP_MAX_PER_EMAIL = 3; // нэг имэйл+төрөлд 10 минутад
const OTP_MAX_PER_IP = 10; // нэг IP-аас 10 минутад

export type OtpType =
  | "SIGNUP"
  | "CHANGE_PASSWORD"
  | "RESET_PASSWORD"
  | "CONSUMER_LOGIN"
  | "SET_PASSWORD"
  | "ACCOUNT_CLOSE"
  | "ACCOUNT_PASSWORD";

export const OTP_CODE_LENGTH = 6;
export const OTP_MAX_AGE_SECONDS = 60 * 10; // 10 минут
export const OTP_MAX_ATTEMPTS = 5;

function hashCode(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

function generateCode(): string {
  // 0-999999 хооронд, 6 оронтой паддингтай
  const n = randomInt(0, 1_000_000);
  return n.toString().padStart(OTP_CODE_LENGTH, "0");
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

// --- Dev-only OTP харагдац ------------------------------------------------
// DB-д зөвхөн codeHash (sha256) хадгалагддаг тул raw кодыг харуулах боломжгүй.
// Хөгжүүлэлтэд SMS-гүйгээр нэвтрэхэд тусдаа raw кодыг санах ойд (DB БИШ) барьж,
// /system/otp хуудсанд харуулна. Production-д ХЭЗЭЭ Ч бичигдэхгүй / хадгалагдахгүй.

export type DevOtpEntry = {
  email?: string;
  phone?: string;
  type: OtpType;
  code: string;
  createdAt: Date;
  expiresAt: Date;
};

const DEV_OTP_LIMIT = 50;
const devOtpHolder = globalThis as unknown as {
  __carcareDevOtps?: DevOtpEntry[];
};

function recordDevOtp(entry: DevOtpEntry): void {
  const list =
    devOtpHolder.__carcareDevOtps ?? (devOtpHolder.__carcareDevOtps = []);
  list.push(entry);
  if (list.length > DEV_OTP_LIMIT) list.splice(0, list.length - DEV_OTP_LIMIT);
}

/**
 * Сервер санах ойд (DB-д биш) хадгалсан сүүлийн OTP кодууд (шинэ нь эхэнд) —
 * /system/otp-оор л харагдана (requireSuperAdmin). Prod-д ч ажиллана
 * (олон instance-тай deploy бол зөвхөн тухайн процесс дээр үүссэн кодыг
 * харуулна), сервер дахин ачаалахад арилна.
 */
export function getDevOtps(): DevOtpEntry[] {
  return [...(devOtpHolder.__carcareDevOtps ?? [])].reverse();
}

export type IssueOtpOptions = {
  email: string;
  type: OtpType;
  userId?: string | null;
  userAgent?: string | null;
  ip?: string | null;
};

/**
 * Шинэ OTP үүсгэж, раw кодыг буцаана (имэйл илгээгчид зориулсан).
 * Өмнөх consumed биш бүх OTP-уудыг хүчингүй болгоно.
 */
export async function issueOtp(
  opts: IssueOtpOptions,
): Promise<{ code: string; expiresAt: Date }> {
  const email = normalizeEmail(opts.email);
  if (!email) throw new Error("Имэйл хоосон байж болохгүй.");

  // Хэт олон код хүсэхээс сэргийлнэ (имэйл+төрөл, мөн боломжтой бол IP-аар).
  const byEmail = consumeRateLimit(`otp:${opts.type}:${email}`, {
    limit: OTP_MAX_PER_EMAIL,
    windowMs: OTP_ISSUE_WINDOW_MS,
  });
  if (!byEmail.ok) {
    throw new Error(
      `Хэт олон код хүслээ. ${Math.ceil(byEmail.retryAfterSec / 60)} минутын дараа дахин оролдоно уу.`,
    );
  }
  if (opts.ip) {
    const byIp = consumeRateLimit(`otp-ip:${opts.ip}`, {
      limit: OTP_MAX_PER_IP,
      windowMs: OTP_ISSUE_WINDOW_MS,
    });
    if (!byIp.ok) {
      throw new Error(
        `Хэт олон код хүслээ. ${Math.ceil(byIp.retryAfterSec / 60)} минутын дараа дахин оролдоно уу.`,
      );
    }
  }

  const code = generateCode();
  const codeHash = hashCode(code);
  const expiresAt = new Date(Date.now() + OTP_MAX_AGE_SECONDS * 1000);

  // /system/otp хуудсанд (superadmin) харуулахын тулд санах ойд бүртгэнэ —
  // prod-д ч хийнэ (support-д зориулав). console.info нь зөвхөн хөгжүүлэлтэд —
  // production сервер логт кодыг бичихгүй.
  recordDevOtp({ email, type: opts.type, code, createdAt: new Date(), expiresAt });
  if (process.env.NODE_ENV !== "production") {
    console.info(`\n🔑 [OTP] ${opts.type} · ${email} → ${code}\n`);
  }

  await prisma.$transaction(async (tx) => {
    // Өмнөх идэвхтэй OTP-уудыг хүчингүй болго (зөвхөн хамгийн сүүлийн нь л зөв)
    await tx.otp.updateMany({
      where: {
        email,
        type: opts.type,
        consumedAt: null,
      },
      data: { consumedAt: new Date() },
    });

    await tx.otp.create({
      data: {
        email,
        codeHash,
        type: opts.type,
        userId: opts.userId ?? null,
        userAgent: opts.userAgent ?? null,
        ip: opts.ip ?? null,
        expiresAt,
      },
    });
  });

  return { code, expiresAt };
}

export type VerifyOtpResult =
  | { ok: true; otpId: string; userId: string | null }
  | { ok: false; reason: "invalid" | "expired" | "consumed" | "too_many_attempts" };

/**
 * OTP-г баталгаажуулна. Зөв тохиолдолд `consumedAt`-г тогтоож дахин ашиглахгүй.
 * Буруу үед `attempts` нэмнэ. OTP_MAX_ATTEMPTS-аас давсан үед OTP-г хаалт хийнэ.
 */
export async function verifyOtp(input: {
  email: string;
  type: OtpType;
  code: string;
}): Promise<VerifyOtpResult> {
  const email = normalizeEmail(input.email);
  const code = (input.code ?? "").trim();
  if (!email || !/^\d{6}$/.test(code)) {
    return { ok: false, reason: "invalid" };
  }
  const codeHash = hashCode(code);

  // Хамгийн сүүлийн consumed биш OTP-ийг авна
  const otp = await prisma.otp.findFirst({
    where: { email, type: input.type, consumedAt: null },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      codeHash: true,
      attempts: true,
      expiresAt: true,
      userId: true,
    },
  });
  if (!otp) return { ok: false, reason: "invalid" };

  if (otp.expiresAt.getTime() <= Date.now()) {
    await prisma.otp.update({
      where: { id: otp.id },
      data: { consumedAt: new Date() },
    });
    return { ok: false, reason: "expired" };
  }

  if (otp.attempts >= OTP_MAX_ATTEMPTS) {
    await prisma.otp.update({
      where: { id: otp.id },
      data: { consumedAt: new Date() },
    });
    return { ok: false, reason: "too_many_attempts" };
  }

  if (otp.codeHash !== codeHash) {
    await prisma.otp.update({
      where: { id: otp.id },
      data: { attempts: { increment: 1 } },
    });
    return { ok: false, reason: "invalid" };
  }

  // Зөв — consume
  await prisma.otp.update({
    where: { id: otp.id },
    data: { consumedAt: new Date() },
  });
  return { ok: true, otpId: otp.id, userId: otp.userId };
}

/**
 * Хэрэглэгчийн бүх consumed биш OTP-уудыг цуцлана (нууц үг солисны дараа г.м.).
 */
export async function revokeAllOtps(
  email: string,
  type?: OtpType,
): Promise<number> {
  const where: Prisma.OtpWhereInput = {
    email: normalizeEmail(email),
    consumedAt: null,
  };
  if (type) where.type = type;
  const r = await prisma.otp.updateMany({
    where,
    data: { consumedAt: new Date() },
  });
  return r.count;
}

// --- Утсаар ажиллах OTP (Account-ийн CONSUMER_LOGIN) ----------------------
// Дээрх email-д суурилсан урсгалтай ижил зарчим, гэхдээ `phone`-оор
// түлхүүрлэнэ. Бүх дугаар lib/phone.ts-ийн канон форматтай байх ёстой.

export type IssuePhoneOtpOptions = {
  phone: string; // канон 8 орон (lib/phone.ts)
  type: Extract<OtpType, "CONSUMER_LOGIN" | "ACCOUNT_CLOSE" | "ACCOUNT_PASSWORD">;
  accountId?: string | null;
  userAgent?: string | null;
  ip?: string | null;
};

/**
 * Утсанд шинэ OTP үүсгэж, раw кодыг буцаана (SMS илгээгчид зориулсан).
 * Өмнөх consumed биш бүх OTP-уудыг хүчингүй болгоно.
 */
export async function issuePhoneOtp(
  opts: IssuePhoneOtpOptions,
): Promise<{ code: string; expiresAt: Date }> {
  const phone = normalizePhone(opts.phone);
  if (!phone) throw new Error("Утасны дугаар буруу байна.");

  const byPhone = consumeRateLimit(`otp:${opts.type}:${phone}`, {
    limit: OTP_MAX_PER_EMAIL,
    windowMs: OTP_ISSUE_WINDOW_MS,
  });
  if (!byPhone.ok) {
    throw new Error(
      `Хэт олон код хүслээ. ${Math.ceil(byPhone.retryAfterSec / 60)} минутын дараа дахин оролдоно уу.`,
    );
  }
  if (opts.ip) {
    const byIp = consumeRateLimit(`otp-ip:${opts.ip}`, {
      limit: OTP_MAX_PER_IP,
      windowMs: OTP_ISSUE_WINDOW_MS,
    });
    if (!byIp.ok) {
      throw new Error(
        `Хэт олон код хүслээ. ${Math.ceil(byIp.retryAfterSec / 60)} минутын дараа дахин оролдоно уу.`,
      );
    }
  }

  const code = generateCode();
  const codeHash = hashCode(code);
  const expiresAt = new Date(Date.now() + OTP_MAX_AGE_SECONDS * 1000);

  recordDevOtp({ phone, type: opts.type, code, createdAt: new Date(), expiresAt });
  if (process.env.NODE_ENV !== "production") {
    console.info(`\n🔑 [OTP] ${opts.type} · ${phone} → ${code}\n`);
  }

  await prisma.$transaction(async (tx) => {
    await tx.otp.updateMany({
      where: { phone, type: opts.type, consumedAt: null },
      data: { consumedAt: new Date() },
    });
    await tx.otp.create({
      data: {
        phone,
        codeHash,
        type: opts.type,
        accountId: opts.accountId ?? null,
        userAgent: opts.userAgent ?? null,
        ip: opts.ip ?? null,
        expiresAt,
      },
    });
  });

  return { code, expiresAt };
}

/**
 * Утасны OTP-г баталгаажуулна. Зөв тохиолдолд consume хийж дахин ашиглахгүй.
 */
export async function verifyPhoneOtp(input: {
  phone: string;
  type: Extract<OtpType, "CONSUMER_LOGIN" | "ACCOUNT_CLOSE" | "ACCOUNT_PASSWORD">;
  code: string;
}): Promise<VerifyOtpResult> {
  const phone = normalizePhone(input.phone);
  const code = (input.code ?? "").trim();
  if (!phone || !/^\d{6}$/.test(code)) {
    return { ok: false, reason: "invalid" };
  }
  const codeHash = hashCode(code);

  const otp = await prisma.otp.findFirst({
    where: { phone, type: input.type, consumedAt: null },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      codeHash: true,
      attempts: true,
      expiresAt: true,
      accountId: true,
    },
  });
  if (!otp) return { ok: false, reason: "invalid" };

  if (otp.expiresAt.getTime() <= Date.now()) {
    await prisma.otp.update({
      where: { id: otp.id },
      data: { consumedAt: new Date() },
    });
    return { ok: false, reason: "expired" };
  }

  if (otp.attempts >= OTP_MAX_ATTEMPTS) {
    await prisma.otp.update({
      where: { id: otp.id },
      data: { consumedAt: new Date() },
    });
    return { ok: false, reason: "too_many_attempts" };
  }

  if (otp.codeHash !== codeHash) {
    await prisma.otp.update({
      where: { id: otp.id },
      data: { attempts: { increment: 1 } },
    });
    return { ok: false, reason: "invalid" };
  }

  await prisma.otp.update({
    where: { id: otp.id },
    data: { consumedAt: new Date() },
  });
  // accountId-г userId талбарт буцаахгүй — дуудагч accountId-р resolve хийнэ.
  return { ok: true, otpId: otp.id, userId: otp.accountId };
}
