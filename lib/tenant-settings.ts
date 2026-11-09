import "server-only";

// Байгууллагын (tenant) тохиргооны хуваалцсан логик — вэбийн server action
// (app/_actions/tenant.ts) болон мобайлын API (app/api/v1/tenant/**) хоёулаа
// энд дуудна. Мессеж, fieldErrors түлхүүрүүд вэбийн action-тай яг адил.
// RLS: async helper дотор `return await prisma…` (bare `return prisma…` биш).

import { unlink } from "node:fs/promises";
import { Prisma } from "@/app/generated/prisma/client";
import { logAudit } from "@/lib/audit";
import { PLAN_LIMIT_CODES } from "@/lib/plan-limits";
import { isValidPhone, normalizePhone } from "@/lib/phone";
import { isFeatureEnabled } from "@/lib/plan-limits-server";
import { prisma } from "@/lib/prisma";
import { resolveUploadPath, saveUpload } from "@/lib/storage";
import { normalizeRegno, regnoKind, TENANT_REGNO_MESSAGE } from "@/lib/tenant-regno";

export type TenantActor = { tenantId: string; userId: string };

/**
 * Алдааны төрөл: VALIDATION → 400, CONFLICT → 409 (нэр/регистр/имэйл
 * давхцал), PLAN → 403 (багц дэмжихгүй), ERROR → бусад (DB г.м.).
 */
export type TenantSettingsFailure = {
  ok: false;
  kind: "VALIDATION" | "CONFLICT" | "PLAN" | "ERROR";
  message?: string;
  fieldErrors?: Record<string, string>;
};

// ---------------------------------------------------------------------------
// Үндсэн мэдээлэл
// ---------------------------------------------------------------------------

/** Хэрэглэгчийн оруулсан (trim хийсэн) түүхий утгууд. */
export type TenantProfileRaw = {
  name: string;
  registerNumber: string;
  email: string;
  phone1: string;
  phone2: string;
  acceptsOnlineBooking: boolean;
  requireCashSession: boolean;
};

export type TenantProfileData = {
  name: string;
  registerNumber: string;
  email: string | null;
  phone1: string;
  phone2: string | null;
  acceptsOnlineBooking: boolean;
  requireCashSession: boolean;
};

function isEmail(v: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}

/** Хэлбэрийн шалгалт (DB-д хандахгүй). */
export function validateTenantProfile(
  raw: TenantProfileRaw,
): { ok: true; data: TenantProfileData } | TenantSettingsFailure {
  const name = raw.name.trim();
  const registerNumber = normalizeRegno(raw.registerNumber.trim());
  const email = raw.email.trim();
  const phone1 = raw.phone1.trim();
  const phone2 = raw.phone2.trim();

  const fieldErrors: Record<string, string> = {};
  if (!name) fieldErrors.name = "Нэрээ оруулна уу.";
  if (!regnoKind(registerNumber))
    fieldErrors.registerNumber = TENANT_REGNO_MESSAGE;
  // Имэйл заавал биш (бүртгэлтэй адил) — хоосон бол null.
  if (email && !isEmail(email)) fieldErrors.email = "Имэйл хаяг буруу.";
  if (!phone1) fieldErrors.phone1 = "Утасны дугаар оруулна уу.";
  else if (!isValidPhone(phone1))
    fieldErrors.phone1 = "Утасны дугаар 8 оронтой тоо байх ёстой.";
  if (phone2 && !isValidPhone(phone2))
    fieldErrors.phone2 = "Утасны дугаар 8 оронтой тоо байх ёстой.";

  if (Object.keys(fieldErrors).length > 0) {
    return { ok: false, kind: "VALIDATION", fieldErrors };
  }

  return {
    ok: true,
    data: {
      name,
      registerNumber,
      email: email || null,
      phone1: normalizePhone(phone1) ?? phone1,
      phone2: phone2 ? normalizePhone(phone2) : null,
      acceptsOnlineBooking: raw.acceptsOnlineBooking,
      requireCashSession: raw.requireCashSession,
    },
  };
}

/**
 * Нэрийн давхцал + багцын шалгалт (DB уншина, бичихгүй). Бичихээс өмнө
 * бусад шалгалттай хамт ажиллуулахын тулд `saveTenantProfile`-ээс тусдаа.
 */
