import { Prisma } from "@/app/generated/prisma/client";
import { PAID_PAYMENT_LOCKED_ITEM_MESSAGE } from "@/lib/cash/locked-copy";
import { findLockedPaymentIds } from "@/lib/cash/session-attach";
import { logAudit } from "@/lib/audit";
import {
  canChangeOrderItemPrice,
  canChangeOrderItemStatus,
  canEditOrder,
  canViewOrderItemHistory,
} from "@/lib/auth/order-access";
import { withOrderTransaction } from "@/lib/order-time-booking";
import { recomputeOrderPaymentTotals } from "@/lib/orders/order-payment-totals";
import { prisma, type PrismaTransactionClient } from "@/lib/prisma";
import {
  ITEM_KINDS,
  isOrderLocked,
  isServiceItemCancellable,
  canChangeServiceItemStatus,
  serviceItemTimingPatch,
  type ItemKind,
  type OrderStatus,
  type ServiceItemStatus,
} from "@/lib/orders";
import { isOrderBranchInScope, type OrderCommandActor, OrderCommandError } from "@/lib/orders/order-commands";

export const MAX_ITEM_QUANTITY = new Prisma.Decimal(1_000_000);
export const MAX_ITEM_UNIT_PRICE = new Prisma.Decimal(1_000_000_000);
export const MAX_ITEM_TOTAL = new Prisma.Decimal("9999999999.99");
export const ITEM_QUANTITY_SCALE = 3;
export const ITEM_UNIT_PRICE_SCALE = 2;
export const ITEM_TOTAL_SCALE = 2;
export const MAX_SERVICE_ORDER_TOTAL = new Prisma.Decimal("9999999999.99");
export const MAX_ITEM_HISTORY_PAGE = 100_000;
export const MAX_ITEM_HISTORY_PAGE_SIZE = 100;
export const MAX_ITEM_HISTORY_SKIP = 10_000_000;
export const ORDER_ITEM_PATCH_KEYS = ["kind", "description", "quantity", "unitPrice", "status"] as const;

const SERVICE_KIND_TO_ITEM_KIND: Record<string, ItemKind> = {
  LABOR: "LABOR",
  GOODS: "PART",
};

export type OrderItemData = {
  kind: ItemKind;
  description: string;
  quantity: Prisma.Decimal;
  unitPrice: Prisma.Decimal;
  serviceId?: string | null;
  diagnosticTemplateId?: string | null;
};

type ItemOrder = {
  id: string;
  branchId: string;
  status: OrderStatus;
  assignedToId: string | null;
};

function assertOrderItemAccess(
  actor: OrderCommandActor,
  order: ItemOrder,
  scope: string | null | undefined,
): void {
  if (!isOrderBranchInScope(actor, order.branchId, scope)) {
    throw new OrderCommandError("Зөвхөн өөрийн салбарын засварын хуудсыг удирдана.", 404, "ORDER_OUT_OF_SCOPE");
  }
  if (!canEditOrder(actor, order)) {
    throw new OrderCommandError("Танд энэ засварын хуудсыг засах эрх байхгүй.", 403, "ORDER_EDIT_FORBIDDEN");
  }
  if (isOrderLocked(order.status)) {
    throw new OrderCommandError("Дууссан / цуцлагдсан засварын хуудсанд мөрийн мэдээлэл өөрчлөх боломжгүй.", 422, "ORDER_LOCKED");
  }
}

/**
 * Төлөгдсөн (PAID) төлбөртэй захиалгын мөнгөн дүнг (үнэ/тоо/төрөл, мөр цуцлах)
 * өөрчлөхгүй — эс бөгөөс төлсөн дүн ба нийт дүн зөрнө. Эхлээд төлбөрийг буцаана.
 * Шинэ мөр нэмэх, тайлбар засах, ажлын явц өөрчлөхийг зөвшөөрнө.
 */
async function assertNoPaidPayments(tx: PrismaTransactionClient, tenantId: string, orderId: string): Promise<void> {
  const paid = await tx.orderPayment.findFirst({
    where: { orderId, tenantId, status: "PAID" },
    select: { id: true },
  });
  if (paid) {
    const paidIds = await tx.orderPayment.findMany({ where: { orderId, tenantId, status: "PAID" }, select: { id: true } });
    if ((await findLockedPaymentIds(tx, tenantId, paidIds.map((r) => r.id))).size > 0) {
      throw new OrderCommandError(PAID_PAYMENT_LOCKED_ITEM_MESSAGE, 422, "PAID_PAYMENT_LOCKED");
    }
    throw new OrderCommandError(
      "Төлбөр төлөгдсөн тул мөрийн үнэ, тоо хэмжээг өөрчлөх эсвэл мөр цуцлах боломжгүй. Эхлээд төлбөрийг буцаана уу.",
      422,
      "PAID_PAYMENT_EXISTS",
    );
  }
}

export const ITEM_COMPLETED_LOCKED_MESSAGE = "Дууссан ажлыг засах боломжгүй.";

/**
 * COMPLETED үйлчилгээний мөр (ажил/оношилгоо/хураамж) түгжигдэнэ: засах, үнэ
 * өөрчлөх, цуцлах боломжгүй — алдааг засах бол шинэ засварлах мөр нэмнэ.
 * Явцыг буцаах нь assertCompletedItemStatusChange-д тусдаа шийдэгдэнэ.
 * Сэлбэг (PART) мөрөнд явц байхгүй тул нөлөөлөхгүй.
 */
