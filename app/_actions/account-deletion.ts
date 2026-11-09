"use server";

import { headers } from "next/headers";
import { deleteAccount } from "@/lib/account-closure/customer";
import { ClosureError, deleteStaffUser } from "@/lib/account-closure/staff";
import { logAudit } from "@/lib/audit";
import { clearAccountSessionCookie } from "@/lib/auth/account-cookies";
import { getAccountSession } from "@/lib/auth/account";
import { parseLoginIdentifier } from "@/lib/auth/login-identifier";
import { issueOtp, issuePhoneOtp, verifyOtp, verifyPhoneOtp } from "@/lib/auth/otp";
import { normalizePhone } from "@/lib/phone";
import { prisma } from "@/lib/prisma";
import { consumeRateLimit, ipFromHeaders, RATE_LIMITED_MESSAGE } from "@/lib/rate-limit";
import { sendOtpSms } from "@/lib/sms";
import { setBypassContext } from "@/lib/tenant-context";

// Google Play-ийн "аппгүйгээр устгах" шаардлага — /account-deletion хуудасны action.
// 1-р шат: identifier → (бүртгэл байвал) ACCOUNT_CLOSE OTP. Хариу үргэлж ижил (W3).
// 2-р шат: OTP + confirm → lib/account-closure-ийн устгах функц.

export type DeletionState = {
  ok: boolean;
  step: "identify" | "confirm" | "done";
  kind: "customer" | "staff";
  identifier?: string;
  message?: string;
  fieldErrors?: Record<string, string>;
} | null;

const GENERIC_SENT = "Энэ мэдээлэлтэй бүртгэл байгаа бол утас руу 6 оронтой код илгээлээ.";

// Хариу өгөх хугацаагаар бүртгэл байгаа эсэхийг мэдэхээс сэргийлнэ (W3) —
// OTP issue+SMS-той тэнцэх хугацаанд хүртэл зохиомлоор хүлээнэ.
const STEP1_MIN_MS = 1500;
// 2-р шатны "олдсонгүй" замыг verify дуудлагатай ойролцоо хугацаанд хүлээлгэнэ.
const STEP2_NOT_FOUND_MIN_MS = 300;

async function padTo(startedAt: number, minMs: number): Promise<void> {
  const remaining = minMs - (Date.now() - startedAt);
  if (remaining > 0) await new Promise((r) => setTimeout(r, remaining));
}

function s(fd: FormData, key: string): string {
  const v = fd.get(key);
  return typeof v === "string" ? v.trim() : "";
}

type Target =
  | { kind: "customer"; id: string; phone: string }
  | { kind: "staff"; id: string; email: string | null; phone: string; name: string; tenantId: string };

async function findTarget(kind: "customer" | "staff", identifier: string): Promise<Target | null> {
  if (kind === "customer") {
    const phone = normalizePhone(identifier);
    if (!phone) return null;
    const a = await prisma.account.findUnique({ where: { phone } });
    return a && !a.deletedAt ? { kind, id: a.id, phone: a.phone } : null;
  }

  // Ажилтны нэвтрэх нэр — имэйл эсвэл утас (lib/auth/login-identifier.ts-тэй адил задлана).
  const id = parseLoginIdentifier(identifier);
  if (!id) return null;
  const u = await prisma.user.findUnique({
    where: id,
    select: { id: true, email: true, phone: true, firstName: true, lastName: true, tenantId: true, deletedAt: true },
  });
  return u && !u.deletedAt
    ? { kind, id: u.id, email: u.email, phone: u.phone, name: `${u.lastName} ${u.firstName}`, tenantId: u.tenantId }
    : null;
}

