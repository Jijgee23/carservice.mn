"use server";

import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { canCreate, canDelete, canEdit, hasPermission } from "@/lib/auth/roles";
import { ALL_BRANCHES } from "@/lib/auth/session";
import { revalidateCashPaths } from "@/lib/cash/revalidate";
import { prisma } from "@/lib/prisma";
import { searchPayableOrders, type PayableOrderRow } from "@/lib/orders/order-payment-search";
import { requireUser } from "@/lib/auth";
import { knownAuthorizationMessage } from "@/lib/action-errors";
import { assertActiveSubscription } from "@/lib/subscription-server";
import {
  cancelOrderQPayPaymentCommand,
  confirmOrderQPayPaymentCommand,
  createOrderPaymentCommand,
  createOrderQPayInvoiceCommand,
  notifyOrderPaymentReceived,
  OrderPaymentCommandError,
  parseOrderPaymentAmount,
  reverseOrderPaymentCommand,
} from "@/lib/orders/order-payment-commands";
import { ORDER_PAYMENT_METHODS, type OrderPaymentMethod } from "@/lib/orders";

export type OrderPaymentActionState = {
  ok: boolean;
  message?: string;
  paymentId?: string;
  change?: string;
} | null;

function s(fd: FormData, key: string): string {
  const value = fd.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function messageFrom(error: unknown, fallback: string): string {
  if (error instanceof OrderPaymentCommandError) return error.message;
  // assertActiveSubscription throws a plain Error; its message is safe and tells the user what to do.
  return knownAuthorizationMessage(error) ?? fallback;
}

export async function createOrderQPayInvoiceAction(
  _prev: OrderPaymentActionState,
  formData: FormData,
): Promise<OrderPaymentActionState> {
  try {
    const user = await requireUser();
    if (!canCreate(user, "payments")) return { ok: false, message: "Танд төлбөр үүсгэх эрх байхгүй." };
    await assertActiveSubscription(user.tenantId);
    const orderId = s(formData, "orderId");
    if (!orderId) return { ok: false, message: "Засварын хуудас шаардлагатай." };
    const result = await createOrderQPayInvoiceCommand({ actor: user, orderId, amount: s(formData, "amount") || undefined });
    revalidatePath(`/dashboard/orders/${orderId}`);
    revalidateCashPaths();
    return { ok: true, paymentId: result.id };
  } catch (error) {
    unstable_rethrow(error);
    // The previous QR turned out to be paid (now recorded): refresh the order page so the panel shows the payment.
    if (error instanceof OrderPaymentCommandError && error.code === "QPAY_PREVIOUS_PAID") {
      const paidOrderId = s(formData, "orderId");
      if (paidOrderId) {
        revalidatePath(`/dashboard/orders/${paidOrderId}`);
        revalidateCashPaths();
      }
    }
    return { ok: false, message: messageFrom(error, "QPay invoice үүсгэхэд алдаа гарлаа.") };
  }
}

export async function checkOrderQPayPaymentAction(
  formData: FormData,
): Promise<{ ok: boolean; paid: boolean; message?: string }> {
  try {
    const user = await requireUser();
    if (!canEdit(user, "payments")) return { ok: false, paid: false, message: "Эрх байхгүй." };
    await assertActiveSubscription(user.tenantId);
    const paymentId = s(formData, "paymentId");
    if (!paymentId) return { ok: false, paid: false, message: "ID шаардлагатай." };
    const result = await confirmOrderQPayPaymentCommand({ actor: user, paymentId });
    if (!result.paid) return { ok: true, paid: false, message: result.message };
    if (result.newlyPaid) await notifyOrderPaymentReceived({ tenantId: user.tenantId, orderId: result.orderId, amount: result.amount, accountId: result.accountId, appointmentId: result.appointmentId });
    revalidatePath(`/dashboard/orders/${result.orderId}`);
    revalidateCashPaths();
    return { ok: true, paid: true };
  } catch (error) {
    unstable_rethrow(error);
    return { ok: false, paid: false, message: messageFrom(error, "Төлбөр шалгахад алдаа гарлаа.") };
  }
}

export async function cancelOrderQPayPaymentAction(
  formData: FormData,
): Promise<{ ok: boolean; message?: string; refresh?: boolean }> {
  try {
    const user = await requireUser();
    if (!canDelete(user, "payments")) return { ok: false, message: "Эрх хүрэлцэхгүй." };
    await assertActiveSubscription(user.tenantId);
    const paymentId = s(formData, "paymentId");
    if (!paymentId) return { ok: false, message: "Төлбөр шаардлагатай." };
    const result = await cancelOrderQPayPaymentCommand({ actor: user, paymentId });
    revalidatePath(`/dashboard/orders/${result.orderId}`);
    revalidateCashPaths();
    return { ok: true };
  } catch (error) {
    unstable_rethrow(error);
    // QPAY_INVOICE_PAID: the invoice was paid and has been recorded — the page must refresh to show it.
    const refresh = error instanceof OrderPaymentCommandError && (error.code === "QPAY_INVOICE_PAID");
    return { ok: false, refresh, message: messageFrom(error, "QPay нэхэмжлэх цуцлахад алдаа гарлаа.") };
  }
}

export async function recordOrderPaymentAction(
  _prev: OrderPaymentActionState,
  formData: FormData,
): Promise<OrderPaymentActionState> {
  try {
    const user = await requireUser();
    if (!canCreate(user, "payments")) return { ok: false, message: "Танд төлбөр бүртгэх эрх байхгүй." };
    await assertActiveSubscription(user.tenantId);
    const orderId = s(formData, "orderId");
    if (!orderId) return { ok: false, message: "Засварын хуудас шаардлагатай." };
    const method = s(formData, "method");
    if (!(ORDER_PAYMENT_METHODS as readonly string[]).includes(method)) return { ok: false, message: "Төлбөрийн арга буруу." };
    const amount = parseOrderPaymentAmount(s(formData, "amount"));
    if (!amount) return { ok: false, message: "Дүнг зөв оруулна уу." };
    const result = await createOrderPaymentCommand({ actor: user, orderId, method: method as OrderPaymentMethod, amount, bank: s(formData, "bank") || null, allowCashChange: true, note: s(formData, "note") || null });
    await notifyOrderPaymentReceived({ tenantId: user.tenantId, orderId: result.orderId, amount: result.payment.amount.toString(), accountId: result.accountId, appointmentId: result.appointmentId });
    revalidatePath(`/dashboard/orders/${orderId}`);
    revalidatePath("/dashboard/orders");
    revalidateCashPaths();
    return { ok: true, paymentId: result.payment.id, change: result.change.gt(0) ? result.change.toString() : undefined };
  } catch (error) {
    unstable_rethrow(error);
    return { ok: false, message: messageFrom(error, "Хадгалахад алдаа.") };
  }
}

export async function reverseOrderPaymentAction(
  _prev: OrderPaymentActionState,
  formData: FormData,
): Promise<OrderPaymentActionState> {
  try {
    const user = await requireUser();
    if (!canDelete(user, "payments")) return { ok: false, message: "Эрх хүрэлцэхгүй." };
    await assertActiveSubscription(user.tenantId);
    const paymentId = s(formData, "paymentId");
    const orderId = s(formData, "orderId");
    if (!paymentId) return { ok: false, message: "Төлбөр шаардлагатай." };
    const result = await reverseOrderPaymentCommand({ actor: user, orderId: orderId || undefined, paymentId });
    revalidatePath(`/dashboard/orders/${result.orderId}`);
    revalidatePath("/dashboard/orders");
    revalidateCashPaths();
    return { ok: true, paymentId };
  } catch (error) {
    unstable_rethrow(error);
    return { ok: false, message: messageFrom(error, "Цуцлахад алдаа.") };
  }
}

/**
 * Cash «Захиалгын төлбөр» picker. Payable orders of ONE branch (the dialog's working branch):
 * not PAID, not internal, not CANCELLED. Empty `q` = most recent. Top 20.
 * Call: `await searchPayableOrdersAction({ branchId, q })` -> `{ ok: true, orders: PayableOrderRow[] } | { ok: false, message }`.
 */
export async function searchPayableOrdersAction(input: {
  branchId: string;
  q?: string;
}): Promise<{ ok: true; orders: PayableOrderRow[] } | { ok: false; message: string }> {
  try {
    const user = await requireUser();
    if (!canCreate(user, "payments") || !hasPermission(user, "cash.manage")) {
      return { ok: false, message: "Эрх байхгүй." };
    }
    const branchId = typeof input?.branchId === "string" ? input.branchId.trim() : "";
    if (!branchId) return { ok: false, message: "Салбар сонгоно уу." };
    if (user.workingBranchId && user.workingBranchId !== ALL_BRANCHES && user.workingBranchId !== branchId) {
      return { ok: false, message: "Энэ салбарт эрхгүй." };
    }
    const branch = await prisma.branch.findFirst({ where: { id: branchId, tenantId: user.tenantId, isActive: true }, select: { id: true } });
    if (!branch) return { ok: false, message: "Салбар олдсонгүй." };
    const orders = await searchPayableOrders({ actor: user, branchId, q: typeof input.q === "string" ? input.q : "" });
    return { ok: true, orders };
  } catch (error) {
    unstable_rethrow(error);
    return { ok: false, message: "Хайлт амжилтгүй." };
  }
}
