"use server";

import { revalidatePath } from "next/cache";
import { redirect, unstable_rethrow } from "next/navigation";
import { logAudit } from "@/lib/audit";
import { requireUser } from "@/lib/auth";
import { type BulkActionState, parseIdsJson } from "@/lib/bulk-action";
import { createNotification } from "@/lib/notifications";
import {
  canCreate,
  canDelete,
  canEdit,
  hasPermission,
  workingBranchScopeId,
} from "@/lib/auth/roles";
import { assertActiveSubscription } from "@/lib/subscription-server";
import {
  ACTION_GENERIC_ERROR_MESSAGE,
  knownAuthorizationMessage,
  logUnexpectedActionError,
} from "@/lib/action-errors";
import { parseDurationInput } from "@/lib/category-duration";
import { parseIntakeInput } from "@/lib/orders/order-intake-server";
import {
  closeOpenOrderTimeBooking,
  openOrderTimeBooking,
  updateOpenOrderTimeBookingSchedule,
  withOrderTransaction,
} from "@/lib/order-time-booking";
import {
  validateScheduledOrderHours,
} from "@/lib/order-schedule-validation";
import {
  ORDER_STATUSES,
  SERVICE_ITEM_STATUSES,
  isOrderLocked,
  type ItemKind,
  type OrderStatus,
  type ServiceItemStatus,
} from "@/lib/orders";
import { prisma, type PrismaTransactionClient } from "@/lib/prisma";
import { parseBusinessLocalDateTime } from "@/lib/booking-time";
import { DEFAULT_SLOT_MINUTES } from "@/lib/appointment-slots";
import { safeNext } from "@/lib/safe-redirect";
import {
  canEditOrder,
  canAssignOrders,
} from "@/lib/auth/order-access";
import {
  assignOrderCommand,
  changeOrderStatusCommand,
  deleteOrderCommand,
  OrderCommandError,
  validateOrderAssignee,
} from "@/lib/orders/order-commands";
import { createOrderCommand } from "@/lib/orders/order-create-command";
import { internalHasPaymentsViolation, internalPostpaidConflict, resolveUpdatedIsPostpaid } from "@/lib/orders/order-internal";
import {
  addOrderItemCommand,
  cancelOrderItemCommand,
  changeOrderItemPriceCommand,
  changeOrderItemStatusCommand,
} from "@/lib/orders/order-item-commands";
import {
  reviseExpectedFinishCommand,
  rescheduleOrderCommand,
  OrderScheduleCommandError,
} from "@/lib/orders/order-schedule-commands";
import { parseNonNegativeDecimal } from "@/lib/decimal-input";

export type OrderActionState = {
  ok: boolean;
  message?: string;
  fieldErrors?: Record<string, string>;
} | null;

// Захиалгын bulk action-уудын (статус солих, хариуцагч оноох) үр дүнгийн
// хэлбэр — `lib/bulk-action.ts`-ийн нийтлэг хэлбэрийн alias (импортлогч
// талуудын нэрийг өөрчлөхгүйн тулд).
export type BulkOrderActionState = BulkActionState;

// S06 fix: validation that happens INSIDE a withOrderTransaction lock (i.e.
// against the freshly re-read row, not any earlier pre-lock read) throws this
// instead of returning early, so it can carry fieldErrors back out through
// the transaction boundary. Plain Error still works for messages alone.
class OrderActionValidationError extends Error {
  fieldErrors?: Record<string, string>;
  constructor(message: string, fieldErrors?: Record<string, string>) {
    super(message);
    this.fieldErrors = fieldErrors;
  }
}

const ORDER_EDIT_FORBIDDEN_MESSAGE = "Танд засварын хуудсанд энэ үйлдэл хийх эрх байхгүй.";

// The only message this file can throw that the shared seam does not already
// know about. `SUBSCRIPTION_LOCKED_MESSAGE` is not listed here on purpose — see
// `lib/action-errors.ts`; it is unconditional there so it cannot be forgotten.
const ORDER_ACTION_KNOWN_MESSAGES = [ORDER_EDIT_FORBIDDEN_MESSAGE] as const;

function orderActionErrorResult(e: unknown): OrderActionState {
  if (e instanceof OrderCommandError) {
    return { ok: false, message: e.message || undefined, fieldErrors: e.fieldErrors };
  }
  if (e instanceof OrderActionValidationError) {
    return { ok: false, message: e.message || undefined, fieldErrors: e.fieldErrors };
  }
  const knownMessage = knownAuthorizationMessage(e, ORDER_ACTION_KNOWN_MESSAGES);
  if (knownMessage) return { ok: false, message: knownMessage };
  logUnexpectedOrderActionError("action", e);
  return { ok: false, message: ACTION_GENERIC_ERROR_MESSAGE };
}

function logUnexpectedOrderActionError(label: string, error: unknown): void {
  logUnexpectedActionError(`orders:${label}`, error);
}

function s(fd: FormData, key: string): string {
  const v = fd.get(key);
  return typeof v === "string" ? v.trim() : "";
}

const parseDecimal = parseNonNegativeDecimal;

async function authorize(action: "create" | "edit" | "delete") {
  const user = await requireUser();
  const ok =
    action === "create"
      ? canCreate(user, "orders")
      : action === "edit"
        ? canEdit(user, "orders")
        : canDelete(user, "orders");
  if (!ok) {
    throw new Error(ORDER_EDIT_FORBIDDEN_MESSAGE);
  }
  await assertActiveSubscription(user.tenantId);
  return user;
}

