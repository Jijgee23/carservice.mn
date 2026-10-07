import "server-only";

import { Prisma } from "@/app/generated/prisma/client";
import { logAudit } from "@/lib/audit";
import { postPaymentIncome } from "@/lib/cash/sync";
import { formatTugrik, type PaymentStatus } from "@/lib/orders";
import { withOrderTransaction } from "@/lib/order-time-booking";
import { recomputeOrderPaymentTotals } from "@/lib/orders/order-payment-totals";
import { prisma } from "@/lib/prisma";
import { TenantQPayService } from "@/lib/qpay-tenant";
import {
  cancelPendingQPayAtProvider,
  defaultQPayCancelDeps,
  QPAY_CANCEL_FAILED_MESSAGE,
  QPAY_INVOICE_PARTIALLY_PAID_MESSAGE,
  QPAY_PREVIOUS_PAID_MESSAGE,
  type QPayCancelOutcome,
} from "@/lib/orders/qpay-cancel";

/** Provider-side cancel for the legacy (non-command) paths; the confirm path is this file's own `confirmOrderQPayPayment`. */
async function providerCancelLegacy(
  tenantId: string,
  userId: string,
  payment: { id: string; orderId: string; amount: { toString(): string }; qpayInvoiceId: string | null },
): Promise<QPayCancelOutcome> {
  return cancelPendingQPayAtProvider(
    { tenantId, userId, payment },
    defaultQPayCancelDeps(async (paymentId) => {
      const r = await confirmOrderQPayPayment(tenantId, userId, paymentId);
      return r.ok && r.paid;
    }),
  );
}

export type OrderQPayCheckResult =
  | {
      ok: true;
      paid: true;
      orderId: string;
      paymentId: string;
      amount: string;
      qpayPaymentId: string | null;
    }
  | { ok: true; paid: false; message?: string }
  | {
      ok: false;
      reason: "not_found" | "no_invoice" | "qpay_error" | "save_failed";
      message: string;
    };

/**
 * QPay-аас захиалгын төлбөрийн invoice-ийн төлөвийг шалгаж, бүтэн төлөгдсөн
 * бол `OrderPayment`-ийг PAID болгож, `ServiceOrder.paidAmount`/`paymentStatus`-ийг
 * шинэчилнэ. Dashboard action (`app/_actions/order-payments.ts`) БОЛОН мобайл
 * API (`app/api/v1/orders/[id]/qpay/check/route.ts`) хоёул үүнийг дуудна.
 *
 * Өмнө нь хоёр тал тус тусдаа мөр мөрөөрөө хуулбарласан хэрэгжилттэй байсан —
 * нэгтгэхдээ хоёр жинхэнэ зөрүүг олж засав:
 *   1. Дашбоард action нь `ServiceOrder`-ийг ХАМГИЙН ЭЦЭСТ, транзакц дотор
 *      дахин уншиж байсан бол API route нь транзакцаас ӨМНӨХ (потенциал
 *      хуучирсан) утгаар тооцоолдог байсан — зэрэгцээ бэлнээр төлбөр
 *      бүртгэгдэх үед `paidAmount` алдагдах эрсдэлтэй. Одоо хоёул
 *      transaction дотор дахин уншсан утгаар тооцно.
 *   2. Дашбоард action нь хэсэгчилсэн (дутуу) QPay төлбөрийг "бүтэн
 *      төлөгдсөн" гэж андуурахгүйн тулд `paidAmount`-ыг дүнтэй нь давхар
 *      тулгадаг байсан бол API route-д энэ шалгалт огт байгаагүй (мобайл
 *      клиентээр дутуу төлбөрийг бүтэн гэж бүртгэх боломжтой цоорхой байсан).
 *      Одоо хоёул `TenantQPayService.checkPayment`-д `expectedAmount`
 *      дамжуулж ижил тулгалт хийнэ.
 */
