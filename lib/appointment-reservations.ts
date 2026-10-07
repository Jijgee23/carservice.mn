import type { Prisma } from "@/app/generated/prisma/client";
import { buildDaySlots, DEFAULT_SLOT_CAPACITY, DEFAULT_SLOT_MINUTES } from "@/lib/appointment-slots";
import { bookingDateKey, MAX_ADVANCE_BOOKING_DAYS } from "@/lib/booking-time";
import { resolveEffectiveSchedule } from "@/lib/branch-effective-schedule";
import { branchScheduleForDateSelect } from "@/lib/branch-effective-schedule-server";
import { isSlotAvailable, resolveCategoryDurations } from "@/lib/category-duration";

export class ReservationError extends Error {
  constructor(public status: 400 | 403 | 409, message: string) { super(message); }
}

/**
 * Specifically the capacity-full case (as opposed to out-of-hours/past,
 * which stays a hard block for everyone). Staff booking a phone-in
 * appointment may deliberately override this one — a customer knows their
 * relationship with the shop lets them double up a bay, or the branch's
 * capacity number is just conservative — the same "soft warning, not a hard
 * rule" latitude order scheduling already has (see D-hours decisions in
 * COWORK.md). Customer online self-booking never gets this override
 * (`staffUserId` absent), since nothing there can vouch for a real physical
 * exception the way a staff member present at the branch can.
 */
export class ReservationConflictError extends ReservationError {
  constructor(message: string) { super(409, message); }
}

// S13 (WEB_SCHEDULING_ASSESSMENT_2026-09-10.md): booking creation/reschedule
// previously had no maximum advance-booking horizon at all, while the
// hours-change impact scan (lib/branch-schedule-impact.ts, called from
// app/_actions/branches.ts) only ever looked MAX_ADVANCE_BOOKING_DAYS ahead —
// an appointment booked further out than that could exist yet never be
// inspected by an hours change.
function assertWithinAdvanceBookingHorizon(requestedAt: Date, now: Date): void {
  const horizon = now.getTime() + MAX_ADVANCE_BOOKING_DAYS * 86400000;
  if (requestedAt.getTime() > horizon) {
    throw new ReservationError(400, "Хэтэрхий хол хугацаанд цаг захиалах боломжгүй.");
  }
}

export type ReservationInput = {
  tenantId: string;
  branchId: string;
  requestedAt: Date;
  categoryIds: string[];
  accountId?: string | null;
  accountVehicleId?: string | null;
  customerId?: string | null;
  // Staff registration only; the caller validates tenant ownership.
  vehicleId?: string | null;
  note?: string | null;
  staffUserId?: string;
  // Only honored when staffUserId is set — see ReservationConflictError.
  confirmed?: boolean;
  // QA #28: staff-chosen master. The caller validates eligibility inside this
  // same transaction through `validateAssignee` (the row locks it takes must
  // share the booking transaction); it is ignored for customer bookings.
  assignedToId?: string | null;
  validateAssignee?: (tx: Prisma.TransactionClient, branchId: string) => Promise<void>;
};

