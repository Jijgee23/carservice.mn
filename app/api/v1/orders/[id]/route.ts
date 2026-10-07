import { Prisma } from "@/app/generated/prisma/client";
import { findOrderIdsWithLockedPayment } from "@/lib/cash/session-attach";
import { jsonError, jsonOk, requireApiUser, requirePermission } from "@/lib/api";
import { resolveWorkingBranch } from "@/lib/auth/api-branch";
import { canEditOrder, orderReadWhere } from "@/lib/auth/order-access";
import { requireActiveSubscriptionApi } from "@/lib/subscription-server";
import { prisma } from "@/lib/prisma";
import { PAID_AT_SELECT, withPaidInFull } from "@/lib/orders/order-payment-totals";
import {
  ORDER_STATUSES,
  type OrderStatus,
} from "@/lib/orders";
import { INTAKE_VIEW_SELECT, omitIntakeColumns, toIntakeView, type IntakeViewRow } from "@/lib/orders/order-intake-view";
import {
  applyOrderPatchCommand,
  deleteOrderCommand,
  OrderCommandError,
} from "@/lib/orders/order-commands";

const ORDER_DETAIL_SELECT = {
  id: true,
  number: true,
  status: true,
  paymentStatus: true,
  scheduledAt: true,
  startedAt: true,
  completedAt: true,
  paidAt: true,
  expectedFinishAt: true,
  estimatedDurationMinutes: true,
  totalAmount: true,
  paidAmount: true,
  notes: true,
  createdAt: true,
  updatedAt: true,
  isPostpaid: true,
  isInternal: true,
  plateSnapshot: true,
  vinSnapshot: true,
  ...PAID_AT_SELECT,
  customer: { select: { id: true, fullName: true, phone: true, email: true } },
  vehicle: {
    select: {
      id: true,
      plate: true,
      make: true,
      model: true,
      year: true,
      vin: true,
      mileage: true,
    },
  },
  branch: { select: { id: true, name: true } },
  assignedTo: { select: { id: true, firstName: true, lastName: true } },
  ...INTAKE_VIEW_SELECT,
  items: {
    orderBy: { createdAt: "asc" as const },
    select: {
      id: true,
      kind: true,
      description: true,
      quantity: true,
      unitPrice: true,
      total: true,
      serviceId: true,
      status: true,
      startedAt: true,
      completedAt: true,
      cancelledAt: true,
      cancelledById: true,
      cancelledBy: { select: { id: true, firstName: true, lastName: true } },
      diagnosticTemplateId: true,
      diagnosticReportId: true,
    },
  },
  reports: {
    orderBy: { createdAt: "desc" as const },
    select: {
      id: true,
      createdAt: true,
      template: { select: { id: true, name: true, type: true } },
    },
  },
} satisfies Prisma.ServiceOrderSelect;

// Intake-н raw багануудыг ил гаргахгүй — зөвхөн `intake` объект.
function serializeOrderDetail<
  T extends IntakeViewRow & {
    status: string;
    paymentStatus: string;
    completedAt: Date | null;
    payments: ReadonlyArray<{ paidAt: Date | null }>;
  },
>(order: T, hasLockedPayment: boolean) {
  const rest = withPaidInFull(omitIntakeColumns(order) as T);
  return { ...rest, hasLockedPayment, intake: toIntakeView(order, { includeRecordedBy: true }) };
}

export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const auth = await requireApiUser(req);
  if (auth.response) return auth.response;
  const { id } = await ctx.params;
  const scopeResult = await resolveWorkingBranch(req, auth.user);
  if (scopeResult.response) return scopeResult.response;
  const scope = scopeResult.branchId;

  const order = await prisma.serviceOrder.findFirst({
    where: {
      id,
      tenantId: auth.user.tenantId,
      ...(scope ? { branchId: scope } : {}),
      ...orderReadWhere(auth.user),
    },
    select: ORDER_DETAIL_SELECT,
  });

  if (!order) return jsonError(404, "Засварын хуудас олдсонгүй.");
  return jsonOk({ order: serializeOrderDetail(order, (await findOrderIdsWithLockedPayment(prisma, auth.user.tenantId, [order.id])).has(order.id)) });
}

export async function DELETE(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const auth = await requireApiUser(req);
  if (auth.response) return auth.response;
  const denied = requirePermission(auth.user, "orders.delete");
  if (denied) return denied;
  const locked = await requireActiveSubscriptionApi(auth.user);
  if (locked) return locked;
  const { id } = await ctx.params;
  const scopeResult = await resolveWorkingBranch(req, auth.user);
  if (scopeResult.response) return scopeResult.response;

  try {
    const { number } = await deleteOrderCommand({
      actor: auth.user,
      orderId: id,
      scope: scopeResult.branchId,
    });
    return jsonOk({ ok: true, orderId: id, number });
  } catch (error) {
    if (error instanceof OrderCommandError) {
      return jsonError(error.status, error.message, { code: error.code });
    }
    return unexpectedOrderRouteError("DELETE", error);
  }
}

