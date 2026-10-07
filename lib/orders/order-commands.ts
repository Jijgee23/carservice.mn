import { Prisma } from "@/app/generated/prisma/client";
import { PAID_PAYMENT_LOCKED_ORDER_MESSAGE } from "@/lib/cash/locked-copy";
import { findLockedPaymentIds } from "@/lib/cash/session-attach";
import { createNotification } from "@/lib/notifications";
import { canAssignOrders, canEditOrder, type OrderAccessUser } from "@/lib/auth/order-access";
import { hasPermission, orderAssignableWhere } from "@/lib/auth/roles";
import { parseDurationInput, MIN_CATEGORY_DURATION_MINUTES, MAX_CATEGORY_DURATION_MINUTES } from "@/lib/category-duration";
import { calculateServiceItemDurationMinutes, type ServiceDurationItem } from "@/lib/service-duration";
import { closeOpenOrderTimeBooking, openOrderTimeBooking, withOrderTransaction } from "@/lib/order-time-booking";
import { logAudit } from "@/lib/audit";
import { deleteUpload } from "@/lib/storage";
import { postInternalRepairExpense, voidInternalRepairExpense } from "@/lib/cash/sync";
import { VOID_REASON_ORDER_CANCELLED, VOID_REASON_ORDER_DELETED, VOID_REASON_ORDER_REOPENED } from "@/lib/cash/rules";
import { prisma, type PrismaTransactionClient } from "@/lib/prisma";
import { recomputeOrderTotal } from "@/lib/orders/order-item-commands";
import { internalHasPaymentsViolation, internalPostpaidConflict } from "@/lib/orders/order-internal";
import { paidLedger } from "@/lib/orders/order-payment-totals";
import {
  ORDER_STATUS_TRANSITIONS,
  isOrderLocked,
  POSTPAID_CLOSE_FORBIDDEN_MESSAGE,
  POSTPAID_SETTLEMENT_FORBIDDEN_MESSAGE,
  type OrderStatus,
} from "@/lib/orders";
import { effectiveBranchScope } from "@/lib/cash/scope";

export type OrderCommandActor = OrderAccessUser & {
  tenantId: string;
  branchId?: string | null;
  assignableBranchIds?: string[];
  workingBranchId?: string | null;
};

export type OrderCommandScope = string | null | undefined;

export class OrderCommandError extends Error {
  constructor(
    message: string,
    public readonly status = 422,
    public readonly code = "ORDER_COMMAND_REJECTED",
    public readonly fieldErrors?: Record<string, string>,
  ) {
    super(message);
    this.name = "OrderCommandError";
  }
}

export type StatusCommandResult = {
  orderId: string;
  fromStatus: OrderStatus;
  toStatus: OrderStatus;
  statusChanged: boolean;
  previousAssignedToId?: string | null;
};

export type AssignmentCommandResult = {
  orderId: string;
  previousAssignedToId: string | null;
  assignedToId: string | null;
};

export function isOrderBranchInScope(
  actor: OrderCommandActor,
  branchId: string,
  scope?: OrderCommandScope,
): boolean {
  const resolved = effectiveBranchScope(actor, scope);
  return resolved == null || resolved === branchId;
}

export function isAllowedOrderStatusTransition(
  current: OrderStatus,
  next: OrderStatus,
): boolean {
  return Boolean(ORDER_STATUS_TRANSITIONS[current]?.includes(next));
}

export function hasRequestedStatusChange(nextStatus: OrderStatus | null | undefined): boolean {
  return nextStatus != null;
}

export function isActiveOrderNotificationAppointmentStatus(status: string | null | undefined): boolean {
  return status === "PENDING" || status === "CONFIRMED";
}

export function isStockBackedOrderItem(kind: string, serviceId: string | null | undefined): boolean {
  return kind === "PART" && Boolean(serviceId);
}

export function parseCommandDuration(
  durationMinutes: unknown,
): { ok: true; minutes: number | null } | { ok: false; error: string } {
  if (durationMinutes == null) return { ok: true, minutes: null };
  if (
    typeof durationMinutes !== "number" ||
    !Number.isInteger(durationMinutes) ||
    durationMinutes < MIN_CATEGORY_DURATION_MINUTES ||
    durationMinutes > MAX_CATEGORY_DURATION_MINUTES
  ) {
    return {
      ok: false,
      error: `Ажлыг эхлүүлэхийн өмнө хугацааг ${MIN_CATEGORY_DURATION_MINUTES}–${MAX_CATEGORY_DURATION_MINUTES} минутын бүхэл тоогоор оруулна уу.`,
    };
  }
  return { ok: true, minutes: durationMinutes };
}

