import { jsonError, jsonOk, requireApiUser, requirePermission } from "@/lib/api";
import { resolveWorkingBranch } from "@/lib/auth/api-branch";
import { requireActiveSubscriptionApi } from "@/lib/subscription-server";
import { APPOINTMENT_NOT_PAYABLE_CODE, retryAppointmentFeeCheckout } from "@/lib/appointment-payments";
import { prisma } from "@/lib/prisma";

/**
 * POST /api/v1/appointments/[id]/payment/retry
 * Permission: payments.edit
 *
 * Staff-realm equivalent of `retryAppointmentPaymentAction`
 * (`app/_actions/appointment-payments.ts`). Re-requests a QPay checkout when
 * the previous invoice attempt failed. `retryAppointmentFeeCheckout` itself
 * re-reads `Appointment.payment`/fee* from the database before deciding
 * anything is idempotent when a payment row already exists — a second,
 * concurrent retry call for the same appointment observes that persisted
 * state and short-circuits rather than issuing a duplicate invoice.
 */
export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const auth = await requireApiUser(req);
  if (auth.response) return auth.response;
  const denied = requirePermission(auth.user, "payments.edit");
  if (denied) return denied;
  const locked = await requireActiveSubscriptionApi(auth.user);
  if (locked) return locked;

  const { id } = await ctx.params;

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

  const result = await retryAppointmentFeeCheckout(appt.id);
  if (!result.ok) {
    if (result.code === APPOINTMENT_NOT_PAYABLE_CODE) {
      return jsonError(409, result.error, { code: APPOINTMENT_NOT_PAYABLE_CODE });
    }
    return jsonError(502, result.error ?? "QPay үйлчилгээ түр ажиллахгүй байна.", {
      code: "QPAY_ERROR",
    });
  }
  return jsonOk({ ok: true, required: result.required });
}
