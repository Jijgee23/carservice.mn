// Үйлчлүүлэгчийн (Account) заавал биш нууц үг. OTP-оор нэвтрэх үргэлж боломжтой хэвээр; нууц үг тохируулсан бол
// утас + нууц үгээр мөн нэвтэрнэ. Тохируулах / солих / устгахад тухайн утсанд ирсэн шинэ ACCOUNT_PASSWORD код
// шаардана — нээлттэй үлдсэн session ганцаараа нууц үг нэмж, SMS-гүй байнгын нэвтрэх эрх үүсгэж чадахгүй. Энэ нь
// «нууц үгээ мартсан» урсгал ч болно: OTP-оор нэвтэрч шинэ нууц үг тохируулна.
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { verifyPhoneOtp } from "@/lib/auth/otp";
import { normalizePhone } from "@/lib/phone";
import { prisma } from "@/lib/prisma";
import { consumeRateLimit, LOGIN_WINDOW_MS } from "@/lib/rate-limit";

export const ACCOUNT_PASSWORD_MIN = 8;
export const ACCOUNT_PASSWORD_MAX = 128;
export const INVALID_CREDENTIALS_MESSAGE = "Утасны дугаар эсвэл нууц үг буруу байна.";
export const ACCOUNT_BLOCKED_MESSAGE = "Энэ дугаар түр хаагдсан байна.";
export const PASSWORD_LOGIN_LIMITED_MESSAGE = "Хэт олон оролдлого. Хэсэг хугацааны дараа дахин оролдох эсвэл кодоор нэвтэрнэ үү.";

/** Per phone: password guesses before OTP-only for the window (OTP login is never blocked by this). */
const PER_PHONE_LIMIT = 10;

/** Returns an error message, or null when the password is acceptable. */
export function validateAccountPassword(password: string): string | null {
  if (password.length < ACCOUNT_PASSWORD_MIN) return `Нууц үг дор хаяж ${ACCOUNT_PASSWORD_MIN} тэмдэгт байна.`;
  if (password.length > ACCOUNT_PASSWORD_MAX) return `Нууц үг ${ACCOUNT_PASSWORD_MAX} тэмдэгтээс хэтрэхгүй.`;
  if (!/[A-Za-zА-Яа-яЁёӨөҮү]/.test(password) || !/\d/.test(password)) return "Нууц үг үсэг болон тоо агуулсан байна.";
  return null;
}

// Compared against when the phone has no account / no password, so a miss costs the same bcrypt time as a hit.
let dummyHash: Promise<string> | null = null;
const getDummyHash = () => (dummyHash ??= hashPassword("carcare-dummy-password-0"));

export type PasswordLoginResult =
  | { ok: true; account: { id: string; phone: string; name: string | null; deactivatedAt: Date | null } }
  | { ok: false; reason: "invalid" | "blocked" | "rate_limited"; message: string };

/**
 * Phone + password check. Never creates an account (OTP login does that). The caller sets the bypass context and
 * the session; `finishAccountLogin` stamps the login. A wrong phone and a wrong password look the same.
 */
export async function verifyAccountPassword(input: { phone: string; password: string }): Promise<PasswordLoginResult> {
  const phone = normalizePhone(input.phone);
  const password = input.password ?? "";
  if (!phone || !password) return { ok: false, reason: "invalid", message: INVALID_CREDENTIALS_MESSAGE };
  if (!consumeRateLimit(`account-pw:${phone}`, { limit: PER_PHONE_LIMIT, windowMs: LOGIN_WINDOW_MS }).ok) {
    return { ok: false, reason: "rate_limited", message: PASSWORD_LOGIN_LIMITED_MESSAGE };
  }
  const account = await prisma.account.findUnique({
    where: { phone },
    select: { id: true, phone: true, name: true, passwordHash: true, isActive: true, deactivatedAt: true, deletedAt: true },
  });
  const hash = account?.passwordHash && !account.deletedAt ? account.passwordHash : null;
  const matches = await verifyPassword(password, hash ?? (await getDummyHash()));
  if (!account || !hash || !matches) return { ok: false, reason: "invalid", message: INVALID_CREDENTIALS_MESSAGE };
  if (!account.isActive) return { ok: false, reason: "blocked", message: ACCOUNT_BLOCKED_MESSAGE };
  return { ok: true, account: { id: account.id, phone: account.phone, name: account.name, deactivatedAt: account.deactivatedAt } };
}

/** Same bookkeeping as an OTP login: last login, and a self-deactivated account comes back. */
export async function finishAccountLogin(accountId: string) {
  return prisma.account.update({
    where: { id: accountId },
    data: { lastLoginAt: new Date(), deactivatedAt: null },
    select: { id: true, phone: true, name: true, passwordHash: true },
  });
}

export type PasswordChangeResult = { ok: true } | { ok: false; field: "code" | "password" | "confirm"; message: string };

async function checkCode(phone: string, code: string): Promise<PasswordChangeResult | null> {
  if (!/^\d{6}$/.test(code)) return { ok: false, field: "code", message: "6 оронтой код оруулна уу." };
  const r = await verifyPhoneOtp({ phone, type: "ACCOUNT_PASSWORD", code });
  if (r.ok) return null;
  const message =
    r.reason === "expired" ? "Кодны хугацаа дууссан. Шинээр код авна уу." : r.reason === "too_many_attempts" ? "Хэт олон удаа буруу оролдсон. Шинээр код авна уу." : "Код буруу байна.";
  return { ok: false, field: "code", message };
}

/** Sets or replaces the password. Requires a fresh ACCOUNT_PASSWORD code sent to the account's phone. */
export async function setAccountPassword(input: {
  account: { id: string; phone: string };
  code: string;
  password: string;
  confirm?: string;
}): Promise<PasswordChangeResult> {
  const invalid = validateAccountPassword(input.password);
  if (invalid) return { ok: false, field: "password", message: invalid };
  if (input.confirm !== undefined && input.confirm !== input.password) return { ok: false, field: "confirm", message: "Нууц үг таарахгүй байна." };
  const codeError = await checkCode(input.account.phone, input.code.trim());
  if (codeError) return codeError;
  await prisma.account.update({
    where: { id: input.account.id },
    data: { passwordHash: await hashPassword(input.password), passwordUpdatedAt: new Date() },
  });
  return { ok: true };
}

/** Removes the password (back to OTP-only). Also requires a fresh ACCOUNT_PASSWORD code. */
export async function removeAccountPassword(input: { account: { id: string; phone: string }; code: string }): Promise<PasswordChangeResult> {
  const codeError = await checkCode(input.account.phone, input.code.trim());
  if (codeError) return codeError;
  await prisma.account.update({ where: { id: input.account.id }, data: { passwordHash: null, passwordUpdatedAt: new Date() } });
  return { ok: true };
}
