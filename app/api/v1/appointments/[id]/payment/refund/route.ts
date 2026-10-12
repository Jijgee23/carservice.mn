import { jsonError, jsonOk, requireApiUser } from "@/lib/api";
import { resolveWorkingBranch } from "@/lib/auth/api-branch";
import { requireActiveSubscriptionApi } from "@/lib/subscription-server";
import { requireAppointmentRefundPermission } from "@/lib/appointments/refund-permission";
import { logAudit } from "@/lib/audit";
import { formatTugrik } from "@/lib/orders";
import { prisma } from "@/lib/prisma";
import {
  claimAppointmentRefund,
  finalizeAppointmentRefundWithRetry,
  isDefiniteRefundRejection,
  REFUND_STAFF_WAIT_MESSAGE,
  REFUND_REJECTION_MESSAGE,
  releaseAppointmentRefundClaim,
  type AppointmentRefundDb,
} from "@/lib/appointment-refund";
import { QPayService } from "@/lib/qpay";

/**
 * POST /api/v1/appointments/[id]/payment/refund
 * Permission: payments.delete — NOT payments.edit.
 *
 * Staff-realm equivalent of `refundAppointmentPaymentAction`
 * (`app/_actions/booking-revenue.ts`), which today is SuperAdmin-only and
 * gated by nothing but `requireSuperAdmin()` — no tenant `payments.*`
 * permission exists on that path at all. P2-B6 does not mirror that: a
 * refund is a destructive money mutation, so the Phase 1 invariant applies
 * here exactly as it does to
 * `app/api/v1/orders/[id]/payments/[paymentId]/reverse/route.ts` —
 * `payments.delete`. `payments.edit` (sufficient for retry/check, a
 * provider-status read-through) must NOT unlock this route; see the explicit
 * negative test in tests/appointment-payment-routes.test.ts.
 *
 * The persisted `AppointmentPayment` row (status, paymentType, qpayPaymentId)
 * is the only source of truth for whether/how a refund is possible — nothing
 * here is computed from a client-supplied scalar. The row is CLAIMED
 * with a conditional update (PAID -> refund-in-progress marker, see
 * `lib/appointment-refund.ts`) before QPay is called, so two concurrent refund
 * requests cannot both reach the provider; the loser is rejected. No DB
 * transaction or row lock is held across the QPay HTTP call: claim -> provider
 * -> finalize (REFUNDED + audit in one short tx), with the claim rolled back
 * if the provider fails.
 */
