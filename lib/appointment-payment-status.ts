/**
 * Booking-fee state derived from the Appointment snapshot and its final
 * payment row. A missing fee means that this booking did not require payment;
 * AppointmentPayment is created only after QPay confirms full payment.
 */
export type AppointmentBookingPaymentStatus =
  | "NOT_REQUIRED"
  | "PENDING"
  | "UNDERPAID"
  | "FAILED"
  | "PAID"
  | "REFUNDED";

export function appointmentBookingPaymentStatus(input: {
  feeAmount: unknown;
  feeQpayInvoiceId: string | null;
  feeUnderpaidAmount: unknown;
  payment: { status: string } | null;
}): AppointmentBookingPaymentStatus {
  if (input.feeAmount == null) return "NOT_REQUIRED";
  if (input.payment?.status === "PAID") return "PAID";
  // Буцаагдсан хураамж: PENDING/FAILED биш — тусдаа төлөв (Retry/Refund санал болгохгүй).
  if (input.payment?.status === "REFUNDED") return "REFUNDED";
  if (input.feeUnderpaidAmount != null) return "UNDERPAID";
  if (input.feeQpayInvoiceId) return "PENDING";
  return "FAILED";
}

export const APPOINTMENT_BOOKING_PAYMENT_LABEL: Record<
  AppointmentBookingPaymentStatus,
  string
> = {
  NOT_REQUIRED: "Төлбөр шаардлагагүй",
  PENDING: "Төлбөр хүлээгдэж байна",
  UNDERPAID: "Дутуу төлсөн",
  FAILED: "Төлбөрийн invoice алдаатай",
  PAID: "Төлбөр төлөгдсөн",
  REFUNDED: "Төлбөр буцаагдсан",
};

// Global fixed window: an online booking fee unpaid this long after the
// appointment was created no longer holds its slot. Not tenant/branch
// configurable yet — see COWORK.md for the deferred admin-override design.
export const PENDING_APPOINTMENT_PAYMENT_TTL_MINUTES = 15;

/**
 * True once a booking that required a fee and has not been paid has sat
 * unpaid past PENDING_APPOINTMENT_PAYMENT_TTL_MINUTES since creation. An
 * expired hold no longer counts toward slot capacity — see
 * lib/branch-schedule.ts and lib/category-duration.ts. A partial
 * ("underpaid") payment is deliberately excluded: money has already changed
 * hands, so the slot stays reserved for staff to resolve manually rather than
 * being silently released.
 */
export function isPendingAppointmentPaymentExpired(
  input: {
    feeAmount: unknown;
    feeUnderpaidAmount?: unknown;
    payment: { status: string } | null;
    createdAt: Date;
  },
  now: Date = new Date(),
): boolean {
  if (input.feeAmount == null) return false;
  if (input.feeUnderpaidAmount != null) return false;
  if (input.payment?.status === "PAID") return false;
  // Буцаагдсан (гэхдээ цуцлагдаагүй) захиалга цагаа хэвээр хадгална — мөнгө нэг
  // удаа орсон тул TTL-ээр суллахгүй; ажилтан гараар шийднэ.
  if (input.payment?.status === "REFUNDED") return false;
  const ttlMs = PENDING_APPOINTMENT_PAYMENT_TTL_MINUTES * 60000;
  return now.getTime() - input.createdAt.getTime() > ttlMs;
}

export const APPOINTMENT_BOOKING_PAYMENT_BADGE: Record<
  AppointmentBookingPaymentStatus,
  string
> = {
  NOT_REQUIRED: "bg-[var(--oc-panel2)] text-[var(--oc-muted3)] border-[var(--oc-line)]",
  PENDING: "bg-amber-500/10 text-amber-300 border-amber-500/25 light:text-amber-700 light:bg-amber-100 light:border-amber-300",
  UNDERPAID: "bg-orange-500/10 text-orange-300 border-orange-500/25 light:text-orange-700 light:bg-orange-100 light:border-orange-300",
  FAILED: "bg-red-500/10 text-red-300 border-red-500/25 light:text-red-700 light:bg-red-100 light:border-red-300",
  PAID: "bg-emerald-500/10 text-emerald-300 border-emerald-500/25 light:text-emerald-700 light:bg-emerald-100 light:border-emerald-300",
  REFUNDED: "bg-[var(--oc-panel2)] text-[var(--oc-muted3)] border-[var(--oc-line)]",
};