async function authorizeAssign() {
  const user = await requireUser();
  if (!canAssignOrders(user)) {
    throw new Error("Танд захиалгад хариуцагч оноох эрх байхгүй.");
  }
  await assertActiveSubscription(user.tenantId);
  return user;
}

// Салбараар хязгаарлагдсан ажилтан зөвхөн өөрийн салбарын захиалгыг
// удирдана — createOrderAction/updateOrderAction-д аль хэдийн байсан адил
// шалгалт, бусад бүх захиалгын action-д мөн адилхан хэрэглэнэ (өмнө нь зөвхөн
// tenantId шалгадаг байсан тул өөр салбарын захиалгын ID мэдвэл салбарын
// хязгаарлалтыг тойрч болдог байсан цоорхой — appointments.ts-ийн
// assertStaffScope-той адил зарчим).
function assertOrderBranchScope(
  user: Awaited<ReturnType<typeof requireUser>>,
  branchId: string,
) {
  const scope = workingBranchScopeId(user);
  if (scope && branchId !== scope) {
    throw new OrderScheduleCommandError("Зөвхөн өөрийн салбарын засварын хуудсыг удирдана.", 404, "ORDER_OUT_OF_SCOPE");
  }
}

async function assertOrderEditAccess(user: Awaited<ReturnType<typeof requireUser>>, id: string) {
  const order = await prisma.serviceOrder.findFirst({
    where: { id, tenantId: user.tenantId }, select: { assignedToId: true, branchId: true },
  });
  if (!order) throw new OrderScheduleCommandError("Засварын хуудас олдсонгүй.", 404, "ORDER_NOT_FOUND");
  assertOrderBranchScope(user, order.branchId);
  if (!canEditOrder(user, order)) throw new OrderScheduleCommandError("Танд энэ засварын хуудсыг засах эрх байхгүй.", 403, "ORDER_EDIT_FORBIDDEN");
}

// Захиалгын товлосон огноо шилжсэнийг холбогдох цаг захиалгын account-д
// мэдэгдэнэ — reviseExpectedFinishAction-ийн expected_finish_revised-тэй адил
// зарчим: анхны товлолт (previous == null) мэдэгдэхгүй, зөвхөн цуцлагдаагүй/
// ирээгүй биш (PENDING/CONFIRMED) идэвхтэй цаг захиалгын account-д л илгээнэ
// (харах: reviseExpectedFinishAction-д олдсон "цуцалсан цагт мэдэгдэх" алдаа).
async function notifyOrderRescheduled(
  appointment: { id: string; accountId: string | null; status: string } | null,
  previous: Date | null,
  next: Date,
): Promise<void> {
  if (!previous || previous.getTime() === next.getTime()) return;
  if (!appointment?.accountId) return;
  const isActive = appointment.status === "PENDING" || appointment.status === "CONFIRMED";
  if (!isActive) return;
  try {
    await createNotification({
      type: "order_rescheduled",
      recipient: { accountId: appointment.accountId },
      input: { appointmentId: appointment.id },
    });
  } catch (e) {
    console.warn("[notify] order_rescheduled:", e);
  }
}

// Мөрийн явц өөрчлөх нь орлогын хуудсанд ерөнхий засах эрхээс тусдаа,
// `orders.itemStatus` тусгай эрхээр хамгаалагдана (харах: lib/auth/permissions.ts).
async function authorizeItemStatus() {
  const user = await requireUser();
  if (!hasPermission(user, "orders.itemStatus")) {
    throw new Error("Танд үйлчилгээний мөрийн явц өөрчлөх эрх байхгүй.");
  }
  await assertActiveSubscription(user.tenantId);
  return user;
}

// Мөрийн үнэ өөрчлөх нь орлогын хуудсанд ерөнхий засах эрхээс тусдаа,
// `orders.itemPrice` тусгай эрхээр хамгаалагдана (харах: lib/auth/permissions.ts).
// Шинэ мөр гараар нэмэхэд (addOrderItemAction) хамаарахгүй — тэр endpoint нь
// ердийн `orders.edit`-ээр л хамгаалагдсан хэвээр байна.
async function authorizeItemPrice() {
  const user = await requireUser();
  if (!hasPermission(user, "orders.itemPrice")) {
    throw new Error("Танд үйлчилгээний мөрийн үнэ өөрчлөх эрх байхгүй.");
  }
  await assertActiveSubscription(user.tenantId);
  return user;
}

// --- CREATE ---------------------------------------------------------------

type OrderInput = {
  branchId: string;
  customerId: string;
  vehicleId: string;
  assignedToId: string | null;
  scheduledAt: Date | null;
  notes: string | null;
};

// "Дараа тооцоо" checkbox: the form always sends the marker field so an
// unchecked box is an explicit false (not "omitted → derive from vehicle").
function parseIsPostpaid(fd: FormData): boolean | undefined {
  if (!fd.has("isPostpaidField")) return undefined;
  return fd.get("isPostpaid") === "on";
}

// "Дотоод засвар" checkbox — same marker convention as isPostpaid.
function parseIsInternal(fd: FormData): boolean | undefined {
  if (!fd.has("isInternalField")) return undefined;
  return fd.get("isInternal") === "on";
}

