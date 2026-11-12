import "server-only";

import { revalidatePath } from "next/cache";
import { Prisma } from "@/app/generated/prisma/client";
import type { SubscriptionPayment } from "@/app/generated/prisma/client";
import { logAudit } from "@/lib/audit";
import { formatTugrik } from "@/lib/orders";
import { prisma } from "@/lib/prisma";
import { QPayService } from "@/lib/qpay";
import { BILLING_PERIOD_LABEL, PLAN_LABEL, isSelfServePlan, periodEndDate } from "@/lib/subscription";
import { getAppBaseUrl } from "@/lib/subscription-server";

export const SUBSCRIPTION_CHECK_ERROR_MESSAGE =
  "Төлбөр шалгахад алдаа гарлаа. Түр хүлээгээд дахин оролдоно уу.";

export type ConfirmResult = { ok: boolean; paid: boolean; message?: string };

/**
 * PENDING нэг SubscriptionPayment-ийг PAID болгож, түүнтэй холбоотой
 * subscription-г идэвхжүүлнэ: хуучин TRIAL/ACTIVE sub-уудыг EXPIRED, шинэ
 * ACTIVE sub үүсгэж, tenant.plan-г sync хийнэ. QPay (confirmSubscriptionPayment)
 * БОЛОН SuperAdmin-ийн гар аргаар баталгаажуулах (харах:
 * app/_actions/system-subscription-payments.ts) хоёул ЭНД дайран өнгөрнө —
 * "төлбөр баталгаажив" гэдгийн цорын ганц бодит үр дагавар. Дахин дуудсан ч
 * idempotent (transaction дотор status-г дахин шалгана).
 */
export async function activateSubscriptionPayment(
  payment: Pick<
    SubscriptionPayment,
    "id" | "tenantId" | "plan" | "period" | "amount"
  >,
  opts: { paidAt: Date; qpayPaymentId?: string | null; note: string },
): Promise<{ subscriptionId: string } | null> {
  const end = periodEndDate(opts.paidAt, payment.period);

  return prisma.$transaction(async (tx) => {
    // Callback + web poll + SuperAdmin гар баталгаажуулалт зэрэг ирэхэд
    // давхар Subscription үүсэхээс сэргийлж SubscriptionPayment мөрийг түгжинэ:
    // хоёр дахь transaction эхнийхийг commit хийтэл хүлээгээд PAID-г харна.
    await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM "SubscriptionPayment" WHERE id = ${payment.id} FOR UPDATE
    `;
    // Хэрэв өөр transaction-аар аль хэдийн PAID болсон бол давхар үүсгэхгүй.
    const fresh = await tx.subscriptionPayment.findUnique({
      where: { id: payment.id },
      select: { status: true },
    });
    if (fresh?.status === "PAID") return null;

    await tx.subscription.updateMany({
      where: { tenantId: payment.tenantId, status: { in: ["TRIAL", "ACTIVE"] } },
      data: { status: "EXPIRED" },
    });
    const created = await tx.subscription.create({
      data: {
        tenantId: payment.tenantId,
        plan: payment.plan,
        status: "ACTIVE",
        startsAt: opts.paidAt,
        endsAt: end,
        amount: payment.amount,
        notes: opts.note,
      },
      select: { id: true },
    });
    await tx.tenant.update({
      where: { id: payment.tenantId },
      data: { plan: payment.plan },
    });
    await tx.subscriptionPayment.update({
      where: { id: payment.id },
      data: {
        status: "PAID",
        paidAt: opts.paidAt,
        qpayPaymentId: opts.qpayPaymentId ?? undefined,
        createdSubscriptionId: created.id,
      },
    });

    await logAudit(
      {
        tenantId: payment.tenantId,
        entity: "Tenant",
        entityId: payment.tenantId,
        action: "PAYMENT_CHANGE",
        summary: `Багц идэвхжив: ${payment.plan} · ${formatTugrik(payment.amount.toString())}`,
        after: {
          paymentId: payment.id,
          plan: payment.plan,
          amount: payment.amount.toString(),
          subscriptionId: created.id,
        },
      },
      tx,
    );

    return { subscriptionId: created.id };
  });
}

/**
 * QPay-аас тухайн SubscriptionPayment-ийн төлөвийг шалгаж, бүрэн төлөгдсөн бол
 * activateSubscriptionPayment-ээр идэвхжүүлнэ. Дахин дуудсан ч idempotent —
 * web-ийн polling action болон QPay callback хоёулаа үүнийг дуудна.
 *
 * Тэмдэглэл: callback-аас ирсэн мэдээлэлд НАЙДАХГҮЙ — үргэлж QPay.checkPayment-ээр
 * бие даан баталгаажуулна. Тиймээс callback-ийг хэн ч дуудсан төлбөрийг хуурамчаар
 * баталгаажуулах боломжгүй.
 */
export async function confirmSubscriptionPayment(
  paymentId: string,
): Promise<ConfirmResult> {
  const payment = await prisma.subscriptionPayment.findUnique({
    where: { id: paymentId },
  });
  if (!payment) return { ok: false, paid: false, message: "Төлбөр олдсонгүй." };
  if (payment.status === "PAID") return { ok: true, paid: true };
  if (!payment.qpayInvoiceId) {
    return { ok: false, paid: false, message: "QPay invoice байхгүй." };
  }

  const check = await QPayService.checkPayment(payment.qpayInvoiceId);
  if ("error" in check) {
    // Provider text is logged, never returned to clients.
    console.error("[subscription-payment] QPay checkPayment failed:", payment.id, check.error);
    return { ok: false, paid: false, message: SUBSCRIPTION_CHECK_ERROR_MESSAGE };
  }
  if (!check.paid) return { ok: true, paid: false };

  // Бодит төлсөн дүнг expected-тэй тулгана — хэсэгчилсэн төлбөрөөр багц
  // идэвхжихээс сэргийлнэ.
  if (new Prisma.Decimal(check.paidAmount).lt(payment.amount)) {
    return {
      ok: true,
      paid: false,
      message: "Төлбөр бүрэн төлөгдөөгүй байна. Дахин шалгана уу.",
    };
  }

  try {
    await activateSubscriptionPayment(payment, {
      paidAt: check.paidAt ?? new Date(),
      qpayPaymentId: check.paymentId,
      note: `QPay төлбөр #${payment.id}`,
    });
  } catch (e) {
    console.error(
      "[subscription-payment] activation failed:",
      payment.id,
      e instanceof Error ? e.message : e,
    );
    return { ok: false, paid: false, message: "Хадгалахад алдаа гарлаа. Дахин оролдоно уу." };
  }

  revalidatePath("/dashboard/settings/subscription");
  revalidatePath("/dashboard");
  return { ok: true, paid: true };
}

