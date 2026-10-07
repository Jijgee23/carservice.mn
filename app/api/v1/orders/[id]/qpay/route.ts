import { jsonError, jsonOk, requireApiUser, requirePermission } from "@/lib/api";
import { resolveWorkingBranch } from "@/lib/auth/api-branch";
import { canViewOrder } from "@/lib/auth/order-access";
import { requireActiveSubscriptionApi } from "@/lib/subscription-server";
import {
  cancelOrderQPayPaymentCommand,
  createOrderQPayInvoiceCommand,
  OrderPaymentCommandError,
} from "@/lib/orders/order-payment-commands";
import { prisma } from "@/lib/prisma";
import { TenantQPayService } from "@/lib/qpay-tenant";

function commandError(error: unknown) {
  if (error instanceof OrderPaymentCommandError) return jsonError(error.status, error.message, { code: error.code, ...(error.fieldErrors ? { fieldErrors: error.fieldErrors } : {}) });
  console.error("[orders/qpay] command failed", error instanceof Error ? { name: error.name } : { name: "UnknownError" });
  return jsonError(500, "Серверийн алдаа гарлаа. Дахин оролдоно уу.");
}

async function resolveUrls(tenantId: string, orderId: string, payment: { id: string; qpayInvoiceId: string | null; qpayUrls: unknown }) {
  if (Array.isArray(payment.qpayUrls) && payment.qpayUrls.length > 0) return payment.qpayUrls;
  if (!payment.qpayInvoiceId) return [];
  const urls = await TenantQPayService.getInvoiceUrls(tenantId, payment.qpayInvoiceId);
  if (urls?.length) {
    await prisma.orderPayment.updateMany({ where: { id: payment.id, tenantId, orderId, status: "PENDING" }, data: { qpayUrls: urls } });
    return urls;
  }
  return Array.isArray(payment.qpayUrls) ? payment.qpayUrls : [];
}

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireApiUser(req);
  if (auth.response) return auth.response;
  const denied = requirePermission(auth.user, "payments.view");
  if (denied) return denied;
  const { id } = await ctx.params;
  const scopeResult = await resolveWorkingBranch(req, auth.user);
  if (scopeResult.response) return scopeResult.response;
  const order = await prisma.serviceOrder.findFirst({ where: { id, tenantId: auth.user.tenantId, ...(scopeResult.branchId ? { branchId: scopeResult.branchId } : {}) }, select: { id: true, assignedToId: true } });
  if (!order) return jsonError(404, "Засварын хуудас олдсонгүй.");
  if (!canViewOrder(auth.user, order)) return jsonError(403, "Танд энэ засварын хуудсыг харах эрх байхгүй.");
  const [qpayConfig, pending] = await Promise.all([
    prisma.tenantQPaySettings.findUnique({ where: { tenantId: auth.user.tenantId }, select: { enabled: true } }),
    prisma.orderPayment.findFirst({ where: { tenantId: auth.user.tenantId, orderId: id, status: "PENDING", method: "QPAY" }, orderBy: { createdAt: "desc" }, select: { id: true, amount: true, qrImage: true, qrText: true, qpayUrls: true, qpayInvoiceId: true } }),
  ]);
  return jsonOk({ qpayEnabled: Boolean(qpayConfig?.enabled), pending: pending ? { id: pending.id, amount: pending.amount.toString(), qrImage: pending.qrImage, qrText: pending.qrText, urls: await resolveUrls(auth.user.tenantId, id, pending) } : null });
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireApiUser(req);
  if (auth.response) return auth.response;
  const denied = requirePermission(auth.user, "payments.create");
  if (denied) return denied;
  const locked = await requireActiveSubscriptionApi(auth.user);
  if (locked) return locked;
  const { id } = await ctx.params;
  const scopeResult = await resolveWorkingBranch(req, auth.user);
  if (scopeResult.response) return scopeResult.response;
  // Optional body { amount }; empty/missing body = remaining balance.
  let amount: string | undefined;
  const rawBody = await req.text();
  if (rawBody.trim()) {
    let body: unknown;
    try { body = JSON.parse(rawBody); } catch { return jsonError(400, "JSON body буруу байна."); }
    if (body == null || typeof body !== "object" || Array.isArray(body)) return jsonError(400, "JSON object шаардлагатай.");
    const raw = (body as Record<string, unknown>).amount;
    if (raw !== undefined && raw !== null) {
      if (typeof raw !== "string") return jsonError(422, "Дүн буруу байна.", { code: "QPAY_AMOUNT_INVALID" });
      amount = raw;
    }
  }
  try {
    const payment = await createOrderQPayInvoiceCommand({ actor: auth.user, orderId: id, amount, scope: scopeResult.branchId });
    return jsonOk({ payment: { id: payment.id, amount: payment.amount, qrImage: payment.qrImage, qrText: payment.qrText, urls: payment.urls } });
  } catch (error) {
    return commandError(error);
  }
}

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireApiUser(req);
  if (auth.response) return auth.response;
  const denied = requirePermission(auth.user, "payments.delete");
  if (denied) return denied;
  const locked = await requireActiveSubscriptionApi(auth.user);
  if (locked) return locked;
  const { id } = await ctx.params;
  const scopeResult = await resolveWorkingBranch(req, auth.user);
  if (scopeResult.response) return scopeResult.response;
  let body: unknown;
  try { body = await req.json(); } catch { return jsonError(400, "JSON body шаардлагатай."); }
  if (body == null || typeof body !== "object" || Array.isArray(body)) return jsonError(400, "JSON object шаардлагатай.");
  const paymentId = (body as Record<string, unknown>).paymentId;
  if (typeof paymentId !== "string" || !paymentId.trim()) return jsonError(400, "paymentId шаардлагатай.");
  try {
    const result = await cancelOrderQPayPaymentCommand({ actor: auth.user, orderId: id, paymentId: paymentId.trim(), scope: scopeResult.branchId });
    return jsonOk({ ok: true, paymentId: result.paymentId });
  } catch (error) {
    return commandError(error);
  }
}
