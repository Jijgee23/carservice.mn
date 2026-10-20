"use server";

import { revalidatePath } from "next/cache";
import { requireSuperAdmin } from "@/lib/auth/system";
import { prisma } from "@/lib/prisma";
import { validateStoreUrl } from "@/lib/app-store-links";

export type SettingsActionState = {
  ok: boolean;
  message?: string;
  fieldErrors?: Record<string, string>;
} | null;

function s(fd: FormData, key: string): string {
  const v = fd.get(key);
  return typeof v === "string" ? v.trim() : "";
}

function isUrlOrEmpty(v: string): boolean {
  return !v || /^https?:\/\/.+/i.test(v);
}

export async function updatePlatformSettings(
  _prev: SettingsActionState,
  formData: FormData,
): Promise<SettingsActionState> {
  await requireSuperAdmin();

  const facebookUrl = s(formData, "facebookUrl");
  const youtubeUrl = s(formData, "youtubeUrl");
  const appointmentFeeEnabled = formData.get("appointmentFeeEnabled") === "on";
  const appointmentFeeAmountRaw = s(formData, "appointmentFeeAmount");

  const fieldErrors: Record<string, string> = {};
  if (!isUrlOrEmpty(facebookUrl))
    fieldErrors.facebookUrl = "http(s):// эхэлсэн хаяг оруулна уу.";
  if (!isUrlOrEmpty(youtubeUrl))
    fieldErrors.youtubeUrl = "http(s):// эхэлсэн хаяг оруулна уу.";

  const storeUrls: Record<string, string | null> = {};
  for (const [field, store] of [
    ["customerAppStoreUrl", "appStore"],
    ["customerPlayStoreUrl", "playStore"],
    ["businessAppStoreUrl", "appStore"],
    ["businessPlayStoreUrl", "playStore"],
  ] as const) {
    const r = validateStoreUrl(s(formData, field), store);
    if (r.ok) storeUrls[field] = r.value;
    else fieldErrors[field] = r.error;
  }

  const appointmentFeeAmount = Number.parseFloat(appointmentFeeAmountRaw);
  if (!Number.isFinite(appointmentFeeAmount) || appointmentFeeAmount <= 0) {
    fieldErrors.appointmentFeeAmount = "0-ээс их дүн оруулна уу.";
  }
  if (Object.keys(fieldErrors).length > 0) return { ok: false, fieldErrors };

  await prisma.platformSetting.upsert({
    where: { id: "default" },
    create: {
      id: "default",
      facebookUrl: facebookUrl || null,
      youtubeUrl: youtubeUrl || null,
      appointmentFeeEnabled,
      appointmentFeeAmount,
      ...storeUrls,
    },
    update: {
      facebookUrl: facebookUrl || null,
      youtubeUrl: youtubeUrl || null,
      appointmentFeeEnabled,
      appointmentFeeAmount,
      ...storeUrls,
    },
  });

  revalidatePath("/system/settings");
  revalidatePath("/system");
  // Store холбоос нүүр хуудас, footer, хэрэглэгч/ажилтны layout-д харагддаг.
  revalidatePath("/", "layout");
  return { ok: true, message: "Хадгалагдлаа." };
}
