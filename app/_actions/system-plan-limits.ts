"use server";

import { revalidatePath } from "next/cache";
import { Prisma } from "@/app/generated/prisma/client";
import { requireSuperAdmin } from "@/lib/auth/system";
import {
  ALL_LIMIT_CODES,
  DEFAULT_PLAN_LIMITS,
  PLAN_LIMIT_META,
  type PlanLimitCode,
} from "@/lib/plan-limits";
import { prisma } from "@/lib/prisma";

// Нүүр хуудасны үнэ/боломжийн хэсэг (ISR, revalidate=3600) болон тенантын
// «Захиалга» хуудас ч энэ өгөгдлөөс уншдаг — хадгалмагц шууд шинэчилнэ.
function revalidatePlanPages() {
  revalidatePath("/system/plan-prices");
  revalidatePath("/");
  revalidatePath("/dashboard/settings/subscription");
}

export type PlanLimitActionState = {
  ok: boolean;
  message?: string;
  fieldErrors?: Record<string, string>;
} | null;

function s(fd: FormData, key: string): string {
  const v = fd.get(key);
  return typeof v === "string" ? v.trim() : "";
}

const PLANS = ["FREE", "BUSINESS", "ENTERPRISE"] as const;

function isPlan(v: string): v is (typeof PLANS)[number] {
  return (PLANS as readonly string[]).includes(v);
}

function isLimitCode(v: string): v is PlanLimitCode {
  return (ALL_LIMIT_CODES as readonly string[]).includes(v);
}

/**
 * Plan дээрх нэг хязгаарын утгыг шинэчилнэ.
 * Бичлэг байхгүй бол default-аар үүсгэнэ.
 *
 * Form fields:
 *   plan: FREE | BUSINESS | ENTERPRISE
 *   code: PlanLimitCode
 *   intValue: string ("" = unlimited)
 *   boolValue: "on" | undefined
 *   highlighted: "on" | undefined
 */
export async function updatePlanLimitAction(
  _prev: PlanLimitActionState,
  formData: FormData,
): Promise<PlanLimitActionState> {
  await requireSuperAdmin();

  const plan = s(formData, "plan");
  const code = s(formData, "code");
  const intRaw = s(formData, "intValue");
  const boolOn = formData.get("boolValue") === "on";
  const highlighted = formData.get("highlighted") === "on";

  if (!isPlan(plan)) return { ok: false, message: "Plan буруу." };
  if (!isLimitCode(code)) return { ok: false, message: "Код буруу." };

  const meta = PLAN_LIMIT_META[code];

  let intValue: number | null = null;
  let boolValue: boolean | null = null;
  if (meta.kind === "COUNT") {
    if (intRaw === "" || intRaw === "-") {
      intValue = null; // unlimited
    } else {
      const n = Number.parseInt(intRaw.replace(/\D+/g, ""), 10);
      if (!Number.isFinite(n) || n < 0) {
        return { ok: false, fieldErrors: { intValue: "Эерэг бүхэл тоо." } };
      }
      intValue = n;
    }
  } else {
    boolValue = boolOn;
  }

  const def = DEFAULT_PLAN_LIMITS[plan][code];

  try {
    await prisma.planLimit.upsert({
      where: { plan_code: { plan, code } },
      create: {
        plan,
        code,
        label: meta.label,
        description: meta.description,
        kind: meta.kind,
        intValue: meta.kind === "COUNT" ? intValue : def.intValue,
        boolValue: meta.kind === "BOOLEAN" ? boolValue : def.boolValue,
        sortOrder: meta.sortOrder,
        highlighted,
      },
      update: {
        intValue: meta.kind === "COUNT" ? intValue : undefined,
        boolValue: meta.kind === "BOOLEAN" ? boolValue : undefined,
        highlighted,
        // label/description гэх мэт meta-г үргэлж шинэчилнэ — кодын тодорхойлолт өөрчилбөл
        label: meta.label,
        description: meta.description,
        sortOrder: meta.sortOrder,
      },
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError) {
      return { ok: false, message: e.message };
    }
    return {
      ok: false,
      message: e instanceof Error ? e.message : "Хадгалахад алдаа.",
    };
  }

  revalidatePlanPages();
  return { ok: true, message: "Хадгалагдлаа." };
}

/**
 * Plan дээрх бүх хязгаарыг default утга руу нь буцаана.
 */
export async function resetPlanLimitsAction(formData: FormData): Promise<void> {
  await requireSuperAdmin();
  const plan = s(formData, "plan");
  if (!isPlan(plan)) return;

  for (const code of ALL_LIMIT_CODES) {
    const meta = PLAN_LIMIT_META[code];
    const def = DEFAULT_PLAN_LIMITS[plan][code];
    await prisma.planLimit.upsert({
      where: { plan_code: { plan, code } },
      create: {
        plan,
        code,
        label: meta.label,
        description: meta.description,
        kind: meta.kind,
        intValue: def.intValue,
        boolValue: def.boolValue,
        sortOrder: meta.sortOrder,
      },
      update: {
        intValue: def.intValue,
        boolValue: def.boolValue,
        label: meta.label,
        description: meta.description,
        sortOrder: meta.sortOrder,
      },
    });
  }

  revalidatePlanPages();
}
