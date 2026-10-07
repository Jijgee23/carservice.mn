/**
 * Provider-side QPay invoice cancellation for PENDING order payments.
 *
 * Why: cancelling a PENDING QPay OrderPayment only locally leaves the invoice
 * open at QPay, so a customer can still pay an old QR and the money arrives
 * unrecorded. EVERY local PENDING -> CANCELLED path must call
 * `cancelPendingQPayAtProvider` (or the order-level `sweepPendingQPayAtProvider`)
 * FIRST.
 *
 * Money-code rules:
 *  - Everything here talks to QPay and therefore MUST run OUTSIDE any DB
 *    transaction. The caller then performs the local cancel in its own
 *    transaction under the order lock, with a conditional (status = PENDING)
 *    update, and only for payments this module reported as `cancelled`.
 *  - Nothing here throws for provider outcomes; callers map the typed outcome to
 *    their own error type (OrderPaymentCommandError / CashError).
 *  - The module never writes OrderPayment rows itself. A fully-paid invoice is
 *    handed to the caller-supplied `confirmPaid`, which must be the existing
 *    confirm path (the one the "Шалгах" button uses) so the payment becomes PAID
 *    with its ledger entry.
 */

import { logAudit } from "@/lib/audit";
import { TenantQPayService } from "@/lib/qpay-tenant";
import type { QPayCancelInvoiceResult, QPayExactCheckResult } from "@/lib/qpay-core";

export const QPAY_CANCEL_FAILED_MESSAGE = "QPay нэхэмжлэх цуцлахад алдаа гарлаа. Дахин оролдоно уу.";
export const QPAY_INVOICE_PARTIALLY_PAID_MESSAGE = "Энэ QPay нэхэмжлэхэд хэсэгчлэн төлбөр орсон байна. Шалгаад дахин оролдоно уу.";
export const QPAY_PREVIOUS_PAID_MESSAGE = "Өмнөх QPay QR төлөгдсөн байна.";
export const QPAY_CANCEL_AUDIT_SUMMARY = "QPay нэхэмжлэх цуцлав (QPay)";

export type PendingQPayPayment = {
  id: string;
  orderId: string;
  amount: { toString(): string };
  qpayInvoiceId: string | null;
};

export type QPayCancelOutcome =
  /** No invoice at QPay (or it is already gone): safe to cancel locally. */
  | "no_invoice"
  /** Cancelled at the provider (or already cancelled/missing there): safe to cancel locally. */
  | "cancelled"
  /** Fully paid at QPay; `confirmPaid` ran. Do NOT cancel locally. */
  | "paid"
  /** Partial QPay money on the invoice. Do NOT cancel locally. */
  | "partial"
  /** Could not verify/cancel at QPay. Do NOT cancel locally. */
  | "failed";

export type QPayCancelDeps = {
  checkPaymentExact(tenantId: string, invoiceId: string, expectedAmount: string): Promise<QPayExactCheckResult>;
  cancelInvoice(tenantId: string, invoiceId: string): Promise<QPayCancelInvoiceResult>;
  /** Existing confirm path. Resolve true when the payment is PAID afterwards. */
  confirmPaid(paymentId: string): Promise<boolean>;
  audit(entry: {
    tenantId: string;
    userId: string | null;
    branchId?: string | null;
    orderId: string;
    paymentId: string;
    ok: boolean;
    detail?: string;
  }): Promise<void>;
};

export function defaultQPayCancelDeps(confirmPaid: (paymentId: string) => Promise<boolean>): QPayCancelDeps {
  return {
    checkPaymentExact: (tenantId, invoiceId, expected) => TenantQPayService.checkPaymentExact(tenantId, invoiceId, expected),
    cancelInvoice: (tenantId, invoiceId) => TenantQPayService.cancelInvoice(tenantId, invoiceId),
    confirmPaid,
    audit: async (entry) => {
      try {
        await logAudit({
          tenantId: entry.tenantId,
          userId: entry.userId,
          branchId: entry.branchId ?? null,
          entity: "ServiceOrder",
          entityId: entry.orderId,
          action: "PAYMENT_CHANGE",
          summary: entry.ok ? QPAY_CANCEL_AUDIT_SUMMARY : "QPay нэхэмжлэх цуцлах амжилтгүй (QPay)",
          after: { paymentId: entry.paymentId, providerCancel: entry.ok ? "ok" : "failed", ...(entry.detail ? { detail: entry.detail } : {}) },
        });
      } catch {
        // Audit must never break the payment flow.
      }
    },
  };
}