export async function accountDeletionAction(
  _prev: DeletionState,
  formData: FormData,
): Promise<DeletionState> {
  setBypassContext(); // нэвтрээгүй, Account/User глобал хайлт
  const kind = s(formData, "kind") === "staff" ? "staff" : "customer";
  const identifier = s(formData, "identifier");
  const otpCode = s(formData, "otpCode");
  const h = await headers();
  const ip = ipFromHeaders(h);

  if (!identifier) {
    return {
      ok: false,
      step: "identify",
      kind,
      fieldErrors: {
        identifier:
          kind === "customer" ? "Утасны дугаараа оруулна уу." : "Имэйл эсвэл утасны дугаараа оруулна уу.",
      },
    };
  }
  if (!consumeRateLimit(`acct-del-ip:${ip}`, { limit: 20, windowMs: 10 * 60_000 }).ok) {
    return { ok: false, step: otpCode ? "confirm" : "identify", kind, identifier, message: RATE_LIMITED_MESSAGE };
  }

  const target = await findTarget(kind, identifier);

  // --- 1-р шат ---
  if (!otpCode) {
    const started = Date.now();
    if (target) {
      try {
        if (target.kind === "customer") {
          const { code } = await issuePhoneOtp({
            phone: target.phone,
            type: "ACCOUNT_CLOSE",
            accountId: target.id,
            ip,
            userAgent: h.get("user-agent"),
          });
          await sendOtpSms(code, "ACCOUNT_CLOSE", target.phone);
        } else {
          const { code } = await issueOtp({
            email: target.email,
            phone: target.phone,
            type: "ACCOUNT_CLOSE",
            userId: target.id,
            ip,
            userAgent: h.get("user-agent"),
          });
          await sendOtpSms(code, "ACCOUNT_CLOSE", target.phone);
        }
      } catch {
        // throttle зэрэг — ижил хариу буцааж, оршин байгааг ил гаргахгүй (W3)
      }
    }
    await padTo(started, STEP1_MIN_MS);
    return { ok: false, step: "confirm", kind, identifier, message: GENERIC_SENT };
  }

  // --- 2-р шат ---
  if (!/^\d{6}$/.test(otpCode)) {
    return { ok: false, step: "confirm", kind, identifier, fieldErrors: { otpCode: "6 оронтой код оруулна уу." } };
  }
  if (s(formData, "confirm") !== "on") {
    return {
      ok: false,
      step: "confirm",
      kind,
      identifier,
      fieldErrors: { confirm: "Устгахын өмнө баталгаажуулна уу." },
    };
  }
  const bad: DeletionState = {
    ok: false,
    step: "confirm",
    kind,
    identifier,
    fieldErrors: { otpCode: "Код буруу эсвэл хугацаа дууссан." },
  };
  if (!target) {
    // Бодит verify дуудлагатай ойролцоо хугацаанд хүлээлгэж, timing-ээр
    // бүртгэл байгаа эсэхийг мэдэхээс сэргийлнэ (W3).
    await new Promise((r) => setTimeout(r, STEP2_NOT_FOUND_MIN_MS));
    return bad;
  }

  const verified =
    target.kind === "customer"
      ? await verifyPhoneOtp({ phone: target.phone, type: "ACCOUNT_CLOSE", code: otpCode })
      : await verifyOtp({ email: target.email, phone: target.phone, type: "ACCOUNT_CLOSE", code: otpCode });
  if (!verified.ok) return bad;

  if (target.kind === "customer") {
    await deleteAccount(target.id);
    const session = await getAccountSession();
    if (session?.accountId === target.id) await clearAccountSessionCookie();
  } else {
    // Нэрийг lib-ийг дуудахаас өмнө бэлдэнэ (deleteStaffUser нэр/имэйлийг
    // tombstone хийнэ) — app/api/v1/me/delete/route.ts-тэй адил.
    const summary = `${target.name} · вэбээр бүртгэлээ устгав`;
    try {
      await deleteStaffUser(target.id);
    } catch (e) {
      if (e instanceof ClosureError) {
        return {
          ok: false,
          step: "confirm",
          kind,
          identifier,
          message:
            e.code === "OPEN_ORDERS"
              ? `Танд ${e.openOrders} нээлттэй захиалга хуваарилагдсан байна. Эхлээд байгууллагынхаа админаар өөр ажилтанд шилжүүлүүлнэ үү.`
              : "Та байгууллагын цорын ганц эзэмшигч тул эхлээд өөр эзэмшигч нэмнэ үү, эсвэл бидэнтэй холбогдоно уу.",
        };
      }
      throw e;
    }
    await logAudit({
      tenantId: target.tenantId,
      userId: target.id,
      entity: "User",
      entityId: target.id,
      action: "DELETE",
      summary,
    });
  }
  return { ok: true, step: "done", kind, message: "Бүртгэл устгагдлаа." };
}