export type AssigneeEligibilityInput = {
  isActive: boolean;
  deactivatedAt?: Date | null;
  activeUntil?: Date | null;
  verified?: boolean;
  tenantId: string;
  isOwner: boolean;
  branchId: string | null;
  assignableBranchIds: string[];
  firstName?: string | null;
  lastName?: string | null;
  role?: { permissions: string[]; isActive?: boolean } | null;
};

export function isAssigneeEligible(
  assignee: AssigneeEligibilityInput,
  tenantId: string,
  orderBranchId: string,
  now: Date = new Date(),
): boolean {
  if (!assignee.isActive || assignee.tenantId !== tenantId) return false;
  // Өөрөө хаасан эсвэл түр ажилтны хугацаа дууссан бол хариуцагч болохгүй.
  if (assignee.deactivatedAt) return false;
  // Идэвхжүүлээгүй (verified=false) ажилтныг оноохгүй; хуучин оноолтыг энэ хаахгүй.
  if (assignee.verified === false) return false;
  if (assignee.activeUntil && assignee.activeUntil.getTime() <= now.getTime()) return false;
  if (assignee.role?.isActive === false) return false;
  const assignableByRole =
    assignee.isOwner || Boolean(assignee.role?.permissions.includes("orders.assignable"));
  if (!assignableByRole) return false;
  return (
    assignee.branchId == null ||
    assignee.branchId === orderBranchId ||
    assignee.assignableBranchIds.includes(orderBranchId)
  );
}

