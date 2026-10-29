"use server";

import { revalidatePath } from "next/cache";
import { unlink } from "node:fs/promises";
import { Prisma } from "@/app/generated/prisma/client";
import { logAudit } from "@/lib/audit";
import { requireUser } from "@/lib/auth";
import { PLAN_LIMIT_CODES } from "@/lib/plan-limits";
import { isValidPhone, normalizePhone } from "@/lib/phone";
import { isFeatureEnabled } from "@/lib/plan-limits-server";
import { prisma } from "@/lib/prisma";
import { resolveUploadPath, saveUpload } from "@/lib/storage";
import { normalizeRegno, regnoKind, TENANT_REGNO_MESSAGE } from "@/lib/tenant-regno";

export type TenantActionState = {
  ok: boolean;
  message?: string;
  fieldErrors?: Record<string, string>;
} | null;

function s(fd: FormData, key: string): string {
  const v = fd.get(key);
  return typeof v === "string" ? v.trim() : "";
}

function isEmail(v: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}

async function authorizeOwner() {
  const user = await requireUser();
  if (!user.isOwner) {
    throw new Error("Зөвхөн админ тохиргоог өөрчилнө.");
  }
  return user;
}

export async function updateTenantAction(
  _prev: TenantActionState,
  formData: FormData,
): Promise<TenantActionState> {
  let user;
  try {
    user = await authorizeOwner();
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Алдаа" };
  }

  const name = s(formData, "name");
  const registerNumber = normalizeRegno(s(formData, "registerNumber"));
  const email = s(formData, "email");
  const phone1 = s(formData, "phone1");
  const phone2 = s(formData, "phone2");
  const acceptsOnlineBooking = formData.get("acceptsOnlineBooking") === "on";

  const fieldErrors: Record<string, string> = {};
  if (!name) fieldErrors.name = "Нэрээ оруулна уу.";
  if (!regnoKind(registerNumber))
    fieldErrors.registerNumber = TENANT_REGNO_MESSAGE;
  if (!isEmail(email)) fieldErrors.email = "Имэйл хаяг буруу.";
  if (!phone1) fieldErrors.phone1 = "Утасны дугаар оруулна уу.";
  else if (!isValidPhone(phone1))
    fieldErrors.phone1 = "Утасны дугаар 8 оронтой тоо байх ёстой.";
  if (phone2 && !isValidPhone(phone2))
    fieldErrors.phone2 = "Утасны дугаар 8 оронтой тоо байх ёстой.";

  if (Object.keys(fieldErrors).length > 0) {
    return { ok: false, fieldErrors };
  }

  const normPhone1 = normalizePhone(phone1) ?? phone1;
  const normPhone2 = phone2 ? normalizePhone(phone2) : null;

  // Tenant.name DB түвшинд unique биш (2 өөр компани адилхан нэртэй байх нь
  // бодит боломжтой) — гэхдээ анзаарахгүй бол давхцах эрсдэлтэй тул
  // сануулга мессеж өгнө (signUpAction-той ижил UX).
  const nameConflict = await prisma.tenant.findFirst({
    where: { name, id: { not: user.tenantId } },
    select: { id: true },
  });
  if (nameConflict) {
    return {
      ok: false,
      fieldErrors: {
        name: "Энэ нэртэй байгууллага аль хэдийн бүртгэлтэй байна. Өөр нэр сонгоно уу.",
      },
    };
  }

  // Онлайн цаг захиалга нь багцаас хамаарна — багц дэмжихгүй бол идэвхжүүлэхгүй.
  if (acceptsOnlineBooking) {
    const allowed = await isFeatureEnabled(
      user.tenantId,
      PLAN_LIMIT_CODES.ONLINE_BOOKING,
    );
    if (!allowed) {
      return {
        ok: false,
        message:
          "Таны багц онлайн цаг захиалгыг дэмжихгүй байна. Багцаа сайжруулна уу.",
      };
    }
  }

  try {
    await prisma.tenant.update({
      where: { id: user.tenantId },
      data: {
        name,
        registerNumber,
        email,
        phone1: normPhone1,
        phone2: normPhone2,
        acceptsOnlineBooking,
      },
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
      return { ok: false, fieldErrors: fe };
    }
    return {
      ok: false,
      message: e instanceof Error ? e.message : "Шинэчлэх явцад алдаа гарлаа.",
    };
  }

  await logAudit({
    tenantId: user.tenantId,
    userId: user.id,
    entity: "Tenant",
    entityId: user.tenantId,
    action: "UPDATE",
    summary: `Үндсэн мэдээлэл шинэчлэв: ${name}`,
    after: {
      name,
      registerNumber,
      email,
      phone1: normPhone1,
      phone2: normPhone2,
      acceptsOnlineBooking,
    },
  });

  revalidatePath("/dashboard/settings");
  revalidatePath("/dashboard");
  return { ok: true, message: "Хадгалагдлаа." };
}

// Цаг захиалгын сануулгыг товлосон цагаас хэдэн минутын өмнө илгээхийг
// (app/api/cron/appointment-reminders) тохируулна. Хоног+цаг хэлбэрээр
// оруулж минутад хөрвүүлнэ — 24 цагаас (1440) их байж болно.
const REMINDER_LEAD_MIN_MINUTES = 60; // 1 цаг
const REMINDER_LEAD_MAX_MINUTES = 7 * 24 * 60; // 7 хоног

export async function updateAppointmentReminderLeadAction(
  _prev: TenantActionState,
  formData: FormData,
): Promise<TenantActionState> {
  let user;
  try {
    user = await authorizeOwner();
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Алдаа" };
  }

  const days = Number.parseInt(s(formData, "leadDays") || "0", 10);
  const hours = Number.parseInt(s(formData, "leadHours") || "0", 10);
  if (!Number.isFinite(days) || days < 0 || !Number.isFinite(hours) || hours < 0) {
    return { ok: false, message: "Хугацаа буруу." };
  }
  const minutes = days * 24 * 60 + hours * 60;

  if (minutes < REMINDER_LEAD_MIN_MINUTES) {
    return {
      ok: false,
      message: "Хугацаа хамгийн багадаа 1 цаг байх ёстой.",
    };
  }
  if (minutes > REMINDER_LEAD_MAX_MINUTES) {
    return {
      ok: false,
      message: "Хугацаа хамгийн ихдээ 7 хоног байх ёстой.",
    };
  }

  await prisma.tenant.update({
    where: { id: user.tenantId },
    data: { appointmentReminderLeadMinutes: minutes },
  });

  await logAudit({
    tenantId: user.tenantId,
    userId: user.id,
    entity: "Tenant",
    entityId: user.tenantId,
    action: "UPDATE",
    summary: `Цаг захиалгын сануулгын хугацаа шинэчлэв: ${days} хоног ${hours} цаг`,
    after: { appointmentReminderLeadMinutes: minutes },
  });

  revalidatePath("/dashboard/settings");
  return { ok: true, message: "Хадгалагдлаа." };
}

export async function uploadTenantLogoAction(
  _prev: TenantActionState,
  formData: FormData,
): Promise<TenantActionState> {
  let user;
  try {
    user = await authorizeOwner();
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Алдаа" };
  }

  const file = formData.get("logo");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, fieldErrors: { logo: "Файл сонгоно уу." } };
  }

  let savedPath: string;
  try {
    const saved = await saveUpload(file, "logos");
    savedPath = saved.path;
  } catch (e) {
    return {
      ok: false,
      fieldErrors: {
        logo: e instanceof Error ? e.message : "Лого хадгалахад алдаа гарлаа.",
      },
    };
  }

  // Хуучин логог устгах (хэрэв байгаа бол)
  const old = await prisma.tenant.findUnique({
    where: { id: user.tenantId },
    select: { logoUrl: true },
  });
  if (old?.logoUrl && old.logoUrl.startsWith("/uploads/")) {
    try {
      await unlink(resolveUploadPath(old.logoUrl));
    } catch {
      // файл байхгүй ч асуудалгүй
    }
  }

  await prisma.tenant.update({
    where: { id: user.tenantId },
    data: { logoUrl: savedPath },
  });

  await logAudit({
    tenantId: user.tenantId,
    userId: user.id,
    entity: "Tenant",
    entityId: user.tenantId,
    action: "UPDATE",
    summary: "Лого шинэчлэв",
    after: { logoUrl: savedPath },
  });

  revalidatePath("/dashboard/settings");
  return { ok: true, message: "Лого солигдлоо." };
}

export async function removeTenantLogoAction(): Promise<void> {
  const user = await authorizeOwner();
  const t = await prisma.tenant.findUnique({
    where: { id: user.tenantId },
    select: { logoUrl: true },
  });
  if (t?.logoUrl && t.logoUrl.startsWith("/uploads/")) {
    try {
      await unlink(resolveUploadPath(t.logoUrl));
    } catch {
      // ignore
    }
  }
  await prisma.tenant.update({
    where: { id: user.tenantId },
    data: { logoUrl: null },
  });

  await logAudit({
    tenantId: user.tenantId,
    userId: user.id,
    entity: "Tenant",
    entityId: user.tenantId,
    action: "UPDATE",
    summary: "Лого устгав",
  });

  revalidatePath("/dashboard/settings");
}
