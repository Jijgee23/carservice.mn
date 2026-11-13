import { requireApiUser } from "@/lib/api";
import { requireAppointmentRefundPermission } from "@/lib/appointments/refund-permission";

/**
 * POST /api/v1/appointments/[id]/payment/refund
 *
 * Always 403 `PLATFORM_REFUND_ONLY` for tenant staff. The booking fee is paid
 * to the PLATFORM QPay merchant, so its refund is platform-only: a super admin
 * refunds it from /system/booking-revenue (`refundAppointmentPaymentAction` in
 * app/_actions/booking-revenue.ts). The route is kept (instead of removed) so
 * older mobile builds get a clear, localized refusal rather than a 404.
 * Authentication still runs first so anonymous callers get 401, not 403.
 * No database or QPay work happens on this path.
 */
export async function POST(req: Request) {
  const auth = await requireApiUser(req);
  if (auth.response) return auth.response;
  return requireAppointmentRefundPermission(auth.user);
}
