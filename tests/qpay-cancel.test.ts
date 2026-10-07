import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";

process.env.DATABASE_URL ??= "postgresql://unused/unused";
process.env.SESSION_SECRET ??= "unit-test-placeholder-secret-value-not-real-00";

const src = (rel: string) => readFile(new URL(`../${rel}`, import.meta.url), "utf8");

type Check = { paid: boolean; underpaidAmount: string | null } | { error: string };
type Cancel = { ok: true } | { ok: false; reason: "not_configured" | "already_paid" | "not_found" | "http_error" };

/** Fake QPay client: NEVER the real API. `checks` / `cancels` are consumed in order. */
function fakeDeps(script: { checks: Check[]; cancels?: Cancel[]; confirmResult?: boolean }) {
  const calls: string[] = [];
  const checks = [...script.checks];
  const cancels = [...(script.cancels ?? [])];
  const audits: Array<{ ok: boolean; detail?: string }> = [];
  const deps = {
    async checkPaymentExact() {
      calls.push("check");
      const next = checks.shift();
      assert.ok(next, "unexpected extra check");
      if ("error" in next) return next;
      return { paid: next.paid, paymentId: next.paid ? "qp1" : null, paidAt: null, paidAmount: next.paid ? "100" : next.underpaidAmount ?? "0", underpaidAmount: next.underpaidAmount, paymentType: null };
    },
    async cancelInvoice() {
      calls.push("cancel");
      const next = cancels.shift();
      assert.ok(next, "unexpected cancel call");
      return next;
    },
    async confirmPaid(id: string) {
      calls.push(`confirm:${id}`);
      return script.confirmResult ?? true;
    },
    async audit(entry: { ok: boolean; detail?: string }) {
      audits.push(entry);
    },
  };
  return { deps, calls, audits };
}

const pay = (over: Record<string, unknown> = {}) => ({ id: "p1", orderId: "o1", amount: { toString: () => "100" }, qpayInvoiceId: "inv1", ...over });
const unpaid: Check = { paid: false, underpaidAmount: null };

test("helper: no invoice id -> nothing at QPay", async () => {
  const { cancelPendingQPayAtProvider } = await import("../lib/orders/qpay-cancel");
  const f = fakeDeps({ checks: [] });
  assert.equal(await cancelPendingQPayAtProvider({ tenantId: "t", userId: "u", payment: pay({ qpayInvoiceId: null }) }, f.deps), "no_invoice");
  assert.deepEqual(f.calls, []);
});

test("helper: fully paid -> confirm path runs, NO provider cancel", async () => {
  const { cancelPendingQPayAtProvider } = await import("../lib/orders/qpay-cancel");
  const f = fakeDeps({ checks: [{ paid: true, underpaidAmount: null }] });
  assert.equal(await cancelPendingQPayAtProvider({ tenantId: "t", userId: "u", payment: pay() }, f.deps), "paid");
  assert.deepEqual(f.calls, ["check", "confirm:p1"]);
});

test("helper: unpaid -> provider cancel ok -> cancelled (+ success audit)", async () => {
  const { cancelPendingQPayAtProvider } = await import("../lib/orders/qpay-cancel");
  const f = fakeDeps({ checks: [unpaid], cancels: [{ ok: true }] });
  assert.equal(await cancelPendingQPayAtProvider({ tenantId: "t", userId: "u", payment: pay() }, f.deps), "cancelled");
  assert.deepEqual(f.calls, ["check", "cancel"]);
  assert.deepEqual(f.audits.map((a) => a.ok), [true]);
});

test("helper: provider says not_found -> treated as already gone (cancelled)", async () => {
  const { cancelPendingQPayAtProvider } = await import("../lib/orders/qpay-cancel");
  const f = fakeDeps({ checks: [unpaid], cancels: [{ ok: false, reason: "not_found" }] });
  assert.equal(await cancelPendingQPayAtProvider({ tenantId: "t", userId: "u", payment: pay() }, f.deps), "cancelled");
});

