"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import {
  clearAccountSessionCookie,
  setAccountSessionCookie,
} from "@/lib/auth/account-cookies";
import { signAccountSession } from "@/lib/auth/account-session";
import { revalidatePath } from "next/cache";
import { requireAccount } from "@/lib/auth/account";
import { finishAccountLogin, removeAccountPassword, setAccountPassword, verifyAccountPassword } from "@/lib/auth/account-password";
import { issuePhoneOtp, verifyPhoneOtp } from "@/lib/auth/otp";
import { consumeRateLimit, LOGIN_WINDOW_MS, RATE_LIMITED_MESSAGE } from "@/lib/rate-limit";
import { formatPhone, maskPhone, normalizePhone } from "@/lib/phone";
import { prisma } from "@/lib/prisma";
import { sendOtpSms } from "@/lib/sms";
import { setBypassContext } from "@/lib/tenant-context";

export type AccountAuthState = {
  ok: boolean;
  message?: string;
  fieldErrors?: Record<string, string>;
  // 2-р шат (OTP оруулах) идэвхжсэн эсэх. Канон утсыг form-д буцааж барина.
  awaitingOtp?: boolean;
  phone?: string;
} | null;

function s(fd: FormData, key: string): string {
  const v = fd.get(key);
  return typeof v === "string" ? v.trim() : "";
}

/**
 * Эцсийн хэрэглэгчийн утсаар нэвтрэх:
 *   mode=password: phone + password → шууд нэвтэрнэ (нууц үг тохируулсан Account; шинээр үүсгэхгүй).
 *   эсвэл OTP 2 шаттай:
 *   1) phone → OTP илгээх (awaitingOtp=true)
 *   2) phone + otpCode → баталгаажуулж Account resolve/create, session тогтооно.
 */
export async function accountLoginAction(
  _prevState: AccountAuthState,
  formData: FormData,
): Promise<AccountAuthState> {
  // Нэвтрэхээс өмнө — session/tenant хараахан байхгүй, Account глобал объект.
  setBypassContext();

  const phone = normalizePhone(s(formData, "phone"));
  const otpCode = s(formData, "otpCode");

  if (!phone) {
    return {
      ok: false,
      fieldErrors: { phone: "Зөв утасны дугаар оруулна уу." },
    };
  }

  const h = await headers();
  const ua = h.get("user-agent");
  const ip =
    h.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    h.get("x-real-ip") ||
    null;

  // --- Нууц үгээр ---
  if (s(formData, "mode") === "password") {
    const password = typeof formData.get("password") === "string" ? (formData.get("password") as string) : "";
    if (!password) return { ok: false, phone, fieldErrors: { password: "Нууц үг оруулна уу." } };
    if (!consumeRateLimit(`account-pw-ip:${ip ?? "unknown"}`, { limit: 30, windowMs: LOGIN_WINDOW_MS }).ok) {
      return { ok: false, phone, message: RATE_LIMITED_MESSAGE };
    }
    const result = await verifyAccountPassword({ phone, password });
    if (!result.ok) return { ok: false, phone, message: result.message };
    const account = await finishAccountLogin(result.account.id);
    await setAccountSessionCookie(await signAccountSession({ accountId: account.id, phone: account.phone }));
    redirect("/account");
  }

  // --- 1-р шат: OTP илгээх ---
  if (!otpCode) {
    try {
      const { code } = await issuePhoneOtp({
        phone,
        type: "CONSUMER_LOGIN",
        userAgent: ua,
        ip,
      });
      const sent = await sendOtpSms(code, "CONSUMER_LOGIN", phone);
      if (!sent && process.env.NODE_ENV === "production") {
        return {
          ok: false,
          message: "Код илгээгдсэнгүй. Дараа дахин оролдоно уу.",
          phone,
        };
      }
    } catch (e) {
      return {
        ok: false,
        message: e instanceof Error ? e.message : "Код илгээхэд алдаа гарлаа.",
        phone,
      };
    }
    return {
      ok: false,
      awaitingOtp: true,
      phone,
      message: `${formatPhone(phone)} руу 6 оронтой код илгээлээ.`,
    };
  }

  // --- 2-р шат: OTP баталгаажуулах ---
  if (!/^\d{6}$/.test(otpCode)) {
    return {
      ok: false,
      awaitingOtp: true,
      phone,
      fieldErrors: { otpCode: "6 оронтой код оруулна уу." },
    };
  }

  // Кодын оролдлогын хязгаараас гадна IP-ээр — олон утсан дээр тархсан таалтыг хаана.
  if (!consumeRateLimit(`otp-verify-ip:${ip ?? "unknown"}`, { limit: 30, windowMs: LOGIN_WINDOW_MS }).ok) {
    return { ok: false, awaitingOtp: true, phone, message: RATE_LIMITED_MESSAGE };
  }

  const result = await verifyPhoneOtp({
    phone,
    type: "CONSUMER_LOGIN",
    code: otpCode,
  });
  if (!result.ok) {
    const message =
      result.reason === "expired"
        ? "Кодны хугацаа дууссан. Шинээр код авна уу."
        : result.reason === "too_many_attempts"
          ? "Хэт олон удаа буруу оролдсон. Шинээр код авна уу."
          : "Код буруу байна.";
    return {
      ok: false,
      awaitingOtp: true,
      phone,
      fieldErrors: { otpCode: message },
    };
  }

  // Account-ийг утсаар resolve / create. Хаагдсан бол нэвтрүүлэхгүй.
  let account = await prisma.account.findUnique({ where: { phone } });
  if (account && !account.isActive) {
    return {
      ok: false,
      awaitingOtp: true,
      phone,
      message: "Энэ дугаар түр хаагдсан байна.",
    };
  }
  if (!account) {
    account = await prisma.account.create({
      data: { phone, lastLoginAt: new Date() },
    });
  } else {
    account = await prisma.account.update({
      where: { id: account.id },
      data: {
        lastLoginAt: new Date(),
        deactivatedAt: null,
      },
    });
  }

  const token = await signAccountSession({
    accountId: account.id,
    phone: account.phone,
  });
  await setAccountSessionCookie(token);

  redirect("/account");
}

