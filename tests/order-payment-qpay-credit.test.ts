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

test("both confirm paths share creditQPayPaymentInTx; income is posted only by the shared helper", async () => {
  const cmds = await src("lib/orders/order-payment-commands.ts");
  const body = fn(cmds, "export async function confirmOrderQPayPaymentCommand");
  assert.match(body, /creditQPayPaymentInTx\(tx/);
  assert.match(body, /409, "QPAY_ORDER_CANCELLED"/);
  assert.match(body, /409, "QPAY_OVERPAYMENT"/);
  assert.doesNotMatch(body, /postPaymentIncome\(/);
  const legacy = await src("lib/order-payments.ts");
  assert.match(legacy, /creditQPayPaymentInTx\(tx/);
  assert.doesNotMatch(legacy, /postPaymentIncome|recomputeOrderPaymentTotals/);
  const credit = await src("lib/orders/qpay-credit.ts");
  assert.ok(credit.indexOf('status: "FAILED"') > 0 && credit.indexOf('status: "FAILED"') < credit.indexOf("postPaymentIncome(tx"));
});

test("creditQPayPaymentInTx: cancelled order and overpay flip the row to FAILED once, keep both QPay ids, post no income", async () => {
  const Decimal = (await import("../app/generated/prisma/client")).Prisma.Decimal;
  const { creditQPayPaymentInTx } = await import("../lib/orders/qpay-credit");
  function fakeTx(paid: string[]) {
    const calls: Array<{ op: string; args: unknown }> = [];
    const tx = {
      orderPayment: {
        findMany: async () => paid.map((amount) => ({ amount: new Decimal(amount), paidAt: null })),
        updateMany: async (args: unknown) => {
          calls.push({ op: "updateMany", args });
          return { count: 1 };
        },
      },
      auditLog: { create: async (args: unknown) => { calls.push({ op: "audit", args }); return {}; } },
      cashTransaction: new Proxy({}, { get: () => async () => { calls.push({ op: "income", args: null }); return null; } }),
    };
    return { tx: tx as never, calls };
  }
  const base = { tenantId: "t1", actorId: "u1", qpayPaymentId: "qp-9", paidAt: new Date() };
  const payment = { id: "p1", amount: new Decimal(100), method: "QPAY" };

  const cancelled = fakeTx([]);
  const r1 = await creditQPayPaymentInTx(cancelled.tx, { ...base, order: { id: "o1", branchId: "b1", status: "CANCELLED", totalAmount: new Decimal(0) }, payment });
  assert.deepEqual(r1, { credited: false, reason: "ORDER_CANCELLED" });
  const upd = cancelled.calls.find((c) => c.op === "updateMany")!.args as { where: { status: string }; data: { status: string; qpayPaymentId: string } };
  assert.equal(upd.where.status, "PENDING");
  assert.deepEqual(upd.data, { status: "FAILED", qpayPaymentId: "qp-9" });
  assert.equal(cancelled.calls.filter((c) => c.op === "audit").length, 1);
  assert.equal(cancelled.calls.filter((c) => c.op === "income").length, 0);

  const overpay = fakeTx(["60"]); // total 100, paid 60 -> remaining 40 < 100
  const r2 = await creditQPayPaymentInTx(overpay.tx, { ...base, order: { id: "o1", branchId: "b1", status: "IN_PROGRESS", totalAmount: new Decimal(100) }, payment });
  assert.deepEqual(r2, { credited: false, reason: "OVERPAYMENT" });
  assert.equal((overpay.calls.find((c) => c.op === "updateMany")!.args as { data: { status: string } }).data.status, "FAILED");
  assert.equal(overpay.calls.filter((c) => c.op === "audit").length, 1);
  assert.equal(overpay.calls.filter((c) => c.op === "income").length, 0);
});

test("QPay client: timeout, abort and bad JSON never throw (return {error} / null) on every call", async () => {
  const core = await src("lib/qpay-core.ts");
  assert.equal((core.match(/await fetch\(/g) ?? []).length, 0, "no raw fetch left");
  assert.equal((core.match(/await qpayFetch\(/g) ?? []).length, 7);

  const { createQPayClient } = await import("../lib/qpay-core");
  const settings = (withToken: boolean) => ({
    username: "u", password: "pw", invoiceCode: "code", callbackUrl: null,
    accessToken: withToken ? "tok" : null, refreshToken: null,
    tokenExpiresAt: withToken ? new Date(Date.now() + 3_600_000) : null, refreshTokenExpiresAt: null,
  });
  const realFetch = globalThis.fetch;
  try {
    for (const failure of ["timeout", "badjson"] as const) {
      globalThis.fetch = (async () => {
        if (failure === "timeout") throw new DOMException("timed out", "TimeoutError");
        return new Response("not json", { status: 200 });
      }) as typeof fetch;
      for (const withToken of [true, false]) {
        const client = createQPayClient<string>({ getSettings: async () => settings(withToken), saveTokens: async () => undefined, messages: { notConfigured: "n", incomplete: "i" } });
        const label = `${failure}/${withToken}`;
        assert.ok("error" in (await client.createInvoice({ id: "t", senderInvoiceNo: "s", invoiceReceiverCode: "r", invoiceDescription: "d", amount: 1 })), `createInvoice ${label}`);
        assert.ok("error" in (await client.checkPaymentExact("t", "inv", "1")), `checkPaymentExact ${label}`);
        assert.ok("error" in (await client.checkPayment("t", "inv", 1)), `checkPayment ${label}`);
        assert.equal(await client.getInvoiceUrls("t", "inv"), null, `getInvoiceUrls ${label}`);
        if (failure === "timeout") assert.ok("error" in (await client.refundPayment("t", "pay")), `refund ${label}`);
        if (failure === "timeout") assert.equal((await client.cancelInvoice("t", "inv")).ok, false, `cancelInvoice ${label}`);
      }
    }
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("in-tx QPay calls use the lower per-call timeout; a failed create records the possible orphan", async () => {
  const cmds = await src("lib/orders/order-payment-commands.ts");
  const body = fn(cmds, "export async function createOrderQPayInvoiceCommand");
  assert.equal((body.match(/withQPayTimeout\(QPAY_IN_TX_FETCH_TIMEOUT_MS/g) ?? []).length, 3);
  assert.match(body, /sender_invoice_no \$\{payment\.id\}/);
  const core = await import("../lib/qpay-core");
  assert.ok(core.QPAY_IN_TX_FETCH_TIMEOUT_MS * 3 < 15_000, "token + invoice + urls fits the 15s tx timeout");

  let seen: number | undefined;
  const realTimeout = AbortSignal.timeout;
  const realFetch = globalThis.fetch;
  AbortSignal.timeout = ((ms: number) => { seen = ms; return realTimeout.call(AbortSignal, ms); }) as typeof AbortSignal.timeout;
  globalThis.fetch = (async () => new Response("{}", { status: 500 })) as typeof fetch;
  try {
    const client = core.createQPayClient<string>({
      getSettings: async () => ({ username: "u", password: "pw", invoiceCode: "c", callbackUrl: null, accessToken: "tok", refreshToken: null, tokenExpiresAt: new Date(Date.now() + 3_600_000), refreshTokenExpiresAt: null }),
      saveTokens: async () => undefined,
      messages: { notConfigured: "n", incomplete: "i" },
    });
    await core.withQPayTimeout(core.QPAY_IN_TX_FETCH_TIMEOUT_MS, () => client.getInvoiceUrls("t", "inv"));
    assert.equal(seen, core.QPAY_IN_TX_FETCH_TIMEOUT_MS);
    await client.getInvoiceUrls("t", "inv");
    assert.equal(seen, core.QPAY_FETCH_TIMEOUT_MS);
  } finally {
    AbortSignal.timeout = realTimeout;
    globalThis.fetch = realFetch;
  }
});

test("status-only item patches skip the stale QPay sweep", async () => {
  const items = await src("lib/orders/order-item-commands.ts");
  assert.match(fn(items, "export async function patchOrderItemCommand"), /if \(hasDetails \|\| hasPrice\) await sweepStaleQPayAfterTotalChange/);
});