// --- Тенант (OWNER)-ийн багцын QPay төлбөр: үүсгэх / шалгах / цуцлах -------
// Вэбийн server action (app/_actions/subscription-payments.ts) болон мобайл
// staff API (app/api/v1/subscription/qpay/**) хоёулаа ЭНД дуудна. Эрх
// (isOwner) болон revalidatePath-ийг дуудагч өөрөө хийнэ. Эдгээр нь багц
// дууссан/түгжигдсэн үед ч ажиллах ёстой тул subscription lock ШАЛГАХГҮЙ.
//
// RLS: async helper дотор үргэлж `return await prisma…`.

/** Төлбөр үүсгэж буй ажилтан (вэбийн SessionUser / API-ийн ApiUser аль аль нь таарна). */
export type SubscriptionPaymentActor = { id: string; tenantId: string };

export type SubscriptionQPayPaymentDto = {
  id: string;
  plan: SubscriptionPayment["plan"];
  period: SubscriptionPayment["period"];
  amount: string;
  currency: string;
  qrImage: string | null;
  qrText: string | null;
  urls: unknown[];
  createdAt: Date;
};

export type CreateSubscriptionPaymentResult =
  | { ok: true; payment: SubscriptionQPayPaymentDto }
  | { ok: false; code: "VALIDATION" | "NOT_FOUND" | "NOT_SELF_SERVE" | "QPAY_ERROR"; message: string };

export function toSubscriptionQPayPaymentDto(
  p: Pick<
    SubscriptionPayment,
    "id" | "plan" | "period" | "amount" | "currency" | "qrImage" | "qrText" | "qpayUrls" | "createdAt"
  >,
): SubscriptionQPayPaymentDto {
  return {
    id: p.id,
    plan: p.plan,
    period: p.period,
    amount: p.amount.toString(),
    currency: p.currency,
    qrImage: p.qrImage,
    qrText: p.qrText,
    urls: Array.isArray(p.qpayUrls) ? (p.qpayUrls as unknown[]) : [],
    createdAt: p.createdAt,
  };
}

/**
 * PlanPrice сонгоод SubscriptionPayment(PENDING) + платформын QPay invoice
 * үүсгэнэ. Зөвхөн тогтсон үнэтэй (self-serve, BUSINESS) багц.
 */