export function assertItemNotCompleted(status: ServiceItemStatus): void {
  if (status === "COMPLETED") throw new OrderCommandError(ITEM_COMPLETED_LOCKED_MESSAGE, 422, "ITEM_COMPLETED_LOCKED");
}

export const DIAGNOSTIC_REPORT_LINKED_MESSAGE = "Оношилгоо бөглөгдсөн тул явцыг буцаах боломжгүй.";

/**
 * Захиалга ажиллаж байх үед (assertOrderInProgressForItemStatus) COMPLETED мөрийн
 * явцыг буцааж болно. Тайлантай оношилгооны мөрийг буцаавал тайлан холбоотой
 * хэрнээ "Хүлээгдэж буй" мөр үүсдэг тул түгжээтэй хэвээр.
 */
export function assertCompletedItemStatusChange(item: { status: ServiceItemStatus; kind: string; diagnosticReportId: string | null }): void {
  if (item.status !== "COMPLETED") return;
  if (item.kind === "DIAGNOSTIC" && item.diagnosticReportId) {
    throw new OrderCommandError(DIAGNOSTIC_REPORT_LINKED_MESSAGE, 422, "DIAGNOSTIC_REPORT_LINKED");
  }
}

function assertItemValues(input: Pick<OrderItemData, "kind" | "description" | "quantity" | "unitPrice">): void {
  if (!(ITEM_KINDS as readonly string[]).includes(input.kind)) {
    throw new OrderCommandError("Мөрийн төрөл буруу.", 422, "ITEM_KIND_INVALID", { kind: "Мөрийн төрөл буруу." });
  }
  if (!input.description.trim()) {
    throw new OrderCommandError("Тайлбар оруулна уу.", 422, "ITEM_DESCRIPTION_REQUIRED", { description: "Тайлбар оруулна уу." });
  }
  if (!input.quantity.isFinite() || input.quantity.lte(0) || input.quantity.gt(MAX_ITEM_QUANTITY)) {
    throw new OrderCommandError("Тоо хэмжээ буруу.", 422, "ITEM_QUANTITY_INVALID", { quantity: "Тоо хэмжээ буруу." });
  }
  if (input.quantity.decimalPlaces() > ITEM_QUANTITY_SCALE) {
    throw new OrderCommandError("Тоо хэмжээний нарийвчлал хэт их.", 422, "ITEM_QUANTITY_PRECISION", { quantity: "Тоо хэмжээ 3 орны нарийвчлалтай байна." });
  }
  if (!input.unitPrice.isFinite() || input.unitPrice.lt(0) || input.unitPrice.gt(MAX_ITEM_UNIT_PRICE)) {
    throw new OrderCommandError("Үнэ буруу.", 422, "ITEM_PRICE_INVALID", { unitPrice: "Үнэ буруу." });
  }
  if (input.unitPrice.decimalPlaces() > ITEM_UNIT_PRICE_SCALE) {
    throw new OrderCommandError("Үнийн нарийвчлал хэт их.", 422, "ITEM_PRICE_PRECISION", { unitPrice: "Үнэ 2 орны нарийвчлалтай байна." });
  }
  if (roundItemTotal(input.quantity, input.unitPrice).gt(MAX_ITEM_TOTAL)) {
    throw new OrderCommandError("Нийт дүн хэт их.", 422, "ITEM_TOTAL_TOO_LARGE", { unitPrice: "Нийт дүн хэт их." });
  }
}

/**
 * ServiceItem.total is Decimal(12,2). Existing writes let the database round
 * products with more than two fractional digits; keep that behavior explicit
 * at the command boundary using Decimal.js half-up rounding before every
 * create/update and order-total recomputation.
 */
export function roundItemTotal(quantity: Prisma.Decimal, unitPrice: Prisma.Decimal): Prisma.Decimal {
  return quantity.times(unitPrice).toDecimalPlaces(ITEM_TOTAL_SCALE, Prisma.Decimal.ROUND_HALF_UP);
}

export function assertServiceOrderTotal(total: Prisma.Decimal): void {
  if (total.gt(MAX_SERVICE_ORDER_TOTAL)) {
    throw new OrderCommandError(
      "Захиалгын нийт дүн хэт их.",
      422,
      "ORDER_TOTAL_TOO_LARGE",
      { totalAmount: "Захиалгын нийт дүн Decimal(12,2)-ийн хязгаараас хэтэрлээ." },
    );
  }
}

export function isOrderItemKindCompatibleWithService(kind: ItemKind, serviceType: string | null | undefined): boolean {
  if (!serviceType) return true;
  return SERVICE_KIND_TO_ITEM_KIND[serviceType] === kind;
}

export async function recomputeOrderTotal(tx: PrismaTransactionClient, orderId: string): Promise<Prisma.Decimal> {
  const agg = await tx.serviceItem.aggregate({
    where: { orderId, status: { not: "CANCELLED" } },
    _sum: { total: true },
  });
  const total = agg._sum.total ?? new Prisma.Decimal(0);
  assertServiceOrderTotal(total);
  const order = await tx.serviceOrder.update({
    where: { id: orderId },
    data: { totalAmount: total },
    select: { id: true, tenantId: true, totalAmount: true },
  });
  // Нийт дүн өөрчлөгдвөл төлбөрийн төлөв (PAID/PARTIAL) хуучирна — дахин тооцно.
  await recomputeOrderPaymentTotals(tx, order.tenantId, order);
  return total;
}