function parseOrderInput(fd: FormData): {
  data: OrderInput;
  errors: Record<string, string>;
} {
  const branchId = s(fd, "branchId");
  const customerId = s(fd, "customerId");
  const vehicleId = s(fd, "vehicleId");
  const assignedToId = s(fd, "assignedToId");
  const scheduledRaw = s(fd, "scheduledAt");
  const notes = s(fd, "notes");

  const errors: Record<string, string> = {};
  if (!branchId) errors.branchId = "Салбар сонгоно уу.";
  if (!customerId) errors.customerId = "Үйлчлүүлэгчээ сонгоно уу.";
  if (!vehicleId) errors.vehicleId = "Машинаа сонгоно уу.";

  let scheduledAt: Date | null = null;
  if (scheduledRaw) {
    const d = parseBusinessLocalDateTime(scheduledRaw);
    if (!Number.isFinite(d.getTime())) {
      errors.scheduledAt = "Огноо буруу.";
    } else {
      scheduledAt = d;
    }
  }

  return {
    data: {
      branchId,
      customerId,
      vehicleId,
      assignedToId: assignedToId || null,
      scheduledAt,
      notes: notes || null,
    },
    errors,
  };
}

async function validateOrderUpdateRefs(tenantId: string, data: OrderInput) {
  const [branch, customer, vehicle, assignee] = await Promise.all([
    prisma.branch.findFirst({
      where: { id: data.branchId, tenantId },
      select: { id: true, slotMinutes: true },
    }),
    prisma.customer.findFirst({
      where: { id: data.customerId, tenantId },
      select: { id: true },
    }),
    prisma.tenantVehicle.findUnique({
      where: { tenantId_vehicleId: { tenantId, vehicleId: data.vehicleId } },
      select: { customerId: true, isPostpaid: true, vehicle: { select: { plate: true, vin: true } } },
    }),
    data.assignedToId
      ? prisma.user.findFirst({ where: { id: data.assignedToId, tenantId }, select: { id: true } })
      : Promise.resolve(null),
  ]);
  const errors: Record<string, string> = {};
  if (!branch) errors.branchId = "Салбар олдсонгүй.";
  if (!customer) errors.customerId = "Үйлчлүүлэгч олдсонгүй.";
  if (data.assignedToId && !assignee) errors.assignedToId = "Ажилтан олдсонгүй.";
  if (vehicle && vehicle.customerId !== data.customerId) {
    errors.vehicleId = "Энэ машин сонгосон үйлчлүүлэгчийнх биш.";
  } else if (!vehicle) {
    errors.vehicleId = "Машин олдсонгүй.";
  }
  return {
    errors,
    vehicleIsPostpaid: vehicle?.isPostpaid ?? false,
    vehicleSnapshot: {
      plateSnapshot: vehicle?.vehicle.plate ?? null,
      vinSnapshot: vehicle?.vehicle.vin ?? null,
    },
    branchSlotMinutes: branch?.slotMinutes && branch.slotMinutes > 0 ? branch.slotMinutes : DEFAULT_SLOT_MINUTES,
  };
}

export async function createOrderAction(
  _prev: OrderActionState,
  formData: FormData,
): Promise<OrderActionState> {
  let user;
  try {
    user = await authorize("create");
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Алдаа" };
  }

  const { data, errors } = parseOrderInput(formData);
  if (!canAssignOrders(user)) {
    if (data.assignedToId && data.assignedToId !== user.id) {
      return { ok: false, message: "Зөвхөн өөрийгөө хариуцагчаар оноож болно." };
    }
    data.assignedToId = user.id;
  }
  if (!data.assignedToId) errors.assignedToId = "Хариуцах мастер сонгоно уу.";
  // QA #14: хүлээн авах хэсэг зөвхөн энд (үүсгэх үед) бичигдэнэ; update нь
  // OrderInput-оор дамждаг тул түүнийг хэзээ ч өөрчлөхгүй.
  const { intake, error: intakeError } = await parseIntakeInput(formData, user.tenantId, user.id);
  if (intakeError) errors.intake = intakeError;

  const appointmentId = s(formData, "appointmentId") || null;
  let estimatedDurationMinutes: number | null = null;
  if (!appointmentId) {
    const durationParse = parseDurationInput(
      s(formData, "durationHours"),
      s(formData, "durationMinutes"),
    );
    if (durationParse.ok) {
      estimatedDurationMinutes = durationParse.minutes;
    } else {
      errors.durationMinutes = durationParse.error;
    }
  }
  if (Object.keys(errors).length > 0) {
    return { ok: false, fieldErrors: errors };
  }

  const scope = workingBranchScopeId(user);
  try {
    const created = await createOrderCommand({
      tenantId: user.tenantId,
      actorId: user.id,
      branchId: data.branchId,
      customerId: data.customerId,
      vehicleId: data.vehicleId,
      assignedToId: data.assignedToId,
      scheduledAt: data.scheduledAt,
      notes: data.notes,
      intake,
      appointmentId,
      estimatedDurationMinutes,
      workingBranchId: scope,
      isPostpaid: parseIsPostpaid(formData),
      isInternal: parseIsInternal(formData),
    });

    if (appointmentId) {
      revalidatePath("/dashboard/appointments");
    }
    revalidatePath("/dashboard/orders");
    revalidatePath("/dashboard");
    redirect(safeNext(s(formData, "next"), "/dashboard/orders/" + created.id));
  } catch (e) {
    // `redirect()` above signals by throwing. Without this the success path is
    // caught here and reported as a server error, after the order has already
    // been created. Must stay the first statement in the catch.
    unstable_rethrow(e);
    if (e instanceof OrderCommandError) {
      return { ok: false, message: e.message || undefined, fieldErrors: e.fieldErrors };
    }
    logUnexpectedOrderActionError("create", e);
    return { ok: false, message: "Серверийн алдаа гарлаа. Дахин оролдоно уу." };
  }
}
// --- UPDATE (info only — status өөр action-аар солино) -------------------