/** Caller authenticates first. All DB operations here use the SAME transaction. */
export async function reserveAppointmentInTransaction(
  tx: Prisma.TransactionClient,
  input: ReservationInput,
  now = new Date(),
) {
  const locked = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM "Branch" WHERE id = ${input.branchId} AND "tenantId" = ${input.tenantId} FOR UPDATE
  `;
  if (!locked.length) throw new ReservationError(403, "Салбар олдсонгүй.");
  if (!Number.isFinite(input.requestedAt.getTime())) throw new ReservationError(400, "Огноо буруу.");
  assertWithinAdvanceBookingHorizon(input.requestedAt, now);
  const dateStr = bookingDateKey(input.requestedAt);
  const branch = await tx.branch.findFirst({
    where: { id: input.branchId, tenantId: input.tenantId, isActive: true },
    select: {
      id: true,
      slotMinutes: true,
      slotCapacity: true,
      ...branchScheduleForDateSelect(dateStr),
      tenant: { select: { suspended: true, acceptsOnlineBooking: true } },
    },
  });
  if (!branch || branch.tenant.suspended || (!input.staffUserId && !branch.tenant.acceptsOnlineBooking)) {
    throw new ReservationError(403, "Энэ салбар цаг захиалга хүлээн авахгүй.");
  }
  if (input.accountVehicleId) {
    if (!input.accountId || !await tx.accountVehicle.findFirst({
      where: { id: input.accountVehicleId, accountId: input.accountId }, select: { id: true },
    })) throw new ReservationError(400, "Машин олдсонгүй.");
  }
  if (input.customerId && !await tx.customer.findFirst({
    where: { id: input.customerId, tenantId: input.tenantId }, select: { id: true },
  })) throw new ReservationError(400, "Үйлчлүүлэгч олдсонгүй.");

  const categoryIds = [...new Set(input.categoryIds)];
  if (categoryIds.length) {
    const categories = await tx.category.findMany({ where: {
      id: { in: categoryIds }, tenantId: input.tenantId, isActive: true,
      OR: [{ branches: { some: { id: branch.id } } }, { branches: { none: {} } }],
    }, select: { id: true } });
    if (categories.length !== categoryIds.length) throw new ReservationError(400, "Үйлчилгээний ангиллаа дахин сонгоно уу.");
  }
  const resolved = await resolveCategoryDurations(tx, categoryIds);
  const duration = resolved.totalMinutes || branch.slotMinutes || DEFAULT_SLOT_MINUTES;
  const schedule = resolveEffectiveSchedule({ dateStr, branch });
  const slots = buildDaySlots({
    dateStr,
    open: schedule.open,
    openTime: schedule.openTime,
    closeTime: schedule.closeTime,
    slotMinutes: branch.slotMinutes ?? DEFAULT_SLOT_MINUTES,
    capacity: branch.slotCapacity ?? 1, appointmentMinutes: duration,
    taken: [], now,
  });
  if (!slots.slots.some((slot) => slot.iso === input.requestedAt.toISOString() && slot.available)) {
    throw new ReservationError(400, "Ажиллах цагт багтах сул цаг сонгоно уу.");
  }
  if (!await isSlotAvailable(tx, branch.id, input.requestedAt, duration)) {
    const overrideAllowed = Boolean(input.staffUserId) && input.confirmed === true;
    if (!overrideAllowed) {
      throw new ReservationConflictError(
        input.staffUserId
          ? "Энэ цаг дүүрсэн байна. Үргэлжлүүлэхийн тулд дахин баталгаажуулна уу."
          : "Энэ цаг дүүрсэн байна. Өөр цаг сонгоно уу.",
      );
    }
  }
  const assignedToId = input.staffUserId ? input.assignedToId ?? null : null;
  if (assignedToId) {
    // Never persist an assignee that was not validated in this transaction.
    if (!input.validateAssignee) throw new ReservationError(400, "Хариуцах мастер шалгагдаагүй байна.");
    await input.validateAssignee(tx, branch.id);
  }
  return tx.appointment.create({
    data: {
      assignedToId,
      tenantId: input.tenantId, branchId: branch.id, requestedAt: input.requestedAt,
      estimatedDurationMinutes: duration, originalEstimatedDurationMinutes: duration,
      accountId: input.accountId ?? null,
      accountVehicleId: input.accountVehicleId ?? null, customerId: input.customerId ?? null,
      vehicleId: input.vehicleId ?? null,
      note: input.note ?? null, categoryId: categoryIds[0] ?? null,
      categories: categoryIds.length ? { create: categoryIds.map((categoryId) => ({ categoryId })) } : undefined,
      status: input.staffUserId ? "CONFIRMED" : "PENDING",
      respondedAt: input.staffUserId ? now : null, respondedById: input.staffUserId ?? null,
    }, select: { id: true, status: true, requestedAt: true },
  });
}

export async function reserveAppointment(input: ReservationInput) {
  const { withBookingTransaction } = await import("@/lib/prisma");
  return withBookingTransaction(input.tenantId, (tx) => reserveAppointmentInTransaction(tx, input));
}

export type MoveAppointmentInput = {
  tenantId: string;
  branchId: string;
  appointmentId: string;
  requestedAt: Date;
  /** Statuses eligible to be moved — callers scope this (e.g. account reschedule vs staff reschedule). */
  allowedStatuses?: readonly string[];
};

/**
 * Shared reservation mutator for moving an EXISTING appointment to a new
 * time — used by both account self-reschedule and staff reschedule so the
 * two paths cannot race each other or a fresh `reserveAppointmentInTransaction`
 * create (S01–S03). Takes the SAME branch row lock as creation, rereads the
 * appointment under that lock, resolves hours with the DATE-only selection
 * helper (`branchScheduleForDateSelect`), validates the FULL saved duration
 * against closing (not just slot length), then checks capacity excluding the
 * appointment's own current slot. Caller authenticates/authorizes first.
 */
export async function moveAppointmentInTransaction(
  tx: Prisma.TransactionClient,
  input: MoveAppointmentInput,
  now = new Date(),
) {
  if (!Number.isFinite(input.requestedAt.getTime())) throw new ReservationError(400, "Огноо буруу.");
  assertWithinAdvanceBookingHorizon(input.requestedAt, now);

  const locked = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM "Branch" WHERE id = ${input.branchId} AND "tenantId" = ${input.tenantId} FOR UPDATE
  `;
  if (!locked.length) throw new ReservationError(403, "Салбар олдсонгүй.");

  // Reread the appointment under the branch lock — its status/link must not
  // have changed since the caller's initial (pre-lock) read.
  const appt = await tx.appointment.findFirst({
    where: { id: input.appointmentId, tenantId: input.tenantId, branchId: input.branchId },
    select: { id: true, status: true, estimatedDurationMinutes: true, serviceOrderId: true },
  });
  if (!appt) throw new ReservationError(403, "Цаг захиалга олдсонгүй.");
  const allowed = input.allowedStatuses ?? (["PENDING", "CONFIRMED"] as const);
  if (!allowed.includes(appt.status)) {
    throw new ReservationError(400, "Энэ цагийг шилжүүлэх боломжгүй.");
  }

  const dateStr = bookingDateKey(input.requestedAt);
  const branch = await tx.branch.findFirst({
    where: { id: input.branchId, tenantId: input.tenantId, isActive: true },
    select: {
      slotMinutes: true,
      slotCapacity: true,
      ...branchScheduleForDateSelect(dateStr),
    },
  });
  if (!branch) throw new ReservationError(403, "Салбар олдсонгүй.");

  const duration = appt.estimatedDurationMinutes ?? branch.slotMinutes ?? DEFAULT_SLOT_MINUTES;
  const schedule = resolveEffectiveSchedule({ dateStr, branch });
  const slots = buildDaySlots({
    dateStr,
    open: schedule.open,
    openTime: schedule.openTime,
    closeTime: schedule.closeTime,
    slotMinutes: branch.slotMinutes ?? DEFAULT_SLOT_MINUTES,
    capacity: branch.slotCapacity ?? DEFAULT_SLOT_CAPACITY,
    // Full saved duration, not just the slot length — a 120-minute
    // appointment must not move into a 30-minute closing window (S02).
    appointmentMinutes: duration,
    taken: [],
    now,
  });
  if (!slots.slots.some((slot) => slot.iso === input.requestedAt.toISOString() && slot.available)) {
    throw new ReservationError(400, "Ажиллах цагт багтах сул цаг сонгоно уу.");
  }
  if (!(await isSlotAvailable(tx, input.branchId, input.requestedAt, duration, appt.id))) {
    throw new ReservationConflictError("Энэ цаг дүүрсэн байна. Өөр цаг сонгоно уу.");
  }

  return tx.appointment.update({
    where: { id: appt.id },
    // S17 Phase B: resetting reminderSentAt lets the appointment-reminders
    // cron's `reminderSentAt: null` filter pick this appointment back up for
    // its NEW time — without this, an appointment already reminded once then
    // rescheduled would never be reminded again.
    data: { requestedAt: input.requestedAt, reminderSentAt: null },
    select: { id: true, status: true, requestedAt: true },
  });
}