function orderItemSelect() {
  return {
    id: true,
    kind: true,
    description: true,
    quantity: true,
    unitPrice: true,
    total: true,
    status: true,
    startedAt: true,
    completedAt: true,
    cancelledAt: true,
    cancelledById: true,
    serviceId: true,
    diagnosticTemplateId: true,
    diagnosticReportId: true,
  } as const;
}

export async function addOrderItemCommand(input: {
  actor: OrderCommandActor;
  orderId: string;
  kind: ItemKind;
  description?: string | null;
  quantity: Prisma.Decimal;
  unitPrice?: Prisma.Decimal | null;
  serviceId?: string | null;
  diagnosticTemplateId?: string | null;
  scope?: string | null;
}) {
  const { actor, orderId, scope } = input;
  return withOrderTransaction(actor.tenantId, orderId, {
    id: true,
    branchId: true,
    status: true,
    assignedToId: true,
  }, async (tx, raw) => {
    const order = raw as ItemOrder | null;
    if (!order) throw new OrderCommandError("Засварын хуудас олдсонгүй.", 404, "ORDER_NOT_FOUND");
    assertOrderItemAccess(actor, order, scope);

    let kind = input.kind;
    let description = input.description?.trim() ?? "";
    let serviceId = input.serviceId ?? null;
    const diagnosticTemplateId = input.diagnosticTemplateId ?? null;
    // Үнэ өөрчлөх эрхгүй бол каталогийн үнийг л ашиглана — илгээсэн үнийг үл тооно.
    // Каталоггүй (гараар) мөрөнд үнэ заавал хэрэгтэй тул тэр эрхийг шаардана.
    const canSetPrice = canChangeOrderItemPrice(actor, order);
    if (!canSetPrice && !serviceId && !diagnosticTemplateId) {
      throw new OrderCommandError("Гараар мөр нэмэх эрх байхгүй.", 403, "ITEM_PRICE_FORBIDDEN");
    }
    let unitPrice = canSetPrice ? (input.unitPrice ?? null) : null;
    let isGoods = false;

    if (diagnosticTemplateId) {
      const template = await tx.diagnosticTemplate.findFirst({
        where: { id: diagnosticTemplateId, isActive: true, OR: [{ tenantId: actor.tenantId }, { tenantId: null, grants: { some: { tenantId: actor.tenantId } } }] },
        select: { id: true, name: true, price: true },
      });
      if (!template) throw new OrderCommandError("Оношилгоо олдсонгүй.", 422, "DIAGNOSTIC_TEMPLATE_NOT_FOUND", { diagnosticTemplateId: "Оношилгоо олдсонгүй." });
      const duplicate = await tx.serviceItem.findFirst({
        where: { orderId, kind: "DIAGNOSTIC", diagnosticTemplateId: template.id, status: { not: "CANCELLED" } },
        select: { id: true },
      });
      if (duplicate) throw new OrderCommandError("Энэ оношилгоо аль хэдийн нэмэгдсэн байна.", 422, "DUPLICATE_DIAGNOSTIC", { diagnosticTemplateId: "Энэ оношилгоо аль хэдийн нэмэгдсэн байна." });
      kind = "DIAGNOSTIC";
      description ||= template.name;
      unitPrice ??= template.price ?? new Prisma.Decimal(0);
      serviceId = null;
    } else if (serviceId) {
      const service = await tx.service.findFirst({
        where: { id: serviceId, tenantId: actor.tenantId, isActive: true },
        select: { id: true, type: true, name: true, code: true, price: true, stock: true, unit: { select: { name: true } } },
      });
      if (!service) throw new OrderCommandError("Үйлчилгээ олдсонгүй.", 422, "SERVICE_NOT_FOUND", { serviceId: "Үйлчилгээ олдсонгүй." });
      const mapped = SERVICE_KIND_TO_ITEM_KIND[service.type];
      if (!mapped) throw new OrderCommandError("Үйлчилгээний төрөл буруу.", 422, "SERVICE_KIND_INVALID", { serviceId: "Үйлчилгээний төрөл буруу." });
      kind = mapped;
      description ||= service.code ? `${service.name} (${service.code})` : service.name;
      unitPrice ??= service.price;
      isGoods = service.type === "GOODS";
      if (isGoods && service.stock != null && service.stock.lt(input.quantity)) {
        throw new OrderCommandError(`Үлдэгдэл хүрэхгүй (одоо: ${service.stock.toString()}${service.unit?.name ? ` ${service.unit.name}` : ""}).`, 422, "INSUFFICIENT_STOCK", { quantity: "Үлдэгдэл хүрэхгүй байна." });
      }
    }

    if (!unitPrice) throw new OrderCommandError("Үнэ буруу.", 422, "ITEM_PRICE_INVALID", { unitPrice: "Үнэ буруу." });

    // Ижил каталогийн ажил/сэлбэгийг дахин нэмбэл шинэ мөр үүсгэхгүй — байгаа
    // мөрийн тоо хэмжээг нэмнэ. Зөвхөн ижил үнэтэй, дуусаагүй (PENDING /
    // IN_PROGRESS) мөрт нэгтгэнэ: өөр үнэ эсвэл дууссан ажил бол тусдаа мөр.
    if (serviceId) {
      const mergeTarget = await tx.serviceItem.findFirst({
        where: {
          orderId,
          serviceId,
          kind,
          unitPrice,
          status: { in: ["PENDING", "IN_PROGRESS"] },
        },
        orderBy: { createdAt: "asc" },
        select: { id: true, description: true, quantity: true, total: true },
      });
      if (mergeTarget) {
        const quantity = mergeTarget.quantity.plus(input.quantity);
        assertItemValues({ kind, description: mergeTarget.description, quantity, unitPrice });
        const total = roundItemTotal(quantity, unitPrice);
        const item = await tx.serviceItem.update({
          where: { id: mergeTarget.id },
          data: { quantity, total },
          select: orderItemSelect(),
        });
        await logAudit({
          tenantId: actor.tenantId,
          userId: actor.id,
          entity: "ServiceOrder",
          entityId: orderId,
          action: "ITEM_UPDATED",
          summary: `${kind} · ${mergeTarget.description} +${input.quantity.toString()} (нэгтгэв) → × ${quantity.toString()}`,
          before: { itemId: mergeTarget.id, quantity: mergeTarget.quantity.toString(), total: mergeTarget.total.toString() },
          after: { itemId: mergeTarget.id, quantity: quantity.toString(), total: total.toString(), merged: input.quantity.toString() },
        }, tx);
        if (isGoods) {
          const updated = await tx.service.update({ where: { id: serviceId }, data: { stock: { decrement: input.quantity } }, select: { stock: true } });
          if (updated.stock != null && updated.stock.lt(0)) throw new OrderCommandError("Үлдэгдэл хүрэлцэхгүй байна.", 422, "INSUFFICIENT_STOCK", { quantity: "Үлдэгдэл хүрэхгүй байна." });
          await logAudit({ tenantId: actor.tenantId, userId: actor.id, entity: "Service", entityId: serviceId, action: "STOCK_CHANGE", summary: `-${input.quantity.toString()} (засварын хуудас #${orderId})`, after: { delta: `-${input.quantity.toString()}`, reason: "ORDER_ITEM_ADD" } }, tx);
        }
        await recomputeOrderTotal(tx, orderId);
        return item;
      }
    }

    const data = { kind, description, quantity: input.quantity, unitPrice, serviceId, diagnosticTemplateId };
    assertItemValues(data);
    const total = roundItemTotal(input.quantity, unitPrice);
    const item = await tx.serviceItem.create({
      data: { ...data, orderId, total },
      select: orderItemSelect(),
    });
    await logAudit({
      tenantId: actor.tenantId,
      userId: actor.id,
      entity: "ServiceOrder",
      entityId: orderId,
      action: "ITEM_ADDED",
      summary: `${kind} · ${description} × ${input.quantity.toString()} @ ${unitPrice.toString()}`,
      after: { itemId: item.id, kind, description, quantity: input.quantity.toString(), unitPrice: unitPrice.toString(), total: total.toString(), serviceId, diagnosticTemplateId },
    }, tx);
    if (isGoods && serviceId) {
      const updated = await tx.service.update({ where: { id: serviceId }, data: { stock: { decrement: input.quantity } }, select: { stock: true } });
      if (updated.stock != null && updated.stock.lt(0)) throw new OrderCommandError("Үлдэгдэл хүрэлцэхгүй байна.", 422, "INSUFFICIENT_STOCK", { quantity: "Үлдэгдэл хүрэхгүй байна." });
      await logAudit({ tenantId: actor.tenantId, userId: actor.id, entity: "Service", entityId: serviceId, action: "STOCK_CHANGE", summary: `-${input.quantity.toString()} (засварын хуудас #${orderId})`, after: { delta: `-${input.quantity.toString()}`, reason: "ORDER_ITEM_ADD" } }, tx);
    }
    await recomputeOrderTotal(tx, orderId);
    return item;
  });
}