/** Account-аас гарах. */
export async function accountSignOutAction(): Promise<void> {
  await clearAccountSessionCookie();
  redirect("/");
}

/** Нэвтэрсэн Account-ийн утсанд ACCOUNT_PASSWORD код илгээнэ (нууц үг тохируулах/солих/устгахад). */
export async function requestAccountPasswordOtpAction(): Promise<{ ok: boolean; message: string }> {
  const account = await requireAccount();
  const h = await headers();
  try {
    const { code } = await issuePhoneOtp({
      phone: account.phone,
      type: "ACCOUNT_PASSWORD",
      accountId: account.id,
      userAgent: h.get("user-agent"),
      ip: h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || null,
    });
    const sent = await sendOtpSms(code, "ACCOUNT_PASSWORD", account.phone);
    if (!sent && process.env.NODE_ENV === "production") return { ok: false, message: "Код илгээгдсэнгүй. Дараа дахин оролдоно уу." };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Код илгээхэд алдаа гарлаа." };
  }
  return { ok: true, message: `${maskPhone(account.phone)} руу 6 оронтой код илгээлээ.` };
}

export type AccountPasswordState = { ok: boolean; message?: string; fieldErrors?: Record<string, string> } | null;

/** formData: code, password, confirm — тохируулах эсвэл солих. */
export async function accountSetPasswordAction(_prev: AccountPasswordState, formData: FormData): Promise<AccountPasswordState> {
  const account = await requireAccount();
  const raw = (k: string) => (typeof formData.get(k) === "string" ? (formData.get(k) as string) : "");
  const r = await setAccountPassword({ account, code: raw("code"), password: raw("password"), confirm: raw("confirm") });
  if (!r.ok) return { ok: false, fieldErrors: { [r.field]: r.message } };
  revalidatePath("/account/security");
  return { ok: true, message: "Нууц үг хадгалагдлаа. Дараагийн удаа утас + нууц үгээр нэвтэрч болно." };
}

/** formData: code — нууц үгийг устгаж зөвхөн кодоор нэвтрэх горимд буцна. */
export async function accountRemovePasswordAction(_prev: AccountPasswordState, formData: FormData): Promise<AccountPasswordState> {
  const account = await requireAccount();
  const r = await removeAccountPassword({ account, code: s(formData, "code") });
  if (!r.ok) return { ok: false, fieldErrors: { [r.field]: r.message } };
  revalidatePath("/account/security");
  return { ok: true, message: "Нууц үг устгагдлаа. Цаашид кодоор нэвтэрнэ." };
}
