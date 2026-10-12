import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";

const src = (path: string) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
function fn(source: string, header: string, end = "\nexport "): string {
  const start = source.indexOf(header);
  assert.ok(start >= 0, `missing ${header}`);
  const next = source.indexOf(end, start + header.length);
  return source.slice(start, next < 0 ? undefined : next);
}

test("cancelOrderQPayPaymentCommand: blocked sweep throws a specific 409 before the local cancel, not QPAY_PAYMENT_RACE", async () => {
  const body = fn(await src("lib/orders/order-payment-commands.ts"), "export async function cancelOrderQPayPaymentCommand");
  const blockedAt = body.indexOf("sweep.blocked.length > 0");
  assert.ok(blockedAt > 0);
  assert.ok(blockedAt < body.indexOf("updateMany"));
  assert.match(body, /sweep\.blockedReasons\?\.\[preflight\.payment\.id\]/);
  assert.match(body, /"QPAY_ORDER_CANCELLED" : "QPAY_OVERPAYMENT"/);
  assert.doesNotMatch(body, /serviceOrder\.findFirst/);
  assert.match(body, /409, "QPAY_PAYMENT_NOT_PENDING"/);
});

test("sweep carries the blocked reason from the locked confirm (fake deps); plain \"blocked\" stays reasonless", async () => {
  process.env.DATABASE_URL ??= "postgresql://unused/unused";
  process.env.SESSION_SECRET ??= "unit-test-placeholder-secret-value-not-real-00";
  const { sweepPendingQPayAtProvider } = await import("../lib/orders/qpay-cancel");
  const results: Array<"blocked" | { blocked: "ORDER_CANCELLED" | "OVERPAYMENT" }> = [{ blocked: "ORDER_CANCELLED" }, "blocked"];
  const deps = {
    checkPaymentExact: async () => ({ paid: true, paymentId: "q", paidAt: null, paidAmount: "100", underpaidAmount: null, paymentType: null }),
    cancelInvoice: async () => ({ ok: true as const }),
    confirmPaid: async () => results.shift()!,
    audit: async () => {},
  };
  const pay = (id: string) => ({ id, orderId: "o1", amount: { toString: () => "100" }, qpayInvoiceId: `inv-${id}` });
  const sweep = await sweepPendingQPayAtProvider({ tenantId: "t", userId: "u", payments: [pay("a"), pay("b")] }, deps as never);
  assert.deepEqual(sweep.blocked, ["a", "b"]);
  assert.deepEqual(sweep.blockedReasons, { a: "ORDER_CANCELLED" });
  assert.deepEqual(sweep.paid, []);
});

test("web actions flag refresh for dead-QR codes (check) and blocked codes (cancel); widget refreshes the router", async () => {
  const actions = await src("app/_actions/order-payments.ts");
  assert.match(actions, /QPAY_DEAD_QR_CODES[^\n]*"QPAY_OVERPAYMENT"[^\n]*"QPAY_ORDER_CANCELLED"[^\n]*"QPAY_PAYMENT_NOT_PENDING"/);
  const check = fn(actions, "export async function checkOrderQPayPaymentAction");
  assert.match(check, /refresh\?: boolean/);
  assert.match(check, /QPAY_DEAD_QR_CODES\.includes\(error\.code\)/);
  assert.match(check, /return \{ ok: false, paid: false, refresh,/);
  const cancel = fn(actions, "export async function cancelOrderQPayPaymentAction");
  assert.match(cancel, /QPAY_DEAD_QR_CODES\.includes\(error\.code\)/);
  assert.match(cancel, /revalidatePath\(`\/dashboard\/orders\/\$\{deadOrderId\}`\)/);
  const widget = await src("app/dashboard/orders/[id]/qpay-widget.tsx");
  assert.match(widget, /if \(res\.refresh\) \{[\s\S]*router\.refresh\(\)/);
});

test("sweepStaleOrderQPayCommand: counts pending QPay rows first and returns before the locked preflight", async () => {
  const body = fn(await src("lib/orders/order-payment-commands.ts"), "export async function sweepStaleOrderQPayCommand");
  const count = body.indexOf('orderPayment.count({ where: { orderId: input.orderId, tenantId: input.actor.tenantId, method: "QPAY", status: "PENDING" } })');
  assert.ok(count > 0);
  assert.match(body.slice(count), /^[^\n]*\n\s*if \(pendingCount === 0\) return;/);
  assert.ok(count < body.indexOf("providerCancelPendingQPay("));
});

test("deleteOrderCommand: FAILED QPay rows with qpayPaymentId are read before deleteMany and recorded in the delete audit", async () => {
  const body = fn(await src("lib/orders/order-commands.ts"), "export async function deleteOrderCommand", "\n/** Adapter");
  const read = body.indexOf('status: "FAILED", qpayPaymentId: { not: null }');
  assert.ok(read > 0 && read < body.indexOf("orderPayment.deleteMany"));
  const audit = body.slice(body.indexOf('action: "DELETE"'));
  assert.match(audit, /QPay дээр буцаалт шаардлагатай/);
  for (const key of ["id: row.id", "amount: row.amount.toString()", "qpayInvoiceId: row.qpayInvoiceId", "qpayPaymentId: row.qpayPaymentId"]) assert.ok(audit.includes(key), key);
});