export async function updateOrderItemCommand(input: {
  actor: OrderCommandActor;
  orderId: string;
  itemId: string;
  kind?: ItemKind;
  description?: string;
  quantity?: Prisma.Decimal;
  unitPrice?: Prisma.Decimal;
  scope?: string | null;
}) {
  const { actor, orderId, itemId, scope } = input;
  return withOrderTransaction(actor.tenantId, orderId, { id: true, branchId: true, status: true, assignedToId: true }, async (tx, raw) => {
    const order = raw as ItemOrder | null;
    if (!order) throw new OrderCommandError("Засварын хуудас олдсонгүй.", 404, "ORDER_NOT_FOUND");
    assertOrderItemAccess(actor, order, scope);
    const existing = await tx.serviceItem.findFirst({ where: { id: itemId, orderId }, select: { ...orderItemSelect(), service: { select: { type: true } } } });
    if (!existing) throw new OrderCommandError("Мөр олдсонгүй.", 404, "ITEM_NOT_FOUND");
    if (existing.status === "CANCELLED") throw new OrderCommandError("Цуцлагдсан мөрийг засах боломжгүй.", 422, "ITEM_CANCELLED");
    assertItemNotCompleted(existing.status);
    const next = {
      kind: input.kind ?? existing.kind,
      description: input.description ?? existing.description,
      quantity: input.quantity ?? existing.quantity,
      unitPrice: input.unitPrice ?? existing.unitPrice,
    } as OrderItemData;
    if (!isOrderItemKindCompatibleWithService(next.kind, existing.service?.type)) {
      throw new OrderCommandError("Каталогийн үйлчилгээний мөрийн төрлийг өөрчлөх боломжгүй.", 422, "ITEM_KIND_SERVICE_MISMATCH", { kind: "Каталогийн үйлчилгээний мөрийн төрлийг өөрчлөх боломжгүй." });
    }
    assertItemValues(next);
    if (next.kind !== existing.kind || !next.quantity.equals(existing.quantity) || !next.unitPrice.equals(existing.unitPrice)) {
      await assertNoPaidPayments(tx, actor.tenantId, orderId);
    }
    const total = roundItemTotal(next.quantity, next.unitPrice);
    const isGoods = existing.serviceId != null && existing.service?.type === "GOODS";
    const delta = isGoods ? next.quantity.minus(existing.quantity) : null;
    const updated = await tx.serviceItem.update({ where: { id: itemId }, data: { kind: next.kind, description: next.description, quantity: next.quantity, unitPrice: next.unitPrice, total }, select: orderItemSelect() });
    if (delta && !delta.isZero() && existing.serviceId) {
      const service = await tx.service.update({ where: { id: existing.serviceId }, data: { stock: { decrement: delta } }, select: { stock: true } });
      if (service.stock != null && service.stock.lt(0)) throw new OrderCommandError("Үлдэгдэл хүрэлцэхгүй байна.", 422, "INSUFFICIENT_STOCK", { quantity: "Үлдэгдэл хүрэхгүй байна." });
      await logAudit({ tenantId: actor.tenantId, userId: actor.id, entity: "Service", entityId: existing.serviceId, action: "STOCK_CHANGE", summary: `${delta.gt(0) ? "-" : "+"}${delta.abs().toString()} (засварын хуудас засварласан)`, after: { delta: delta.toString(), reason: "ORDER_ITEM_UPDATE" } }, tx);
    }
    await logAudit({ tenantId: actor.tenantId, userId: actor.id, entity: "ServiceOrder", entityId: orderId, action: "ITEM_UPDATED", summary: `${next.kind} · ${next.description} × ${next.quantity.toString()} @ ${next.unitPrice.toString()}`, before: { kind: existing.kind, description: existing.description, quantity: existing.quantity.toString(), unitPrice: existing.unitPrice.toString() }, after: { kind: next.kind, description: next.description, quantity: next.quantity.toString(), unitPrice: next.unitPrice.toString(), total: total.toString() } }, tx);
    await recomputeOrderTotal(tx, orderId);
    return updated;
  });
}