export async function confirmOrderQPayPayment(
  tenantId: string,
  userId: string,
  paymentId: string,
): Promise<OrderQPayCheckResult> {
  const payment = await prisma.orderPayment.findFirst({
    where: { id: paymentId, tenantId },
  });
  if (!payment) {
    return { ok: false, reason: "not_found", message: "Төлбөр олдсонгүй." };
  }
  if (payment.status === "PAID") {
    return {
      ok: true,
      paid: true,
      orderId: payment.orderId,
      paymentId: payment.id,
      amount: payment.amount.toString(),
      qpayPaymentId: payment.qpayPaymentId,
    };
  }
  if (payment.status !== "PENDING") {
    return { ok: true, paid: false, message: "Энэ QPay нэхэмжлэх хүчингүй болсон байна." };
  }
  if (!payment.qpayInvoiceId) {
    return { ok: false, reason: "no_invoice", message: "QPay invoice байхгүй." };
  }

  const check = await TenantQPayService.checkPayment(
    tenantId,
    payment.qpayInvoiceId,
    Number.parseFloat(payment.amount.toString()),
  );
  if ("error" in check) {
    return { ok: false, reason: "qpay_error", message: check.error };
  }
  if (!check.paid) {
    return {
      ok: true,
      paid: false,
      message:
        check.underpaidAmount != null
          ? "Төлбөр бүрэн төлөгдөөгүй байна. Дахин шалгана уу."
          : "Төлбөр төлөгдөөгүй байна.",
    };
  }

  const paidAt = check.paidAt ?? new Date();
  try {
    // Same order-row lock as every other payment path, so paid totals are read
    // under the lock. Only a PENDING invoice may become PAID: a CANCELLED one
    // (e.g. closed by a postpaid settlement) must never be revived by a late QR payment.
    const applied = await withOrderTransaction(tenantId, payment.orderId, { id: true, totalAmount: true }, async (tx, raw) => {
      const order = raw as { id: string; totalAmount: Prisma.Decimal | null } | null;
      if (!order) return false;
      const moved = await tx.orderPayment.updateMany({
        where: { id: payment.id, tenantId, status: "PENDING" },
        data: { status: "PAID", paidAt, qpayPaymentId: check.paymentId },
      });
      if (moved.count === 0) return false;

      // Cash ledger: income entry in the same transaction (idempotent).
      await postPaymentIncome(tx, {
        tenantId,
        actorId: userId,
        payment: {
          id: payment.id,
          orderId: payment.orderId,
          amount: payment.amount,
          method: payment.method,
          bank: payment.bank,
          paidAt,
          settlementId: payment.settlementId,
        },
      });
      const totals = await recomputeOrderPaymentTotals(tx, tenantId, order);
      await logAudit(
        {
          tenantId,
          userId,
          entity: "ServiceOrder",
          entityId: payment.orderId,
          action: "PAYMENT_CHANGE",
          summary: `QPay PAID · ${formatTugrik(payment.amount.toString())} → ${totals.status}`,
          after: {
            paymentId: payment.id,
            qpayPaymentId: check.paymentId,
            newPaidAmount: totals.paid.toString(),
            paymentStatus: totals.status,
          },
        },
        tx,
      );
      return true;
    });
    if (!applied) {
      const current = await prisma.orderPayment.findFirst({ where: { id: payment.id, tenantId }, select: { status: true } });
      if (current?.status !== "PAID") {
        return { ok: true, paid: false, message: "Энэ QPay нэхэмжлэх хүчингүй болсон байна." };
      }
    }
  } catch (e) {
    return {
      ok: false,
      reason: "save_failed",
      message: e instanceof Error ? e.message : "Хадгалахад алдаа.",
    };
  }

  return {
    ok: true,
    paid: true,
    orderId: payment.orderId,
    paymentId: payment.id,
    amount: payment.amount.toString(),
    qpayPaymentId: check.paymentId,
  };
}

/** `createOrReuseOrderQPayInvoice`-д дуудагч талаас урьдчилан (зөвшөөрлийн
 * шалгалттайгаа хамт) уншсан захиалгын дата — auth-scoping (dashboard
 * `canEditOrderForUser` vs мобайл `canEditOrder`+branch scope) тал бүрдээ
 * ялгаатай тул энд давхар шалгахгүй, зөвхөн invoice үүсгэхэд хэрэгтэй
 * талбаруудыг л шаардана. */
export type OrderForQPayInvoice = {
  id: string;
  number: string;
  paymentStatus: PaymentStatus;
  totalAmount: Prisma.Decimal | null;
  paidAmount: Prisma.Decimal | null;
  customer: { fullName: string; phone: string };
};

export type OrderQPayInvoicePayment = {
  id: string;
  qrImage: string | null;
  qrText: string | null;
  amount: string;
  qpayUrls: Prisma.JsonValue;
  qpayInvoiceId: string | null;
};

