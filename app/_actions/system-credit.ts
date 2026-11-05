"use server";

import { revalidatePath } from "next/cache";
import { requireSuperAdmin } from "@/lib/auth/system";
import { clampAdjustment } from "@/lib/credit-score";
import { recomputeAllCredit, recomputeTenantCredit } from "@/lib/credit-score-server";
import { prisma } from "@/lib/prisma";
import { deleteReview, setReviewHidden } from "@/lib/reviews";

export type SystemCreditState = { ok: boolean; message?: string; fieldErrors?: Record<string, string> } | null;

function s(fd: FormData, key: string): string {
  const v = fd.get(key);
  return typeof v === "string" ? v.trim() : "";
}

/** Платформын тохиргоо: автомат блок, босго, блокын хэлбэр. Хадгалсны дараа бүх тенантыг дахин тооцно. */
export async function updateCreditSettingsAction(
  _prev: SystemCreditState,
  formData: FormData,
): Promise<SystemCreditState> {
  await requireSuperAdmin();
  const creditAutoBlock = formData.get("creditAutoBlock") === "on";
  const threshold = Number(s(formData, "creditBlockThreshold"));
  const mode = s(formData, "creditBlockMode");
  if (!Number.isInteger(threshold) || threshold < 0 || threshold > 100) {
    return { ok: false, fieldErrors: { creditBlockThreshold: "0–100 бүхэл тоо." } };
  }
  if (mode !== "HIDE" && mode !== "SUSPEND") return { ok: false, fieldErrors: { creditBlockMode: "Хэлбэр буруу." } };

  await prisma.platformSetting.upsert({
    where: { id: "default" },
    create: { id: "default", creditAutoBlock, creditBlockThreshold: threshold, creditBlockMode: mode },
    update: { creditAutoBlock, creditBlockThreshold: threshold, creditBlockMode: mode },
  });
  const results = await recomputeAllCredit();
  revalidatePath("/system/settings");
  revalidatePath("/system/tenants");
  const blocked = results.filter((r) => r.event === "blocked").length;
  const unblocked = results.filter((r) => r.event === "unblocked").length;
  return {
    ok: true,
    message: `Хадгалагдлаа. ${results.length} байгууллага дахин тооцогдов${blocked ? `, ${blocked} блоклогдов` : ""}${unblocked ? `, ${unblocked} нээгдэв` : ""}.`,
  };
}

/** Тенантын залруулга (−50..50) + тайлбар; дараа нь оноог дахин тооцно. */
export async function updateCreditAdjustmentAction(
  _prev: SystemCreditState,
  formData: FormData,
): Promise<SystemCreditState> {
  await requireSuperAdmin();
  const tenantId = s(formData, "tenantId");
  const raw = Number(s(formData, "creditAdjustment") || "0");
  if (!Number.isFinite(raw)) return { ok: false, fieldErrors: { creditAdjustment: "Тоо оруулна уу." } };
  await prisma.tenant.update({
    where: { id: tenantId },
    data: { creditAdjustment: clampAdjustment(raw), creditAdjustmentNote: s(formData, "creditAdjustmentNote") || null },
  });
  const r = await recomputeTenantCredit(tenantId);
  revalidatePath(`/system/tenants/${tenantId}`);
  return { ok: true, message: r ? `Хадгалагдлаа. Шинэ оноо: ${r.score}.` : "Хадгалагдлаа (тест байгууллага — оноо тооцогдохгүй)." };
}

/** Нэг тенантын оноог одоо дахин тооцох. */
export async function recomputeTenantCreditAction(formData: FormData): Promise<void> {
  await requireSuperAdmin();
  const tenantId = s(formData, "tenantId");
  await recomputeTenantCredit(tenantId);
  revalidatePath(`/system/tenants/${tenantId}`);
}

/**
 * Автомат блокыг энэ байгууллагад цуцлах (exempt=true → блок арилна, цаашид
 * автоматаар блоклогдохгүй) эсвэл дахин идэвхжүүлэх (exempt=false).
 */
export async function setCreditExemptAction(formData: FormData): Promise<void> {
  await requireSuperAdmin();
  const tenantId = s(formData, "tenantId");
  const exempt = s(formData, "exempt") === "true";
  await prisma.tenant.update({ where: { id: tenantId }, data: { creditExempt: exempt } });
  await recomputeTenantCredit(tenantId);
  revalidatePath(`/system/tenants/${tenantId}`);
  revalidatePath("/system/tenants");
}

// --- Үнэлгээний хяналт ------------------------------------------------------

export async function setReviewHiddenAction(formData: FormData): Promise<void> {
  await requireSuperAdmin();
  await setReviewHidden(s(formData, "reviewId"), s(formData, "hidden") === "true", s(formData, "reason") || null);
  revalidatePath("/system/reviews");
}

export async function deleteReviewAction(formData: FormData): Promise<void> {
  await requireSuperAdmin();
  await deleteReview(s(formData, "reviewId"));
  revalidatePath("/system/reviews");
}
