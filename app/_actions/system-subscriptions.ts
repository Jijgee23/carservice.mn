"use server";


import type { ConfirmActionResult } from "@/lib/confirm-action";
import { revalidatePath } from "next/cache";
import { Prisma } from "@/app/generated/prisma/client";
import { requireSuperAdmin } from "@/lib/auth/system";
import { prisma } from "@/lib/prisma";
import { trialEndDate } from "@/lib/subscription";

function s(fd: FormData, key: string): string {
  const v = fd.get(key);
  return typeof v === "string" ? v.trim() : "";
}

function parseDate(v: string): Date | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isFinite(d.getTime()) ? d : null;
}

function parseAmount(v: string): Prisma.Decimal | null {
  if (!v) return null;
  const cleaned = v.replace(/[,\s]/g, "");
  const n = Number.parseFloat(cleaned);
  if (!Number.isFinite(n) || n < 0) return null;
  return new Prisma.Decimal(cleaned);
}

/**
 * Шинэ subscription нэмж, өмнөх идэвхтэй (TRIAL/ACTIVE) бүх subscription-ийг
 * EXPIRED болгоно. SuperAdmin л гүйцэтгэнэ.
 *
 * Form fields: id (tenant id), plan, status (TRIAL/ACTIVE), startsAt, endsAt?,
 *              amount?, notes?
 */
export async function createSubscriptionAction(formData: FormData): Promise<void> {
  const admin = await requireSuperAdmin();

  const tenantId = s(formData, "id");
  const plan = s(formData, "plan");
  const status = s(formData, "status");
  const startsAtRaw = s(formData, "startsAt");
  const endsAtRaw = s(formData, "endsAt");
  const amountRaw = s(formData, "amount");
  const notes = s(formData, "notes");

  if (!tenantId) throw new Error("Tenant ID шаардлагатай.");
  if (!["FREE", "BUSINESS", "ENTERPRISE"].includes(plan))
    throw new Error("Багц буруу.");
  if (!["TRIAL", "ACTIVE"].includes(status))
    throw new Error("Статус нь TRIAL эсвэл ACTIVE байх ёстой.");

  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { id: true },
  });
  if (!tenant) throw new Error("Тенант олдсонгүй.");

  const startsAt = parseDate(startsAtRaw) ?? new Date();
  let endsAt = parseDate(endsAtRaw);
  // TRIAL үед төгсгөл заавал — оруулаагүй бол default (TRIAL_DAYS) хоног нэмж тогтооно
  if (status === "TRIAL" && !endsAt) {
    endsAt = trialEndDate(startsAt);
  }
  if (endsAt && endsAt.getTime() <= startsAt.getTime()) {
    throw new Error("Дуусах огноо эхэлсэн огнооноос хойш байх ёстой.");
  }
  const amount = parseAmount(amountRaw);

  await prisma.$transaction(async (tx) => {
    // Өмнөх идэвхтэй subscription-уудыг EXPIRED болгоно
    await tx.subscription.updateMany({
      where: {
        tenantId,
        status: { in: ["TRIAL", "ACTIVE"] },
      },
      data: { status: "EXPIRED" },
    });
    await tx.subscription.create({
      data: {
        tenantId,
        plan: plan as "FREE" | "BUSINESS" | "ENTERPRISE",
        status: status as "TRIAL" | "ACTIVE",
        isTrial: status === "TRIAL",
        startsAt,
        endsAt,
        amount,
        notes: notes || null,
        createdById: admin.id,
      },
    });

    // Тенант дээрх "plan" талбарыг ч шинэчилнэ — UI consistency
    await tx.tenant.update({
      where: { id: tenantId },
      data: { plan: plan as "FREE" | "BUSINESS" | "ENTERPRISE" },
    });
  });

  revalidatePath(`/system/tenants/${tenantId}`);
  revalidatePath(`/dashboard/settings/subscription`);
}

/**
 * Тухайн subscription-ийн дуусах огноог сунгана. Идэвхтэй (TRIAL/ACTIVE) дээр л
 * үйлдэгдэнэ.
 *
 * Form fields: id (tenant id), subscriptionId, addDays
 */
export async function extendSubscriptionAction(
  formData: FormData,
): Promise<ConfirmActionResult> {
  await requireSuperAdmin();

  const tenantId = s(formData, "id");
  const subscriptionId = s(formData, "subscriptionId");
  const addDaysRaw = s(formData, "addDays");
  const addDays = Number.parseInt(addDaysRaw, 10);
  if (!Number.isFinite(addDays) || addDays <= 0) {
    return { error: "Нэмэгдэх хоног эерэг тоо байх ёстой." };
  }

  const sub = await prisma.subscription.findFirst({
    where: { id: subscriptionId, tenantId },
    select: { id: true, status: true, endsAt: true },
  });
  if (!sub) return { error: "Subscription олдсонгүй." };
  if (sub.status !== "TRIAL" && sub.status !== "ACTIVE") {
    return { error: "Зөвхөн идэвхтэй subscription-ийг сунгана." };
  }

  const base = sub.endsAt ?? new Date();
  const newEnd = new Date(base);
  newEnd.setDate(newEnd.getDate() + addDays);

  await prisma.subscription.update({
    where: { id: sub.id },
    data: { endsAt: newEnd },
  });

  revalidatePath(`/system/tenants/${tenantId}`);
  revalidatePath(`/dashboard/settings/subscription`);
}

/**
 * Subscription-ийг цуцалж EXPIRED-CANCELLED хооронд ялгана.
 */
export async function cancelSubscriptionAction(
  formData: FormData,
): Promise<ConfirmActionResult> {
  await requireSuperAdmin();

  const tenantId = s(formData, "id");
  const subscriptionId = s(formData, "subscriptionId");
  const sub = await prisma.subscription.findFirst({
    where: { id: subscriptionId, tenantId },
    select: { id: true, status: true },
  });
  if (!sub) return { error: "Subscription олдсонгүй." };
  if (sub.status === "CANCELLED" || sub.status === "EXPIRED") return;

  await prisma.subscription.update({
    where: { id: sub.id },
    data: { status: "CANCELLED", cancelledAt: new Date() },
  });

  revalidatePath(`/system/tenants/${tenantId}`);
  revalidatePath(`/dashboard/settings/subscription`);
}
