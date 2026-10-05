import { canEdit, workingBranchScopeId } from "@/lib/auth/roles";
import { canEditOrder, type OrderAccessUser } from "@/lib/auth/order-access";
import { assertActiveSubscription } from "@/lib/subscription-server";
import { isAppointmentOverdue, resolveCustomerForAccount } from "@/lib/appointments";
import { ensureTenantVehicle } from "@/lib/vehicles";
import { appointmentBookingPaymentStatus } from "@/lib/appointment-payment-status";
import { createNotification } from "@/lib/notifications";
import { logAudit } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import {
  moveAppointmentInTransaction,
  ReservationError,
} from "@/lib/appointment-reservations";
import { moveLinkedAppointmentOrder, LinkedRescheduleError } from "@/lib/linked-reschedule";
import { bookingDateKey, bookingDayBounds } from "@/lib/booking-time";
import { resolveEffectiveSchedule } from "@/lib/branch-effective-schedule";
import { branchScheduleForDateSelect } from "@/lib/branch-effective-schedule-server";
import { timeToMinutes } from "@/lib/branches";
import { DEFAULT_SLOT_MINUTES } from "@/lib/appointment-slots";

/**
 * Shared actor shape for appointment commands — structurally compatible with
 * `RoleCheckUser` (`canEdit`), `OrderAccessUser` (`canEditOrder`) and
 * `workingBranchScopeId`'s input, so the same value from `requireUser()`
 * (server actions) or an API-token session (routes) can be passed straight
 * through without adapting shape.
 */
export type AppointmentCommandActor = OrderAccessUser & {
  tenantId: string;
  branchId?: string | null;
  workingBranchId?: string;
};

export class AppointmentCommandError extends Error {
  constructor(
    message: string,
    public readonly status = 422,
    public readonly code = "APPOINTMENT_COMMAND_REJECTED",
    public readonly fieldErrors?: Record<string, string>,
  ) {
    super(message);
    this.name = "AppointmentCommandError";
  }
}

/**
 * `requireUser()`/session resolution happens in the caller (action or route)
 * BEFORE this runs, exactly like the original inline `assertStaffScope` —
 * this function only checks the already-resolved actor against the target
 * branch and the tenant's subscription state.
 *
 * D-132: the two messages below are named constants so a sanitizing caller
 * can allow-list them via `knownAuthorizationMessage`.
 */
export const STAFF_SCOPE_FORBIDDEN_MESSAGE = "Танд цаг захиалга удирдах эрх байхгүй.";
export const STAFF_SCOPE_WRONG_BRANCH_MESSAGE = "Зөвхөн өөрийн салбарын цаг захиалгыг удирдана.";

export const STAFF_SCOPE_MESSAGES = [
  STAFF_SCOPE_FORBIDDEN_MESSAGE,
  STAFF_SCOPE_WRONG_BRANCH_MESSAGE,
] as const;

export async function assertStaffScope(
  actor: AppointmentCommandActor,
  branchId?: string,
): Promise<void> {
  if (!canEdit(actor, "appointments")) {
    throw new Error(STAFF_SCOPE_FORBIDDEN_MESSAGE);
  }
  const scope = workingBranchScopeId(actor);
  if (scope && branchId && branchId !== scope) {
    throw new Error(STAFF_SCOPE_WRONG_BRANCH_MESSAGE);
  }
  await assertActiveSubscription(actor.tenantId);
}

async function loadAppointmentForStaffAction(id: string) {
  return prisma.appointment.findUnique({
    where: { id },
    select: {
      id: true,
      tenantId: true,
      branchId: true,
      status: true,
      accountId: true,
      arrivedAt: true,
      requestedAt: true,
      account: { select: { id: true, phone: true, name: true, email: true } },
      accountVehicle: { select: { vehicleId: true } },
      feeAmount: true,
      feeQpayInvoiceId: true,
      feeUnderpaidAmount: true,
      payment: { select: { status: true } },
    },
  });
}

async function assertStaffTenantScope(
  actor: AppointmentCommandActor,
  appt: { tenantId: string; branchId: string },
): Promise<void> {
  await assertStaffScope(actor, appt.branchId);
  if (actor.tenantId !== appt.tenantId) {
    throw new AppointmentCommandError("Танд энэ цагийг удирдах эрх байхгүй.", 403, "APPOINTMENT_OUT_OF_SCOPE");
  }
}

export type ConfirmAppointmentResult = {
  appointmentId: string;
  accountId: string;
};