/**
 * Apply every supported generic-item PATCH field in one order-row transaction.
 * This deliberately does not compose the status, price, and detail commands:
 * composing those commands would acquire and commit three independent locks,
 * allowing the first mutation to survive when a later one is rejected.
 */
export async function patchOrderItemCommand(input: {
  actor: OrderCommandActor;
  orderId: string;
  itemId: string;
  kind?: ItemKind;
  description?: string;
  quantity?: Prisma.Decimal;
  unitPrice?: Prisma.Decimal;
  nextStatus?: Exclude<ServiceItemStatus, "CANCELLED">;
  scope?: string | null;
}) {
  const { actor, orderId, itemId, scope } = input;
  const hasDetails = input.kind !== undefined || input.description !== undefined || input.quantity !== undefined;
  const hasPrice = input.unitPrice !== undefined;
  const hasStatus = input.nextStatus !== undefined;
  return withOrderTransaction(actor.tenantId, orderId, { id: true, branchId: true, status: true, assignedToId: true }, async (tx, raw) => {
    const order = raw as ItemOrder | null;
    if (!order) throw new OrderCommandError("Засварын хуудас олдсонгүй.", 404, "ORDER_NOT_FOUND");
    if (!isOrderBranchInScope(actor, order.branchId, scope)) throw new OrderCommandError("Зөвхөн өөрийн салбарын засварын хуудсыг удирдана.", 404, "ORDER_OUT_OF_SCOPE");
    if (isOrderLocked(order.status)) throw new OrderCommandError("Дууссан / цуцлагдсан засварын хуудсанд мөрийн мэдээлэл өөрчлөх боломжгүй.", 422, "ORDER_LOCKED");
    if (hasDetails && !canEditOrder(actor, order)) throw new OrderCommandError("Танд энэ засварын хуудсыг засах эрх байхгүй.", 403, "ORDER_EDIT_FORBIDDEN");
    if (hasStatus && !canChangeOrderItemStatus(actor, order)) throw new OrderCommandError("Танд үйлчилгээний мөрийн явц өөрчлөх эрх байхгүй.", 403, "ITEM_STATUS_FORBIDDEN");
    if (hasStatus) assertOrderInProgressForItemStatus(order.status);
    if (hasPrice && !canChangeOrderItemPrice(actor, order)) throw new OrderCommandError("Танд үйлчилгээний мөрийн үнэ өөрчлөх эрх байхгүй.", 403, "ITEM_PRICE_FORBIDDEN");

    const existing = await tx.serviceItem.findFirst({
      where: { id: itemId, orderId },
      select: { ...orderItemSelect(), service: { select: { type: true } } },
    });
    if (!existing) throw new OrderCommandError("Мөр олдсонгүй.", 404, "ITEM_NOT_FOUND");
    if (!hasDetails && !hasPrice && !hasStatus) return existing;
    if (existing.status === "CANCELLED") throw new OrderCommandError("Цуцлагдсан мөрийг өөрчлөх боломжгүй.", 422, "ITEM_CANCELLED");
    const priceChanged = hasPrice && !input.unitPrice!.equals(existing.unitPrice);
    if (!hasDetails && !priceChanged && !hasStatus) return existing;
    if (hasDetails || priceChanged) assertItemNotCompleted(existing.status);
    if (hasStatus) {
      if (!hasDetails && !priceChanged && input.nextStatus === existing.status) return existing;
      assertCompletedItemStatusChange(existing);
    }

    const next = {
      kind: input.kind ?? existing.kind,
      description: input.description ?? existing.description,
      quantity: input.quantity ?? existing.quantity,
      unitPrice: input.unitPrice ?? existing.unitPrice,
    } as OrderItemData;
    if ((hasDetails || priceChanged) && !isOrderItemKindCompatibleWithService(next.kind, existing.service?.type)) {
      throw new OrderCommandError("Каталогийн үйлчилгээний мөрийн төрлийг өөрчлөх боломжгүй.", 422, "ITEM_KIND_SERVICE_MISMATCH", { kind: "Каталогийн үйлчилгээний мөрийн төрлийг өөрчлөх боломжгүй." });
    }
    if (hasDetails || priceChanged) assertItemValues(next);
    if (priceChanged || next.kind !== existing.kind || !next.quantity.equals(existing.quantity)) {
      await assertNoPaidPayments(tx, actor.tenantId, orderId);
    }
    if (hasStatus) {
      if (!canChangeServiceItemStatus(existing.status)) throw new OrderCommandError("Цуцлагдсан мөрийн явцыг өөрчлөх боломжгүй.", 422, "ITEM_CANCELLED");
      if (next.kind === "PART") throw new OrderCommandError("Сэлбэг мөрийн явц байхгүй.", 422, "PART_STATUS_UNSUPPORTED");
      if (input.nextStatus === "COMPLETED" && next.kind === "DIAGNOSTIC" && !existing.diagnosticReportId) {
        throw new OrderCommandError("Оношилгоог эхлээд бөглөнө үү.", 422, "DIAGNOSTIC_REPORT_REQUIRED");
      }
    }

    const total = roundItemTotal(next.quantity, next.unitPrice);
    const isGoods = existing.serviceId != null && existing.service?.type === "GOODS";
    const delta = hasDetails && isGoods ? next.quantity.minus(existing.quantity) : null;
    const updated = await tx.serviceItem.update({
      where: { id: itemId },
      data: {
        ...(hasDetails ? { kind: next.kind, description: next.description, quantity: next.quantity } : {}),
        ...(priceChanged ? { unitPrice: next.unitPrice, total } : {}),
        ...(hasDetails && !priceChanged ? { total } : {}),
        ...(hasStatus ? { status: input.nextStatus, ...serviceItemTimingPatch(input.nextStatus!, existing.startedAt) } : {}),
      },
      select: orderItemSelect(),
    });
    if (delta && !delta.isZero() && existing.serviceId) {
      const service = await tx.service.update({ where: { id: existing.serviceId }, data: { stock: { decrement: delta } }, select: { stock: true } });
      if (service.stock != null && service.stock.lt(0)) throw new OrderCommandError("Үлдэгдэл хүрэлцэхгүй байна.", 422, "INSUFFICIENT_STOCK", { quantity: "Үлдэгдэл хүрэхгүй байна." });
      await logAudit({ tenantId: actor.tenantId, userId: actor.id, entity: "Service", entityId: existing.serviceId, action: "STOCK_CHANGE", summary: `${delta.gt(0) ? "-" : "+"}${delta.abs().toString()} (засварын хуудас засварласан)`, after: { delta: delta.toString(), reason: "ORDER_ITEM_PATCH" } }, tx);
    }
    if (hasDetails || priceChanged) {
      await logAudit({ tenantId: actor.tenantId, userId: actor.id, entity: "ServiceOrder", entityId: orderId, action: "ITEM_UPDATED", summary: `${next.kind} · ${next.description} × ${next.quantity.toString()} @ ${next.unitPrice.toString()}`, before: { kind: existing.kind, description: existing.description, quantity: existing.quantity.toString(), unitPrice: existing.unitPrice.toString() }, after: { kind: next.kind, description: next.description, quantity: next.quantity.toString(), unitPrice: next.unitPrice.toString(), total: total.toString() } }, tx);
      await recomputeOrderTotal(tx, orderId);
    }
    if (hasStatus) {
      await logAudit({ tenantId: actor.tenantId, userId: actor.id, entity: "ServiceOrder", entityId: orderId, action: "ITEM_STATUS_CHANGE", summary: `${existing.status} → ${input.nextStatus} (мөр ${existing.id})`, before: { status: existing.status }, after: { status: input.nextStatus } }, tx);
    }
    return updated;
  });
}

