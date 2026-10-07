"use server";

// Хуваарийн (Day/Grid) харагдацаас захиалга дээр дарахад унших зорилготой,
// хөнгөн дэлгэрэнгүй мэдээлэл — lib/branch-schedule-loader.ts-ийн Day
// datasets-д items/assignedTo/төлбөр зэргийг тогтмол оруулахгүй (өдрийн
// бүх мөрд хэрэггүй дата ачаалахаас зайлсхийх), харин ажилтан тухайн нэг
// захиалга дээр дарахад л энэ action-аар тусад нь татна.

import { Prisma } from "@/app/generated/prisma/client";
import { requireUser } from "@/lib/auth";
import { canCreate, canDelete, canEdit, canView, workingBranchScopeId } from "@/lib/auth/roles";
import { canViewOrder, canEditOrder } from "@/lib/auth/order-access";
import { tenantVisibleTemplateWhere } from "@/lib/diagnostics";
import { prisma } from "@/lib/prisma";
import type { OrderItemLite } from "@/app/dashboard/orders/[id]/order-items";
import { PAYMENT_LEDGER_SELECT } from "@/lib/orders/order-payment-commands";
import { findLockedPaymentIds } from "@/lib/cash/session-attach";
import type { OrderPaymentRow } from "@/app/dashboard/orders/[id]/order-payments-list";
import type {
  DiagnosticTemplateOption,
  ServiceOption,
} from "@/app/dashboard/orders/[id]/add-item-form";
import { isOrderLocked, type OrderStatus, type PaymentStatus } from "@/lib/orders";

export type ScheduleOrderDetail = {
  id: string;
  number: string;
  branchId: string;
  status: OrderStatus;
  scheduledAt: string | null;
  paymentStatus: PaymentStatus;
  totalAmount: string;
  paidAmount: string | null;
  remainingAmount: string;
  isPostpaid: boolean;
  assignedToName: string | null;
  customerName: string;
  customerPhone: string;
  vehiclePlate: string;
  vehicleMakeModel: string;
  notes: string | null;
  items: OrderItemLite[];
  // Мөр нэмэх (AddItemForm) харагдах эсэх — order/[id]/page.tsx-ийн
  // "isEditable && canEditOrder" адил зарчим (устгасан/дууссан хуудсанд
  // болон "orders" засах эрхгүй ажилтанд харагдахгүй; сервер талд
  // addOrderItemAction өөрөө дахин шалгадаг тул энэ зөвхөн UI-г нуух/харуулах).
  canAddItems: boolean;
  services: ServiceOption[];
  diagnosticTemplates: DiagnosticTemplateOption[];
  payments: OrderPaymentRow[];
  canRecordPayments: boolean;
  canReversePayments: boolean;
};

