"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import {
  removeTenantLogo,
  replaceTenantLogo,
  saveReminderLead,
  updateTenantProfile,
  validateReminderLead,
} from "@/lib/tenant-settings";

// Шалгалт + DB логик lib/tenant-settings.ts-д (мобайл API
// app/api/v1/tenant/** мөн адил кодыг дууддаг).

export type TenantActionState = {
  ok: boolean;
  message?: string;
  fieldErrors?: Record<string, string>;
} | null;

function s(fd: FormData, key: string): string {
  const v = fd.get(key);
  return typeof v === "string" ? v.trim() : "";
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

  const result = await updateTenantProfile(
    { tenantId: user.tenantId, userId: user.id },
    {
      name: s(formData, "name"),
      registerNumber: s(formData, "registerNumber"),
      email: s(formData, "email"),
      phone1: s(formData, "phone1"),
      phone2: s(formData, "phone2"),
      acceptsOnlineBooking: formData.get("acceptsOnlineBooking") === "on",
      // Касс (ээлж) заавал нээх эсэх — server-ийн шалгалт lib/cash/session-attach.ts.
      requireCashSession: formData.get("requireCashSession") === "on",
    },
  );
  if (!result.ok) {
    return result.fieldErrors
      ? { ok: false, fieldErrors: result.fieldErrors }
      : { ok: false, message: result.message };
  }

  revalidatePath("/dashboard/settings");
  revalidatePath("/dashboard");
  return { ok: true, message: "Хадгалагдлаа." };
}

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
  const lead = validateReminderLead(days, hours);
  if (!lead.ok) return { ok: false, message: lead.message };

  await saveReminderLead(
    { tenantId: user.tenantId, userId: user.id },
    days,
    hours,
    lead.minutes,
  );

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

  const result = await replaceTenantLogo(
    { tenantId: user.tenantId, userId: user.id },
    file,
  );
  if (!result.ok) {
    return {
      ok: false,
      fieldErrors: { logo: result.message ?? "Лого хадгалахад алдаа гарлаа." },
    };
  }

  revalidatePath("/dashboard/settings");
  return { ok: true, message: "Лого солигдлоо." };
}

export async function removeTenantLogoAction(): Promise<void> {
  const user = await authorizeOwner();
  await removeTenantLogo({ tenantId: user.tenantId, userId: user.id });
  revalidatePath("/dashboard/settings");
}