export async function updateOrderAction(
  id: string,
  _prev: OrderActionState,
  formData: FormData,
): Promise<OrderActionState> {
  let user;
  try {
    user = await authorize("edit");
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Алдаа" };
  }

  const { data, errors } = parseOrderInput(formData);
  if (Object.keys(errors).length > 0) {
    return { ok: false, fieldErrors: errors };
  }

  const { errors: refErrors, vehicleIsPostpaid, vehicleSnapshot, branchSlotMinutes } = await validateOrderUpdateRefs(
    user.tenantId,
    data,
  );
  if (Object.keys(refErrors).length > 0) {
    return { ok: false, fieldErrors: refErrors };
  }

  // Салбараар хязгаарлагдсан ажилтан өөр салбарын захиалгыг засах / өөр
  // салбар руу шилжүүлэх боломжгүй.
  const scope = workingBranchScopeId(user);
  if (scope && data.branchId !== scope) {
    return {
      ok: false,
      fieldErrors: { branchId: "Зөвхөн өөрийн салбарын засварын хуудсыг засах боломжтой." },
    };
  }
  const scopedOrderWhere = {
    id,
    tenantId: user.tenantId,
    ...(scope ? { branchId: scope } : {}),
  };

  const existing = await prisma.serviceOrder.findFirst({
    where: scopedOrderWhere,
    select: {
      status: true,
      scheduledAt: true,
      estimatedDurationMinutes: true,
      assignedToId: true,
      appointment: { select: { id: true, accountId: true, status: true } },
    },
  });
  if (!existing) {
    return { ok: false, message: "Засварын хуудас олдсонгүй." };
  }
  if (!canAssignOrders(user) && data.assignedToId !== existing.assignedToId) {
    return { ok: false, message: "Зөвхөн orders.assign эрхтэй хэрэглэгч хариуцагч өөрчилж болно." };
  }
  if (isOrderLocked(existing.status as OrderStatus)) {
    return {
      ok: false,
      message: "Дууссан / цуцлагдсан засварын хуудасны мэдээллийг засаж болохгүй.",
    };
  }

  const scheduledHoursError = await validateScheduledOrderHours(
    prisma,
    user.tenantId,
    data.branchId,
    data.scheduledAt,
    existing.estimatedDurationMinutes ?? branchSlotMinutes,
  );
  if (scheduledHoursError) {
    return { ok: false, fieldErrors: { scheduledAt: scheduledHoursError } };
  }

  // Товлосон огноог өөрчилж байгаа бөгөөд захиалга хараахан эхлээгүй (эсвэл
  // хойшлогдсон ч товлосон огноогоороо тооцогддог) үед л давхцлыг шалгана —
  // reviseExpectedFinishAction-той адил, зөвхөн анхааруулга, хатуу хориглол
  // биш (D-хугацааны шийдвэр, COWORK.md-г үз).
  const scheduledChanged =
    data.scheduledAt != null &&
    (existing.scheduledAt == null ||
      data.scheduledAt.getTime() !== existing.scheduledAt.getTime());
  // D-111: schedule-overlap warning removed here too — see createOrderAction.

  try {
    // S06 fix: lock the row, re-read it fresh, re-validate against THAT
    // state (not the pre-lock `existing` above), then write — all under one
    // lock so a concurrent status change/cancel can't land between our
    // validation and our write. Машин солигдож болзошгүй тул дараа төлбөрт
    // snapshot-ыг дахин тооцно.
    const updated = await withOrderTransaction(
      user.tenantId,
      id,
      { status: true, scheduledAt: true, estimatedDurationMinutes: true, branchId: true, assignedToId: true, vehicleId: true, isInternal: true },
      async (tx, freshRaw) => {
        const fresh = freshRaw as {
          status: OrderStatus;
          scheduledAt: Date | null;
          estimatedDurationMinutes: number | null;
          branchId: string;
          assignedToId: string | null;
          vehicleId: string;
          isInternal: boolean;
        } | null;
        if (!fresh || (scope && fresh.branchId !== scope)) {
          throw new OrderActionValidationError("Засварын хуудас олдсонгүй.");
        }
        if (isOrderLocked(fresh.status as OrderStatus)) {
          throw new OrderActionValidationError(
            "Дууссан / цуцлагдсан засварын хуудасны мэдээллийг засаж болохгүй.",
          );
        }
        if (!canEditOrder(user, fresh)) {
          throw new OrderActionValidationError("Танд энэ засварын хуудсыг засах эрх байхгүй.");
        }
        if (!canAssignOrders(user) && data.assignedToId !== fresh.assignedToId) {
          throw new OrderActionValidationError("Зөвхөн orders.assign эрхтэй хэрэглэгч хариуцагч өөрчилж болно.");
        }
        // Хариуцах мастер заавал: оноосон мастерыг арилгахгүй; оноох эрхтэй бол
        // мастергүй хуучин хуудсанд ч сонгуулна.
        if (!data.assignedToId && (fresh.assignedToId || canAssignOrders(user))) {
          throw new OrderActionValidationError("Хариуцах мастер сонгоно уу.", { assignedToId: "Хариуцах мастер сонгоно уу." });
        }
        // Хариуцагч эсвэл салбар өөрчлөгдсөн үед л шалгана — эс бөгөөс дараа нь
        // ажлаас гарсан / хугацаа дууссан мастертай хуучин хуудсыг засаж чадахгүй.
        if (
          data.assignedToId &&
          (data.assignedToId !== fresh.assignedToId || data.branchId !== fresh.branchId)
        ) {
          await validateOrderAssignee(tx, {
            tenantId: user.tenantId,
            assigneeId: data.assignedToId,
            orderBranchId: data.branchId,
          });
        }
        const vehicleChanged = fresh.vehicleId !== data.vehicleId;
        const explicitPostpaid = parseIsPostpaid(formData);
        const explicitInternal = parseIsInternal(formData);
        const nextInternal = explicitInternal ?? fresh.isInternal;
        const conflict = internalPostpaidConflict(nextInternal, explicitPostpaid);
        if (conflict) {
          throw new OrderActionValidationError(conflict.message, {
            isInternal: conflict.message,
            isPostpaid: conflict.message,
          });
        }
        if (explicitInternal === true && !fresh.isInternal) {
          const paidRow = await tx.orderPayment.findFirst({
            where: { orderId: id, tenantId: user.tenantId, status: "PAID" },
            select: { id: true },
          });
          const violation = internalHasPaymentsViolation(explicitInternal, fresh.isInternal, Boolean(paidRow));
          if (violation) throw new OrderActionValidationError(violation.message, { isInternal: violation.message });
        }
        // Дотоод захиалгад машин солигдоход дараа тооцоог дахин идэвхжүүлэхгүй.
        const nextPostpaid = resolveUpdatedIsPostpaid({
          nextIsInternal: nextInternal,
          explicitPostpaid,
          vehicleChanged,
          vehicleIsPostpaid,
        });
        const freshScheduledChanged =
          (fresh.scheduledAt?.getTime() ?? null) !== (data.scheduledAt?.getTime() ?? null);
        const result = await tx.serviceOrder.updateMany({
          where: scopedOrderWhere,
          data: {
            ...data,
            ...(nextPostpaid !== undefined ? { isPostpaid: nextPostpaid } : {}),
            ...(explicitInternal !== undefined ? { isInternal: explicitInternal } : {}),
            ...(vehicleChanged ? vehicleSnapshot : {}),
            ...(fresh.status === "SCHEDULED" && freshScheduledChanged
              ? { occupiesCapacity: data.scheduledAt != null }
              : {}),
          },
        });
        // D-068 dual-write: scheduledAt only actually drives the SCHEDULED-phase
        // booking (resolveOrderEffectiveInterval ignores it once work has
        // started, using startedAt instead) — only update the open booking here
        // when it's still that phase, in place, not a phase transition.
        if (result.count > 0 && fresh.status === "SCHEDULED" && freshScheduledChanged && data.scheduledAt) {
          const durationMinutes = fresh.estimatedDurationMinutes ?? branchSlotMinutes;
          const openScheduled = await tx.orderTimeBooking.findFirst({
            where: { orderId: id, closedAt: null, kind: "SCHEDULED" },
            select: { id: true },
          });
          if (openScheduled) {
            await updateOpenOrderTimeBookingSchedule(tx, id, {
              startAt: data.scheduledAt,
              endAt: new Date(data.scheduledAt.getTime() + durationMinutes * 60000),
            });
          } else {
            await openOrderTimeBooking(tx, {
              tenantId: user.tenantId,
              orderId: id,
              branchId: data.branchId,
              kind: "SCHEDULED",
              startAt: data.scheduledAt,
              endAt: new Date(data.scheduledAt.getTime() + durationMinutes * 60000),
              createdById: user.id,
            });
          }
        } else if (result.count > 0 && fresh.status === "SCHEDULED" && freshScheduledChanged) {
          await closeOpenOrderTimeBooking(tx, id, new Date(), "SCHEDULED");
        }
        return result;
      },
    );
    if (updated.count === 0) {
      return { ok: false, message: "Засварын хуудас олдсонгүй." };
    }
  } catch (e) {
    return orderActionErrorResult(e);
  }

  await logAudit({
    tenantId: user.tenantId,
    userId: user.id,
    entity: "ServiceOrder",
    entityId: id,
    action: "UPDATE",
    summary: "Засварын хуудасны мэдээлэл шинэчлэв",
    after: {
      branchId: data.branchId,
      customerId: data.customerId,
      vehicleId: data.vehicleId,
      assignedToId: data.assignedToId,
      scheduledAt: data.scheduledAt?.toISOString() ?? null,
    },
  });

  if (scheduledChanged) {
    await notifyOrderRescheduled(existing.appointment, existing.scheduledAt, data.scheduledAt!);
  }

  revalidatePath("/dashboard/orders");
  revalidatePath(`/dashboard/orders/${id}`);
  return { ok: true, message: "Засварын хуудас шинэчлэгдлээ." };
}

