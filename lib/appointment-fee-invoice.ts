/**
 * Provider-side cancellation of an appointment booking-fee QPay invoice.
 *
 * Why: cancelling/expiring an appointment only locally leaves the platform
 * QPay invoice open, so the customer can still pay the old QR afterwards and
 * the money lands on a dead booking. Every local ... -> CANCELLED path
 * (customer app route, web account command, expire cron, staff PATCH) calls
 * `cancelAppointmentFeeInvoice` AFTER its conditional status write.
 *
 * Rules:
 *  - Runs OUTSIDE any DB transaction (it talks to QPay).
 *  - Best effort: it never throws. A failed provider cancel leaves the QR
 *    payable, but `confirmAppointmentPayment` then records the late payment on
 *    the cancelled booking and flags it for refund (see recordLatePaymentUnderLock).
 *  - `already_paid` hands over to `confirmAppointmentPayment`, the existing
 *    confirm path, so the money is recorded rather than lost.
 */
import { prisma } from "@/lib/prisma";
import type { QPayCancelInvoiceResult } from "@/lib/qpay-core";
import { QPayService } from "@/lib/qpay";

export type FeeInvoiceCancelOutcome = "no_invoice" | "cancelled" | "paid" | "failed";

export type FeeInvoiceCancelDeps = {
  cancelInvoice(invoiceId: string): Promise<QPayCancelInvoiceResult>;
  /** Existing confirm path; must record the payment if QPay says it is paid. */
  confirmPaid(appointmentId: string): Promise<unknown>;
};

const defaultDeps: FeeInvoiceCancelDeps = {
  cancelInvoice: (invoiceId) => QPayService.cancelInvoice(invoiceId),
  async confirmPaid(appointmentId) {
    const { confirmAppointmentPayment } = await import("@/lib/appointment-payments");
    return confirmAppointmentPayment(appointmentId);
  },
};

/** Cancel the live fee invoice for an appointment row already loaded by the caller. */
export async function cancelAppointmentFeeInvoice(
  appt: { id: string; feeQpayInvoiceId: string | null; hasPayment: boolean },
  deps: FeeInvoiceCancelDeps = defaultDeps,
): Promise<FeeInvoiceCancelOutcome> {
  if (!appt.feeQpayInvoiceId || appt.hasPayment) return "no_invoice";
  try {
    const result = await deps.cancelInvoice(appt.feeQpayInvoiceId);
    if (result.ok || result.reason === "not_found") return "cancelled";
    if (result.reason === "already_paid") {
      await deps.confirmPaid(appt.id);
      return "paid";
    }
    console.warn("[appointment-fee] provider invoice cancel failed:", appt.id, result.reason);
    return "failed";
  } catch (e) {
    console.warn("[appointment-fee] provider invoice cancel threw:", appt.id, e instanceof Error ? e.name : "UnknownError");
    return "failed";
  }
}

/** Convenience for cancel paths: load the appointment's fee state, then cancel. Never throws. */
export async function cancelAppointmentFeeInvoiceById(
  appointmentId: string,
  deps?: FeeInvoiceCancelDeps,
): Promise<FeeInvoiceCancelOutcome> {
  try {
    const appt = await prisma.appointment.findUnique({
      where: { id: appointmentId },
      select: { id: true, feeQpayInvoiceId: true, payment: { select: { id: true } } },
    });
    if (!appt) return "no_invoice";
    return await cancelAppointmentFeeInvoice(
      { id: appt.id, feeQpayInvoiceId: appt.feeQpayInvoiceId, hasPayment: appt.payment != null },
      deps,
    );
  } catch (e) {
    console.warn("[appointment-fee] cancel lookup failed:", appointmentId, e instanceof Error ? e.name : "UnknownError");
    return "failed";
  }
}

/**
 * Cancel many fee invoices with bounded concurrency and an overall time budget
 * (expire cron: avoids N sequential 15s provider timeouts). Never throws.
 * Ids not started before the budget runs out are skipped; their QR stays payable
 * but a late payment is still recorded on the dead booking and flagged for refund.
 */
export async function cancelAppointmentFeeInvoicesBounded(
  appointmentIds: string[],
  opts: {
    concurrency?: number;
    budgetMs?: number;
    cancel?: (appointmentId: string) => Promise<unknown>;
    now?: () => number;
  } = {},
): Promise<{ attempted: number; skipped: number }> {
  const concurrency = Math.max(1, opts.concurrency ?? 5);
  const budgetMs = opts.budgetMs ?? 45_000;
  const cancel = opts.cancel ?? ((id: string) => cancelAppointmentFeeInvoiceById(id));
  const now = opts.now ?? Date.now;
  const deadline = now() + budgetMs;
  let next = 0;
  let attempted = 0;
  const worker = async () => {
    while (next < appointmentIds.length && now() < deadline) {
      const id = appointmentIds[next++];
      attempted++;
      await Promise.allSettled([cancel(id)]);
    }
  };
  await Promise.allSettled(Array.from({ length: Math.min(concurrency, appointmentIds.length) }, worker));
  const skipped = appointmentIds.length - attempted;
  if (skipped > 0) console.warn("[appointment-fee] bounded cancel skipped (time budget):", skipped);
  return { attempted, skipped };
}