export async function cancelOrderItemCommand(input: { actor: OrderCommandActor; orderId: string; itemId: string; scope?: string | null }) {
  const { actor, orderId, itemId, scope } = input;
  return withOrderTransaction(actor.tenantId, orderId, { id: true, branchId: true, status: true, assignedToId: true }, async (tx, raw) => {
    const order = raw as ItemOrder | null;
    if (!order) throw new OrderCommandError("Засварын хуудас олдсонгүй.", 404, "ORDER_NOT_FOUND");
    assertOrderItemAccess(actor, order, scope);
    const item = await tx.serviceItem.findFirst({ where: { id: itemId, orderId }, select: { ...orderItemSelect(), service: { select: { type: true } } } });
    if (!item) throw new OrderCommandError("Мөр олдсонгүй.", 404, "ITEM_NOT_FOUND");
    assertItemNotCompleted(item.status);
    if (!isServiceItemCancellable(item.status)) throw new OrderCommandError("Энэ мөрийг цуцлах боломжгүй.", 422, "ITEM_NOT_CANCELLABLE");
    if (!item.total.isZero()) await assertNoPaidPayments(tx, actor.tenantId, orderId);
    const now = new Date();
    await tx.serviceItem.update({ where: { id: itemId }, data: { status: "CANCELLED", cancelledAt: now, cancelledById: actor.id }, select: { id: true } });
    await logAudit({ tenantId: actor.tenantId, userId: actor.id, entity: "ServiceOrder", entityId: orderId, action: "ITEM_CANCELLED", summary: `цуцалсан мөр ${item.id}`, before: { itemId: item.id, serviceId: item.serviceId, quantity: item.quantity.toString() } }, tx);
    if (item.serviceId && item.service?.type === "GOODS") {
      await tx.service.update({ where: { id: item.serviceId }, data: { stock: { increment: item.quantity } } });
      await logAudit({ tenantId: actor.tenantId, userId: actor.id, entity: "Service", entityId: item.serviceId, action: "STOCK_CHANGE", summary: `+${item.quantity.toString()} (мөр цуцлагдсан)`, after: { delta: `+${item.quantity.toString()}`, reason: "ORDER_ITEM_CANCEL" } }, tx);
    }
    const total = await recomputeOrderTotal(tx, orderId);
    return { itemId, serviceId: item.serviceId, total };
  });
}

