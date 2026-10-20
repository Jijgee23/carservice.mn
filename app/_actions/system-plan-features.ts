"use server";

import { revalidatePath } from "next/cache";
import { requireSuperAdmin } from "@/lib/auth/system";
import { prisma } from "@/lib/prisma";

// Нүүр хуудасны үнэ/боломжийн хэсэг (ISR, revalidate=3600) болон тенантын
// «Захиалга» хуудас ч энэ өгөгдлөөс уншдаг — хадгалмагц шууд шинэчилнэ.
function revalidatePlanPages() {
  revalidatePath("/system/plan-prices");
  revalidatePath("/");
  revalidatePath("/dashboard/settings/subscription");
}

export type PlanFeatureActionState = {
  ok: boolean;
  message?: string;
  fieldErrors?: Record<string, string>;
} | null;

function s(fd: FormData, key: string): string {
  const v = fd.get(key);
  return typeof v === "string" ? v.trim() : "";
}

type Parsed = {
  plan: "FREE" | "BUSINESS" | "ENTERPRISE";
  label: string;
  value: string;
  description: string | null;
  sortOrder: number;
  highlighted: boolean;
};

function validate(fd: FormData): {
  data: Parsed | null;
  errors: Record<string, string>;
} {
  const planRaw = s(fd, "plan");
  const label = s(fd, "label");
  const value = s(fd, "value");
  const description = s(fd, "description");
  const sortOrderRaw = s(fd, "sortOrder");
  const highlighted = fd.get("highlighted") === "on";

  const errors: Record<string, string> = {};
  if (!["FREE", "BUSINESS", "ENTERPRISE"].includes(planRaw))
    errors.plan = "Багц буруу.";
  if (!label) errors.label = "Боломжийн нэр шаардлагатай.";
  if (!value) errors.value = "Утга шаардлагатай.";

  let sortOrder = 0;
  if (sortOrderRaw) {
    const n = Number.parseInt(sortOrderRaw, 10);
    if (!Number.isFinite(n)) errors.sortOrder = "Эрэмбэ тоо байх ёстой.";
    else sortOrder = n;
  }

  if (Object.keys(errors).length > 0) return { data: null, errors };
  return {
    data: {
      plan: planRaw as Parsed["plan"],
      label,
      value,
      description: description || null,
      sortOrder,
      highlighted,
    },
    errors,
  };
}

export async function createPlanFeatureAction(
  _prev: PlanFeatureActionState,
  formData: FormData,
): Promise<PlanFeatureActionState> {
  await requireSuperAdmin();
  const { data, errors } = validate(formData);
  if (!data) return { ok: false, fieldErrors: errors };

  try {
    await prisma.planFeature.create({ data });
  } catch (e) {
    return {
      ok: false,
      message: e instanceof Error ? e.message : "Үүсгэх явцад алдаа.",
    };
  }
  revalidatePlanPages();
  return { ok: true, message: "Боломж нэмэгдлээ." };
}

export async function updatePlanFeatureAction(
  id: string,
  _prev: PlanFeatureActionState,
  formData: FormData,
): Promise<PlanFeatureActionState> {
  await requireSuperAdmin();
  const { data, errors } = validate(formData);
  if (!data) return { ok: false, fieldErrors: errors };

  try {
    await prisma.planFeature.update({ where: { id }, data });
  } catch (e) {
    return {
      ok: false,
      message: e instanceof Error ? e.message : "Шинэчлэх явцад алдаа.",
    };
  }
  revalidatePlanPages();
  return { ok: true, message: "Хадгалагдлаа." };
}

export async function deletePlanFeatureAction(formData: FormData): Promise<void> {
  await requireSuperAdmin();
  const id = s(formData, "id");
  if (!id) return;
  await prisma.planFeature.delete({ where: { id } });
  revalidatePlanPages();
}
