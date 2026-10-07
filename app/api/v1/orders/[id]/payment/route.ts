import { Prisma } from "@/app/generated/prisma/client";
import { jsonError, jsonOk, requireApiUser, requirePermission } from "@/lib/api";
import { resolveWorkingBranch } from "@/lib/auth/api-branch";
import { requireActiveSubscriptionApi } from "@/lib/subscription-server";
import {
  createOrderPaymentCommand,
  isOrderPaymentMethod,
  notifyOrderPaymentReceived,
  OrderPaymentCommandError,
  parseOrderPaymentAmount,
  reverseAllOrderPaymentsCommand,
} from "@/lib/orders/order-payment-commands";
import { prisma } from "@/lib/prisma";
import { PAID_AT_SELECT, withPaidInFull } from "@/lib/orders/order-payment-totals";

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
  vehicle: { select: { id: true, plate: true, make: true, model: true, year: true, vin: true, mileage: true } },
  branch: { select: { id: true, name: true } },
  assignedTo: { select: { id: true, firstName: true, lastName: true } },
  items: {
    orderBy: { createdAt: "asc" as const },
    select: { id: true, kind: true, description: true, quantity: true, unitPrice: true, total: true, serviceId: true, status: true },
  },
  reports: {
    orderBy: { createdAt: "desc" as const },
    select: { id: true, createdAt: true, template: { select: { id: true, name: true, type: true } } },
  },
} satisfies Prisma.ServiceOrderSelect;

function commandError(error: unknown) {
  if (error instanceof OrderPaymentCommandError) return jsonError(error.status, error.message, { code: error.code, ...(error.fieldErrors ? { fieldErrors: error.fieldErrors } : {}) });
  console.error("[orders/payment-legacy] command failed", error instanceof Error ? { name: error.name } : { name: "UnknownError" });
  return jsonError(500, "Серверийн алдаа гарлаа. Дахин оролдоно уу.");
}

/**
 * Compatibility adapter only. It deliberately cannot write ServiceOrder's
 * scalar payment fields: a PAID transition is represented by an OrderPayment
 * ledger row and the aggregate is recomputed by the shared command.
 */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireApiUser(req);
  if (auth.response) return auth.response;
  const locked = await requireActiveSubscriptionApi(auth.user);
  if (locked) return locked;
  let body: unknown;
  try { body = await req.json(); } catch { return jsonError(400, "JSON body шаардлагатай."); }
  if (body == null || typeof body !== "object" || Array.isArray(body)) return jsonError(400, "JSON object шаардлагатай.");
  const b = body as Record<string, unknown>;
  if (b.paymentStatus !== "PAID" && b.paymentStatus !== "PARTIAL" && b.paymentStatus !== "UNPAID") return jsonError(422, "Шууд төлбөрийн төлөв өөрчлөх боломжгүй. /payments endpoint-ийг ашиглана уу.");
  const requiredPermission = b.paymentStatus === "UNPAID" ? "payments.delete" : "payments.create";
  const denied = requirePermission(auth.user, requiredPermission);
  if (denied) return denied;
  const { id } = await ctx.params;
  const scopeResult = await resolveWorkingBranch(req, auth.user);
  if (scopeResult.response) return scopeResult.response;
  if (b.paymentStatus === "UNPAID") {
    try {
      await reverseAllOrderPaymentsCommand({ actor: auth.user, orderId: id, scope: scopeResult.branchId });
      const order = await prisma.serviceOrder.findFirst({ where: { id, tenantId: auth.user.tenantId, ...(scopeResult.branchId ? { branchId: scopeResult.branchId } : {}) }, select: ORDER_DETAIL_SELECT });
      if (!order) return jsonError(404, "Засварын хуудас олдсонгүй.");
      return jsonOk({ order: withPaidInFull(order) });
    } catch (error) {
      return commandError(error);
    }
  }
  const method = b.method === undefined ? "OTHER" : b.method;
  if (!isOrderPaymentMethod(method)) return jsonError(422, "Төлбөрийн арга буруу.", { fieldErrors: { method: "Төлбөрийн арга буруу." } });
  // The old Flutter adapter sends a JSON number. Convert its canonical
  // decimal text immediately; all validation and arithmetic still happen with
  // Prisma.Decimal in the shared command (never with a JS float).
  const legacyAmount = typeof b.amount === "number" && Number.isFinite(b.amount) ? String(b.amount) : b.amount;
  const amount = b.amount === undefined ? null : parseOrderPaymentAmount(legacyAmount);
  if (b.amount !== undefined && !amount) return jsonError(422, "Дүнг зөв оруулна уу.", { fieldErrors: { amount: "Дүнг зөв оруулна уу." } });
  if (b.paymentStatus === "PARTIAL" && !amount) return jsonError(422, "Хагас төлбөрт дүн шаардлагатай.", { fieldErrors: { amount: "Дүн оруулна уу." } });
  try {
    const result = await createOrderPaymentCommand({ actor: auth.user, orderId: id, method, amount, bank: typeof b.bank === "string" ? b.bank : null, scope: scopeResult.branchId });
    await notifyOrderPaymentReceived({ tenantId: auth.user.tenantId, orderId: result.orderId, amount: result.payment.amount.toString(), accountId: result.accountId, appointmentId: result.appointmentId });
    const order = await prisma.serviceOrder.findFirst({
      where: { id, tenantId: auth.user.tenantId, ...(scopeResult.branchId ? { branchId: scopeResult.branchId } : {}) },
      select: ORDER_DETAIL_SELECT,
    });
    if (!order) return jsonError(404, "Засварын хуудас олдсонгүй.");
    return jsonOk({ order: withPaidInFull(order), paymentId: result.payment.id });
  } catch (error) {
    return commandError(error);
  }
}