export async function checkTenantProfile(
  actor: TenantActor,
  data: TenantProfileData,
): Promise<{ ok: true } | TenantSettingsFailure> {
  // Tenant.name DB түвшинд unique биш (2 өөр компани адилхан нэртэй байх нь
  // бодит боломжтой) — гэхдээ анзаарахгүй бол давхцах эрсдэлтэй тул
  // сануулга мессеж өгнө (signUpAction-той ижил UX).
  const nameConflict = await prisma.tenant.findFirst({
    where: { name: data.name, id: { not: actor.tenantId } },
    select: { id: true },
  });
  if (nameConflict) {
    return {
      ok: false,
      kind: "CONFLICT",
      fieldErrors: {
        name: "Энэ нэртэй байгууллага аль хэдийн бүртгэлтэй байна. Өөр нэр сонгоно уу.",
      },
    };
  }

  // Онлайн цаг захиалга нь багцаас хамаарна — багц дэмжихгүй бол идэвхжүүлэхгүй.
  if (data.acceptsOnlineBooking) {
    const allowed = await isFeatureEnabled(
      actor.tenantId,
      PLAN_LIMIT_CODES.ONLINE_BOOKING,
    );
    if (!allowed) {
      return {
        ok: false,
        kind: "PLAN",
        message:
          "Таны багц онлайн цаг захиалгыг дэмжихгүй байна. Багцаа сайжруулна уу.",
      };
    }
  }

  return { ok: true };
}

