import { canCreate, workingBranchScopeId } from "@/lib/auth/roles";
import { assertActiveSubscription } from "@/lib/subscription-server";
import { SUBSCRIPTION_LOCKED_MESSAGE } from "@/lib/subscription";
import { logAudit } from "@/lib/audit";
import { createNotification } from "@/lib/notifications";
import { buildAppointmentBookedByStaffBody } from "@/lib/appointments/appointment-booked-by-staff-notification";
import { prisma } from "@/lib/prisma";
import {
  reserveAppointment,
  ReservationConflictError,
  ReservationError,
} from "@/lib/appointment-reservations";
import { AppointmentCommandError, type AppointmentCommandActor } from "@/lib/appointments/appointment-commands";
import {
  assertCanSetAppointmentAssignee,
  throwAssigneeRejection,
  validateAppointmentAssignee,
} from "@/lib/appointments/appointment-assignee";
import { resolveCreateAssignee } from "@/lib/appointments/appointment-assignee-rule";
import { canAssignOrders } from "@/lib/auth/order-access";

export type RegisterAppointmentByStaffInput = {
  actor: AppointmentCommandActor;
  branchId: string;
  customerId: string;
  vehicleId?: string | null;
  requestedAt: Date;
  note: string | null;
  categoryIds: string[];
  confirmed?: boolean;
  /** QA #28: required for orders.assign users; others default to themselves. */
  assignedToId?: string | null;
};

export type RegisterAppointmentByStaffResult = {
  appointmentId: string;
};

/**
 * Staff phone-in registration. Mirrors the original `registerAppointmentByStaff`
 * action: no Account (phone-in), the tenant's Customer is assigned directly,
 * and the appointment is created CONFIRMED via `reserveAppointment` (shared
 * capacity/category/duration checks with the customer-facing reservation
 * path; staff alone may override a capacity-full slot after an explicit
 * `confirmed=true`, since a phone-in booking is a real physical exception a
 * staff member present at the branch can vouch for).
 */