// --- STATUS CHANGE --------------------------------------------------------

/**
 * `changeOrderStatusAction` (ганц захиалга) БОЛОН `bulkChangeOrderStatusAction`
 * (олноор сонгосон) хоёулаа энэ цөм логикийг дуудна — S06 fix-ийн шинжийг
 * (нэг row lock дотор шалгаад бичих) хадгалж, хоёр action хооронд давхардуулж
 * бичихээс сэргийлнэ. `duration`-г зөвхөн ганц захиалгын урсгал (formData-аас)
 * дамжуулна — bulk урсгалд IN_PROGRESS-д шилжихдээ хугацаа автоматаар
 * тооцоологдоогүй захиалгыг зүгээр л алгасна (доор bulkChangeOrderStatusAction).
 */
export async function changeOrderStatusAction(
  _prev: OrderActionState,
  formData: FormData,
): Promise<OrderActionState> {
  let user;
  try {
    user = await authorize("edit");
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Алдаа" };
  }
  const id = s(formData, "id");
  const next = s(formData, "status") as OrderStatus;
  if (!id || !next) return { ok: false, message: "Буруу хүсэлт." };

  try {
    await changeOrderStatusCommand({
      actor: user,
      orderId: id,
      nextStatus: next,
      duration: {
        hours: s(formData, "durationHours"),
        minutes: s(formData, "durationMinutes"),
      },
    });
  } catch (e) {
    return orderActionErrorResult(e);
  }

  revalidatePath("/dashboard/orders");
  revalidatePath(`/dashboard/orders/${id}`);
  revalidatePath("/dashboard");
  return { ok: true, message: "Статус шинэчлэгдлээ." };
}

