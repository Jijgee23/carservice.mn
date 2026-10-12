import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";

process.env.DATABASE_URL ??= "postgresql://unused/unused";
process.env.SESSION_SECRET ??= "unit-test-placeholder-secret-value-not-real-00";

const src = (path: string) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
function fn(source: string, header: string, end = "\nexport "): string {
  const start = source.indexOf(header);
  assert.ok(start >= 0, `missing ${header}`);
  const next = source.indexOf(end, start + header.length);
  return source.slice(start, next < 0 ? undefined : next);
}

test("1(b): new money is refused on a CANCELLED order with 409 ORDER_CANCELLED", async () => {
  const commands = await import("../lib/orders/order-payment-commands");
  assert.throws(
    () => commands.assertOrderOpenForPayment({ status: "CANCELLED" }),
    (error: unknown) => error instanceof commands.OrderPaymentCommandError && error.status === 409 && error.code === "ORDER_CANCELLED" && /Цуцлагдсан/.test(error.message),
  );
  for (const status of ["NEW", "IN_PROGRESS", "COMPLETED"]) assert.doesNotThrow(() => commands.assertOrderOpenForPayment({ status }));
});

test("1(b): payment and QPay-invoice commands check CANCELLED before the provider pre-step and again under the lock", async () => {
  const cmds = await src("lib/orders/order-payment-commands.ts");
  for (const header of ["export async function createOrderPaymentCommand", "export async function createOrderQPayInvoiceCommand"]) {
    const body = fn(cmds, header);
    const first = body.indexOf("assertOrderOpenForPayment(order)");
    assert.ok(first >= 0 && first < body.indexOf("assertSweepAllowsLocalCancel("), `${header}: validate must reject CANCELLED before any provider sweep`);
    assert.ok(body.indexOf("assertOrderOpenForPayment(order)", first + 1) > body.indexOf("withOrderTransaction("), `${header}: tx re-check`);
  }
  // reverse / cancel-QR / confirm must still work on a cancelled order (reversal is how money leaves it)
  assert.doesNotMatch(fn(cmds, "export async function reverseOrderPaymentCommand"), /assertOrderOpenForPayment/);
  assert.doesNotMatch(fn(cmds, "export async function cancelOrderQPayPaymentCommand"), /assertOrderOpenForPayment/);
});

test("1(b): overpayment stays refused (cash needs allowCashChange; QPay invoice amount capped at remaining)", async () => {
  const commands = await import("../lib/orders/order-payment-commands");
  const Decimal = (await import("../app/generated/prisma/client")).Prisma.Decimal;
  assert.equal(commands.applyTender("CARD", new Decimal(150), new Decimal(100), true), null);
  assert.equal(commands.applyTender("CASH", new Decimal(150), new Decimal(100), false), null);
  assert.throws(() => commands.resolveQPayInvoiceAmount("100.01", new Decimal(100)), /үлдэгдлээс/);
});

test("1(c): order cancel and total reductions sweep stale pending QPay invoices", async () => {
  const cmds = await src("lib/orders/order-payment-commands.ts");
  const sweep = fn(cmds, "export async function sweepStaleOrderQPayCommand");
  assert.match(sweep, /providerCancelPendingQPay\(/);
  assert.match(sweep, /state\.remaining\.lte\(0\) \|\| row\.amount\.gt\(state\.remaining\)/);
  assert.ok(sweep.indexOf("providerCancelPendingQPay(") < sweep.indexOf("cancelPendingQPay(tx"));
  assert.match(sweep, /catch \(error\)/); // best effort, never throws after the order change committed

  const orderCmds = await src("lib/orders/order-commands.ts");
  assert.match(fn(orderCmds, "export async function applyOrderPatchCommand"), /result\.toStatus === "CANCELLED"\) \{[\s\S]*sweepStaleOrderQPayCommand/);

  const items = await src("lib/orders/order-item-commands.ts");
  for (const name of ["updateOrderItemCommand", "patchOrderItemCommand", "cancelOrderItemCommand", "changeOrderItemPriceCommand"]) {
    const body = fn(items, `export async function ${name}`);
    assert.match(body, /await sweepStaleQPayAfterTotalChange\(actor, orderId, scope\);?[^\n]*\r?\n  return result;/, name);
  }
});

test("2: the payment account is validated before the live QPay QR is cancelled at the provider", async () => {
  const cmds = await src("lib/orders/order-payment-commands.ts");
  const body = fn(cmds, "export async function createOrderPaymentCommand");
  const validateAccount = body.indexOf("resolveAccountOrThrow(tx");
  assert.ok(validateAccount > 0 && validateAccount < body.indexOf("assertSweepAllowsLocalCancel(providerSweep)"));
  assert.ok(body.indexOf("resolveAccountOrThrow(tx", validateAccount + 1) > 0, "authoritative in-tx resolve is kept");
});

test("3: reverse-all checks settlement payments before the provider sweep", async () => {
  const cmds = await src("lib/orders/order-payment-commands.ts");
  const body = fn(cmds, "export async function reverseAllOrderPaymentsCommand");
  assert.ok(body.indexOf("assertNotSettlementPayment(paidIds)") > 0 && body.indexOf("assertNotSettlementPayment(paidIds)") < body.indexOf("assertSweepAllowsLocalCancel("));
});

test("3: dead legacy QPay invoice code is gone and has no callers", async () => {
  const legacy = await src("lib/order-payments.ts");
  assert.doesNotMatch(legacy, /createOrReuseOrderQPayInvoice|cancelOrderQPayInvoice/);
  assert.match(legacy, /export async function confirmOrderQPayPayment/);
});

test("3: cash change stays web-only by spec and the /payments notification uses the recorded amount", async () => {
  const route = await src("app/api/v1/orders/[id]/payments/route.ts");
  assert.doesNotMatch(route, /allowCashChange/);
  assert.match(route, /amount: result\.payment\.amount\.toString\(\)/);
});

test("M6: a date-only backdate is raised to a same-day completion instead of being rejected", async () => {
  const { alignOccurredToCompletion, assertOccurredAfterCompletion } = await import("../lib/cash/settlement");
  const completedAt = new Date("2026-10-10T08:30:00.000Z"); // 16:30 Ulaanbaatar (UTC+8), after the 12:00 local default
  const noonLocal = new Date("2026-10-10T04:00:00.000Z");
  const allocations = [{ orderNumber: "7", completedAt }];
  assert.throws(() => assertOccurredAfterCompletion(allocations, noonLocal), /дууссан огнооноос өмнө/);
  const aligned = alignOccurredToCompletion(allocations, noonLocal);
  assert.equal(aligned.getTime(), completedAt.getTime());
  assert.doesNotThrow(() => assertOccurredAfterCompletion(allocations, aligned));
  // an earlier DAY is still rejected
  const dayBefore = new Date("2026-10-09T04:00:00.000Z");
  assert.equal(alignOccurredToCompletion(allocations, dayBefore).getTime(), dayBefore.getTime());
  assert.throws(() => assertOccurredAfterCompletion(allocations, alignOccurredToCompletion(allocations, dayBefore)));
  // already after completion: unchanged; no completedAt: unchanged
  const later = new Date("2026-10-10T10:00:00.000Z");
  assert.equal(alignOccurredToCompletion(allocations, later).getTime(), later.getTime());
  assert.equal(alignOccurredToCompletion([{ completedAt: null }], noonLocal).getTime(), noonLocal.getTime());
});
