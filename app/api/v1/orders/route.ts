import { Prisma } from "@/app/generated/prisma/client";
import { findOrderIdsWithLockedPayment } from "@/lib/cash/session-attach";
import { jsonError, jsonOk, requireApiUser, requirePermission } from "@/lib/api";
import { resolveWorkingBranch } from "@/lib/auth/api-branch";
import { canAssignOrders, orderReadWhere } from "@/lib/auth/order-access";
import { requireActiveSubscriptionApi } from "@/lib/subscription-server";
import { buildMeta } from "@/lib/pagination";
import { prisma } from "@/lib/prisma";
import { OrderCommandError } from "@/lib/orders/order-commands";
import { createOrderCommand } from "@/lib/orders/order-create-command";
import { readIntakeBody, validateIntakeFields, type IntakeInput } from "@/lib/orders/order-intake-server";
import { parseCreateOrderBody } from "@/lib/orders/order-create-request";
import { buildOrderListWhere, parseOrderListQuery } from "@/lib/orders/order-list-query";
import { summarizeOrderProgress } from "@/lib/orders/order-progress";
import { PAID_AT_SELECT, withPaidInFull } from "@/lib/orders/order-payment-totals";

const ORDER_SELECT = {
  id: true,
  number: true,
  status: true,
  paymentStatus: true,
  scheduledAt: true,
  startedAt: true,
  completedAt: true,
  expectedFinishAt: true,
  estimatedDurationMinutes: true,
  totalAmount: true,
  paidAmount: true,
  notes: true,
  createdAt: true,
  isPostpaid: true,
  isInternal: true,
  plateSnapshot: true,
  vinSnapshot: true,
  customer: { select: { id: true, fullName: true, phone: true } },
  vehicle: { select: { id: true, plate: true, make: true, model: true, year: true } },
  branch: { select: { id: true, name: true } },
  assignedTo: { select: { id: true, firstName: true, lastName: true } },
} satisfies Prisma.ServiceOrderSelect;

const ORDER_LIST_SELECT = {
  ...ORDER_SELECT,
  items: { select: { kind: true, status: true, description: true } },
} satisfies Prisma.ServiceOrderSelect;

export async function GET(req: Request) {
  const auth = await requireApiUser(req);
  if (auth.response) return auth.response;

  const url = new URL(req.url);
  const parsed = parseOrderListQuery(url.searchParams);
  if (!parsed.ok) return jsonError(400, parsed.message, { field: parsed.field });

  // Салбараар хязгаарлагдсан ажилтан зөвхөн өөрийн салбарын захиалгыг харна.
  const scopeResult = await resolveWorkingBranch(req, auth.user);
  if (scopeResult.response) return scopeResult.response;
  const where = buildOrderListWhere(parsed.value, {
    tenantId: auth.user.tenantId,
    workingBranchId: scopeResult.branchId,
    readWhere: orderReadWhere(auth.user),
  });

  const [orders, total] = await Promise.all([
    prisma.serviceOrder.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: parsed.value.skip,
      take: parsed.value.take,
      select: { ...ORDER_LIST_SELECT, ...PAID_AT_SELECT },
    }),
    prisma.serviceOrder.count({ where }),
  ]);
  const lockedOrderIds = await findOrderIdsWithLockedPayment(prisma, auth.user.tenantId, orders.map((o) => o.id));
  return jsonOk({
    orders: orders.map(({ items, ...rawOrder }) => ({
      ...withPaidInFull(rawOrder),
      hasLockedPayment: lockedOrderIds.has(rawOrder.id),
      progress: summarizeOrderProgress(items),
      servicePreview: items.filter((item) => item.status !== "CANCELLED" && item.kind !== "PART").slice(0, 2).map((item) => item.description),
    })),
    pagination: buildMeta(total, parsed.value.page, parsed.value.pageSize),
  });
}

export async function POST(req: Request) {
  const auth = await requireApiUser(req);
  if (auth.response) return auth.response;
  const denied = requirePermission(auth.user, "orders.create");
  if (denied) return denied;
  const locked = await requireActiveSubscriptionApi(auth.user);
  if (locked) return locked;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError(400, "JSON body шаардлагатай.");
  }

  const parsed = parseCreateOrderBody(body);
  if (!parsed.ok) {
    return jsonError(parsed.status, parsed.message, {
      ...(parsed.code ? { code: parsed.code } : {}),
      ...(parsed.fieldErrors ? { fieldErrors: parsed.fieldErrors } : {}),
    });
  }
  const { branchId, customerId, vehicleId, scheduledAt, notes, appointmentId, estimatedDurationMinutes, isPostpaid, isInternal } =
    parsed.value;
  let { assignedToId } = parsed.value;

  if (assignedToId) {
    const assignDenied = requirePermission(auth.user, "orders.assign");
    if (assignDenied) return assignDenied;
  } else if (!canAssignOrders(auth.user)) {
    // Хариуцах мастер заавал — оноох эрхгүй бол өөрийгөө (web createOrderAction-тэй ижил).
    assignedToId = auth.user.id;
  }

  const scopeResult = await resolveWorkingBranch(req, auth.user);
  if (scopeResult.response) return scopeResult.response;

  // Хүлээн авах бүртгэл (заавал биш): зөвхөн үүсгэх үед бичигдэнэ.
  const intakeBody = readIntakeBody((body as Record<string, unknown>).intake);
  if (intakeBody.error) {
    return jsonError(422, "Хүсэлт буруу.", { fieldErrors: { intake: intakeBody.error } });
  }
  let intake: IntakeInput | null = null;
  if (intakeBody.fields) {
    const checked = await validateIntakeFields(intakeBody.fields, auth.user.tenantId, auth.user.id);
    if (checked.error) {
      return jsonError(422, checked.error, { fieldErrors: { intake: checked.error } });
    }
    intake = checked.intake;
  }

  try {
    const created = await createOrderCommand({
      tenantId: auth.user.tenantId,
      actorId: auth.user.id,
      branchId,
      customerId,
      vehicleId,
      assignedToId,
      scheduledAt,
      notes,
      appointmentId,
      estimatedDurationMinutes,
      isPostpaid,
      isInternal,
      workingBranchId: scopeResult.branchId,
      intake,
    });
    const order = await prisma.serviceOrder.findFirst({
      where: { id: created.id, tenantId: auth.user.tenantId },
      select: { ...ORDER_SELECT, ...PAID_AT_SELECT },
    });
    if (!order) return jsonError(500, "Захиалга үүссэн боловч буцааж уншиж чадсангүй.");
    return jsonOk({ order: withPaidInFull(order) }, { status: 201 });
  } catch (error) {
    if (error instanceof OrderCommandError) {
      return jsonError(error.status, error.message, {
        code: error.code,
        ...(error.fieldErrors ? { fieldErrors: error.fieldErrors } : {}),
      });
    }
    return jsonError(500, "Серверийн алдаа гарлаа. Дахин оролдоно уу.");
  }
}