/**
 * Staff confirms a PENDING appointment: resolves the account-linked customer
 * (bridge) into the tenant's Customer table, snapshots the chosen vehicle,
 * and moves the appointment to CONFIRMED. Behavior mirrors the original
 * `confirmAppointment` action exactly.
 */
export async function confirmAppointmentCommand(input: {
  actor: AppointmentCommandActor;
  appointmentId: string;
}): Promise<ConfirmAppointmentResult> {
  const { actor, appointmentId } = input;
  const appt = await loadAppointmentForStaffAction(appointmentId);
  if (!appt) throw new AppointmentCommandError("Цаг захиалга олдсонгүй.", 404, "APPOINTMENT_NOT_FOUND");
  await assertStaffTenantScope(actor, appt);
  if (appt.status !== "PENDING") {
    throw new AppointmentCommandError("Энэ цаг аль хэдийн хариу авсан байна.", 422, "APPOINTMENT_NOT_PENDING");
  }
  if (isAppointmentOverdue(appt)) {
    throw new AppointmentCommandError("Цагийн хугацаа өнгөрсөн тул баталгаажуулах боломжгүй.", 422, "APPOINTMENT_OVERDUE");
  }
  const bookingPaymentStatus = appointmentBookingPaymentStatus(appt);
  if (bookingPaymentStatus !== "NOT_REQUIRED" && bookingPaymentStatus !== "PAID") {
    throw new AppointmentCommandError(
      "Захиалгын хураамж бүрэн төлөгдөөгүй тул цагийг баталгаажуулах боломжгүй.",
      422,
      "APPOINTMENT_FEE_UNPAID",
    );
  }
  if (!appt.account) {
    throw new AppointmentCommandError("Энэ цагт хэрэглэгчийн мэдээлэл алга.", 422, "APPOINTMENT_NO_ACCOUNT");
  }
  const account = appt.account;
  const accountVehicle = appt.accountVehicle;

  await prisma.$transaction(async (tx) => {
    const customerId = await resolveCustomerForAccount(tx, appt.tenantId, account);
    // Link энэ tenant-д ӨӨР эзэнтэй байсан бол (хуучин олон эзэнтэй мөр)
    // эзнийг дарж бичихгүй, машиныг ч цагт холбохгүй — ажилтан захиалга
    // үүсгэхдээ энэ Customer-т машин сонгоно/шинээр бүртгэнэ.
    //
    // Дээд урсгалын 6c4ecc1 (vehicle-per-owner) `ensureTenantVehicle`-ийг
    // линкийн ЖИНХЭНЭ эзнийг буцаадаг болгож, route дотор энэ шалгалтыг
    // нэмсэн. Тэр route нь энэ команд руу нэгдсэн тул шалгалт эндээ
    // шилжив — үгүй бол өөр эзний машиныг цагт холбох алдаа эргэж ирнэ.
    let vehicleId: string | null = null;
    if (accountVehicle) {
      const link = await ensureTenantVehicle(tx, {
        tenantId: appt.tenantId,
        vehicleId: accountVehicle.vehicleId,
        customerId,
      });
      vehicleId = link.customerId === customerId ? accountVehicle.vehicleId : null;
    }
    const updated = await tx.appointment.updateMany({
      where: { id: appt.id, tenantId: appt.tenantId, status: "PENDING" },
      data: {
        status: "CONFIRMED",
        customerId,
        vehicleId,
        respondedAt: new Date(),
        respondedById: actor.id,
      },
    });
    if (updated.count !== 1) {
      throw new AppointmentCommandError(
        "Энэ цаг аль хэдийн хариу авсан байна.",
        409,
        "APPOINTMENT_NOT_PENDING",
      );
    }
    await logAudit(
      {
        tenantId: appt.tenantId,
        userId: actor.id,
        branchId: appt.branchId,
        entity: "Appointment",
        entityId: appt.id,
        action: "STATUS_CHANGE",
        summary: "Цаг баталгаажуулсан",
        after: { status: "CONFIRMED", customerId, vehicleId },
      },
      tx,
    );
  });

  try {
    await createNotification({
      type: "appointment_confirmed",
      recipient: { accountId: account.id },
      input: { appointmentId: appt.id },
    });
  } catch (e) {
    console.warn("[notify] confirmAppointmentCommand:", e);
  }

  return { appointmentId: appt.id, accountId: account.id };
}