export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const auth = await requireApiUser(req);
  if (auth.response) return auth.response;
  const denied = requireAppointmentRefundPermission(auth.user);
  if (denied) return denied;
  const locked = await requireActiveSubscriptionApi(auth.user);
  if (locked) return locked;

  const { id } = await ctx.params;

  let note = "";
  try {
    const body = await req.json();
    if (typeof body?.note === "string") note = body.note.trim();
  } catch {
    // no body / invalid JSON — treated as missing note below
  }
  if (!note) {
    return jsonError(422, "Буцаах шалтгаан/тэмдэглэл заавал бөглөнө үү.", {
      code: "REFUND_NOTE_REQUIRED",
      fieldErrors: { note: "Заавал бөглөнө." },
    });
  }

  const scopeResult = await resolveWorkingBranch(req, auth.user);
  if (scopeResult.response) return scopeResult.response;

  const appt = await prisma.appointment.findFirst({
    where: { id, tenantId: auth.user.tenantId },
    select: { id: true, branchId: true },
  });
  if (!appt) return jsonError(404, "Цаг захиалга олдсонгүй.");
  if (scopeResult.branchId != null && appt.branchId !== scopeResult.branchId) {
    return jsonError(404, "Цаг захиалга олдсонгүй.");
  }

  const payment = await prisma.appointmentPayment.findUnique({
    where: { appointmentId: appt.id },
    select: { id: true },
  });
  if (!payment) return jsonError(404, "Төлбөр олдсонгүй.");

  const db = prisma.appointmentPayment as unknown as AppointmentRefundDb;

  try {
    // 1) Claim (conditional PAID -> refund-in-progress). No transaction and no
    //    row lock is held across the QPay call below.
    const claim = await claimAppointmentRefund(db, {
      paymentId: payment.id,
      tenantId: auth.user.tenantId,
      allowReclaim: false, // a held claim is resolved by a super admin only
    });
    if (!claim.claimed) {
      throw new AppointmentRefundError(
        claim.reason === "NOT_FOUND" ? 404 : claim.reason === "IN_PROGRESS" ? 409 : 422,
        claim.reason === "IN_PROGRESS" ? REFUND_STAFF_WAIT_MESSAGE : REFUND_REJECTION_MESSAGE[claim.reason],
        claim.reason === "ALREADY_REFUNDED"
          ? "PAYMENT_ALREADY_REFUNDED"
          : claim.reason === "IN_PROGRESS"
            ? "PAYMENT_REFUND_IN_PROGRESS"
            : claim.reason === "NOT_PAID"
              ? "PAYMENT_NOT_PAID"
              : "APPOINTMENT_REFUND_REJECTED",
      );
    }
    const fresh = claim.payment;
    const token = claim.token;

    // 2) Provider call (CARD only) outside any transaction.
    let refundedVia: "QPAY" | "MANUAL" = "MANUAL";
    if (fresh.paymentType === "CARD" && fresh.qpayPaymentId) {
      const qpay = await QPayService.refundPayment(fresh.qpayPaymentId, note).catch(
        (e: unknown) => ({ error: e instanceof Error ? e.name : "UnknownError" }),
      );
      if ("error" in qpay) {
        console.error("[appointments/payment/refund] QPay refund failed:", fresh.id, qpay.error);
        if (isDefiniteRefundRejection(qpay.error)) {
          // Definite provider rejection (4xx): nothing refunded; roll the claim back.
          await releaseAppointmentRefundClaim(db, fresh.id, token);
          throw new AppointmentRefundError(
            502,
            "QPay буцаалтыг татгалзлаа. Мэдээллээ шалгаад дахин оролдоно уу.",
            "QPAY_ERROR",
          );
        }
        // Ambiguous: KEEP the claim; the refund may have gone through.
        throw new AppointmentRefundError(502, REFUND_STAFF_WAIT_MESSAGE, "QPAY_REFUND_UNCERTAIN");
      }
      refundedVia = "QPAY";
    }

    // 3) Finalize on its own (+ one retry) so a failing audit/commit can never roll it back.
    const refundNote = `[${[auth.user.firstName, auth.user.lastName].filter(Boolean).join(" ").trim() || auth.user.id}] ${note}`;
    const finalized = await finalizeAppointmentRefundWithRetry(db, {
      paymentId: fresh.id,
      token,
      refundNote,
    });
    if (!finalized) {
      throw new AppointmentRefundError(
        500,
        "Буцаалтын төлөв хадгалагдсангүй. Төлбөрийн төлөвийг QPay дээр шалгана уу.",
        "REFUND_FINALIZE_FAILED",
      );
    }

    // Audit is best-effort after the money state is durable.
    try {
      await logAudit({
        tenantId: auth.user.tenantId,
        userId: auth.user.id,
        branchId: appt.branchId,
        entity: "Appointment",
        entityId: appt.id,
        action: "PAYMENT_CHANGE",
        summary: `Цаг захиалгын хураамж буцаав (${refundedVia}) · ${formatTugrik(fresh.amount.toString())}`,
        after: {
          paymentId: fresh.id,
          status: "REFUNDED",
          refundedVia,
          amount: fresh.amount.toString(),
          currency: fresh.currency,
        },
      });
    } catch (e) {
      console.error("[appointments/payment/refund] audit failed for", fresh.id, e instanceof Error ? e.name : e);
    }

    return jsonOk({
      ok: true,
      paymentId: fresh.id,
      refundedVia,
      amount: fresh.amount.toString(),
      currency: fresh.currency,
    });
  } catch (error) {
    if (error instanceof AppointmentRefundError) {
      return jsonError(error.status, error.message, { code: error.code });
    }
    console.error("[appointments/payment/refund]", error instanceof Error ? error.name : "UnknownError");
    return jsonError(500, "Серверийн алдаа гарлаа. Дахин оролдоно уу.");
  }
}

class AppointmentRefundError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly code = "APPOINTMENT_REFUND_REJECTED",
  ) {
    super(message);
    this.name = "AppointmentRefundError";
  }
}