export type OrderQPayInvoiceResult =
  | { ok: true; payment: OrderQPayInvoicePayment }
  | { ok: false; reason: "already_paid" | "no_remaining" | "qpay_error"; message: string };

/**
 * Захиалгад QPay QR үүсгэнэ (эсвэл үлдэгдэлтэй нь тохирсон pending QR-ийг
 * дахин ашиглана). Dashboard action (`createOrderQPayInvoiceAction`) БОЛОН
 * мобайл API (`app/api/v1/orders/[id]/qpay/route.ts`-ийн POST) хоёул үүнийг
 * дуудна.
 *
 * Нэгтгэхдээ нэг зөрүү олж засав: dashboard action нь pending QR-ийн дүн
 * одоогийн үлдэгдэлтэй ТОХИРОХГҮЙ бол (жиш нь захиалгад мөр нэмэгдэж
 * үлдэгдэл өөрчлөгдсөн) хуучныг цуцалж шинээр үүсгэдэг байсан бол API route
 * pending байхад дүнг тулгалгүй үргэлж хуучныг шууд буцаадаг байсан —
 * мобайл клиентээр хуучирсан (буруу дүнтэй) QR ашиглагдах цоорхой байсан.
 */
export async function createOrReuseOrderQPayInvoice(
  tenantId: string,
  userId: string,
  order: OrderForQPayInvoice,
): Promise<OrderQPayInvoiceResult> {
  if (order.paymentStatus === "PAID") {
    return { ok: false, reason: "already_paid", message: "Засварын хуудас бүрэн төлөгдсөн." };
  }

  const total = order.totalAmount ?? new Prisma.Decimal(0);
  const paid = order.paidAmount ?? new Prisma.Decimal(0);
  const remaining = total.minus(paid);
  if (remaining.lte(0)) {
    return { ok: false, reason: "no_remaining", message: "Үлдэгдэл байхгүй." };
  }

  // Pending QR байвал — үлдэгдэл өөрчлөгдөөгүй л бол дахин ашиглана. Энэ
  // хооронд өөр төлбөр бүртгэгдсэн/цуцлагдсан бол үлдэгдэл өөрчлөгдсөн байх
  // тул хуучин (буруу дүнтэй) QR-ийг цуцалж доор шинээр үүсгэнэ.
  const pending = await prisma.orderPayment.findFirst({
    where: { orderId: order.id, status: "PENDING", method: "QPAY" },
    orderBy: { createdAt: "desc" },
  });
  if (pending) {
    if (pending.amount.equals(remaining)) {
      return {
        ok: true,
        payment: {
          id: pending.id,
          qrImage: pending.qrImage,
          qrText: pending.qrText,
          amount: pending.amount.toString(),
          qpayUrls: pending.qpayUrls,
          qpayInvoiceId: pending.qpayInvoiceId,
        },
      };
    }
    // Provider first (outside any tx); only then the conditional local cancel.
    const outcome = await providerCancelLegacy(tenantId, userId, pending);
    if (outcome === "paid") return { ok: false, reason: "already_paid", message: QPAY_PREVIOUS_PAID_MESSAGE };
    if (outcome === "partial") return { ok: false, reason: "qpay_error", message: QPAY_INVOICE_PARTIALLY_PAID_MESSAGE };
    if (outcome === "failed") return { ok: false, reason: "qpay_error", message: QPAY_CANCEL_FAILED_MESSAGE };
    await prisma.orderPayment.updateMany({
      where: { id: pending.id, tenantId, status: "PENDING" },
      data: { status: "CANCELLED" },
    });
  }

  // SubscriptionPayment-тэй ижил pattern
  const payment = await prisma.orderPayment.create({
    data: {
      tenantId,
      orderId: order.id,
      amount: remaining,
      method: "QPAY",
      status: "PENDING",
    },
    select: { id: true },
  });

  const inv = await TenantQPayService.createInvoice({
    tenantId,
    senderInvoiceNo: payment.id,
    invoiceReceiverCode: order.customer.fullName || order.customer.phone,
    invoiceDescription: `Засварын хуудас #${order.number}`,
    amount: Number.parseFloat(remaining.toString()),
  });
  if ("error" in inv) {
    await prisma.orderPayment.update({
      where: { id: payment.id },
      data: { status: "FAILED" },
    });
    return { ok: false, reason: "qpay_error", message: inv.error };
  }

  const updated = await prisma.orderPayment.update({
    where: { id: payment.id },
    data: {
      qpayInvoiceId: inv.invoice_id,
      qrText: inv.qr_text,
      qrImage: inv.qr_image,
      qpayUrls: inv.urls ?? Prisma.JsonNull,
    },
    select: {
      id: true,
      qrImage: true,
      qrText: true,
      amount: true,
      qpayUrls: true,
      qpayInvoiceId: true,
    },
  });

  await logAudit({
    tenantId,
    userId,
    entity: "ServiceOrder",
    entityId: order.id,
    action: "PAYMENT_CHANGE",
    summary: `QPay QR үүсгэв · ${formatTugrik(remaining.toString())}`,
    after: { paymentId: payment.id, amount: remaining.toString() },
  });

  return {
    ok: true,
    payment: {
      id: updated.id,
      qrImage: updated.qrImage,
      qrText: updated.qrText,
      amount: updated.amount.toString(),
      qpayUrls: updated.qpayUrls,
      qpayInvoiceId: updated.qpayInvoiceId,
    },
  };
}

