"use server";

import { Prisma } from "@/app/generated/prisma/client";
import { requireUser } from "@/lib/auth";
import { canEditOrder as canEditAssignedOrder, canViewOrder } from "@/lib/auth/order-access";
import { canCreate, canView, hasPermission, workingBranchScopeId } from "@/lib/auth/roles";
import { PAID_PAYMENT_LOCKED_CANCEL_REASON } from "@/lib/cash/locked-copy";
import { findLockedPaymentIds } from "@/lib/cash/session-attach";
import { ORDER_STATUS_TRANSITIONS, type OrderStatus } from "@/lib/orders";
import { canSettlePostpaidOrder } from "@/lib/orders/order-commands";
import { orderCompleteBlockedReason } from "@/lib/orders/order-complete-guard";
import { listPickerAccounts } from "@/lib/payment-account-service";
import { prisma } from "@/lib/prisma";
import { calculateServiceItemDurationMinutes } from "@/lib/service-duration";
import type { PaymentAccountOption } from "@/app/dashboard/_components/payment-method-modal";
import { openSessionBranchIds } from "@/app/dashboard/cash/open-sessions";

// Засварын хуудасны жагсаалтын мөрийн «Төлбөр бүртгэх» / «Төлөв өөрчлөх»
// modal-д хэрэгтэй өгөгдлийг шаардлагатай үед нь (modal нээхэд) ачаална —
// жагсаалтын мөр бүрт урьдчилж тооцохгүй. Тооцоолол нь засварын хуудасны
// дэлгэрэнгүй (app/dashboard/orders/[id]/page.tsx)-тэй ижил; бичих үйлдэл
// бүрийг сервер action өөрөө дахин шалгана.

export type OrderQuickContext = {
  ok: true;
  id: string;
  number: string;
  status: OrderStatus;
  canEditOrder: boolean;
  transitions: OrderStatus[];
  estimatedDurationMinutes: number | null;
  serviceItemDurationMinutes: number | null;
  completeBlockedReason: string | null;
  cancelBlockedReason: string | null;
  payment: {
    remaining: string;
    canRecord: boolean;
    cashSessionOpen: boolean;
    banks: PaymentAccountOption[];
    canManageAccounts: boolean;
  } | null;
};

export async function getOrderQuickContextAction(
  orderId: string,
): Promise<OrderQuickContext | { ok: false; message: string }> {
  const user = await requireUser();
  if (!canView(user, "orders")) return { ok: false, message: "Танд засварын хуудас харах эрх байхгүй." };
  if (typeof orderId !== "string" || !orderId) return { ok: false, message: "Буруу хүсэлт." };
  const scopeBranchId = workingBranchScopeId(user);

  const order = await prisma.serviceOrder.findFirst({
    where: { id: orderId, tenantId: user.tenantId, ...(scopeBranchId ? { branchId: scopeBranchId } : {}) },
    select: {
      id: true,
      number: true,
      status: true,
      branchId: true,
      assignedToId: true,
      isInternal: true,
      isPostpaid: true,
      totalAmount: true,
      paidAmount: true,
      estimatedDurationMinutes: true,
      items: {
        select: {
          kind: true,
          status: true,
          quantity: true,
          diagnosticReportId: true,
          diagnosticTemplate: { select: { durationMin: true } },
          service: { select: { durationValue: true, durationUnit: { select: { name: true, code: true } } } },
        },
      },
    },
  });
  if (!order || !canViewOrder(user, order)) return { ok: false, message: "Засварын хуудас олдсонгүй." };

  const status = order.status as OrderStatus;
  const remaining = (order.totalAmount ?? new Prisma.Decimal(0)).minus(order.paidAmount ?? new Prisma.Decimal(0));
  const activeItems = order.items.filter((it) => it.status !== "CANCELLED" && it.kind !== "PART");
  const unfinished = activeItems.filter((it) => it.status !== "COMPLETED").length;
  const unfilledDiagnostics = activeItems.filter((it) => it.kind === "DIAGNOSTIC" && !it.diagnosticReportId).length;

  const paidIds = (
    await prisma.orderPayment.findMany({ where: { orderId: order.id, status: "PAID" }, select: { id: true } })
  ).map((p) => p.id);
  const lockedIds = await findLockedPaymentIds(prisma, user.tenantId, paidIds);

  const canSettle = canSettlePostpaidOrder(user, { isPostpaid: order.isPostpaid, status: order.status });
  const canRecord = canCreate(user, "payments") && canSettle && !order.isInternal && status !== "CANCELLED";
  let payment: OrderQuickContext["payment"] = null;
  if (canRecord && remaining.gt(0)) {
    const [openIds, banks] = await Promise.all([
      openSessionBranchIds(user.tenantId, [order.branchId]),
      listPickerAccounts(user.tenantId),
    ]);
    payment = {
      remaining: remaining.toString(),
      canRecord,
      cashSessionOpen: openIds.length > 0,
      banks,
      canManageAccounts: hasPermission(user, "cash.manage"),
    };
  }

  return {
    ok: true,
    id: order.id,
    number: order.number,
    status,
    canEditOrder: canEditAssignedOrder(user, order),
    transitions: ORDER_STATUS_TRANSITIONS[status],
    estimatedDurationMinutes: order.estimatedDurationMinutes,
    serviceItemDurationMinutes: calculateServiceItemDurationMinutes(order.items),
    completeBlockedReason: orderCompleteBlockedReason({
      unfilledDiagnostics,
      unfinishedItems: unfinished,
      isInternal: order.isInternal,
      isPostpaid: order.isPostpaid,
      remaining,
      canCloseUnpaidPostpaid: hasPermission(user, "orders.closeUnpaidPostpaid"),
    }),
    cancelBlockedReason: lockedIds.size > 0 ? PAID_PAYMENT_LOCKED_CANCEL_REASON : null,
    payment,
  };
}
