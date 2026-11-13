import { jsonError } from "@/lib/api";
import type { ApiUser } from "@/lib/auth/api-token";

export const PLATFORM_REFUND_ONLY_MESSAGE =
  "Захиалгын хураамжийг зөвхөн платформын админ буцаана.";

/**
 * The appointment booking fee is collected through the PLATFORM QPay merchant
 * (see lib/appointment-payments.ts), so refunding it moves platform money.
 * Product decision: only a super admin may refund it, via the web action
 * `refundAppointmentPaymentAction` (app/_actions/booking-revenue.ts). No tenant
 * staff permission — not even `payments.delete` or owner — unlocks it through
 * the staff API. Kept database-independent so it can be tested behaviorally.
 */
export function requireAppointmentRefundPermission(
  user: ApiUser,
) {
  void user;
  return jsonError(403, PLATFORM_REFUND_ONLY_MESSAGE, {
    code: "PLATFORM_REFUND_ONLY",
  });
}
