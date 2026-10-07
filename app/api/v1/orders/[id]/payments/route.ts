import { jsonError, jsonOk, requireApiUser, requirePermission } from "@/lib/api";
import { resolveWorkingBranch } from "@/lib/auth/api-branch";
import { requireActiveSubscriptionApi } from "@/lib/subscription-server";
import {
  createOrderPaymentCommand,
  isOrderPaymentMethod,
  listOrderPaymentsCommand,
  notifyOrderPaymentReceived,
  OrderPaymentCommandError,
  parseOrderPaymentAmount,
  serializeLedgerPayment,
} from "@/lib/orders/order-payment-commands";

function commandError(error: unknown) {
  if (error instanceof OrderPaymentCommandError) return jsonError(error.status, error.message, { code: error.code, ...(error.fieldErrors ? { fieldErrors: error.fieldErrors } : {}) });
  console.error("[orders/payments] command failed", error instanceof Error ? { name: error.name } : { name: "UnknownError" });
  return jsonError(500, "Серверийн алдаа гарлаа. Дахин оролдоно уу.");
}

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireApiUser(req);
  if (auth.response) return auth.response;
  const denied = requirePermission(auth.user, "payments.view");
  if (denied) return denied;
  const { id } = await ctx.params;
  const scopeResult = await resolveWorkingBranch(req, auth.user);
  if (scopeResult.response) return scopeResult.response;
  try {
    const payments = await listOrderPaymentsCommand({ actor: auth.user, orderId: id, scope: scopeResult.branchId });
    return jsonOk({ payments: payments.map((p) => serializeLedgerPayment(p, p.locked)) });
  } catch (error) {
    return commandError(error);
  }
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireApiUser(req);
  if (auth.response) return auth.response;
  const denied = requirePermission(auth.user, "payments.create");
  if (denied) return denied;
  const locked = await requireActiveSubscriptionApi(auth.user);
  if (locked) return locked;
  let body: unknown;
  try { body = await req.json(); } catch { return jsonError(400, "JSON body шаардлагатай."); }
  if (body == null || typeof body !== "object" || Array.isArray(body)) return jsonError(400, "JSON object шаардлагатай.");
  const b = body as Record<string, unknown>;
  if (!isOrderPaymentMethod(b.method)) return jsonError(422, "Төлбөрийн арга буруу.", { fieldErrors: { method: "Төлбөрийн арга буруу." } });
  const amount = parseOrderPaymentAmount(b.amount);
  if (!amount) return jsonError(422, "Дүнг зөв оруулна уу.", { fieldErrors: { amount: "Дүнг зөв оруулна уу." } });
  const { id } = await ctx.params;
  const scopeResult = await resolveWorkingBranch(req, auth.user);
  if (scopeResult.response) return scopeResult.response;
  try {
    const result = await createOrderPaymentCommand({ actor: auth.user, orderId: id, method: b.method, amount, bank: typeof b.bank === "string" ? b.bank : null, scope: scopeResult.branchId });
    await notifyOrderPaymentReceived({ tenantId: auth.user.tenantId, orderId: result.orderId, amount: amount.toString(), accountId: result.accountId, appointmentId: result.appointmentId });
    return jsonOk({ payment: serializeLedgerPayment(result.payment), order: { paidAmount: result.totals.paid.toString(), paymentStatus: result.totals.status, totalAmount: result.totals.total.toString(), remainingAmount: result.totals.remaining.toString() } }, { status: 201 });
  } catch (error) {
    return commandError(error);
  }
}