/**
 * Жагсаалтын хуудсанд олноор сонгосон захиалгын статусыг нэг зэрэг
 * өөрчилнэ. All-or-nothing БИШ — захиалга бүрийг тус тусад нь (өөрийн row
 * lock-тойгоор) `applyOrderStatusChange`-аар боловсруулж, амжилтгүй болсон
 * нь (жишээ нь буруу шилжилт, бөглөгдөөгүй оношилгоотой, эсвэл IN_PROGRESS
 * рүү орохдоо хугацаа автоматаар тооцоологдоогүй) бусдыг зогсоохгүй —
 * зөвхөн тухайн мөрийг алгасаж, эцэст нь алдааны жагсаалтаар мэдээлнэ.
 */
export async function bulkChangeOrderStatusAction(
  _prev: BulkOrderActionState,
  formData: FormData,
): Promise<BulkOrderActionState> {
  let user;
  try {
    user = await authorize("edit");
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Алдаа" };
  }
  const next = s(formData, "status") as OrderStatus;
  if (!next || !(ORDER_STATUSES as readonly string[]).includes(next)) {
    return { ok: false, message: "Статус сонгоно уу." };
  }
  const ids = parseIdsJson(s(formData, "orderIdsJson"));
  if (ids.length === 0) return { ok: false, message: "Дор хаяж нэг захиалга сонгоно уу." };

  const orders = await prisma.serviceOrder.findMany({
    where: { id: { in: ids }, tenantId: user.tenantId },
    select: { id: true, number: true },
  });
  const numberById = new Map(orders.map((o) => [o.id, o.number]));

  let succeeded = 0;
  const errors: string[] = [];
  for (const id of ids) {
    try {
      await changeOrderStatusCommand({
        actor: user,
        orderId: id,
        nextStatus: next,
      });
      succeeded++;
    } catch (e) {
      const label = numberById.get(id) ? `#${numberById.get(id)}` : id;
      if (e instanceof OrderCommandError) {
        errors.push(`${label}: ${e.message}`);
      } else {
        logUnexpectedOrderActionError("bulk-status", e);
        errors.push(`${label}: Серверийн алдаа гарлаа.`);
      }
    }
  }

  revalidatePath("/dashboard/orders");
  revalidatePath("/dashboard");

  if (succeeded === 0) {
    return {
      ok: false,
      message: errors[0] ?? "Статус шинэчлэхэд алдаа гарлаа.",
      succeeded,
      failed: errors.length,
      errors,
    };
  }
  return {
    ok: true,
    message: `${succeeded}/${ids.length} захиалгын статус шинэчлэгдлээ.${
      errors.length ? ` (${errors.length} амжилтгүй)` : ""
    }`,
    succeeded,
    failed: errors.length,
    errors,
  };
}

/**
 * Жагсаалтын хуудсанд олноор сонгосон захиалгад нэг зэрэг хариуцагч оноох.
 * `orders.assign` эрх нь bulk assignment-д заавал шаардлагатай.
 * All-or-nothing биш — захиалга бүрийг тус тусад нь шалгаж бичнэ.
 */