export async function validateOrderAssignee(
  tx: PrismaTransactionClient,
  input: { tenantId: string; assigneeId: string; orderBranchId: string },
): Promise<AssigneeEligibilityInput & { id: string; firstName: string | null; lastName: string | null }> {
  const lockedAssignee = await tx.$queryRaw<{ id: string; roleId: string | null; verified: boolean }[]>`
    SELECT id, "roleId", verified FROM "User"
    WHERE id = ${input.assigneeId} AND "tenantId" = ${input.tenantId}
    FOR UPDATE
  `;
  if (lockedAssignee.length === 0) {
    throw new OrderCommandError("Сонгосон ажилтан олдсонгүй.", 422, "ASSIGNEE_INELIGIBLE");
  }
  if (lockedAssignee[0].verified === false) {
    throw new OrderCommandError(
      "Сонгосон ажилтан бүртгэлээ идэвхжүүлээгүй байна. Идэвхжүүлсэн мастер сонгоно уу.",
      422,
      "ASSIGNEE_INELIGIBLE",
    );
  }
  const roleId = lockedAssignee[0].roleId;
  if (roleId) {
    const lockedRole = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM "Role"
      WHERE id = ${roleId} AND "tenantId" = ${input.tenantId}
      FOR UPDATE
    `;
    if (lockedRole.length === 0) {
      throw new OrderCommandError("Сонгосон ажилтан энэ салбарт хариуцагч болж болохгүй.", 422, "ASSIGNEE_INELIGIBLE");
    }
  }
  const assignee = await tx.user.findFirst({
    where: { id: input.assigneeId, tenantId: input.tenantId, isActive: true, ...orderAssignableWhere() },
    select: {
      id: true,
      tenantId: true,
      isActive: true,
      deactivatedAt: true,
      activeUntil: true,
      verified: true,
      isOwner: true,
      branchId: true,
      assignableBranchIds: true,
      firstName: true,
      lastName: true,
      role: { select: { permissions: true, isActive: true } },
    },
  }) as (AssigneeEligibilityInput & { id: string; firstName: string | null; lastName: string | null }) | null;
  if (!assignee || !isAssigneeEligible(assignee, input.tenantId, input.orderBranchId)) {
    throw new OrderCommandError("Сонгосон ажилтан энэ салбарт хариуцагч болж болохгүй.", 422, "ASSIGNEE_INELIGIBLE");
  }
  return assignee;
}

function assertOrderScope(
  actor: OrderCommandActor,
  branchId: string,
  scope: OrderCommandScope,
): void {
  if (!isOrderBranchInScope(actor, branchId, scope)) {
    throw new OrderCommandError(
      "Зөвхөн өөрийн салбарын засварын хуудсыг удирдана.",
      404,
      "ORDER_OUT_OF_SCOPE",
    );
  }
}

function assertCanEdit(
  actor: OrderCommandActor,
  order: { assignedToId: string | null },
): void {
  if (!canEditOrder(actor, order)) {
    throw new OrderCommandError(
      "Танд энэ засварын хуудсыг засах эрх байхгүй.",
      403,
      "ORDER_EDIT_FORBIDDEN",
    );
  }
}

async function notifyOrderStatusChange(
  orderId: string,
  type: "order_completed" | "order_cancelled" | "order_in_progress",
): Promise<void> {
  try {
    const order = await prisma.serviceOrder.findUnique({
      where: { id: orderId },
      select: { isInternal: true, appointment: { select: { id: true, accountId: true, status: true } } },
    });
    // Дотоод засварын мэдэгдэл үйлчлүүлэгчид явуулахгүй.
    if (order?.isInternal) return;
    if (!order?.appointment?.accountId || !isActiveOrderNotificationAppointmentStatus(order.appointment.status)) return;
    await createNotification({
      type,
      recipient: { accountId: order.appointment.accountId },
      input: { orderId, appointmentId: order.appointment.id },
    });
  } catch (error) {
    console.warn(`[notify] ${type}:`, error);
  }
}

/**
 * COMPLETED payment rule. Non-postpaid: must be fully paid (PAYMENT_INCOMPLETE).
 * Postpaid with a remaining balance: only `orders.closeUnpaidPostpaid` holders
 * (owner implicit) may close it (POSTPAID_CLOSE_FORBIDDEN, 403).
 */
/** Дараа тооцоот захиалга дуусахдаа бүрэн төлөгдсөн бол дараа тооцоог арилгана. */
export function shouldUncheckPostpaidOnCompletion(
  isPostpaid: boolean,
  totalAmount: Prisma.Decimal | null,
  paid: Prisma.Decimal,
): boolean {
  if (!isPostpaid) return false;
  return paid.gte(totalAmount ?? new Prisma.Decimal(0));
}

export function assertCompletionPaymentAllowed(input: {
  actor: Pick<OrderCommandActor, "isOwner" | "role">;
  isPostpaid: boolean;
  /** Дотоод засвар: төлбөрийн дүрэм хамаарахгүй. */
  isInternal?: boolean;
  totalAmount: Prisma.Decimal | null;
  paid: Prisma.Decimal;
}): void {
  if (input.isInternal) return;
  const total = input.totalAmount ?? new Prisma.Decimal(0);
  if (!input.paid.lt(total)) return;
  if (!input.isPostpaid) {
    throw new OrderCommandError(
      `Төлбөр бүрэн төлөгдөөгүй (үлдэгдэл ${total.minus(input.paid).toString()}₮). Төлбөрөө бүрэн авсны дараа засварын хуудсыг дуусгана уу.`,
      422,
      "PAYMENT_INCOMPLETE",
    );
  }
  if (!hasPermission(input.actor, "orders.closeUnpaidPostpaid")) {
    throw new OrderCommandError(POSTPAID_CLOSE_FORBIDDEN_MESSAGE, 403, "POSTPAID_CLOSE_FORBIDDEN");
  }
}

/**
 * Postpaid settlement gate: once a postpaid order is COMPLETED, recording /
 * reversing payments (incl. QPay) needs `orders.closeUnpaidPostpaid`
 * (owner implicit). `actor` is required: a missing user must fail closed.
 */
export function canSettlePostpaidOrder(
  actor: Pick<OrderCommandActor, "isOwner" | "role">,
  order: { isPostpaid: boolean; status: string },
): boolean {
  if (!order.isPostpaid || order.status !== "COMPLETED") return true;
  return hasPermission(actor, "orders.closeUnpaidPostpaid");
}

export function assertPostpaidSettlementAllowed(
  actor: Pick<OrderCommandActor, "isOwner" | "role">,
  order: { isPostpaid: boolean; status: string },
): void {
  if (!canSettlePostpaidOrder(actor, order)) {
    throw new OrderCommandError(POSTPAID_SETTLEMENT_FORBIDDEN_MESSAGE, 403, "POSTPAID_SETTLEMENT_FORBIDDEN");
  }
}

export async function applyOrderPatchCommand(input: {
  actor: OrderCommandActor;
  orderId: string;
  nextStatus?: OrderStatus | null;
  durationMinutes?: number | null;
  duration?: { hours: string; minutes: string };
  assignedToId?: string | null;
  notes?: string | null;
  isPostpaid?: boolean;
  isInternal?: boolean;
  scope?: OrderCommandScope;
}): Promise<StatusCommandResult> {
  const { actor, orderId, nextStatus, scope } = input;
  const result = await withOrderTransaction(
    actor.tenantId,
    orderId,
    {
      id: true,
      branchId: true,
      status: true,
      assignedToId: true,
      startedAt: true,
      estimatedDurationMinutes: true,
      isPostpaid: true,
      isInternal: true,
      totalAmount: true,
      items: {
        where: { status: { not: "CANCELLED" } },
        select: {
          kind: true,
          status: true,
          quantity: true,
          serviceId: true,
          service: {
            select: {
              durationValue: true,
              durationUnit: { select: { name: true, code: true } },
            },
          },
          diagnosticTemplate: { select: { durationMin: true } },
        },
      },
    },
    async (tx, raw) => {
      const order = raw as {
        id: string;
        branchId: string;
        status: OrderStatus;
        assignedToId: string | null;
        startedAt: Date | null;
        estimatedDurationMinutes: number | null;
        isPostpaid: boolean;
        isInternal: boolean;
        totalAmount: Prisma.Decimal | null;
        items: Array<ServiceDurationItem & { serviceId: string | null }>;
      } | null;
      if (!order) throw new OrderCommandError("Засварын хуудас олдсонгүй.", 404, "ORDER_NOT_FOUND");
      assertOrderScope(actor, order.branchId, scope);
      const editsOrderFields = nextStatus != null || input.notes !== undefined || input.isPostpaid !== undefined || input.isInternal !== undefined;
      if (editsOrderFields) assertCanEdit(actor, order);
      if (input.assignedToId !== undefined && !canAssignOrders(actor)) {
        throw new OrderCommandError("Зөвхөн orders.assign эрхтэй хэрэглэгч хариуцагч өөрчилж болно.", 403, "ORDER_ASSIGN_FORBIDDEN");
      }
      // Хариуцах мастер заавал — оноосон мастерыг арилгахгүй (сольж л болно).
      if (input.assignedToId === null && order.assignedToId) {
        throw new OrderCommandError(
          "Хариуцах мастерыг арилгах боломжгүй — өөр мастер сонгоно уу.",
          422,
          "ASSIGNEE_REQUIRED",
          { assignedToId: "Хариуцах мастер сонгоно уу." },
        );
      }
      const nextInternal = input.isInternal ?? order.isInternal;
      // Дотоод + дараа тооцоо зэрэг байж болохгүй (input дотор эсвэл одоогийн дотоод төлөвтэй).
      const conflict = internalPostpaidConflict(nextInternal, input.isPostpaid);
      if (conflict) {
        throw new OrderCommandError(conflict.message, conflict.status, conflict.code, {
          isInternal: conflict.message,
          isPostpaid: conflict.message,
        });
      }
      if (isOrderLocked(order.status) && nextStatus == null) {
        throw new OrderCommandError(
          "Дууссан / цуцлагдсан засварын хуудсанд мэдээлэл засах боломжгүй.",
          422,
          "ORDER_LOCKED",
        );
      }
      if (nextStatus != null && !isAllowedOrderStatusTransition(order.status, nextStatus)) {
        throw new OrderCommandError("Энэ статус руу шилжих боломжгүй.", 422, "INVALID_STATUS_TRANSITION");
      }

      if (input.isInternal === true && !order.isInternal) {
        const paidRow = await tx.orderPayment.findFirst({
          where: { orderId, tenantId: actor.tenantId, status: "PAID" },
          select: { id: true },
        });
        const violation = internalHasPaymentsViolation(input.isInternal, order.isInternal, Boolean(paidRow));
        if (violation) throw new OrderCommandError(violation.message, violation.status, violation.code);
      }

      // Төлөгдсөн төлбөртэй захиалгыг цуцлахгүй (устгахтай ижил) — эхлээд
      // төлбөрийг буцаах ёстой, эс бөгөөс шийдэгдээгүй илүү төлөлт үлдэнэ.
      if (nextStatus === "CANCELLED") {
        const paid = await tx.orderPayment.findFirst({
          where: { orderId, tenantId: actor.tenantId, status: "PAID" },
          select: { id: true },
        });
        if (paid) {
          // A paid payment in a CLOSED cash session can never be reversed: «reverse first» would be a dead end.
          const lockedIds = await findLockedPaymentIds(tx, actor.tenantId, (await tx.orderPayment.findMany({ where: { orderId, tenantId: actor.tenantId, status: "PAID" }, select: { id: true } })).map((r) => r.id));
          if (lockedIds.size > 0) throw new OrderCommandError(PAID_PAYMENT_LOCKED_ORDER_MESSAGE, 422, "PAID_PAYMENT_LOCKED");
          throw new OrderCommandError(
            "Энэ засварын хуудсанд төлбөр төлөгдсөн тул цуцлах боломжгүй. Эхлээд төлбөрийг буцаана уу.",
            422,
            "PAID_PAYMENT_EXISTS",
          );
        }
      }

      let uncheckPostpaidOnCompletion = false;
      if (nextStatus === "COMPLETED") {
        const pending = await tx.serviceItem.count({
          where: {
            orderId,
            kind: "DIAGNOSTIC",
            status: { not: "CANCELLED" },
            diagnosticReportId: null,
          },
        });
        if (pending > 0) {
          throw new OrderCommandError(
            "Бөглөгдөөгүй оношилгоо байна. Бүх оношилгоог бөглөсний дараа засварын хуудсыг дуусгана уу.",
            422,
            "DIAGNOSTIC_REPORT_REQUIRED",
          );
        }
        // Ажил/оношилгоо/хураамжийн мөр бүгд дууссан байх (сэлбэгт явц байхгүй).
        const unfinished = order.items.filter((item) => item.kind !== "PART" && item.status !== "COMPLETED").length;
        if (unfinished > 0) {
          throw new OrderCommandError(
            `Дуусаагүй ${unfinished} ажил байна. Бүх ажлыг дуусгасны дараа засварын хуудсыг дуусгана уу.`,
            422,
            "ITEMS_NOT_COMPLETED",
          );
        }
        // Төлбөрийн шалгалт (ердийн: PAYMENT_INCOMPLETE; дараа тооцоот: эрхтэй хэрэглэгч л хаана).
        const { paid } = await paidLedger(tx, actor.tenantId, orderId);
        const completingPostpaid = input.isPostpaid ?? order.isPostpaid;
        assertCompletionPaymentAllowed({
          actor,
          isPostpaid: completingPostpaid,
          isInternal: nextInternal,
          totalAmount: order.totalAmount,
          paid,
        });
        // Дуусгах үед төлбөр бүрэн бол дараа тооцоог арилгана (тооцоо нийлэх зүйлгүй).
        uncheckPostpaidOnCompletion = shouldUncheckPostpaidOnCompletion(completingPostpaid, order.totalAmount, paid);
      }

      const enteringInProgress = nextStatus === "IN_PROGRESS";
      const startingFresh = enteringInProgress && order.status === "SCHEDULED";
      let effectiveDurationMinutes = order.estimatedDurationMinutes;
      const itemDuration = enteringInProgress
        ? calculateServiceItemDurationMinutes(order.items)
        : null;
      if (effectiveDurationMinutes == null && itemDuration != null) {
        effectiveDurationMinutes = itemDuration;
      }
      if (enteringInProgress && effectiveDurationMinutes == null) {
        const parsed = input.duration
          ? parseActionDuration(input.duration.hours, input.duration.minutes)
          : parseCommandDuration(input.durationMinutes);
        if (!parsed.ok || parsed.minutes == null) {
          throw new OrderCommandError(
            parsed.ok ? "Ажлыг эхлүүлэхийн өмнө ойролцоо үргэлжлэх хугацааг оруулна уу." : parsed.error,
            422,
            "DURATION_REQUIRED",
            { duration: parsed.ok ? "Ажлыг эхлүүлэхийн өмнө ойролцоо үргэлжлэх хугацааг оруулна уу." : parsed.error },
          );
        }
        effectiveDurationMinutes = parsed.minutes;
      }

      const now = new Date();
      const startedAt = startingFresh ? now : order.startedAt;
      const completedAt = nextStatus === "COMPLETED" ? new Date() : undefined;
      const updates: Prisma.ServiceOrderUpdateInput = {
        ...(nextStatus != null ? { status: nextStatus } : {}),
        ...(startingFresh ? { startedAt } : {}),
        ...(startingFresh && effectiveDurationMinutes !== order.estimatedDurationMinutes
          ? { estimatedDurationMinutes: effectiveDurationMinutes }
          : {}),
        ...(completedAt ? { completedAt } : {}),
        ...(nextStatus != null
          ? { occupiesCapacity: nextStatus === "COMPLETED" || nextStatus === "CANCELLED" ? false : true }
          : {}),
        ...(enteringInProgress && effectiveDurationMinutes != null && startedAt
          ? { expectedFinishAt: new Date(startedAt.getTime() + effectiveDurationMinutes * 60000) }
          : {}),
      };
      let assigneeDisplayName: string | null = null;
      if (input.isInternal !== undefined) updates.isInternal = input.isInternal;
      // Дотоод болгоход дараа тооцоог заавал арилгана (DB CHECK).
      if (input.isInternal === true) updates.isPostpaid = false;
      else if (input.isPostpaid !== undefined) updates.isPostpaid = input.isPostpaid;
      if (uncheckPostpaidOnCompletion) updates.isPostpaid = false;
      if (nextStatus != null || input.notes !== undefined || input.assignedToId !== undefined || input.isPostpaid !== undefined || input.isInternal !== undefined) {
        if (input.assignedToId !== undefined) {
          // Ижил хариуцагчийг дахин илгээвэл шалгахгүй — дараа нь ажлаас гарсан /
          // хугацаа дууссан мастертай хуудсыг бусад талбараар засаж болно.
          if (input.assignedToId && input.assignedToId !== order.assignedToId) {
            const assignee = await validateOrderAssignee(tx, {
              tenantId: actor.tenantId,
              assigneeId: input.assignedToId,
              orderBranchId: order.branchId,
            });
            assigneeDisplayName = [assignee.lastName, assignee.firstName].filter(Boolean).join(" ").trim() || null;
          }
          updates.assignedTo = input.assignedToId
            ? { connect: { id: input.assignedToId } }
            : { disconnect: true };
        }
        if (input.notes !== undefined) updates.notes = input.notes?.trim() || null;
        await tx.serviceOrder.update({ where: { id: orderId }, data: updates });
      }

      if (enteringInProgress) {
        await closeOpenOrderTimeBooking(tx, orderId, now, "all");
        await openOrderTimeBooking(tx, {
          tenantId: actor.tenantId,
          orderId,
          branchId: order.branchId,
          kind: "ACTIVE",
          startAt: now,
          endAt: (updates.expectedFinishAt as Date | undefined) ?? null,
          createdById: actor.id,
        });
      } else if (nextStatus === "COMPLETED") {
        await closeOpenOrderTimeBooking(tx, orderId, completedAt as Date, "ACTIVE");
      } else if (nextStatus === "CANCELLED") {
        await closeOpenOrderTimeBooking(tx, orderId, now, "all");
        for (const item of order.items) {
          if (!isStockBackedOrderItem(item.kind, item.serviceId)) continue;
          await tx.service.update({
            where: { id: item.serviceId as string },
            data: { stock: { increment: new Prisma.Decimal(item.quantity.toString()) } },
          });
          await logAudit({
            tenantId: actor.tenantId,
            userId: actor.id,
            entity: "Service",
            entityId: item.serviceId as string,
            action: "STOCK_CHANGE",
            summary: `+${item.quantity.toString()} (захиалга цуцлагдсан)`,
            after: { delta: `+${item.quantity.toString()}`, reason: "ORDER_CANCEL" },
          }, tx);
        }
        await tx.serviceItem.updateMany({
          where: { orderId, status: { not: "CANCELLED" } },
          data: { status: "CANCELLED", cancelledAt: now, cancelledById: actor.id },
        });
        await recomputeOrderTotal(tx, orderId);
      }

      // Cash ledger: internal repair cost follows the order's lifecycle (same transaction).
      if (nextStatus === "COMPLETED" && nextInternal) {
        await postInternalRepairExpense(tx, {
          tenantId: actor.tenantId,
          actorId: actor.id,
          orderId,
          branchId: order.branchId,
          amount: order.totalAmount,
          occurredAt: completedAt as Date,
        });
      } else if (nextStatus === "CANCELLED") {
        await voidInternalRepairExpense(tx, { tenantId: actor.tenantId, actorId: actor.id, orderId, reason: VOID_REASON_ORDER_CANCELLED });
      } else if (nextStatus != null && order.status === "COMPLETED" && nextStatus !== "COMPLETED") {
        await voidInternalRepairExpense(tx, { tenantId: actor.tenantId, actorId: actor.id, orderId, reason: VOID_REASON_ORDER_REOPENED });
      }

      if (nextStatus != null) await logAudit(
        {
          tenantId: actor.tenantId,
          userId: actor.id,
          entity: "ServiceOrder",
          entityId: orderId,
          action: "STATUS_CHANGE",
          summary: `${order.status} → ${nextStatus}`,
          before: { status: order.status },
          after: { status: nextStatus },
        },
        tx,
      );
      if (input.assignedToId !== undefined && input.assignedToId !== order.assignedToId) {
        await logAudit({ tenantId: actor.tenantId, userId: actor.id, entity: "ServiceOrder", entityId: orderId, action: "UPDATE", summary: input.assignedToId ? `Хариуцагч: ${assigneeDisplayName ?? input.assignedToId}` : "Хариуцагчийг арилгав", before: { assignedToId: order.assignedToId }, after: { assignedToId: input.assignedToId } }, tx);
      }
      return {
        orderId,
        fromStatus: order.status,
        toStatus: nextStatus ?? order.status,
        statusChanged: nextStatus != null,
        previousAssignedToId: order.assignedToId,
      };
    },
  );

  if (result.statusChanged && result.toStatus === "COMPLETED") await notifyOrderStatusChange(orderId, "order_completed");
  else if (result.statusChanged && result.toStatus === "CANCELLED") await notifyOrderStatusChange(orderId, "order_cancelled");
  else if (result.statusChanged && result.toStatus === "IN_PROGRESS") await notifyOrderStatusChange(orderId, "order_in_progress");
  return result;
}

export async function changeOrderStatusCommand(input: {
  actor: OrderCommandActor;
  orderId: string;
  nextStatus: OrderStatus;
  durationMinutes?: number | null;
  duration?: { hours: string; minutes: string };
  scope?: OrderCommandScope;
}): Promise<StatusCommandResult> {
  return applyOrderPatchCommand(input);
}

export async function assignOrderCommand(input: {
  actor: OrderCommandActor;
  orderId: string;
  assignedToId: string | null;
  scope?: OrderCommandScope;
}): Promise<AssignmentCommandResult> {
  const { actor, orderId, assignedToId, scope } = input;
  const patched = await applyOrderPatchCommand({ actor, orderId, assignedToId, scope });
  return {
    orderId,
    previousAssignedToId: patched.previousAssignedToId ?? null,
    assignedToId,
  };
}

export async function deleteOrderCommand(input: {
  actor: OrderCommandActor;
  orderId: string;
  scope?: OrderCommandScope;
}): Promise<{ orderId: string; number: string | null }> {
  const { actor, orderId, scope } = input;
  let intakeFilePaths: string[] = [];
  // Provider pre-step: deleting the order hard-deletes its non-PAID payments, including pending QPay rows whose
  // invoice would otherwise stay payable at QPay with no record. Cancel those invoices at QPay first (outside any tx).
  const providerPending = await withOrderTransaction(
    actor.tenantId,
    orderId,
    { id: true, branchId: true },
    async (tx, raw) => {
      const order = raw as { id: string; branchId: string } | null;
      if (!order) throw new OrderCommandError("Засварын хуудас олдсонгүй.", 404, "ORDER_NOT_FOUND");
      assertOrderScope(actor, order.branchId, scope);
      const pending = await tx.orderPayment.findMany({
        where: { orderId, tenantId: actor.tenantId, method: "QPAY", status: "PENDING", qpayInvoiceId: { not: null } },
        select: { id: true, orderId: true, amount: true, qpayInvoiceId: true },
      });
      return { branchId: order.branchId, pending };
    },
  );
  let providerCancelled: string[] = [];
  if (providerPending.pending.length > 0) {
    // Lazy: the QPay client chain needs the full server env, which pure order-command unit tests do not set.
    const { defaultQPayCancelDeps, QPAY_CANCEL_FAILED_MESSAGE, QPAY_INVOICE_PARTIALLY_PAID_MESSAGE, sweepPendingQPayAtProvider } = await import("@/lib/orders/qpay-cancel");
    const sweep = await sweepPendingQPayAtProvider(
      { tenantId: actor.tenantId, userId: actor.id, branchId: providerPending.branchId, payments: providerPending.pending },
      defaultQPayCancelDeps(async (paymentId) => {
        // Existing confirm path (loaded lazily: it is a server-only module).
        const { confirmOrderQPayPayment } = await import("@/lib/order-payments");
        const r = await confirmOrderQPayPayment(actor.tenantId, actor.id, paymentId);
        return r.ok && r.paid;
      }),
    );
    if (sweep.paid.length > 0) throw new OrderCommandError("Энэ засварын хуудасны QPay нэхэмжлэх төлөгдсөн тул устгах боломжгүй.", 409, "PAID_PAYMENT_EXISTS");
    if (sweep.partial.length > 0) throw new OrderCommandError(QPAY_INVOICE_PARTIALLY_PAID_MESSAGE, 409, "QPAY_INVOICE_PARTIALLY_PAID");
    if (sweep.failed.length > 0) throw new OrderCommandError(QPAY_CANCEL_FAILED_MESSAGE, 502, "QPAY_CANCEL_FAILED");
    providerCancelled = sweep.cancellable;
  }
  const result = await withOrderTransaction(
    actor.tenantId,
    orderId,
    { id: true, number: true, branchId: true, assignedToId: true },
    async (tx, raw) => {
      const order = raw as { id: string; number: string; branchId: string; assignedToId: string | null } | null;
      if (!order) throw new OrderCommandError("Засварын хуудас олдсонгүй.", 404, "ORDER_NOT_FOUND");
      assertOrderScope(actor, order.branchId, scope);
      const paid = await tx.orderPayment.findFirst({
        where: { orderId, tenantId: actor.tenantId, status: "PAID" },
        select: { id: true },
      });
      if (paid) {
        throw new OrderCommandError(
          "Энэ засварын хуудсанд төлбөр төлөгдсөн тул устгах боломжгүй.",
          422,
          "PAID_PAYMENT_EXISTS",
        );
      }
      // Never delete a pending QPay row whose invoice was not cancelled at QPay first (appeared after the pre-step).
      const unhandledQPay = await tx.orderPayment.findFirst({
        where: { orderId, tenantId: actor.tenantId, method: "QPAY", status: "PENDING", qpayInvoiceId: { not: null }, id: { notIn: providerCancelled } },
        select: { id: true },
      });
      if (unhandledQPay) throw new OrderCommandError("QPay нэхэмжлэхийн төлөв өөрчлөгдлөө. Дахин оролдоно уу.", 409, "QPAY_PENDING_CHANGED");
      await tx.orderPayment.deleteMany({
        where: { orderId, tenantId: actor.tenantId, status: { not: "PAID" } },
      });
      // Cash ledger: ledger rows outlive the order (no FK) — void any live internal-repair expense.
      await voidInternalRepairExpense(tx, { tenantId: actor.tenantId, actorId: actor.id, orderId, reason: VOID_REASON_ORDER_DELETED });
      // Мөрүүд cascade-аар устана — цуцлагдаагүй барааны үлдэгдлийг эхлээд
      // буцаана (захиалга цуцлахтай ижил).
      const stockItems = await tx.serviceItem.findMany({
        where: { orderId, status: { not: "CANCELLED" } },
        select: { kind: true, serviceId: true, quantity: true },
      });
      for (const item of stockItems) {
        if (!isStockBackedOrderItem(item.kind, item.serviceId)) continue;
        await tx.service.update({
          where: { id: item.serviceId as string },
          data: { stock: { increment: new Prisma.Decimal(item.quantity.toString()) } },
        });
        await logAudit({
          tenantId: actor.tenantId,
          userId: actor.id,
          entity: "Service",
          entityId: item.serviceId as string,
          action: "STOCK_CHANGE",
          summary: `+${item.quantity.toString()} (захиалга устгагдсан)`,
          after: { delta: `+${item.quantity.toString()}`, reason: "ORDER_DELETE" },
        }, tx);
      }
      // Хүлээн авах зургийн мөрүүд cascade-аар устана (гарын үсэг нь багана); файлыг commit-ийн дараа
      // устгахын тулд замуудыг энд авна (QA #14).
      const [intakePhotos, intakeOrder] = await Promise.all([
        tx.serviceOrderIntakePhoto.findMany({ where: { orderId }, select: { path: true } }),
        tx.serviceOrder.findUnique({ where: { id: orderId }, select: { intakeSignaturePath: true } }),
      ]);
      intakeFilePaths = intakePhotos.map((photo) => photo.path);
      if (intakeOrder?.intakeSignaturePath) intakeFilePaths.push(intakeOrder.intakeSignaturePath);
      await tx.serviceOrder.delete({ where: { id: orderId, tenantId: actor.tenantId } });
      await logAudit(
        {
          tenantId: actor.tenantId,
          userId: actor.id,
          entity: "ServiceOrder",
          entityId: orderId,
          action: "DELETE",
          summary: `#${order.number}`,
        },
        tx,
      );
      return { orderId, number: order.number };
    },
  );
  // Transaction амжилттай бол л файлыг устгана — rollback болвол зураг хэвээр.
  // Файл устгах алдаа захиалга устгалтыг буцаахгүй.
  await Promise.all(
    intakeFilePaths.map((path) =>
      deleteUpload(path).catch((e) => console.warn("[order-delete] intake file:", path, e)),
    ),
  );
  return result;
}

/** Adapter helper for the FormData action's hours/minutes inputs. */
export function parseActionDuration(hours: string, minutes: string):
  | { ok: true; minutes: number | null }
  | { ok: false; error: string } {
  return parseDurationInput(hours, minutes);
}
