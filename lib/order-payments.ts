import "server-only";

import { Prisma } from "@/app/generated/prisma/client";
import { withOrderTransaction } from "@/lib/order-time-booking";
import { creditQPayPaymentInTx, qpayCreditBlockMessage } from "@/lib/orders/qpay-credit";
import { prisma } from "@/lib/prisma";
import { TenantQPayService } from "@/lib/qpay-tenant";

export type OrderQPayCheckResult =
  | {
      ok: true;
      paid: true;
      orderId: string;
      paymentId: string;
      amount: string;
      qpayPaymentId: string | null;
    }
  | { ok: true; paid: false; message?: string; blocked?: true }
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
    const outcome = await withOrderTransaction(tenantId, payment.orderId, { id: true, branchId: true, totalAmount: true, status: true }, async (tx, raw) => {
      const order = raw as { id: string; branchId: string; totalAmount: Prisma.Decimal | null; status: string } | null;
      if (!order) return "gone" as const;
      const fresh = await tx.orderPayment.findFirst({ where: { id: payment.id, tenantId, orderId: order.id }, select: { id: true, amount: true, method: true, status: true, settlementId: true } });
      if (!fresh) return "gone" as const;
      if (fresh.status === "PAID") return "already" as const;
      if (fresh.status !== "PENDING") return "gone" as const;
      // Same shared crediting step as confirmOrderQPayPaymentCommand: cancelled order / overpay -> row FAILED + audit
      // flag (never left PENDING), otherwise PAID + income. A late QR payment never revives a non-PENDING row.
      const credit = await creditQPayPaymentInTx(tx, { tenantId, actorId: userId, order, payment: fresh, qpayPaymentId: check.paymentId, paidAt });
      return credit.credited ? ("credited" as const) : credit.reason;
    });
    if (outcome === "ORDER_CANCELLED" || outcome === "OVERPAYMENT") {
      return { ok: true, paid: false, message: qpayCreditBlockMessage(outcome), blocked: true };
    }
    if (outcome === "gone") {
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