export type RejectAppointmentResult = { appointmentId: string; accountId: string | null };

export async function rejectAppointmentCommand(input: {
  actor: AppointmentCommandActor;
  appointmentId: string;
}): Promise<RejectAppointmentResult> {
  const { actor, appointmentId } = input;
  const appt = await prisma.appointment.findUnique({
    where: { id: appointmentId },
    select: { id: true, tenantId: true, branchId: true, status: true, accountId: true },
  });
  if (!appt) throw new AppointmentCommandError("Цаг захиалга олдсонгүй.", 404, "APPOINTMENT_NOT_FOUND");
  await assertStaffTenantScope(actor, appt);
  if (appt.status !== "PENDING") {
    throw new AppointmentCommandError("Энэ цаг аль хэдийн хариу авсан байна.", 422, "APPOINTMENT_NOT_PENDING");
  }

  const updated = await prisma.appointment.updateMany({
    where: { id: appt.id, tenantId: appt.tenantId, status: "PENDING" },
    data: { status: "REJECTED", respondedAt: new Date(), respondedById: actor.id },
  });
  if (updated.count !== 1) {
    throw new AppointmentCommandError(
      "Энэ цаг аль хэдийн хариу авсан байна.",
      409,
      "APPOINTMENT_NOT_PENDING",
    );
  }
  await logAudit({
    tenantId: appt.tenantId,
    userId: actor.id,
    branchId: appt.branchId,
    entity: "Appointment",
    entityId: appt.id,
    action: "STATUS_CHANGE",
    summary: "Цаг татгалзсан",
    after: { status: "REJECTED" },
  });

  if (appt.accountId) {
    try {
      await createNotification({
        type: "appointment_rejected",
        recipient: { accountId: appt.accountId },
        input: { appointmentId: appt.id },
      });
    } catch (e) {
      console.warn("[notify] rejectAppointmentCommand:", e);
    }
  }

  return { appointmentId: appt.id, accountId: appt.accountId };
}

export type NoShowAppointmentResult = { appointmentId: string; accountId: string | null };

export async function markAppointmentNoShowCommand(input: {
  actor: AppointmentCommandActor;
  appointmentId: string;
}): Promise<NoShowAppointmentResult> {
  const { actor, appointmentId } = input;
  const appt = await prisma.appointment.findUnique({
    where: { id: appointmentId },
    select: { id: true, tenantId: true, branchId: true, status: true, accountId: true },
  });
  if (!appt) throw new AppointmentCommandError("Цаг захиалга олдсонгүй.", 404, "APPOINTMENT_NOT_FOUND");
  await assertStaffTenantScope(actor, appt);
  if (appt.status !== "CONFIRMED") {
    throw new AppointmentCommandError("Энэ цагийг тэмдэглэх боломжгүй.", 422, "APPOINTMENT_NOT_CONFIRMED");
  }

  const updated = await prisma.appointment.updateMany({
    where: { id: appt.id, tenantId: appt.tenantId, status: "CONFIRMED" },
    data: { status: "NO_SHOW" },
  });
  if (updated.count !== 1) {
    throw new AppointmentCommandError(
      "Энэ цагийг тэмдэглэх боломжгүй.",
      409,
      "APPOINTMENT_NOT_CONFIRMED",
    );
  }
  await logAudit({
    tenantId: appt.tenantId,
    userId: actor.id,
    branchId: appt.branchId,
    entity: "Appointment",
    entityId: appt.id,
    action: "STATUS_CHANGE",
    summary: "Цагт ирээгүй гэж тэмдэглэв",
    after: { status: "NO_SHOW" },
  });

  if (appt.accountId) {
    try {
      await createNotification({
        type: "appointment_no_show",
        recipient: { accountId: appt.accountId },
        input: { appointmentId: appt.id },
      });
    } catch (e) {
      console.warn("[notify] markAppointmentNoShowCommand:", e);
    }
  }

  return { appointmentId: appt.id, accountId: appt.accountId };
}

export type ArrivedAppointmentResult = { appointmentId: string };