test("helper: http_error / not_configured -> failed (caller must NOT cancel locally), failure audited", async () => {
  const { cancelPendingQPayAtProvider } = await import("../lib/orders/qpay-cancel");
  for (const reason of ["http_error", "not_configured"] as const) {
    const f = fakeDeps({ checks: [unpaid], cancels: [{ ok: false, reason }] });
    assert.equal(await cancelPendingQPayAtProvider({ tenantId: "t", userId: "u", payment: pay() }, f.deps), "failed", reason);
    assert.deepEqual(f.audits.map((a) => a.ok), [false]);
    assert.ok(!f.calls.some((c) => c.startsWith("confirm")));
  }
});

test("helper: check error before cancel -> failed without calling cancel", async () => {
  const { cancelPendingQPayAtProvider } = await import("../lib/orders/qpay-cancel");
  const f = fakeDeps({ checks: [{ error: "boom" }] });
  assert.equal(await cancelPendingQPayAtProvider({ tenantId: "t", userId: "u", payment: pay() }, f.deps), "failed");
  assert.deepEqual(f.calls, ["check"]);
});

test("helper: partial money -> partial, never cancelled", async () => {
  const { cancelPendingQPayAtProvider } = await import("../lib/orders/qpay-cancel");
  const f = fakeDeps({ checks: [{ paid: false, underpaidAmount: "40" }] });
  assert.equal(await cancelPendingQPayAtProvider({ tenantId: "t", userId: "u", payment: pay() }, f.deps), "partial");
  assert.deepEqual(f.calls, ["check"]);
});

test("helper: cancel says already_paid -> re-check -> paid => confirm; still unpaid => failed", async () => {
  const { cancelPendingQPayAtProvider } = await import("../lib/orders/qpay-cancel");
  const a = fakeDeps({ checks: [unpaid, { paid: true, underpaidAmount: null }], cancels: [{ ok: false, reason: "already_paid" }] });
  assert.equal(await cancelPendingQPayAtProvider({ tenantId: "t", userId: "u", payment: pay() }, a.deps), "paid");
  assert.deepEqual(a.calls, ["check", "cancel", "check", "confirm:p1"]);
  const b = fakeDeps({ checks: [unpaid, unpaid], cancels: [{ ok: false, reason: "already_paid" }] });
  assert.equal(await cancelPendingQPayAtProvider({ tenantId: "t", userId: "u", payment: pay() }, b.deps), "failed");
  const c = fakeDeps({ checks: [unpaid, { paid: false, underpaidAmount: "10" }], cancels: [{ ok: false, reason: "already_paid" }] });
  assert.equal(await cancelPendingQPayAtProvider({ tenantId: "t", userId: "u", payment: pay() }, c.deps), "partial");
});

test("helper: a confirm that throws still reports paid (never cancel a paid invoice)", async () => {
  const { cancelPendingQPayAtProvider } = await import("../lib/orders/qpay-cancel");
  const f = fakeDeps({ checks: [{ paid: true, underpaidAmount: null }] });
  f.deps.confirmPaid = async () => { throw new Error("db down"); };
  assert.equal(await cancelPendingQPayAtProvider({ tenantId: "t", userId: "u", payment: pay() }, f.deps), "paid");
});

test("sweep: classifies every payment; only no_invoice/cancelled are cancellable", async () => {
  const { sweepPendingQPayAtProvider } = await import("../lib/orders/qpay-cancel");
  const f = fakeDeps({
    checks: [unpaid, { paid: true, underpaidAmount: null }, { paid: false, underpaidAmount: "5" }, unpaid],
    cancels: [{ ok: true }, { ok: false, reason: "http_error" }],
  });
  const sweep = await sweepPendingQPayAtProvider({ tenantId: "t", userId: "u", payments: [pay({ id: "a" }), pay({ id: "b" }), pay({ id: "c" }), pay({ id: "d" }), pay({ id: "e", qpayInvoiceId: null })] }, f.deps);
  assert.deepEqual(sweep, { cancellable: ["a", "e"], paid: ["b"], partial: ["c"], failed: ["d"] });
});

