/**
 * The ONE place a QPay payment that is PAID at the provider becomes a local order payment.
 * Shared by `confirmOrderQPayPaymentCommand` (order-payment-commands.ts) and the legacy
 * `confirmOrderQPayPayment` (lib/order-payments.ts, used by order delete / settlement sweeps) so both behave identically.
 *
 * Call inside the order-row-locked transaction, with a row that is still PENDING.
 *
 * Crediting is refused when the order is CANCELLED or the amount exceeds the remaining balance. The customer's money
 * is already at QPay, so the row is NOT left PENDING (a paid-at-provider PENDING row would make every provider
 * sweep report "paid" and block cash payments, reversals, cancels, delete and settlement for the order). Instead it
 * moves to FAILED, keeping `qpayInvoiceId` and setting `qpayPaymentId`, so the money stays traceable for a manual
 * refund; nothing is posted as income; one audit entry flags it (later checks see FAILED, so it is not repeated).
 */
import { Prisma } from "@/app/generated/prisma/client";
import { logAudit } from "@/lib/audit";
import { postPaymentIncome } from "@/lib/cash/sync";
import { formatTugrik } from "@/lib/orders";
import { paidLedger, recomputeOrderPaymentTotals } from "@/lib/orders/order-payment-totals";
import type { PrismaTransactionClient } from "@/lib/prisma";

export type QPayCreditBlockReason = "ORDER_CANCELLED" | "OVERPAYMENT";

export const QPAY_ORDER_CANCELLED_MESSAGE = "Захиалга цуцлагдсан тул QPay төлбөрийг бүртгэх боломжгүй. QPay-ээс гараар буцаана уу.";
export const QPAY_OVERPAYMENT_MESSAGE = "QPay төлбөр захиалгын үлдэгдлээс их байна. Бүртгээгүй — QPay-ээс гараар буцаана уу.";

export function qpayCreditBlockMessage(reason: QPayCreditBlockReason): string {
  return reason === "ORDER_CANCELLED" ? QPAY_ORDER_CANCELLED_MESSAGE : QPAY_OVERPAYMENT_MESSAGE;
}

export type QPayCreditResult =
  | { credited: true; totals: Awaited<ReturnType<typeof recomputeOrderPaymentTotals>> }
  | { credited: false; reason: QPayCreditBlockReason };

export async function creditQPayPaymentInTx(
  tx: PrismaTransactionClient,
  input: {
    tenantId: string;
    actorId: string;
    order: { id: string; branchId: string; status: string; totalAmount: Prisma.Decimal | null };
    payment: { id: string; amount: Prisma.Decimal; method: string; settlementId?: string | null };
    qpayPaymentId: string | null;
    paidAt: Date;
  },
): Promise<QPayCreditResult> {
  const { tenantId, order, payment } = input;
  let reason: QPayCreditBlockReason | null = null;
  if (order.status === "CANCELLED") {
    reason = "ORDER_CANCELLED";
  } else {
    const ledger = await paidLedger(tx, tenantId, order.id);
    if (payment.amount.gt((order.totalAmount ?? new Prisma.Decimal(0)).minus(ledger.paid))) reason = "OVERPAYMENT";
  }
  if (reason) {
    const moved = await tx.orderPayment.updateMany({
      where: { id: payment.id, tenantId, status: "PENDING" },
      data: { status: "FAILED", qpayPaymentId: input.qpayPaymentId },
    });
    if (moved.count > 0) {
      await logAudit({
        tenantId,
        userId: input.actorId,
        branchId: order.branchId,
        entity: "ServiceOrder",
        entityId: order.id,
        action: "PAYMENT_CHANGE",
        summary: `QPay төлбөр төлөгдсөн боловч бүртгээгүй (${reason === "ORDER_CANCELLED" ? "захиалга цуцлагдсан" : "үлдэгдлээс их"}) · ${formatTugrik(payment.amount.toString())} · QPay-ээс гараар буцаана уу`,
        after: { paymentId: payment.id, qpayPaymentId: input.qpayPaymentId, status: "FAILED", blocked: reason, amount: payment.amount.toString() },
      }, tx);
    }
    return { credited: false, reason };
  }
  const moved = await tx.orderPayment.updateMany({
    where: { id: payment.id, tenantId, status: "PENDING" },
    data: { status: "PAID", paidAt: input.paidAt, qpayPaymentId: input.qpayPaymentId },
  });
  if (moved.count === 0) throw new Error("QPAY_PAYMENT_RACE");
  // Cash ledger: QPay payment became PAID -> income entry, same transaction (idempotent).
  await postPaymentIncome(tx, {
    tenantId,
    actorId: input.actorId,
    payment: { id: payment.id, orderId: order.id, amount: payment.amount, method: payment.method, bankId: null, paidAt: input.paidAt, settlementId: payment.settlementId ?? null },
  });
  const totals = await recomputeOrderPaymentTotals(tx, tenantId, order);
  await logAudit({
    tenantId,
    userId: input.actorId,
    branchId: order.branchId,
    entity: "ServiceOrder",
    entityId: order.id,
    action: "PAYMENT_CHANGE",
    summary: `QPay PAID · ${formatTugrik(payment.amount.toString())} → ${totals.status}`,
    after: { paymentId: payment.id, qpayPaymentId: input.qpayPaymentId, paidAmount: totals.paid.toString(), paymentStatus: totals.status },
  }, tx);
  return { credited: true, totals };
}