function unexpectedOrderRouteError(label: string, error: unknown) {
  const record = error && typeof error === "object"
    ? error as { name?: unknown; code?: unknown }
    : null;
  const name = typeof record?.name === "string" ? record.name.slice(0, 80) : "UnknownError";
  const code = typeof record?.code === "string" ? record.code.slice(0, 40) : undefined;
  console.error(`[orders ${label}]`, code ? { name, code } : { name });
  return jsonError(500, "Серверийн алдаа гарлаа. Дахин оролдоно уу.");
}

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const auth = await requireApiUser(req);
  if (auth.response) return auth.response;
  const locked = await requireActiveSubscriptionApi(auth.user);
  if (locked) return locked;
  const { id } = await ctx.params;
  const scopeResult = await resolveWorkingBranch(req, auth.user);
  if (scopeResult.response) return scopeResult.response;
  const scope = scopeResult.branchId;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError(400, "JSON body шаардлагатай.");
  }
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return jsonError(400, "JSON object body шаардлагатай.");
  }
  const b = body as Record<string, unknown>;
  const hasStatus = Object.prototype.hasOwnProperty.call(b, "status");
  const hasAssignment = Object.prototype.hasOwnProperty.call(b, "assignedToId");
  const hasNotes = Object.prototype.hasOwnProperty.call(b, "notes");
  const hasPostpaid = Object.prototype.hasOwnProperty.call(b, "isPostpaid");
  const hasInternal = Object.prototype.hasOwnProperty.call(b, "isInternal");
  if (hasStatus && (typeof b.status !== "string" || !(ORDER_STATUSES as readonly string[]).includes(b.status))) {
    return jsonError(400, "Статус буруу байна.");
  }
  if (hasNotes && typeof b.notes !== "string") {
    return jsonError(400, "notes нь string байна.");
  }
  if (hasPostpaid && typeof b.isPostpaid !== "boolean") {
    return jsonError(400, "isPostpaid нь boolean байна.");
  }
  if (hasInternal && typeof b.isInternal !== "boolean") {
    return jsonError(400, "isInternal нь boolean байна.");
  }
  if (hasStatus || hasNotes || hasPostpaid || hasInternal) {
    const editDenied = requirePermission(auth.user, "orders.edit");
    if (editDenied && !auth.user.role?.permissions.includes("orders.editOwn")) return editDenied;
  }
  if (hasAssignment) {
    const assignDenied = requirePermission(auth.user, "orders.assign");
    if (assignDenied) return assignDenied;
  }

  // Pre-lock existence/scope check only — status/lock state is re-validated
  // fresh, under the row lock, below. Assignment-only patches deliberately do
  // not require edit scope; the shared command enforces orders.assign and
  // assignee eligibility under the same lock.
  const preCheck = await prisma.serviceOrder.findFirst({
    where: {
      id,
      tenantId: auth.user.tenantId,
      ...(scope ? { branchId: scope } : {}),
    },
    select: { id: true, assignedToId: true },
  });
  if (!preCheck) return jsonError(404, "Засварын хуудас олдсонгүй.");
  if ((hasStatus || hasNotes || hasPostpaid || hasInternal) && !canEditOrder(auth.user, preCheck)) {
    return jsonError(403, "Танд энэ засварын хуудсыг засах эрх байхгүй.");
  }

  // Status and assignment mutations are backed by the same typed, locked
  // commands as the dashboard actions. Keep notes-only PATCH compatibility in
  // the legacy adapter below; combined requests use the commands first and
  // then return the same detail DTO.
  if (hasStatus || hasAssignment || hasNotes || hasPostpaid || hasInternal) {
    try {
      if (hasAssignment && b.assignedToId !== null && typeof b.assignedToId !== "string") {
        return jsonError(400, "assignedToId нь string эсвэл null байна.");
      }
      const assignedToId = hasAssignment
        ? (typeof b.assignedToId === "string" ? b.assignedToId.trim() || null : null)
        : undefined;
      await applyOrderPatchCommand({
        actor: auth.user,
        orderId: id,
        nextStatus: hasStatus ? b.status as OrderStatus : undefined,
        durationMinutes: typeof b.durationMinutes === "number" ? b.durationMinutes : undefined,
        assignedToId,
        notes: hasNotes ? b.notes as string : undefined,
        isPostpaid: hasPostpaid ? b.isPostpaid as boolean : undefined,
        isInternal: hasInternal ? b.isInternal as boolean : undefined,
        scope,
      });
      const updated = await prisma.serviceOrder.findFirst({
        where: { id, tenantId: auth.user.tenantId, ...(scope ? { branchId: scope } : {}) },
        select: ORDER_DETAIL_SELECT,
      });
      if (!updated) return jsonError(404, "Засварын хуудас олдсонгүй.");
      return jsonOk({ order: serializeOrderDetail(updated, (await findOrderIdsWithLockedPayment(prisma, auth.user.tenantId, [updated.id])).has(updated.id)) });
    } catch (error) {
      if (error instanceof OrderCommandError) {
        return jsonError(error.status, error.message, {
          code: error.code,
          ...(error.fieldErrors ? { fieldErrors: error.fieldErrors } : {}),
        });
      }
      return unexpectedOrderRouteError("PATCH", error);
    }
  }
}