test("QPay core: DELETE failure classification (404 / INVOICE_NOTFOUND = gone, INVOICE_PAID = paid, rest = http_error)", async () => {
  const { classifyCancelInvoiceFailure } = await import("../lib/qpay-core");
    assert.equal((classifyCancelInvoiceFailure(404, "") as { reason: string }).reason, "http_error", "bare 404");
  assert.equal((classifyCancelInvoiceFailure(404, "<html>Not Found</html>") as { reason: string }).reason, "http_error", "HTML 404");
  assert.equal((classifyCancelInvoiceFailure(404, '{"error":"INVOICE_NOTFOUND"}') as { reason: string }).reason, "not_found");
  assert.equal((classifyCancelInvoiceFailure(400, '{"error":"INVOICE_NOTFOUND"}') as { reason: string }).reason, "not_found");
  assert.equal((classifyCancelInvoiceFailure(400, '{"error":"INVOICE_ALREADY_CANCELED"}') as { reason: string }).reason, "not_found");
  assert.equal((classifyCancelInvoiceFailure(400, '{"error":"INVOICE_PAID"}') as { reason: string }).reason, "already_paid");
  assert.equal((classifyCancelInvoiceFailure(500, "oops") as { reason: string }).reason, "http_error");
  assert.equal((classifyCancelInvoiceFailure(401, "") as { reason: string }).reason, "http_error");
});

test("QPay core: cancelInvoice uses DELETE invoice/{id} with bearer and never throws", async () => {
  const core = await src("lib/qpay-core.ts");
  assert.match(core, /\$\{QPAY_URL\}invoice\/\$\{encodeURIComponent\(invoiceId\)\}/);
  assert.match(core, /method: "DELETE"[\s\S]{0,120}Bearer \$\{tokenResult\.accessToken\}/);
  assert.match(core, /async function cancelInvoice[\s\S]*?catch \(error\)[\s\S]*?reason: "http_error"/);
  assert.match(await src("lib/qpay-tenant.ts"), /cancelInvoice: \(tenantId: string, invoiceId: string\)/);
});

test("settlement pre-step: paid -> 409 SETTLEMENT_AMOUNT_CHANGED, partial -> 409, failed -> 502, ok -> cancelled ids; no pending -> no provider call", async () => {
  const { prisma } = await import("../lib/prisma");
  const { providerCancelSettlementQPay } = await import("../lib/cash/settlement");
  const orderPayment = prisma.orderPayment as unknown as { findMany: unknown };
  const original = orderPayment.findMany;
  const input = { tenantId: "t", actorId: "u", branchId: "b", customerId: "c", orderIds: ["o1"] };
  let queried: unknown;
  const setPending = (rows: unknown[]) => { orderPayment.findMany = async (args: unknown) => { queried = args; return rows; }; };
  try {
    setPending([]);
    assert.deepEqual(await providerCancelSettlementQPay(input, fakeDeps({ checks: [] }).deps), []);
    assert.match(JSON.stringify(queried), /"isPostpaid":true/);
    assert.match(JSON.stringify(queried), /"branchId":"b"/);

    setPending([pay()]);
    const outcomes: Array<[ReturnType<typeof fakeDeps>, number, string] | [ReturnType<typeof fakeDeps>, null, null]> = [
      [fakeDeps({ checks: [{ paid: true, underpaidAmount: null }] }), 409, "SETTLEMENT_AMOUNT_CHANGED"],
      [fakeDeps({ checks: [{ paid: false, underpaidAmount: "1" }] }), 409, "QPAY_INVOICE_PARTIALLY_PAID"],
      [fakeDeps({ checks: [unpaid], cancels: [{ ok: false, reason: "http_error" }] }), 502, "QPAY_CANCEL_FAILED"],
    ];
    for (const [f, status, code] of outcomes) {
      await assert.rejects(() => providerCancelSettlementQPay(input, f.deps), (e: { status: number; code: string }) => e.status === status && e.code === code);
    }
    const ok = fakeDeps({ checks: [unpaid], cancels: [{ ok: true }] });
    assert.deepEqual(await providerCancelSettlementQPay(input, ok.deps), ["p1"]);
  } finally {
    orderPayment.findMany = original;
  }
});

