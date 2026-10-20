"use server";

import { revalidatePath } from "next/cache";
import { Prisma } from "@/app/generated/prisma/client";
import { requireSuperAdmin } from "@/lib/auth/system";
import { prisma } from "@/lib/prisma";

// Нүүр хуудасны үнэ/боломжийн хэсэг (ISR, revalidate=3600) болон тенантын
// «Захиалга» хуудас ч энэ өгөгдлөөс уншдаг — хадгалмагц шууд шинэчилнэ.
function revalidatePlanPages() {
  revalidatePath("/system/plan-prices");
  revalidatePath("/");
  revalidatePath("/dashboard/settings/subscription");
}

export type PlanPriceActionState = {
  ok: boolean;
  message?: string;
  fieldErrors?: Record<string, string>;
} | null;

function s(fd: FormData, key: string): string {
  const v = fd.get(key);
  return typeof v === "string" ? v.trim() : "";
}

function parseAmount(v: string): Prisma.Decimal | null {
  if (!v) return null;
  const cleaned = v.replace(/[,\s]/g, "");
  const n = Number.parseFloat(cleaned);
  if (!Number.isFinite(n) || n < 0) return null;
  return new Prisma.Decimal(cleaned);
}

type Parsed = {
  plan: "FREE" | "BUSINESS" | "ENTERPRISE";
  period: "MONTH" | "QUARTER" | "YEAR";
  amount: Prisma.Decimal;
  currency: string;
  isActive: boolean;
  notes: string | null;
};

function validate(fd: FormData): {
  data: Parsed | null;
  errors: Record<string, string>;
} {
  const planRaw = s(fd, "plan");
  const periodRaw = s(fd, "period");
  const amountRaw = s(fd, "amount");
  const currency = s(fd, "currency") || "MNT";
  const notes = s(fd, "notes");
  const isActive = fd.get("isActive") === "on";

  const errors: Record<string, string> = {};
  if (!["FREE", "BUSINESS", "ENTERPRISE"].includes(planRaw))
    errors.plan = "Багц буруу.";
  if (!["MONTH", "QUARTER", "YEAR"].includes(periodRaw))
    errors.period = "Хугацаа буруу.";
  const amount = parseAmount(amountRaw);
  if (!amount) errors.amount = "Үнэ буруу.";

  if (Object.keys(errors).length > 0) return { data: null, errors };

  return {
    data: {
      plan: planRaw as Parsed["plan"],
      period: periodRaw as Parsed["period"],
      amount: amount!,
      currency,
      isActive,
      notes: notes || null,
    },
    errors,
  };
}

export async function createPlanPriceAction(
  _prev: PlanPriceActionState,
  formData: FormData,
): Promise<PlanPriceActionState> {
  await requireSuperAdmin();
  const { data, errors } = validate(formData);
  if (!data) return { ok: false, fieldErrors: errors };

  try {
    await prisma.planPrice.create({ data });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return {
        ok: false,
        message:
          "Энэ багц + хугацаа + валют хослолтой үнэ аль хэдийн бүртгэгдсэн байна.",
      };
    }
    return {
      ok: false,
      message: e instanceof Error ? e.message : "Үүсгэх явцад алдаа.",
    };
  }
  revalidatePlanPages();
  return { ok: true, message: "Үнэ нэмэгдлээ." };
}

export async function updatePlanPriceAction(
  id: string,
  _prev: PlanPriceActionState,
  formData: FormData,
): Promise<PlanPriceActionState> {
  await requireSuperAdmin();
  const { data, errors } = validate(formData);
  if (!data) return { ok: false, fieldErrors: errors };

  try {
    const updated = await prisma.planPrice.update({
      where: { id },
      data,
    });
    if (!updated) return { ok: false, message: "Олдсонгүй." };
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return {
        ok: false,
        message:
          "Энэ багц + хугацаа + валют хослол өөр мөртэй давхцаж байна.",
      };
    }
    return {
      ok: false,
      message: e instanceof Error ? e.message : "Шинэчлэх явцад алдаа.",
    };
  }
  revalidatePlanPages();
  return { ok: true, message: "Хадгалагдлаа." };
}

export async function deletePlanPriceAction(formData: FormData): Promise<void> {
  await requireSuperAdmin();
  const id = s(formData, "id");
  if (!id) return;
  await prisma.planPrice.delete({ where: { id } });
  revalidatePlanPages();
}

/**
 * Plan + Period + Currency хослолоор upsert хийнэ. Matrix UI-аас дуудна:
 * нэг cell дотор үнэ / идэвхтэй эсэх 2 утгыг шинэчилнэ.
 */
export async function upsertPlanPriceAction(
  _prev: PlanPriceActionState,
  formData: FormData,
): Promise<PlanPriceActionState> {
  await requireSuperAdmin();

  const planRaw = s(formData, "plan");
  const periodRaw = s(formData, "period");
  const currency = (s(formData, "currency") || "MNT").toUpperCase();
  const amountRaw = s(formData, "amount");
  const isActive = formData.get("isActive") === "on";
  const notes = s(formData, "notes");

  if (!["BUSINESS", "ENTERPRISE"].includes(planRaw)) {
    return { ok: false, message: "FREE багц нь зөвхөн туршилт — үнэ бүртгэхгүй." };
  }
  if (!["MONTH", "QUARTER", "YEAR"].includes(periodRaw)) {
    return { ok: false, message: "Хугацаа буруу." };
  }

  const amount = parseAmount(amountRaw);
  if (!amount) {
    return { ok: false, fieldErrors: { amount: "Үнэ буруу." } };
  }

  const plan = planRaw as Parsed["plan"];
  const period = periodRaw as Parsed["period"];

  try {
    await prisma.planPrice.upsert({
      where: { plan_period_currency: { plan, period, currency } },
      create: {
        plan,
        period,
        currency,
        amount,
        isActive,
        notes: notes || null,
      },
      update: {
        amount,
        isActive,
        notes: notes || null,
      },
    });
  } catch (e) {
    return {
      ok: false,
      message: e instanceof Error ? e.message : "Хадгалахад алдаа.",
    };
  }

  revalidatePlanPages();
  return { ok: true, message: "Хадгалагдлаа." };
}