type Verdict = "paid" | "partial" | "unpaid" | "error";

async function verdictFor(deps: QPayCancelDeps, tenantId: string, payment: PendingQPayPayment): Promise<Verdict> {
  const check = await deps.checkPaymentExact(tenantId, payment.qpayInvoiceId as string, payment.amount.toString());
  if ("error" in check) return "error";
  if (check.paid) return "paid";
  if (check.underpaidAmount != null) return "partial";
  return "unpaid";
}

/** Fully paid at QPay: run the existing confirm path. A false from it means the row is no longer PENDING here (raced); the money is still not ours to cancel. */
async function settlePaid(deps: QPayCancelDeps, paymentId: string): Promise<QPayCancelOutcome> {
  try {
    await deps.confirmPaid(paymentId);
  } catch {
    // The invoice IS paid at QPay; whatever stopped the confirm, we must not cancel locally.
  }
  return "paid";
}

/**
 * Cancel ONE pending QPay payment's invoice at the provider (steps a-d of the
 * spec). Call before any local cancel; never inside a DB transaction.
 */
export async function cancelPendingQPayAtProvider(
  input: { tenantId: string; userId: string | null; branchId?: string | null; payment: PendingQPayPayment },
  deps: QPayCancelDeps,
): Promise<QPayCancelOutcome> {
  const { tenantId, payment } = input;
  if (!payment.qpayInvoiceId) return "no_invoice";

  const auditFailure = (detail: string) =>
    deps.audit({ tenantId, userId: input.userId, branchId: input.branchId, orderId: payment.orderId, paymentId: payment.id, ok: false, detail });

  // b. Already (fully) paid? Then confirm instead of cancelling.
  const first = await verdictFor(deps, tenantId, payment);
  if (first === "paid") return settlePaid(deps, payment.id);
  // d. Partial money on the invoice: never cancel.
  if (first === "partial") return "partial";
  if (first === "error") {
    await auditFailure("check_failed");
    return "failed";
  }

  // c. Cancel at the provider.
  const result = await deps.cancelInvoice(tenantId, payment.qpayInvoiceId);
  if (result.ok || result.reason === "not_found") {
    await deps.audit({ tenantId, userId: input.userId, branchId: input.branchId, orderId: payment.orderId, paymentId: payment.id, ok: true, detail: result.ok ? undefined : "already_gone" });
    return "cancelled";
  }
  if (result.reason === "already_paid") {
    const again = await verdictFor(deps, tenantId, payment);
    if (again === "paid") return settlePaid(deps, payment.id);
    if (again === "partial") return "partial";
    await auditFailure("already_paid_unverified");
    return "failed";
  }
  await auditFailure(result.reason);
  return "failed";
}

export type QPayCancelSweep = {
  /** Safe to cancel locally (provider cancelled, gone, or never had an invoice). */
  cancellable: string[];
  paid: string[];
  partial: string[];
  failed: string[];
};

/** Run `cancelPendingQPayAtProvider` over several pending payments (sequential: provider calls, one invoice at a time). */
export async function sweepPendingQPayAtProvider(
  input: { tenantId: string; userId: string | null; branchId?: string | null; payments: PendingQPayPayment[] },
  deps: QPayCancelDeps,
): Promise<QPayCancelSweep> {
  const sweep: QPayCancelSweep = { cancellable: [], paid: [], partial: [], failed: [] };
  for (const payment of input.payments) {
    const outcome = await cancelPendingQPayAtProvider({ tenantId: input.tenantId, userId: input.userId, branchId: input.branchId, payment }, deps);
    if (outcome === "no_invoice" || outcome === "cancelled") sweep.cancellable.push(payment.id);
    else if (outcome === "paid") sweep.paid.push(payment.id);
    else if (outcome === "partial") sweep.partial.push(payment.id);
    else sweep.failed.push(payment.id);
  }
  return sweep;
}
