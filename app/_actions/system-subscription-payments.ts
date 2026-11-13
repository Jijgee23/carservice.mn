"use server";

import type { ConfirmActionResult } from "@/lib/confirm-action";
import { revalidatePath } from "next/cache";
import { Prisma } from "@/app/generated/prisma/client";
import { requireSuperAdmin } from "@/lib/auth/system";
import { prisma } from "@/lib/prisma";
import { activateSubscriptionPayment } from "@/lib/subscription-payments";

export type SubscriptionPaymentActionState = {
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
  if (!Number.isFinite(n) || n <= 0) return null;
  return new Prisma.Decimal(cleaned);
}

/**
 * SuperAdmin гар аргаар (жишээ: банкны шилжүүлэг) төлбөрийн бичлэг нэмнэ.
 * "Төлөгдсөн гэж тэмдэглэх" сонговол шууд идэвхжинэ (activateSubscriptionPayment) —
 * эс бөгөөс зөвхөн PENDING бүртгэл болно (дараа нь тусад нь баталгаажуулж болно).
 */
export async function createManualSubscriptionPaymentAction(
  _prev: SubscriptionPaymentActionState,
  formData: FormData,
): Promise<SubscriptionPaymentActionState> {
  const admin = await requireSuperAdmin();

  const tenantId = s(formData, "tenantId");
  const plan = s(formData, "plan");
  const period = s(formData, "period");
  const amount = parseAmount(s(formData, "amount"));
  const method = s(formData, "method") || "BANK_TRANSFER";
  const notes = s(formData, "notes");
  const markPaid = formData.get("markPaid") === "on";

  const fieldErrors: Record<string, string> = {};
  if (!tenantId) fieldErrors.tenantId = "Tenant ID шаардлагатай.";
  if (!["FREE", "BUSINESS", "ENTERPRISE"].includes(plan))
    fieldErrors.plan = "Багц буруу.";
  if (!["MONTH", "QUARTER", "YEAR"].includes(period))
    fieldErrors.period = "Хугацаа буруу.";
  if (!amount) fieldErrors.amount = "Дүн эерэг тоо байх ёстой.";
  if (
    !["QPAY", "BANK_TRANSFER", "CASH", "OTHER"].includes(method)
  )
    fieldErrors.method = "Төлбөрийн арга буруу.";
  if (Object.keys(fieldErrors).length > 0) return { ok: false, fieldErrors };

  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { id: true },
  });
  if (!tenant) return { ok: false, message: "Тенант олдсонгүй." };

  const payment = await prisma.subscriptionPayment.create({
    data: {
      tenantId,
      plan: plan as "FREE" | "BUSINESS" | "ENTERPRISE",
      period: period as "MONTH" | "QUARTER" | "YEAR",
      amount: amount!,
      method: method as "QPAY" | "BANK_TRANSFER" | "CASH" | "OTHER",
      status: "PENDING",
    },
  });

  if (markPaid) {
    await activateSubscriptionPayment(payment, {
      paidAt: new Date(),
      note:
        notes ||
        `Гар аргаар (${method}) баталгаажуулсан — ${admin.lastName} ${admin.firstName}`,
    });
  }

  revalidatePath(`/system/tenants/${tenantId}`);
  return {
    ok: true,
    message: markPaid
      ? "Төлбөр бүртгэгдэж, багц идэвхжлээ."
      : "Төлбөр PENDING төлөвөөр бүртгэгдлээ.",
  };
}

/** PENDING төлбөрийг гар аргаар PAID болгож, багцыг идэвхжүүлнэ. */
export async function markSubscriptionPaymentPaidAction(
  formData: FormData,
): Promise<ConfirmActionResult> {
  const admin = await requireSuperAdmin();
  const id = s(formData, "id");
  if (!id) return;

  const payment = await prisma.subscriptionPayment.findUnique({
    where: { id },
  });
  if (!payment) return { error: "Төлбөр олдсонгүй." };
  if (payment.status === "PAID") return;

  await activateSubscriptionPayment(payment, {
    paidAt: new Date(),
    note: `Гар аргаар баталгаажуулсан — ${admin.lastName} ${admin.firstName}`,
  });

  revalidatePath(`/system/tenants/${payment.tenantId}`);
}

/**
 * PENDING/FAILED төлбөрийг "төлөгдөөгүй" (CANCELLED) гэж тэмдэглэнэ —
 * PAID болсон төлбөрийг ЭНД буцааж болохгүй (Subscription аль хэдийн
 * идэвхэжсэн тул тусад нь цуцлах action-оор л буцаана).
 */
export async function markSubscriptionPaymentUnpaidAction(
  formData: FormData,
): Promise<ConfirmActionResult> {
  await requireSuperAdmin();
  const id = s(formData, "id");
  if (!id) return;

  const payment = await prisma.subscriptionPayment.findUnique({
    where: { id },
  });
  if (!payment) return { error: "Төлбөр олдсонгүй." };
  if (payment.status === "PAID") {
    return {
      error: "Аль хэдийн баталгаажсан төлбөрийг 'төлөгдөөгүй' болгож болохгүй.",
    };
  }
  if (payment.status === "CANCELLED") return;

  await prisma.subscriptionPayment.update({
    where: { id },
    data: { status: "CANCELLED" },
  });

  revalidatePath(`/system/tenants/${payment.tenantId}`);
}