export async function changeOrderItemStatusCommand(input: { actor: OrderCommandActor; orderId: string; itemId: string; nextStatus: Exclude<ServiceItemStatus, "CANCELLED">; scope?: string | null }) {
  const { actor, orderId, itemId, nextStatus, scope } = input;
  return withOrderTransaction(actor.tenantId, orderId, { id: true, branchId: true, status: true, assignedToId: true }, async (tx, raw) => {
    const order = raw as ItemOrder | null;
    if (!order) throw new OrderCommandError("Засварын хуудас олдсонгүй.", 404, "ORDER_NOT_FOUND");
    if (!canChangeOrderItemStatus(actor, order)) throw new OrderCommandError("Танд үйлчилгээний мөрийн явц өөрчлөх эрх байхгүй.", 403, "ITEM_STATUS_FORBIDDEN");
    if (!isOrderBranchInScope(actor, order.branchId, scope)) throw new OrderCommandError("Зөвхөн өөрийн салбарын засварын хуудсыг удирдана.", 404, "ORDER_OUT_OF_SCOPE");
    assertOrderInProgressForItemStatus(order.status);
    if (isOrderLocked(order.status)) throw new OrderCommandError("Дууссан засварын хуудсанд мөрийн явцыг өөрчлөх боломжгүй.", 422, "ORDER_LOCKED");
    const item = await tx.serviceItem.findFirst({ where: { id: itemId, orderId }, select: { id: true, kind: true, status: true, startedAt: true, diagnosticReportId: true } });
    if (!item) throw new OrderCommandError("Мөр олдсонгүй.", 404, "ITEM_NOT_FOUND");
    if (!canChangeServiceItemStatus(item.status)) throw new OrderCommandError("Цуцлагдсан мөрийн явцыг өөрчлөх боломжгүй.", 422, "ITEM_CANCELLED");
    if (nextStatus === item.status && item.status === "COMPLETED") return tx.serviceItem.findFirstOrThrow({ where: { id: itemId }, select: orderItemSelect() });
    assertCompletedItemStatusChange(item);
    if (item.kind === "PART") throw new OrderCommandError("Сэлбэг мөрийн явц байхгүй.", 422, "PART_STATUS_UNSUPPORTED");
    if (nextStatus === "COMPLETED" && item.kind === "DIAGNOSTIC" && !item.diagnosticReportId) throw new OrderCommandError("Оношилгоог эхлээд бөглөнө үү.", 422, "DIAGNOSTIC_REPORT_REQUIRED");
    const updated = await tx.serviceItem.update({ where: { id: itemId }, data: { status: nextStatus, ...serviceItemTimingPatch(nextStatus, item.startedAt) }, select: orderItemSelect() });
    await logAudit({ tenantId: actor.tenantId, userId: actor.id, entity: "ServiceOrder", entityId: orderId, action: "ITEM_STATUS_CHANGE", summary: `${item.status} → ${nextStatus} (мөр ${item.id})`, before: { status: item.status }, after: { status: nextStatus } }, tx);
    return updated;
  });
}

export function assertOrderInProgressForItemStatus(status: OrderStatus): void {
  if (status !== "IN_PROGRESS") {
    throw new OrderCommandError(
      "Мөрийн явцыг зөвхөн ажиллаж буй захиалгад өөрчилнө үү.",
      422,
      "ORDER_STATUS_INVALID",
    );
  }
}

