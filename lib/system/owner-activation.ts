// Харилцагчийн ЭЗЭНД нууц үг тохируулах (идэвхжүүлэх) SMS код илгээх. Ажилтан бүртгэсэн эзэн `verified: false`,
// нууц үггүй — энэ код (OTP "SET_PASSWORD") + /api/v1/auth/activate-аар өөрөө нууц үгээ тогтооно.
// Нийтийн /auth/activate/request-otp-той ижил OTP төрөл ба throttle (issueOtp); ялгаа нь нэвтэрсэн ажилтанд
// тодорхой төлөв (олдсонгүй / аль хэдийн идэвхжсэн / хэт олон хүсэлт) хэлнэ. `issueOtp`/`sendOtpSms`-ийг дамжуулдаг
// тул тест бодит SMS ЯВУУЛАХГҮЙ (gateway бодитоор тохируулагдсан).

import { issueOtp } from "@/lib/auth/otp";
import { prisma } from "@/lib/prisma";
import { sendOtpSms } from "@/lib/sms";

export type ActivationDeps = {
  issue: typeof issueOtp;
  send: typeof sendOtpSms;
  db: Pick<typeof prisma, "user">;
};

const defaultDeps: ActivationDeps = { issue: issueOtp, send: sendOtpSms, db: prisma };

export type ActivationResult =
  | { ok: true; ownerId: string; maskedPhone: string }
  | { ok: false; reason: "NOT_FOUND" | "ALREADY_ACTIVE" | "THROTTLED" | "SMS_FAILED"; message: string };

export function maskPhone(phone: string): string {
  return phone.length <= 2 ? "**" : `${"*".repeat(phone.length - 2)}${phone.slice(-2)}`;
}

export async function sendOwnerActivationCode(
  input: { tenantId: string; ownerId?: string | null; userAgent?: string | null; ip?: string | null },
  deps: ActivationDeps = defaultDeps,
): Promise<ActivationResult> {
  const owners = await deps.db.user.findMany({
    where: { tenantId: input.tenantId, isOwner: true, deletedAt: null, ...(input.ownerId ? { id: input.ownerId } : {}) },
    orderBy: { createdAt: "asc" },
    select: { id: true, email: true, phone: true, verified: true },
  });
  if (owners.length === 0) return { ok: false, reason: "NOT_FOUND", message: "Эзэн олдсонгүй." };
  const owner = owners.find((o) => !o.verified);
  if (!owner) return { ok: false, reason: "ALREADY_ACTIVE", message: "Эзэн аль хэдийн нууц үгээ тохируулсан байна." };

  let code: string;
  try {
    ({ code } = await deps.issue({ email: owner.email, phone: owner.phone, type: "SET_PASSWORD", userId: owner.id, userAgent: input.userAgent ?? null, ip: input.ip ?? null }));
  } catch (e) {
    return { ok: false, reason: "THROTTLED", message: e instanceof Error ? e.message : "Хэт олон код хүслээ." };
  }
  const sent = await deps.send(code, "SET_PASSWORD", owner.phone);
  if (!sent) return { ok: false, reason: "SMS_FAILED", message: "SMS илгээж чадсангүй. Дахин оролдоно уу." };
  return { ok: true, ownerId: owner.id, maskedPhone: maskPhone(owner.phone) };
}