export async function markAppointmentArrivedCommand(input: {
  actor: AppointmentCommandActor;
  appointmentId: string;
}): Promise<ArrivedAppointmentResult> {
  const { actor, appointmentId } = input;
  const appt = await prisma.appointment.findUnique({
    where: { id: appointmentId },
    select: { id: true, tenantId: true, branchId: true, status: true, arrivedAt: true },
  });
  if (!appt) throw new AppointmentCommandError("Цаг захиалга олдсонгүй.", 404, "APPOINTMENT_NOT_FOUND");
  await assertStaffTenantScope(actor, appt);
  if (appt.status !== "CONFIRMED") {
    throw new AppointmentCommandError("Энэ цагийг тэмдэглэх боломжгүй.", 422, "APPOINTMENT_NOT_CONFIRMED");
  }
  if (appt.arrivedAt) {
    throw new AppointmentCommandError("Аль хэдийн ирсэн гэж тэмдэглэсэн байна.", 422, "APPOINTMENT_ALREADY_ARRIVED");
  }

  const arrivedAt = new Date();
  const updated = await prisma.appointment.updateMany({
    where: {
      id: appt.id,
      tenantId: appt.tenantId,
      status: "CONFIRMED",
      arrivedAt: null,
    },
    data: { arrivedAt },
  });
  if (updated.count !== 1) {
    throw new AppointmentCommandError(
      "Аль хэдийн ирсэн гэж тэмдэглэсэн байна.",
      409,
      "APPOINTMENT_ALREADY_ARRIVED",
    );
  }
  await logAudit({
    tenantId: appt.tenantId,
    userId: actor.id,
    branchId: appt.branchId,
    entity: "Appointment",
    entityId: appt.id,
    action: "STATUS_CHANGE",
    summary: "Үйлчлүүлэгч ирснийг тэмдэглэв",
    after: { arrivedAt: arrivedAt.toISOString() },
  });

  return { appointmentId: appt.id };
}

export type CancelAppointmentByAccountResult = { appointmentId: string; cancelled: boolean };

/**
 * Account cancels its own PENDING/CONFIRMED appointment. Kept a no-op (not
 * an error) when the appointment does not exist or is not in a cancellable
 * status, matching the original `cancelAppointmentByAccount` action, which
 * silently returns rather than surfacing a field error for this fire-and-
 * forget form action.
 */
export async function cancelAppointmentByAccountCommand(input: {
  account: { id: string; name: string | null; phone: string };
  appointmentId: string;
}): Promise<CancelAppointmentByAccountResult> {
  const { account, appointmentId } = input;
  const appt = await prisma.appointment.findFirst({
    where: { id: appointmentId, accountId: account.id },
    select: { id: true, status: true, tenantId: true, branchId: true, requestedAt: true, serviceOrderId: true },
  });
  // Засварын хуудас холбогдсон (ажил эхэлсэн байж болох) цагийг үйлчлүүлэгч
  // цуцлахгүй — appointment-ийг цуцлахад ServiceOrder хөндөгдөхгүй тул ажил
  // үргэлжилсээр, ажилтанд төөрөгдүүлсэн мэдэгдэл очно (апп ч мөн нуудаг).
  if (!appt || appt.serviceOrderId || (appt.status !== "PENDING" && appt.status !== "CONFIRMED")) {
    return { appointmentId, cancelled: false };
  }

  const updated = await prisma.appointment.updateMany({
    where: {
      id: appt.id,
      accountId: account.id,
      status: { in: ["PENDING", "CONFIRMED"] },
      serviceOrderId: null,
    },
    data: { status: "CANCELLED" },
  });

  return { appointmentId: appt.id, cancelled: updated.count === 1 };
}

export type RescheduleAppointmentResult = {
  appointmentId: string;
  orderId?: string;
  linked: boolean;
  accountId: string | null;
};

/**
 * Staff reschedules a CONFIRMED appointment. Carries the D-132 correction
 * as-is: an appointment linked to a still-SCHEDULED order is moved through
 * `moveLinkedAppointmentOrder` (the order's own scheduledAt/OrderTimeBooking
 * row shares the slot and must not drift from the appointment's
 * `requestedAt`), and an order that has left SCHEDULED (IN_PROGRESS/
 * COMPLETED/CANCELLED) hard-blocks rescheduling from this path. The
 * removed capacity-blind overlap-confirm warning (D-111) is NOT
 * reintroduced — only working-hours validation remains for the unlinked
 * path.
 */