export async function changeOrderItemPriceCommand(input: { actor: OrderCommandActor; orderId: string; itemId: string; unitPrice: Prisma.Decimal; scope?: string | null }) {
  const { actor, orderId, itemId, unitPrice, scope } = input;
  return withOrderTransaction(actor.tenantId, orderId, { id: true, branchId: true, status: true, assignedToId: true }, async (tx, raw) => {
    const order = raw as ItemOrder | null;
    if (!order) throw new OrderCommandError("Засварын хуудас олдсонгүй.", 404, "ORDER_NOT_FOUND");
    if (!canChangeOrderItemPrice(actor, order)) throw new OrderCommandError("Танд үйлчилгээний мөрийн үнэ өөрчлөх эрх байхгүй.", 403, "ITEM_PRICE_FORBIDDEN");
    if (!isOrderBranchInScope(actor, order.branchId, scope)) throw new OrderCommandError("Зөвхөн өөрийн салбарын засварын хуудсыг удирдана.", 404, "ORDER_OUT_OF_SCOPE");
    if (isOrderLocked(order.status)) throw new OrderCommandError("Дууссан засварын хуудсанд мөрийн үнийг өөрчлөх боломжгүй.", 422, "ORDER_LOCKED");
    const item = await tx.serviceItem.findFirst({ where: { id: itemId, orderId }, select: { ...orderItemSelect() } });
    if (!item) throw new OrderCommandError("Мөр олдсонгүй.", 404, "ITEM_NOT_FOUND");
    if (item.status === "CANCELLED") throw new OrderCommandError("Цуцлагдсан мөрийн үнийг өөрчлөх боломжгүй.", 422, "ITEM_CANCELLED");
    if (unitPrice.equals(item.unitPrice)) return item;
    assertItemNotCompleted(item.status);
    assertItemValues({ kind: item.kind, description: item.description, quantity: item.quantity, unitPrice });
    await assertNoPaidPayments(tx, actor.tenantId, orderId);
    const total = roundItemTotal(item.quantity, unitPrice);
    const updated = await tx.serviceItem.update({ where: { id: itemId }, data: { unitPrice, total }, select: orderItemSelect() });
    await logAudit({ tenantId: actor.tenantId, userId: actor.id, entity: "ServiceOrder", entityId: orderId, action: "ITEM_UPDATED", summary: `Үнэ: ${item.unitPrice.toString()} → ${unitPrice.toString()} (мөр ${item.id})`, before: { unitPrice: item.unitPrice.toString(), total: item.total.toString() }, after: { unitPrice: unitPrice.toString(), total: total.toString() } }, tx);
    await recomputeOrderTotal(tx, orderId);
    return updated;
  });
}

export async function listCancelledOrderItems(input: { actor: OrderCommandActor; orderId: string; page: number; pageSize: number; scope?: string | null }) {
  if (!Number.isSafeInteger(input.page) || input.page < 1 || input.page > MAX_ITEM_HISTORY_PAGE) {
    throw new OrderCommandError("Хуудасны параметр буруу.", 400, "ITEM_HISTORY_PAGE_INVALID");
  }
  if (!Number.isSafeInteger(input.pageSize) || input.pageSize < 1 || input.pageSize > MAX_ITEM_HISTORY_PAGE_SIZE) {
    throw new OrderCommandError("Хуудасны параметр буруу.", 400, "ITEM_HISTORY_PAGE_SIZE_INVALID");
  }
  const order = await prisma.serviceOrder.findFirst({ where: { id: input.orderId, tenantId: input.actor.tenantId }, select: { id: true, branchId: true, assignedToId: true } });
  if (!order) throw new OrderCommandError("Засварын хуудас олдсонгүй.", 404, "ORDER_NOT_FOUND");
  if (!isOrderBranchInScope(input.actor, order.branchId, input.scope)) throw new OrderCommandError("Зөвхөн өөрийн салбарын засварын хуудсыг харна.", 404, "ORDER_OUT_OF_SCOPE");
  if (!canViewOrderItemHistory(input.actor, order)) throw new OrderCommandError("Танд мөрийн түүх харах эрх байхгүй.", 403, "ITEM_HISTORY_FORBIDDEN");
  const skip = (input.page - 1) * input.pageSize;
  if (!Number.isSafeInteger(skip) || skip > MAX_ITEM_HISTORY_SKIP) {
    throw new OrderCommandError("Хуудасны параметр буруу.", 400, "ITEM_HISTORY_PAGE_INVALID");
  }
  const where = { orderId: input.orderId, status: "CANCELLED" as const };
  const [items, total] = await Promise.all([
    prisma.serviceItem.findMany({ where, orderBy: [{ cancelledAt: "desc" }, { id: "desc" }], skip, take: input.pageSize, select: { ...orderItemSelect(), cancelledBy: { select: { id: true, firstName: true, lastName: true } } } }),
    prisma.serviceItem.count({ where }),
  ]);
  return { items, total, page: input.page, pageSize: input.pageSize, totalPages: Math.ceil(total / input.pageSize) };
}

export function parseOrderItemDecimal(value: unknown, maxScale?: number): Prisma.Decimal | null {
  const raw = typeof value === "number" ? String(value) : typeof value === "string" ? value.trim() : "";
  if (!raw) return null;
  try {
    const decimal = new Prisma.Decimal(raw);
    return decimal.isFinite() && decimal.gte(0) && (maxScale === undefined || decimal.decimalPlaces() <= maxScale) ? decimal : null;
  } catch {
    return null;
  }
}

export function parseItemHistoryInteger(value: string | null, defaultValue: number, maxValue: number): number | null {
  const raw = value == null ? String(defaultValue) : value.trim();
  if (!/^\d+$/.test(raw)) return null;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) && parsed >= 1 && parsed <= maxValue ? parsed : null;
}