/** Шалгагдсан өгөгдлийг бичиж, audit log үлдээнэ. */
export async function saveTenantProfile(
  actor: TenantActor,
  data: TenantProfileData,
): Promise<{ ok: true } | TenantSettingsFailure> {
  try {
    await prisma.tenant.update({
      where: { id: actor.tenantId },
      data,
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      const target = (e.meta?.target as string[] | undefined)?.join(",") ?? "";
      const fe: Record<string, string> = {};
      if (target.includes("registerNumber"))
        fe.registerNumber = "Энэ регистр өөр байгууллагад ашиглагдсан байна.";
      else if (target.includes("email"))
        fe.email = "Энэ Gmail өөр байгууллагад ашиглагдсан байна.";
      else fe._ = "Давхардсан утга.";
      return { ok: false, kind: "CONFLICT", fieldErrors: fe };
    }
    return {
      ok: false,
      kind: "ERROR",
      message: e instanceof Error ? e.message : "Шинэчлэх явцад алдаа гарлаа.",
    };
  }

  await logAudit({
    tenantId: actor.tenantId,
    userId: actor.userId,
    entity: "Tenant",
    entityId: actor.tenantId,
    action: "UPDATE",
    summary: `Үндсэн мэдээлэл шинэчлэв: ${data.name}`,
    after: { ...data },
  });

  return { ok: true };
}

/** Шалгалт + бичилт нэг дор (вэбийн `updateTenantAction`). */
export async function updateTenantProfile(
  actor: TenantActor,
  raw: TenantProfileRaw,
): Promise<{ ok: true; data: TenantProfileData } | TenantSettingsFailure> {
  const parsed = validateTenantProfile(raw);
  if (!parsed.ok) return parsed;
  const checked = await checkTenantProfile(actor, parsed.data);
  if (!checked.ok) return checked;
  const saved = await saveTenantProfile(actor, parsed.data);
  if (!saved.ok) return saved;
  return { ok: true, data: parsed.data };
}

// ---------------------------------------------------------------------------
// Цаг захиалгын сануулгын хугацаа
// ---------------------------------------------------------------------------

// Цаг захиалгын сануулгыг товлосон цагаас хэдэн минутын өмнө илгээхийг
// (app/api/cron/appointment-reminders) тохируулна. Хоног+цаг хэлбэрээр
// оруулж минутад хөрвүүлнэ — 24 цагаас (1440) их байж болно.
export const REMINDER_LEAD_MIN_MINUTES = 60; // 1 цаг
export const REMINDER_LEAD_MAX_MINUTES = 7 * 24 * 60; // 7 хоног

/** Хоног + цагийг шалгаж минутад хөрвүүлнэ. */
export function validateReminderLead(
  days: number,
  hours: number,
): { ok: true; minutes: number } | TenantSettingsFailure {
  if (
    !Number.isInteger(days) ||
    days < 0 ||
    !Number.isInteger(hours) ||
    hours < 0
  ) {
    return { ok: false, kind: "VALIDATION", message: "Хугацаа буруу." };
  }
  const minutes = days * 24 * 60 + hours * 60;

  if (minutes < REMINDER_LEAD_MIN_MINUTES) {
    return {
      ok: false,
      kind: "VALIDATION",
      message: "Хугацаа хамгийн багадаа 1 цаг байх ёстой.",
    };
  }
  if (minutes > REMINDER_LEAD_MAX_MINUTES) {
    return {
      ok: false,
      kind: "VALIDATION",
      message: "Хугацаа хамгийн ихдээ 7 хоног байх ёстой.",
    };
  }
  return { ok: true, minutes };
}

/** Шалгагдсан хугацааг бичиж audit log үлдээнэ. */
export async function saveReminderLead(
  actor: TenantActor,
  days: number,
  hours: number,
  minutes: number,
): Promise<void> {
  await prisma.tenant.update({
    where: { id: actor.tenantId },
    data: { appointmentReminderLeadMinutes: minutes },
  });

  await logAudit({
    tenantId: actor.tenantId,
    userId: actor.userId,
    entity: "Tenant",
    entityId: actor.tenantId,
    action: "UPDATE",
    summary: `Цаг захиалгын сануулгын хугацаа шинэчлэв: ${days} хоног ${hours} цаг`,
    after: { appointmentReminderLeadMinutes: minutes },
  });
}

// ---------------------------------------------------------------------------
// Лого
// ---------------------------------------------------------------------------

async function unlinkOldLogo(logoUrl: string | null | undefined): Promise<void> {
  if (logoUrl && logoUrl.startsWith("/uploads/")) {
    try {
      await unlink(resolveUploadPath(logoUrl));
    } catch {
      // файл байхгүй ч асуудалгүй
    }
  }
}

/**
 * Шинэ лого хадгалж (lib/storage — PNG/JPG/WEBP, 2MB), хуучныг устгана.
 * Алдааны `message` нь вэбийн `logo` талбарын алдаатай адил.
 */
export async function replaceTenantLogo(
  actor: TenantActor,
  file: File,
): Promise<{ ok: true; logoUrl: string } | TenantSettingsFailure> {
  let savedPath: string;
  try {
    const saved = await saveUpload(file, "logos");
    savedPath = saved.path;
  } catch (e) {
    return {
      ok: false,
      kind: "VALIDATION",
      message: e instanceof Error ? e.message : "Лого хадгалахад алдаа гарлаа.",
    };
  }

  // Хуучин логог устгах (хэрэв байгаа бол)
  const old = await prisma.tenant.findUnique({
    where: { id: actor.tenantId },
    select: { logoUrl: true },
  });
  await unlinkOldLogo(old?.logoUrl);

  await prisma.tenant.update({
    where: { id: actor.tenantId },
    data: { logoUrl: savedPath },
  });

  await logAudit({
    tenantId: actor.tenantId,
    userId: actor.userId,
    entity: "Tenant",
    entityId: actor.tenantId,
    action: "UPDATE",
    summary: "Лого шинэчлэв",
    after: { logoUrl: savedPath },
  });

  return { ok: true, logoUrl: savedPath };
}

/** Логог устгана (файл + DB), audit log үлдээнэ. */
export async function removeTenantLogo(actor: TenantActor): Promise<void> {
  const t = await prisma.tenant.findUnique({
    where: { id: actor.tenantId },
    select: { logoUrl: true },
  });
  await unlinkOldLogo(t?.logoUrl);
  await prisma.tenant.update({
    where: { id: actor.tenantId },
    data: { logoUrl: null },
  });

  await logAudit({
    tenantId: actor.tenantId,
    userId: actor.userId,
    entity: "Tenant",
    entityId: actor.tenantId,
    action: "UPDATE",
    summary: "Лого устгав",
  });
}