export type CancelOrderQPayInvoiceResult =
  | { ok: true; orderId: string }
  | { ok: false; code?: "QPAY_INVOICE_PAID" | "QPAY_INVOICE_PARTIALLY_PAID" | "QPAY_CANCEL_FAILED"; message?: string };

/**
 * Хүлээгдэж буй QPay QR-ийг цуцлана (бүртгэгдээгүй л бол — PAID болсныг
 * цуцлахгүй). Dashboard action (`cancelOrderQPayPaymentAction`) БОЛОН
 * мобайл API (`app/api/v1/orders/[id]/qpay/route.ts`-ийн DELETE) хоёул
 * үүнийг дуудна.
 *
 * Нэгтгэхдээ нэг зөрүү олж засав: dashboard action нь цуцлахдаа audit лог
 * бичдэг байсан бол API route (мобайл) огт лог бичдэггүй байсан — одоо
 * хоёул адилхан бичнэ.
 */
export async function cancelOrderQPayInvoice(
  tenantId: string,
  userId: string,
  paymentId: string,
  /** Мобайл API-ийн URL-ийн orderId — `paymentId` заавал ЭНЭ захиалгынх байх
   * ёстойг DB түвшинд баталгаажуулна (dashboard action-д энэ шаардлагагүй,
   * учир нь тэнд зөвшөөрлийг аль хэдийн `payment.orderId`-аар шалгасан байдаг). */
  orderId?: string,
): Promise<CancelOrderQPayInvoiceResult> {
  const payment = await prisma.orderPayment.findFirst({
    where: {
      id: paymentId,
      tenantId,
      status: "PENDING",
      ...(orderId ? { orderId } : {}),
    },
    select: { id: true, orderId: true, amount: true, qpayInvoiceId: true },
  });
  if (!payment) return { ok: false };

  // Provider first (outside any tx); a paid/partial/unverifiable invoice must stay PENDING locally.
  const outcome = await providerCancelLegacy(tenantId, userId, payment);
  if (outcome === "paid") return { ok: false, code: "QPAY_INVOICE_PAID", message: "Энэ QPay нэхэмжлэх төлөгдсөн байна. Төлбөрийг бүртгэлээ шалгана уу." };
  if (outcome === "partial") return { ok: false, code: "QPAY_INVOICE_PARTIALLY_PAID", message: QPAY_INVOICE_PARTIALLY_PAID_MESSAGE };
  if (outcome === "failed") return { ok: false, code: "QPAY_CANCEL_FAILED", message: QPAY_CANCEL_FAILED_MESSAGE };

  await prisma.orderPayment.updateMany({
    where: { id: paymentId, tenantId, status: "PENDING" },
    data: { status: "CANCELLED" },
  });

  await logAudit({
    tenantId,
    userId,
    entity: "ServiceOrder",
    entityId: payment.orderId,
    action: "PAYMENT_CHANGE",
    summary: `QPay QR цуцлав · ${formatTugrik(payment.amount.toString())}`,
    after: { paymentId, amount: payment.amount.toString(), status: "CANCELLED" },
  });

  return { ok: true, orderId: payment.orderId };
}