export async function bulkAssignOrderAction(
  _prev: BulkOrderActionState,
  formData: FormData,
): Promise<BulkOrderActionState> {
  let user;
  try {
    user = await authorizeAssign();
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Алдаа" };
  }
  const ids = parseIdsJson(s(formData, "orderIdsJson"));
  if (ids.length === 0) return { ok: false, message: "Дор хаяж нэг захиалга сонгоно уу." };

  const assignedToId: string | null = s(formData, "assignedToId") || null;

  const orders = await prisma.serviceOrder.findMany({
    where: { id: { in: ids }, tenantId: user.tenantId },
    select: { id: true, number: true },
  });
  const orderById = new Map(orders.map((o) => [o.id, o]));

  let succeeded = 0;
  const errors: string[] = [];
  for (const id of ids) {
    const order = orderById.get(id);
    const label = order ? `#${order.number}` : id;
    if (!order) {
      errors.push(`${label}: Засварын хуудас олдсонгүй.`);
      continue;
    }
    try {
      await assignOrderCommand({ actor: user, orderId: id, assignedToId });
      succeeded++;
    } catch (e) {
      if (e instanceof OrderCommandError) {
        errors.push(`${label}: ${e.message}`);
      } else {
        logUnexpectedOrderActionError("bulk-assign", e);
        errors.push(`${label}: Серверийн алдаа гарлаа.`);
      }
    }
  }

  revalidatePath("/dashboard/orders");
  revalidatePath("/dashboard");

  if (succeeded === 0) {
    return {
      ok: false,
      message: errors[0] ?? "Хариуцагч оноход алдаа гарлаа.",
      succeeded,
      failed: errors.length,
      errors,
    };
  }
  return {
    ok: true,
    message: `${succeeded}/${ids.length} захиалганд хариуцагч оноогдлоо.${
      errors.length ? ` (${errors.length} амжилтгүй)` : ""
    }`,
    succeeded,
    failed: errors.length,
    errors,
  };
}

// --- EXPECTED FINISH TIME (manual revision) --------------------------------

// Дуусах хугацааг тооцоолсноос хойш ажилтан гар аргаар засаж чадна (сэлбэг
// хүлээх, гэнэтийн ажил зэргээс шалтгаалан хойшлох тохиолдол) — анхны
// автомат тооцооллоос ялгаатай, дурын үедээ дуудагдана. Анхны утга анх
// тавигдахад (өмнө нь байгаагүй үед) мэдэгдэл илгээхгүй — зөвхөн ЗАСВАРЛАСАН
// (өөрчилсөн) үед л, ба ялгаа 15 минутаас бага бол чимээгүй алгасна (эргэлзээт
// бага зөрүүгээр үйлчлүүлэгчийг дэмий цочроохгүйн тулд).
export async function reviseExpectedFinishAction(
  _prev: OrderActionState,
  formData: FormData,
): Promise<OrderActionState> {
  let user;
  try {
    user = await authorize("edit");
  } catch (e) {
    return orderActionErrorResult(e);
  }
  const id = s(formData, "id");
  const expectedFinishRaw = s(formData, "expectedFinishAt");
  const confirmed = s(formData, "confirmed") === "true";
  if (!id) return { ok: false, message: "Буруу хүсэлт." };
  try {
    await assertOrderEditAccess(user, id);
  } catch (e) {
    if (e instanceof OrderScheduleCommandError) return { ok: false, message: e.message, fieldErrors: e.fieldErrors };
    console.error("[orders revise expected finish preflight]", e instanceof Error ? e.name : "UnknownError");
    return { ok: false, message: "Серверийн алдаа гарлаа. Дахин оролдоно уу." };
  }

  let expectedFinishAt: Date | null = null;
  if (expectedFinishRaw) {
    const d = parseBusinessLocalDateTime(expectedFinishRaw);
    if (!Number.isFinite(d.getTime())) {
      return { ok: false, fieldErrors: { expectedFinishAt: "Огноо буруу." } };
    }
    expectedFinishAt = d;
  }

  try {
    await reviseExpectedFinishCommand({
      actor: user,
      orderId: id,
      expectedFinishAt,
      confirmed,
    });
  } catch (e) {
    if (e instanceof OrderScheduleCommandError) {
      return { ok: false, message: e.message || undefined, fieldErrors: e.fieldErrors };
    }
    console.error("[orders revise expected finish]", e instanceof Error ? e.name : "UnknownError");
    return { ok: false, message: "Серверийн алдаа гарлаа. Дахин оролдоно уу." };
  }
  revalidatePath("/dashboard/orders");
  revalidatePath(`/dashboard/orders/${id}`);
  return { ok: true, message: "Дуусах хугацаа шинэчлэгдлээ." };

}

// --- RESCHEDULE (SCHEDULED захиалгын товлосон огноог гар аргаар шилжүүлэх) -

// Хуваарийн (schedule) харагдацаас шууд ашиглах хөнгөн үйлдэл — бүтэн
// засах маягт руу орохгүйгээр товлосон огноог л шилжүүлнэ. Зөвхөн SCHEDULED
// (хараахан эхлээгүй) захиалгад хамаатай — эхэлсэн ажлыг StatusControls-ийн
// "Дуусах хугацаа" (reviseExpectedFinishAction) удирддаг, энэ өөр зорилготой.
export async function rescheduleOrderAction(
  _prev: OrderActionState,
  formData: FormData,
): Promise<OrderActionState> {
  let user;
  try {
    user = await authorize("edit");
  } catch (e) {
    return orderActionErrorResult(e);
  }
  const id = s(formData, "id");
  const scheduledRaw = s(formData, "scheduledAt");
  const confirmed = s(formData, "confirmed") === "true";
  if (!id || !scheduledRaw) return { ok: false, message: "Буруу хүсэлт." };
  try {
    await assertOrderEditAccess(user, id);
  } catch (e) {
    if (e instanceof OrderScheduleCommandError) return { ok: false, message: e.message, fieldErrors: e.fieldErrors };
    console.error("[orders reschedule preflight]", e instanceof Error ? e.name : "UnknownError");
    return { ok: false, message: "Серверийн алдаа гарлаа. Дахин оролдоно уу." };
  }

  const scheduledAt = parseBusinessLocalDateTime(scheduledRaw);
  if (!Number.isFinite(scheduledAt.getTime())) {
    return { ok: false, fieldErrors: { scheduledAt: "Огноо буруу." } };
  }
  // S09: general order create/update reject a past time; direct reschedule did not.
  if (scheduledAt.getTime() < Date.now()) {
    return { ok: false, fieldErrors: { scheduledAt: "Өнгөрсөн цаг сонгох боломжгүй." } };
  }

  try {
    await rescheduleOrderCommand({
      actor: user,
      orderId: id,
      scheduledAt,
      confirmed,
    });
  } catch (e) {
    if (e instanceof OrderScheduleCommandError) {
      return { ok: false, message: e.message || undefined, fieldErrors: e.fieldErrors };
    }
    console.error("[orders reschedule]", e instanceof Error ? e.name : "UnknownError");
    return { ok: false, message: "Серверийн алдаа гарлаа. Дахин оролдоно уу." };
  }
  revalidatePath("/dashboard/orders");
  revalidatePath(`/dashboard/orders/${id}`);
  revalidatePath("/dashboard/appointments/calendar");
  revalidatePath("/dashboard/appointments");
  revalidatePath("/account");
  return { ok: true, message: "Товлосон огноо шилжлээ." };

}