test("structural: every local QPay cancel path runs the provider pre-step first", async () => {
  const cmds = await src("lib/orders/order-payment-commands.ts");
  const fn = (text: string, head: string) => {
    const start = text.indexOf(head);
    assert.ok(start >= 0, head);
    const next = text.indexOf("\nexport ", start + head.length);
    return text.slice(start, next < 0 ? undefined : next);
  };
  const localCancel = /cancelPendingQPay\(tx,|status: "CANCELLED"/;
  for (const head of [
    "export async function createOrderPaymentCommand",
    "export async function reverseOrderPaymentCommand",
    "export async function reverseAllOrderPaymentsCommand",
  ]) {
    const body = fn(cmds, head);
    const pre = body.indexOf("providerCancelPendingQPay(");
    assert.ok(pre >= 0, `${head} calls the provider pre-step`);
    assert.ok(pre < body.search(localCancel), `${head}: provider pre-step precedes the local cancel`);
    assert.ok(body.indexOf("assertSweepAllowsLocalCancel(") > pre);
  }
  // re-create with a different amount
  const create = fn(cmds, "export async function createOrderQPayInvoiceCommand");
  assert.ok(create.indexOf("providerCancelPendingQPay(") >= 0 && create.indexOf("providerCancelPendingQPay(") < create.indexOf("withOrderTransaction("));
  assert.match(create, /QPAY_PREVIOUS_PAID/);
  assert.match(create, /cancellable\.includes\(pending\.id\)/);
  // explicit cancel
  const cancel = fn(cmds, "export async function cancelOrderQPayPaymentCommand");
  assert.ok(cancel.indexOf("sweepPendingQPayAtProvider(") >= 0 && cancel.indexOf("sweepPendingQPayAtProvider(") < cancel.indexOf('data: { status: "CANCELLED" }'));
  assert.match(cancel, /updateMany\(\{ where: \{ id: payment\.id[^}]*status: "PENDING"/);
  assert.match(cancel, /QPAY_PAYMENT_RACE/);
  // confirm: sibling cancellation goes through the provider first, best-effort
  const confirm = fn(cmds, "export async function confirmOrderQPayPaymentCommand");
  assert.match(confirm, /cancelSiblingsAtProvider/);
  assert.match(confirm, /siblings === "keep"/);
  // the only local cancel helper restricts to provider-cancelled ids
  const local = fn(cmds, "async function cancelPendingQPay(");
  assert.match(local, /OR: \[\{ qpayInvoiceId: null \}, \{ id: \{ in: \[\.\.\.providerCancelledIds\] \} \}\]/);
  assert.doesNotMatch(cmds, /cancelPendingQPay\(tx, [^)]*order\.id\);/);

  const settlement = await src("lib/cash/settlement.ts");
  const create2 = fn(settlement, "export async function createPostpaidSettlement");
  assert.ok(create2.indexOf("providerCancelSettlementQPay(") >= 0 && create2.indexOf("providerCancelSettlementQPay(") < create2.indexOf("withBookingTransaction("));
  assert.match(settlement, /input\.providerCancelledPaymentIds/);

  const orderCommands = await src("lib/orders/order-commands.ts");
  const del = fn(orderCommands, "export async function deleteOrderCommand");
  assert.ok(del.indexOf("sweepPendingQPayAtProvider(") >= 0 && del.indexOf("sweepPendingQPayAtProvider(") < del.indexOf("orderPayment.deleteMany"));

  const legacy = await src("lib/order-payments.ts");
  const reuse = fn(legacy, "export async function createOrReuseOrderQPayInvoice");
  assert.ok(reuse.indexOf("providerCancelLegacy(") >= 0 && reuse.indexOf("providerCancelLegacy(") < reuse.indexOf('status: "CANCELLED"'));
  const cancelLegacy = fn(legacy, "export async function cancelOrderQPayInvoice");
  assert.ok(cancelLegacy.indexOf("providerCancelLegacy(") >= 0 && cancelLegacy.indexOf("providerCancelLegacy(") < cancelLegacy.indexOf('status: "CANCELLED"'));
});

test("structural: provider cancel never runs inside a DB transaction (helper has no tx, no OrderPayment writes)", async () => {
  const helper = await src("lib/orders/qpay-cancel.ts");
  assert.doesNotMatch(helper, /withOrderTransaction|withBookingTransaction|\$transaction|orderPayment\.(update|updateMany|create|delete)/);
  const cmds = await src("lib/orders/order-payment-commands.ts");
  // inside providerCancelPendingQPay the tx callback ends before the sweep is awaited
  const fn = cmds.slice(cmds.indexOf("async function providerCancelPendingQPay("), cmds.indexOf("export type RecordedOrderPayment"));
  assert.ok(fn.indexOf("sweepPendingQPayAtProvider(") > fn.indexOf("return { branchId: order.branchId"));
});