export async function rescheduleAppointmentCommand(input: {
  actor: AppointmentCommandActor;
  appointmentId: string;
  requestedAt: Date;
  confirmed?: boolean;
}): Promise<RescheduleAppointmentResult> {
  const { actor, appointmentId, requestedAt, confirmed = false } = input;
  if (!Number.isFinite(requestedAt.getTime())) {
    throw new AppointmentCommandError("Огноо буруу.", 422, "INVALID_DATE", { requestedAt: "Огноо буруу." });
  }
  if (requestedAt.getTime() < Date.now()) {
    throw new AppointmentCommandError("Өнгөрсөн цаг сонгох боломжгүй.", 422, "PAST_TIME", {
      requestedAt: "Өнгөрсөн цаг сонгох боломжгүй.",
    });
  }

  const appt = await prisma.appointment.findUnique({
    where: { id: appointmentId },
    select: {
      id: true,
      tenantId: true,
      branchId: true,
      status: true,
      requestedAt: true,
      accountId: true,
      estimatedDurationMinutes: true,
      serviceOrderId: true,
      serviceOrder: { select: { id: true, status: true } },
    },
  });
  if (!appt) throw new AppointmentCommandError("Цаг захиалга олдсонгүй.", 404, "APPOINTMENT_NOT_FOUND");
  await assertStaffTenantScope(actor, appt);
  if (appt.status !== "CONFIRMED") {
    throw new AppointmentCommandError("Зөвхөн баталгаажсан цагийг энд шилжүүлнэ.", 422, "APPOINTMENT_NOT_CONFIRMED");
  }

  if (appt.serviceOrderId) {
    if (appt.serviceOrder?.status !== "SCHEDULED") {
      throw new AppointmentCommandError(
        "Энэ цаг захиалга эхэлсэн/хойшлуулсан ажлын хуудастай холбогдсон тул энд шилжүүлэх боломжгүй. Захиалгын хуудаснаас цагийг нь шилжүүлнэ үү.",
        422,
        "LINKED_ORDER_NOT_SCHEDULED",
      );
    }
    const linked = await prisma.serviceOrder.findFirst({
      where: { id: appt.serviceOrderId, tenantId: appt.tenantId },
      select: { assignedToId: true, branchId: true },
    });
    if (!linked || !canEditOrder(actor, linked)) {
      throw new AppointmentCommandError("Танд холбогдсон засварын хуудсыг засах эрх байхгүй.", 403, "ORDER_EDIT_FORBIDDEN");
    }
    const moved = await moveLinkedAppointmentOrder({
      tenantId: appt.tenantId,
      userId: actor.id,
      orderId: appt.serviceOrderId,
      newTime: requestedAt,
      confirmed,
      actor,
      scope: workingBranchScopeId(actor),
    });
    if (!moved.appointmentId) {
      throw new AppointmentCommandError("Холбогдсон цаг захиалга олдсонгүй.", 422, "APPOINTMENT_LINK_MISSING");
    }
    if (appt.accountId) {
      try {
        await createNotification({
          type: "appointment_rescheduled",
          recipient: { accountId: appt.accountId },
          input: { appointmentId: moved.appointmentId },
        });
      } catch (e) {
        console.warn("[notify] rescheduleAppointmentCommand (linked):", e);
      }
    }
    return {
      appointmentId: moved.appointmentId,
      orderId: moved.orderId,
      linked: true,
      accountId: appt.accountId,
    };
  }

  const requestedDateStr = bookingDateKey(requestedAt);
  const requestedDay = bookingDayBounds(requestedDateStr);

  const branch = await prisma.branch.findFirst({
    where: { id: appt.branchId, tenantId: appt.tenantId, isActive: true },
    select: { slotMinutes: true, ...branchScheduleForDateSelect(requestedDateStr) },
  });
  if (!branch) throw new AppointmentCommandError("Салбар олдсонгүй.", 404, "BRANCH_NOT_FOUND");
  const durationMinutes = appt.estimatedDurationMinutes ?? branch.slotMinutes ?? DEFAULT_SLOT_MINUTES;
  const requestedEnd = new Date(requestedAt.getTime() + durationMinutes * 60000);
  const endExclusive = new Date(requestedEnd.getTime() - 1);
  if (bookingDateKey(endExclusive) !== requestedDateStr) {
    throw new AppointmentCommandError(
      "Цаг захиалга нэг өдрийн ажиллах цагийн дотор багтах ёстой.",
      422,
      "SPANS_DAY_BOUNDARY",
    );
  }
  const effective = resolveEffectiveSchedule({ dateStr: requestedDateStr, branch });
  const openMin = effective.openTime ? timeToMinutes(effective.openTime) : null;
  const closeMin = effective.closeTime ? timeToMinutes(effective.closeTime) : null;
  const startMin = (requestedAt.getTime() - requestedDay.start.getTime()) / 60000;
  if (
    !effective.open ||
    openMin == null ||
    closeMin == null ||
    closeMin <= openMin ||
    startMin < openMin ||
    startMin + durationMinutes > closeMin
  ) {
    throw new AppointmentCommandError("Ажиллах цагт багтах сул цаг сонгоно уу.", 422, "OUTSIDE_BUSINESS_HOURS", {
      requestedAt: "Ажиллах цагт багтах сул цаг сонгоно уу.",
    });
  }

  // D-111: the schedule-overlap warning that used to sit here is gone — it
  // never blocked anything and was capacity-blind. Deliberately not
  // reintroduced. The working-hours validation above is the real,
  // hard-blocking constraint.

  const previous = appt.requestedAt;
  await prisma.$transaction(async (tx) => {
    await tx.appointment.update({ where: { id: appt.id }, data: { requestedAt } });
    await logAudit(
      {
        tenantId: appt.tenantId,
        userId: actor.id,
        branchId: appt.branchId,
        entity: "Appointment",
        entityId: appt.id,
        action: "UPDATE",
        summary: "Цагийг шилжүүлэв",
        before: { requestedAt: previous.toISOString() },
        after: { requestedAt: requestedAt.toISOString() },
      },
      tx,
    );
  });

  if (appt.accountId) {
    try {
      await createNotification({
        type: "appointment_rescheduled",
        recipient: { accountId: appt.accountId },
        input: { appointmentId: appt.id },
      });
    } catch (e) {
      console.warn("[notify] rescheduleAppointmentCommand:", e);
    }
  }

  return { appointmentId: appt.id, linked: false, accountId: appt.accountId };
}