export async function createSubscriptionQPayPayment(
  actor: SubscriptionPaymentActor,
  planPriceId: string,
): Promise<CreateSubscriptionPaymentResult> {
  if (!planPriceId) return { ok: false, code: "VALIDATION", message: "Үнэ сонгоно уу." };

  const price = await prisma.planPrice.findFirst({
    where: { id: planPriceId, isActive: true },
  });
  if (!price) {
    return { ok: false, code: "NOT_FOUND", message: "Сонгосон үнэ олдсонгүй / идэвхгүй." };
  }

  // Зөвхөн тогтсон үнэтэй багцыг (BUSINESS) QPay-ээр авна. FREE үргэлж
  // үнэгүй; ENTERPRISE-ийн үнийг тохиролцож super admin гараар олгоно.
  if (!isSelfServePlan(price.plan)) {
    return {
      ok: false,
      code: "NOT_SELF_SERVE",
      message:
        price.plan === "FREE"
          ? "Энгийн (FREE) багц үнэгүй — худалдаж авах шаардлагагүй."
          : "Энтерпрайз багц тогтсон үнэгүй — «Үнийн санал авах»-аар хүсэлт илгээнэ үү.",
    };
  }

  // Snapshot + payment үүсгэх
  const amountNumber = Number.parseFloat(price.amount.toString());
  const payment = await prisma.subscriptionPayment.create({
    data: {
      tenantId: actor.tenantId,
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
    invoiceReceiverCode: actor.tenantId,
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
      tenantId: actor.tenantId,
      userId: actor.id,
      entity: "Tenant",
      entityId: actor.tenantId,
      action: "PAYMENT_CHANGE",
      summary: `Багцын QPay invoice үүсгэхэд алдаа: ${price.plan}`,
      after: { paymentId: payment.id, plan: price.plan, status: "FAILED" },
    });
    // Provider text (status/body/config hints) stays server-side.
    console.error("[subscription-payment] QPay createInvoice failed:", payment.id, inv.error);
    return {
      ok: false,
      code: "QPAY_ERROR",
      message: "QPay нэхэмжлэх үүсгэхэд алдаа гарлаа. Түр хүлээгээд дахин оролдоно уу.",
    };
  }

  const updated = await prisma.subscriptionPayment.update({
    where: { id: payment.id },
    data: {
      qpayInvoiceId: inv.invoice_id,
      qrText: inv.qr_text,
      qrImage: inv.qr_image,
      qpayUrls: inv.urls ?? Prisma.JsonNull,
    },
    select: {
      id: true,
      plan: true,
      period: true,
      amount: true,
      currency: true,
      qrImage: true,
      qrText: true,
      qpayUrls: true,
      createdAt: true,
    },
  });

  await logAudit({
    tenantId: actor.tenantId,
    userId: actor.id,
    entity: "Tenant",
    entityId: actor.tenantId,
    action: "PAYMENT_CHANGE",
    summary: `Багцын QPay QR үүсгэв: ${price.plan} · ${formatTugrik(amountNumber)}`,
    after: { paymentId: payment.id, plan: price.plan, amount: amountNumber },
  });

  return { ok: true, payment: toSubscriptionQPayPaymentDto(updated) };
}

/**
 * Тухайн тенантын payment мөн эсэхийг шалгаад QPay-аас төлөвийг нь шалгана
 * (confirmSubscriptionPayment — web polling + QPay callback адил замаар).
 */
export async function checkTenantSubscriptionPayment(
  tenantId: string,
  paymentId: string,
): Promise<ConfirmResult & { notFound?: boolean }> {
  if (!paymentId) return { ok: false, paid: false, message: "ID шаардлагатай." };
  const payment = await prisma.subscriptionPayment.findFirst({
    where: { id: paymentId, tenantId },
    select: { id: true },
  });
  if (!payment) return { ok: false, paid: false, notFound: true, message: "Төлбөр олдсонгүй." };
  return await confirmSubscriptionPayment(payment.id);
}

/** QR-ыг хаах үед PENDING-ийг CANCELLED болгоно. PENDING биш/олдохгүй бол `cancelled: false`. */
export async function cancelTenantSubscriptionPayment(
  actor: SubscriptionPaymentActor,
  paymentId: string,
): Promise<{ cancelled: boolean }> {
  if (!paymentId) return { cancelled: false };

  const payment = await prisma.subscriptionPayment.findFirst({
    where: { id: paymentId, tenantId: actor.tenantId, status: "PENDING" },
    select: { plan: true, amount: true },
  });
  if (!payment) return { cancelled: false };

  await prisma.subscriptionPayment.updateMany({
    where: {
      id: paymentId,
      tenantId: actor.tenantId,
      status: "PENDING",
    },
    data: { status: "CANCELLED" },
  });

  await logAudit({
    tenantId: actor.tenantId,
    userId: actor.id,
    entity: "Tenant",
    entityId: actor.tenantId,
    action: "PAYMENT_CHANGE",
    summary: `Багцын QPay QR цуцлав: ${payment.plan} · ${formatTugrik(payment.amount.toString())}`,
    after: { paymentId, plan: payment.plan, status: "CANCELLED" },
  });

  return { cancelled: true };
}