export async function getScheduleOrderDetail(
  orderId: string,
): Promise<{ ok: true; order: ScheduleOrderDetail } | { ok: false; message: string }> {
  const user = await requireUser();
  if (!canView(user, "orders")) {
    return { ok: false, message: "Танд харах эрх байхгүй." };
  }

  const order = await prisma.serviceOrder.findFirst({
    where: { id: orderId, tenantId: user.tenantId },
    select: {
      id: true,
      number: true,
      branchId: true,
      assignedToId: true,
      status: true,
      scheduledAt: true,
      paymentStatus: true,
      totalAmount: true,
      paidAmount: true,
      isPostpaid: true,
      notes: true,
      assignedTo: { select: { firstName: true, lastName: true } },
      customer: { select: { fullName: true, phone: true } },
      vehicle: { select: { plate: true, make: true, model: true } },
      items: {
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          kind: true,
          description: true,
          quantity: true,
          unitPrice: true,
          total: true,
          status: true,
          cancelledAt: true,
          cancelledBy: { select: { firstName: true, lastName: true } },
          diagnosticReportId: true,
          diagnosticTemplateId: true,
        },
      },
    },
  });
  if (!order) return { ok: false, message: "Засварын хуудас олдсонгүй." };
  if (!canViewOrder(user, order)) {
    return { ok: false, message: "Танд харах эрх байхгүй." };
  }
  const scope = workingBranchScopeId(user);
  if (scope && order.branchId !== scope) {
    return { ok: false, message: "Танд харах эрх байхгүй." };
  }

  const isEditable = order.status !== "COMPLETED" && order.status !== "CANCELLED";
  const canAddItems = isEditable && canEditOrder(user, order) && !isOrderLocked(order.status);

  // order/[id]/page.tsx-тэй адил: аль хэдийн нэмэгдсэн (цуцлагдаагүй)
  // оношилгооны загваруудыг сонголтоос хасна — давхардуулахгүй.
  const usedDiagnosticTemplateIds = new Set(
    order.items
      .filter((it) => it.kind === "DIAGNOSTIC" && it.status !== "CANCELLED")
      .map((it) => it.diagnosticTemplateId)
      .filter((tid): tid is string => Boolean(tid)),
  );

  const [services, diagnosticTemplates] = canAddItems
    ? await Promise.all([
        prisma.service.findMany({
          where: {
            tenantId: user.tenantId,
            isActive: true,
            OR: [{ type: "LABOR" }, { type: "GOODS", stock: { gt: 0 } }],
          },
          orderBy: [{ type: "asc" }, { name: "asc" }],
          select: {
            id: true,
            type: true,
            name: true,
            code: true,
            price: true,
            stock: true,
            unit: { select: { name: true } },
            categoryId: true,
            category: { select: { name: true } },
          },
        }),
        prisma.diagnosticTemplate.findMany({
          where: { ...tenantVisibleTemplateWhere(user.tenantId), isActive: true },
          orderBy: { name: "asc" },
          select: { id: true, name: true, price: true, durationMin: true },
        }),
      ])
    : [[], []];

  // Гараар бүртгэсэн бодит төлбөрүүд (order-payments.ts) — Jijgee23-ийн
  // "payment_list_on_order" өөрчлөлтөөр PAID/PARTIAL/UNPAID цаашид үүнээс
  // автоматаар тооцогдоно, гараар зарлах action байхгүй болсон.
  const orderPayments = await prisma.orderPayment.findMany({
    where: { orderId: order.id, status: { not: "PENDING" } },
    orderBy: { createdAt: "desc" },
    select: PAYMENT_LEDGER_SELECT,
  });
  const lockedPaymentIds = await findLockedPaymentIds(prisma, user.tenantId, orderPayments.map((p) => p.id));
  const remainingAmount = (order.totalAmount ?? new Prisma.Decimal(0))
    .minus(order.paidAmount ?? new Prisma.Decimal(0))
    .toString();

  return {
    ok: true,
    order: {
      id: order.id,
      number: order.number,
      branchId: order.branchId,
      status: order.status as OrderStatus,
      scheduledAt: order.scheduledAt?.toISOString() ?? null,
      paymentStatus: order.paymentStatus as PaymentStatus,
      totalAmount: order.totalAmount?.toString() ?? "0",
      paidAmount: order.paidAmount ? order.paidAmount.toString() : null,
      remainingAmount,
      isPostpaid: order.isPostpaid,
      assignedToName: order.assignedTo
        ? `${order.assignedTo.lastName} ${order.assignedTo.firstName}`
        : null,
      customerName: order.customer.fullName,
      customerPhone: order.customer.phone,
      vehiclePlate: order.vehicle.plate,
      vehicleMakeModel: `${order.vehicle.make} ${order.vehicle.model}`,
      notes: order.notes,
      items: order.items.map((it) => ({
        id: it.id,
        kind: it.kind,
        description: it.description,
        quantity: it.quantity.toString(),
        unitPrice: it.unitPrice.toString(),
        total: it.total.toString(),
        status: it.status,
        cancelledAt: it.cancelledAt?.toISOString() ?? null,
        cancelledByName: it.cancelledBy
          ? `${it.cancelledBy.lastName} ${it.cancelledBy.firstName}`
          : null,
        diagnosticReportId: it.diagnosticReportId,
      })),
      canAddItems,
      services: services.map((s) => ({
        id: s.id,
        type: s.type,
        name: s.name,
        code: s.code,
        unit: s.unit?.name ?? "",
        price: s.price.toString(),
        stock: s.stock != null ? s.stock.toString() : null,
        laborCategoryId: s.categoryId,
        laborCategoryName: s.category?.name ?? null,
      })),
      diagnosticTemplates: diagnosticTemplates
        .filter((t) => !usedDiagnosticTemplateIds.has(t.id))
        .map((t) => ({
          id: t.id,
          name: t.name,
          price: t.price?.toString() ?? "0",
          durationMin: t.durationMin,
        })),
      payments: orderPayments.map((p) => ({
        id: p.id,
        amount: p.amount.toString(),
        method: p.method,
        status: p.status,
        createdAt: p.createdAt.toISOString(),
        bank: p.bank,
        settlementId: p.settlementId,
        locked: lockedPaymentIds.has(p.id),
      })),
      canRecordPayments: canCreate(user, "payments"),
      canReversePayments: canDelete(user, "payments"),
    },
  };
}