export async function registerAppointmentByStaffCommand(
  input: RegisterAppointmentByStaffInput,
): Promise<RegisterAppointmentByStaffResult> {
  const { actor, branchId, customerId, requestedAt, note, categoryIds, confirmed = false } = input;
  const vehicleId = input.vehicleId || null;

  // Creation is intentionally a separate permission from editing an existing
  // appointment. The web action and API route both expose this operation as
  // `appointments.create`; requiring `appointments.edit` here made a
  // create-only staff role unable to use the documented registration flow.
  if (!canCreate(actor, "appointments")) {
    throw new AppointmentCommandError(
      "Танд цаг захиалга бүртгэх эрх байхгүй.",
      403,
      "APPOINTMENT_CREATE_FORBIDDEN",
    );
  }
  try {
    await assertActiveSubscription(actor.tenantId);
  } catch (error) {
    if (error instanceof Error && error.message === SUBSCRIPTION_LOCKED_MESSAGE) {
      throw new AppointmentCommandError(
        error.message,
        403,
        "SUBSCRIPTION_EXPIRED",
      );
    }
    throw error;
  }

  const scope = workingBranchScopeId(actor);
  if (scope && branchId !== scope) {
    throw new AppointmentCommandError(
      "Зөвхөн өөрийн салбарт бүртгэх боломжтой.",
      422,
      "OUT_OF_SCOPE",
      { branchId: "Зөвхөн өөрийн салбарт бүртгэх боломжтой." },
    );
  }

  // Same rule as order creation: master required (orders.assign users pick;
  // everyone else is assigned to themselves); others need `orders.assign`.
  const resolvedAssignee = resolveCreateAssignee({
    canAssign: canAssignOrders(actor),
    actorId: actor.id,
    requested: input.assignedToId,
  });
  if (!resolvedAssignee.ok) throwAssigneeRejection(resolvedAssignee);
  const assignedToId = resolvedAssignee.assigneeId;
  assertCanSetAppointmentAssignee(actor, assignedToId);

  const [branch, customer, vehicle] = await Promise.all([
    prisma.branch.findFirst({ where: { id: branchId, tenantId: actor.tenantId }, select: { id: true, name: true } }),
    prisma.customer.findFirst({
      where: { id: customerId, tenantId: actor.tenantId },
      select: { id: true, accountId: true },
    }),
    vehicleId
      ? prisma.tenantVehicle.findUnique({
          where: { tenantId_vehicleId: { tenantId: actor.tenantId, vehicleId } },
          select: { customerId: true },
        })
      : Promise.resolve(null),
  ]);
  if (!branch) {
    throw new AppointmentCommandError("Салбар олдсонгүй.", 422, "BRANCH_NOT_FOUND", { branchId: "Салбар олдсонгүй." });
  }
  if (!customer) {
    throw new AppointmentCommandError("Үйлчлүүлэгч олдсонгүй.", 422, "CUSTOMER_NOT_FOUND", {
      customerId: "Үйлчлүүлэгч олдсонгүй.",
    });
  }

  // Same ownership rule and wording as order creation
  // (lib/orders/order-create-references.ts).
  if (vehicleId && !vehicle) {
    throw new AppointmentCommandError("Машин олдсонгүй.", 422, "VEHICLE_NOT_FOUND", { vehicleId: "Машин олдсонгүй." });
  }
  if (vehicleId && vehicle?.customerId !== customerId) {
    throw new AppointmentCommandError("Энэ машин сонгосон үйлчлүүлэгчийнх биш.", 422, "VEHICLE_CUSTOMER_MISMATCH", {
      vehicleId: "Энэ машин сонгосон үйлчлүүлэгчийнх биш.",
    });
  }

  const uniqueCategoryIds = [...new Set(categoryIds)];
  let created;
  try {
    created = await reserveAppointment({
      tenantId: actor.tenantId,
      branchId,
      customerId,
      vehicleId,
      staffUserId: actor.id,
      // Bridges the phone-in booking to the customer's online Account (if
      // any), so it still shows up under "Миний захиалгууд".
      accountId: customer.accountId,
      categoryIds: uniqueCategoryIds,
      requestedAt,
      note: note || null,
      confirmed,
      assignedToId,
      // Eligibility is checked inside the booking transaction (row-locks the
      // assignee/role, exactly as order creation does).
      validateAssignee: (tx, assigneeBranchId) =>
        validateAppointmentAssignee(tx, { tenantId: actor.tenantId, assigneeId: assignedToId, branchId: assigneeBranchId }),
    });
  } catch (error) {
    if (error instanceof ReservationConflictError) {
      throw new AppointmentCommandError(error.message, 409, "RESERVATION_CONFLICT", { confirmNeeded: "true" });
    }
    if (error instanceof ReservationError) {
      throw new AppointmentCommandError(error.message, error.status, "RESERVATION_REJECTED");
    }
    throw error;
  }

  await logAudit({
    tenantId: actor.tenantId,
    userId: actor.id,
    branchId,
    entity: "Appointment",
    entityId: created.id,
    action: "CREATE",
    summary: "Утсаар цаг бүртгэсэн",
    after: { customerId, vehicleId, assignedToId, requestedAt: requestedAt.toISOString(), status: "CONFIRMED" },
  });

  // D-191: ажилтан утсаар бүртгэсэн ч энэ Customer нь онлайн Account-тай
  // холбоотой байвал (`customer.accountId`) тухайн хэрэглэгчид мэдэгдэнэ —
  // "Миний захиалгууд" хуудас нээлттэй байхад автоматаар шинэчлэгдэхийн тулд
  // (харах: customer app router.dart `_activeOnlyPushTypes`). Best-effort:
  // мэдэгдэл бичих/push илгээхэд алдаа гарсан ч захиалга буцаагдахгүй.
  if (customer.accountId) {
    try {
      await createNotification({
        type: "appointment_booked_by_staff",
        recipient: { accountId: customer.accountId },
        input: {
          appointmentId: created.id,
          body: buildAppointmentBookedByStaffBody(branch.name, requestedAt),
        },
      });
    } catch (e) {
      console.warn("[notify] registerAppointmentByStaffCommand:", e);
    }
  }

  return { appointmentId: created.id };
}
