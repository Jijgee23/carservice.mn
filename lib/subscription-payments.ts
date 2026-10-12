import "server-only";

import { revalidatePath } from "next/cache";
import { Prisma } from "@/app/generated/prisma/client";
import type { SubscriptionPayment } from "@/app/generated/prisma/client";
import { logAudit } from "@/lib/audit";
import { formatTugrik } from "@/lib/orders";
import { prisma } from "@/lib/prisma";
import { QPayService } from "@/lib/qpay";
import { periodEndDate } from "@/lib/subscription";

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