export async function deleteOrderAction(formData: FormData): Promise<void> {
  const user = await authorize("delete");
  const id = s(formData, "id");
  if (!id) return;
  await deleteOrderCommand({ actor: user, orderId: id });
  revalidatePath("/dashboard/orders");
  revalidatePath("/dashboard");
  redirect("/dashboard/orders");
}

async function resolveOrderIdForItem(user: Awaited<ReturnType<typeof requireUser>>, itemId: string): Promise<string | null> {
  const item = await prisma.serviceItem.findFirst({
    where: { id: itemId, order: { tenantId: user.tenantId } },
    select: { orderId: true },
  });
  return item?.orderId ?? null;
}

export async function addOrderItemAction(orderId: string, _prev: OrderActionState, formData: FormData): Promise<OrderActionState> {
  let user;
  try { user = await authorize("edit"); } catch (e) { return { ok: false, message: e instanceof Error ? e.message : "Алдаа" }; }
  const serviceId = s(formData, "serviceId") || null;
  const diagnosticTemplateId = s(formData, "diagnosticTemplateId") || null;
  const quantity = parseDecimal(s(formData, "quantity") || "1");
  const unitPriceRaw = s(formData, "unitPrice");
  const unitPrice = unitPriceRaw ? parseDecimal(unitPriceRaw) : null;
  if (!quantity || quantity.lte(0)) return { ok: false, fieldErrors: { quantity: "Тоо хэмжээ буруу." } };
  if (unitPriceRaw && !unitPrice) return { ok: false, fieldErrors: { unitPrice: "Үнэ буруу." } };
  try {
    const created = await addOrderItemCommand({ actor: user, orderId, kind: s(formData, "kind") as ItemKind, description: s(formData, "description"), quantity, unitPrice, serviceId, diagnosticTemplateId });
    revalidatePath(`/dashboard/orders/${orderId}`);
    // Stock changes for goods/part lines; labor/diagnostic lines change the
    // service's "used" count (delete/archive gating). Narrow, non-layout paths only.
    if (created.serviceId) {
      revalidatePath(`/dashboard/services/${created.serviceId}`);
      revalidatePath(created.kind === "PART" ? "/dashboard/services/goods" : "/dashboard/services/labor");
    }
    return { ok: true };
  } catch (e) { return orderActionErrorResult(e); }
}

export async function cancelOrderItemAction(formData: FormData): Promise<void> {
  const user = await authorize("edit");
  const itemId = s(formData, "itemId");
  if (!itemId) return;
  const orderId = s(formData, "orderId") || await resolveOrderIdForItem(user, itemId);
  if (!orderId) return;
  const cancelled = await cancelOrderItemCommand({ actor: user, orderId, itemId });
  revalidatePath(`/dashboard/orders/${orderId}`);
  if (cancelled.serviceId) {
    revalidatePath("/dashboard/services", "layout");
    revalidatePath(`/dashboard/services/${cancelled.serviceId}`);
  }
}

export async function changeOrderItemStatusAction(formData: FormData): Promise<void> {
  const user = await authorizeItemStatus();
  const itemId = s(formData, "itemId");
  const next = s(formData, "status") as ServiceItemStatus;
  if (!itemId || !next || next === "CANCELLED" || !(SERVICE_ITEM_STATUSES as readonly string[]).includes(next)) return;
  const orderId = s(formData, "orderId") || await resolveOrderIdForItem(user, itemId);
  if (!orderId) return;
  await changeOrderItemStatusCommand({ actor: user, orderId, itemId, nextStatus: next as Exclude<ServiceItemStatus, "CANCELLED"> });
  revalidatePath(`/dashboard/orders/${orderId}`);
}

export async function changeOrderItemPriceAction(formData: FormData): Promise<void> {
  const user = await authorizeItemPrice();
  const itemId = s(formData, "itemId");
  const unitPrice = parseDecimal(s(formData, "unitPrice"));
  if (!itemId || !unitPrice || unitPrice.lte(0)) return;
  const orderId = s(formData, "orderId") || await resolveOrderIdForItem(user, itemId);
  if (!orderId) return;
  await changeOrderItemPriceCommand({ actor: user, orderId, itemId, unitPrice });
  revalidatePath(`/dashboard/orders/${orderId}`);
}