export type RescheduleAppointmentByAccountResult = { appointmentId: string };

/**
 * Account reschedules its own PENDING/CONFIRMED appointment — shared between
 * the web server action and the mobile `/api/v1/app/appointments/[id]/reschedule`
 * route, mirroring the original `rescheduleAppointmentByAccountCore`.
 */
export async function rescheduleAppointmentByAccountCommand(input: {
  account: { id: string; name: string | null; phone: string };
  appointmentId: string;
  requestedAt: Date;
}): Promise<RescheduleAppointmentByAccountResult> {
  const { account, appointmentId, requestedAt } = input;
  if (requestedAt.getTime() < Date.now()) {
    throw new AppointmentCommandError("Өнгөрсөн цаг сонгох боломжгүй.", 422, "PAST_TIME", {
      requestedAt: "Өнгөрсөн цаг сонгох боломжгүй.",
    });
  }

  const appt = await prisma.appointment.findFirst({
    where: { id: appointmentId, accountId: account.id },
    select: {
      id: true,
      tenantId: true,
      branchId: true,
      status: true,
      requestedAt: true,
      estimatedDurationMinutes: true,
      serviceOrderId: true,
    },
  });
  if (!appt) throw new AppointmentCommandError("Цаг захиалга олдсонгүй.", 404, "APPOINTMENT_NOT_FOUND");
  if (appt.status !== "PENDING" && appt.status !== "CONFIRMED") {
    throw new AppointmentCommandError("Энэ цагийг шилжүүлэх боломжгүй.", 422, "APPOINTMENT_NOT_ELIGIBLE");
  }
  if (appt.serviceOrderId) {
    throw new AppointmentCommandError(
      "Энэ цагт засварын хуудас нээгдсэн тул онлайнаар шилжүүлэх боломжгүй. Байгууллагатай холбогдоно уу.",
      422,
      "LINKED_ORDER_EXISTS",
    );
  }

  const { withBookingTransaction } = await import("@/lib/prisma");
  await withBookingTransaction(appt.tenantId, (tx) =>
    moveAppointmentInTransaction(tx, {
      tenantId: appt.tenantId,
      branchId: appt.branchId,
      appointmentId: appt.id,
      requestedAt,
      allowedStatuses: ["PENDING", "CONFIRMED"],
    }),
  );

  await logAudit({
    tenantId: appt.tenantId,
    branchId: appt.branchId,
    entity: "Appointment",
    entityId: appt.id,
    action: "UPDATE",
    summary: "Хэрэглэгч цагаа шилжүүлэв",
    before: { requestedAt: appt.requestedAt.toISOString() },
    after: { requestedAt: requestedAt.toISOString() },
  });

  return { appointmentId: appt.id };
}

export { ReservationError, LinkedRescheduleError };
