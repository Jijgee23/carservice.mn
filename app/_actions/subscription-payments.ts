"use server";

import { revalidatePath } from "next/cache";
import { Prisma } from "@/app/generated/prisma/client";
import { logAudit } from "@/lib/audit";
import { requireUser } from "@/lib/auth";
import { formatTugrik } from "@/lib/orders";
import { prisma } from "@/lib/prisma";
import { QPayService } from "@/lib/qpay";
import { confirmSubscriptionPayment } from "@/lib/subscription-payments";
import { getAppBaseUrl } from "@/lib/subscription-server";
import { BILLING_PERIOD_LABEL, PLAN_LABEL } from "@/lib/subscription";

export type PaymentActionState = {
  ok: boolean;
  message?: string;
  paymentId?: string;
} | null;

function s(fd: FormData, key: string): string {
  const v = fd.get(key);
  return typeof v === "string" ? v.trim() : "";
}

/**
 * Тенант OWNER нь PlanPrice сонгоод төлбөр үүсгэнэ. SubscriptionPayment(PENDING)
 * + QPay invoice үүсгэнэ. QR + payment-н id-г буцаана. UI нь шалгуурын polling
 * хийж PAID болсон үед subscription идэвхжүүлнэ.
 */
export async function createSubscriptionPaymentAction(
  _prev: PaymentActionState,
  formData: FormData,
): Promise<PaymentActionState> {
  const user = await requireUser();
  if (!user.isOwner) {
    return { ok: false, message: "Зөвхөн админ багц авна." };
  }

  const planPriceId = s(formData, "planPriceId");
  if (!planPriceId) return { ok: false, message: "Үнэ сонгоно уу." };

  const price = await prisma.planPrice.findFirst({
    where: { id: planPriceId, isActive: true },
  });
  if (!price) {
    return { ok: false, message: "Сонгосон үнэ олдсонгүй / идэвхгүй." };
  }

  // FREE plan-ыг худалдан авах боломжгүй — энэ нь зөвхөн signup үед 14 хоногийн
  // нэг удаагийн туршилт хэлбэрээр үүсдэг.
  if (price.plan === "FREE") {
    return {
      ok: false,
      message:
        "Энгийн (FREE) багц нь зөвхөн бүртгүүлэх үед нэг удаагийн туршилт. Худалдаж авах боломжгүй.",
    };
  }

  // Snapshot + payment үүсгэх
  const amountNumber = Number.parseFloat(price.amount.toString());
  const payment = await prisma.subscriptionPayment.create({
    data: {
      tenantId: user.tenantId,
      plan: price.plan,
      period: price.period,
      amount: price.amount,
      currency: price.currency,
      planPriceId: price.id,
      method: "QPAY",
      status: "PENDING",
    },
    select: { id: true },
  });

  // QPay invoice үүсгэх. callback_url-д payment.id-г дамжуулна — QPay төлбөр
  // хийгдсэний дараа энэ URL рүү дуудаж, бид checkPayment-ээр баталгаажуулна.
  const inv = await QPayService.createInvoice({
    senderInvoiceNo: payment.id,
    invoiceReceiverCode: user.tenantId,
    invoiceDescription: `${PLAN_LABEL[price.plan]} · ${BILLING_PERIOD_LABEL[price.period]}`,
    amount: amountNumber,
    callbackUrl: `${getAppBaseUrl()}/api/v1/subscriptions/qpay/callback?payment_id=${payment.id}`,
  });
  if ("error" in inv) {
    await prisma.subscriptionPayment.update({
      where: { id: payment.id },
      data: { status: "FAILED" },
    });
    await logAudit({
      tenantId: user.tenantId,
      userId: user.id,
      entity: "Tenant",
      entityId: user.tenantId,
      action: "PAYMENT_CHANGE",
      summary: `Багцын QPay invoice үүсгэхэд алдаа: ${price.plan}`,
      after: { paymentId: payment.id, plan: price.plan, status: "FAILED" },
    });
    // Provider text (status/body/config hints) stays server-side.
    console.error("[subscription-payment] QPay createInvoice failed:", payment.id, inv.error);
    return { ok: false, message: "QPay нэхэмжлэх үүсгэхэд алдаа гарлаа. Түр хүлээгээд дахин оролдоно уу." };
  }

  await prisma.subscriptionPayment.update({
    where: { id: payment.id },
    data: {
      qpayInvoiceId: inv.invoice_id,
      qrText: inv.qr_text,
      qrImage: inv.qr_image,
      qpayUrls: inv.urls ?? Prisma.JsonNull,
    },
  });

  await logAudit({
    tenantId: user.tenantId,
    userId: user.id,
    entity: "Tenant",
    entityId: user.tenantId,
    action: "PAYMENT_CHANGE",
    summary: `Багцын QPay QR үүсгэв: ${price.plan} · ${formatTugrik(amountNumber)}`,
    after: { paymentId: payment.id, plan: price.plan, amount: amountNumber },
  });

  revalidatePath("/dashboard/settings/subscription");
  return { ok: true, paymentId: payment.id };
}

/**
 * UI-аас тогтмол дуудна — QPay-аас тус payment-ийн төлөв шалгаж, PAID болсон
 * үед subscription үүсгэж payment-ийг шинэчилнэ. Дахин дуудсан ч idempotent.
 *
 * Form fields: paymentId
 */
export async function checkSubscriptionPaymentAction(
  formData: FormData,
): Promise<{ ok: boolean; paid: boolean; message?: string }> {
  const user = await requireUser();
  const paymentId = s(formData, "paymentId");
  if (!paymentId) return { ok: false, paid: false, message: "ID шаардлагатай." };

  // Энэ payment тухайн тенантынх эсэхийг шалгаад, баталгаажуулалтыг хуваалцсан
  // core логикт даатгана (web polling + QPay callback хоёул адил замаар явна).
  const payment = await prisma.subscriptionPayment.findFirst({
    where: { id: paymentId, tenantId: user.tenantId },
    select: { id: true },
  });
  if (!payment) return { ok: false, paid: false, message: "Төлбөр олдсонгүй." };

  return confirmSubscriptionPayment(payment.id);
}

/**
 * Хэрэглэгч QR-ыг хаах үед PENDING-ийг CANCELLED болгоно.
 */
export async function cancelSubscriptionPaymentAction(
  formData: FormData,
): Promise<void> {
  const user = await requireUser();
  const paymentId = s(formData, "paymentId");
  if (!paymentId) return;

  const payment = await prisma.subscriptionPayment.findFirst({
    where: { id: paymentId, tenantId: user.tenantId, status: "PENDING" },
    select: { plan: true, amount: true },
  });
  if (!payment) return;

  await prisma.subscriptionPayment.updateMany({
    where: {
      id: paymentId,
      tenantId: user.tenantId,
      status: "PENDING",
    },
    data: { status: "CANCELLED" },
  });

  await logAudit({
    tenantId: user.tenantId,
    userId: user.id,
    entity: "Tenant",
    entityId: user.tenantId,
    action: "PAYMENT_CHANGE",
    summary: `Багцын QPay QR цуцлав: ${payment.plan} · ${formatTugrik(payment.amount.toString())}`,
    after: { paymentId, plan: payment.plan, status: "CANCELLED" },
  });

  revalidatePath("/dashboard/settings/subscription");
}
