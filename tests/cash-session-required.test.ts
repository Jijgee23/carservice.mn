import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

process.env.DATABASE_URL ??= "postgresql://unused/unused";
process.env.SESSION_SECRET ??= "unit-test-placeholder-secret-value-not-real-00";

const src = (rel: string) => readFile(new URL(`../${rel}`, import.meta.url), "utf8");
const MESSAGE = "Касс нээгээгүй байна. Эхлээд кассаа нээнэ үү.";

function fakeTx(open: boolean) {
  const calls: string[] = [];
  const tx = {
    $queryRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => {
      calls.push(`lock:${strings[0].includes('"Branch"') ? "Branch" : "?"}:${values[0]}`);
      return [];
    },
    cashSession: {
      findFirst: async (args: { where: Record<string, unknown> }) => {
        calls.push(`find:${JSON.stringify(args.where)}`);
        return open ? { id: "s1" } : null;
      },
    },
  };
  return { tx: tx as never, calls };
}

function body(code: string, from: string, to?: string): string {
  const a = code.indexOf(from);
  assert.ok(a !== -1, `missing ${from}`);
  const b = to ? code.indexOf(to, a + from.length) : -1;
  return code.slice(a, b === -1 ? undefined : b);
}

test("assertCashSessionOpen: closed register -> 409 CASH_SESSION_CLOSED with the Mongolian message, after the shared Branch lock", async () => {
  const { assertCashSessionOpen } = await import("../lib/cash/session-attach");
  const { CashError } = await import("../lib/cash/rules");
  const { tx, calls } = fakeTx(false);
  await assert.rejects(assertCashSessionOpen(tx, "t1", "b1"), (e: unknown) => {
    const err = e as InstanceType<typeof CashError>;
    return err instanceof CashError && err.status === 409 && err.code === "CASH_SESSION_CLOSED" && err.message === MESSAGE;
  });
  assert.equal(calls[0], "lock:Branch:b1", "shared Branch lock first (serialises with Kass haah)");
  assert.match(calls[1], /"tenantId":"t1".*"branchId":"b1".*"closedAt":null/);
});

test("assertCashSessionOpen: open register passes for any payment method (no method argument)", async () => {
  const { assertCashSessionOpen } = await import("../lib/cash/session-attach");
  const { tx, calls } = fakeTx(true);
  await assertCashSessionOpen(tx, "t1", "b1");
  assert.equal(calls.length, 2);
});

test("assertCashSessionOpen: custom error factory is used (order-payment commands raise their own class)", async () => {
  const { assertCashSessionOpen } = await import("../lib/cash/session-attach");
  const { tx } = fakeTx(false);
  class Custom extends Error {}
  await assert.rejects(assertCashSessionOpen(tx, "t1", "b1", () => new Custom("x")), Custom);
});

test("CashError for CASH_SESSION_CLOSED maps to the staff API envelope (409 + code)", async () => {
  const { cashErrorResponse } = await import("../lib/cash/http");
  const { CashError } = await import("../lib/cash/rules");
  const res = cashErrorResponse("test", new CashError(MESSAGE, 409, "CASH_SESSION_CLOSED"));
  assert.equal(res.status, 409);
  const json = (await res.json()) as { error: string; code: string };
  assert.equal(json.code, "CASH_SESSION_CLOSED");
  assert.equal(json.error, MESSAGE);
});

test("order payment commands raise OrderPaymentCommandError 409 CASH_SESSION_CLOSED (routes/actions already map it)", async () => {
  const cmds = await src("lib/orders/order-payment-commands.ts");
  const helper = cmds.slice(cmds.indexOf("async function assertOrderRegisterOpen"), cmds.indexOf("async function cancelPendingQPay"));
  assert.match(helper, /new OrderPaymentCommandError\(CASH_SESSION_CLOSED_MESSAGE, 409, CASH_SESSION_CLOSED_CODE\)/);
  const session = await src("lib/cash/session-attach.ts");
  assert.ok(session.includes(`CASH_SESSION_CLOSED_MESSAGE = "${MESSAGE}"`));
  assert.match(session, /CASH_SESSION_CLOSED_CODE = "CASH_SESSION_CLOSED"/);
});

test("blocked order paths: payment create, QPay invoice start, reverse one, reverse all guard in the pre-provider validate AND the locked tx", async () => {
  const cmds = await src("lib/orders/order-payment-commands.ts");
  const fns: Array<[string, string]> = [
    ["export async function createOrderPaymentCommand", "export async function reverseOrderPaymentCommand"],
    ["export async function reverseOrderPaymentCommand", "export async function reverseAllOrderPaymentsCommand"],
    ["export async function reverseAllOrderPaymentsCommand", "export async function listOrderPaymentsCommand"],
    ["export async function createOrderQPayInvoiceCommand", "export type OrderQPayConfirmResult"],
  ];
  for (const [from, to] of fns) {
    const fn = body(cmds, from, to);
    const hits = fn.match(/assertOrderRegisterOpen\(/g) ?? [];
    assert.ok(hits.length >= 2, `${from}: expected guard twice`);
    assert.ok(fn.indexOf("assertOrderRegisterOpen") < fn.indexOf("assertSweepAllowsLocalCancel("), `${from}: guard precedes provider sweep`);
  }
});

test("not blocked: QPay confirm/cancel, auto income/expense hooks and session open/close never call the guard", async () => {
  const cmds = await src("lib/orders/order-payment-commands.ts");
  assert.ok(!body(cmds, "export async function confirmOrderQPayPaymentCommand", "export async function cancelOrderQPayPaymentCommand").includes("assertOrderRegisterOpen"));
  assert.ok(!body(cmds, "export async function cancelOrderQPayPaymentCommand", "export async function notifyOrderPaymentReceived").includes("assertOrderRegisterOpen"));
  assert.ok(!(await src("lib/cash/sync.ts")).includes("assertCashSessionOpen"), "payment income / internal-repair hooks are system paths");
  assert.ok(!(await src("lib/order-payments.ts")).includes("assertCashSessionOpen"), "provider confirm path");
  assert.ok(!(await src("lib/cash/session.ts")).includes("assertCashSessionOpen"), "open/close session");
});

test("blocked cash paths: manual entry create/void and settlement create/void guard inside their tx before writing", async () => {
  const ledger = await src("lib/cash/ledger.ts");
  const create = body(ledger, "export async function createCashEntry", "export async function runVoidCashEntry");
  assert.ok(create.indexOf("assertCashSessionOpen(tx, tenantId, branchId)") !== -1 && create.indexOf("assertCashSessionOpen") < create.indexOf("tx.cashTransaction.create"));
  const voidFn = body(ledger, "export async function runVoidCashEntry", "export type CashEntryFilters");
  assert.ok(voidFn.indexOf("assertCashSessionOpen(tx, tenantId, entry.branchId)") !== -1 && voidFn.indexOf("assertCashSessionOpen") < voidFn.indexOf("tx.cashTransaction.updateMany"));
  const st = await src("lib/cash/settlement.ts");
  const sc = body(st, "export async function runCreateSettlement", "export async function createPostpaidSettlement");
  assert.ok(sc.indexOf("assertCashSessionOpen(tx, tenantId, input.branchId)") !== -1 && sc.indexOf("assertCashSessionOpen") < sc.indexOf("tx.postpaidSettlement.create"));
  const sv = body(st, "export async function runVoidSettlement", "export async function voidPostpaidSettlement");
  assert.ok(sv.indexOf("assertCashSessionOpen(tx, tenantId, settlement.branchId)") !== -1 && sv.indexOf("assertCashSessionOpen") < sv.indexOf("tx.postpaidSettlement.update"));
  const pre = body(st, "export async function createPostpaidSettlement", "// --- void");
  assert.ok(pre.indexOf("CASH_SESSION_CLOSED_CODE") < pre.indexOf("providerCancelSettlementQPay("), "early refusal before provider-side QPay cancel");
});

test("runCreateSettlement / runVoidSettlement behaviour: closed register aborts with 409 before any write", async () => {
  const s = await import("../lib/cash/settlement");
  const writes: string[] = [];
  const mk = (settlement: unknown) =>
    ({
      $queryRaw: async () => [],
      branch: { findFirst: async () => ({ id: "b1", isActive: true }) },
      customer: { findFirst: async () => ({ id: "c1" }) },
      cashSession: { findFirst: async () => null },
      postpaidSettlement: {
        findFirst: async () => settlement,
        create: async () => (writes.push("create"), { id: "s1" }),
        update: async () => (writes.push("update"), {}),
      },
      serviceOrder: { findMany: async () => [] },
      orderPayment: { findMany: async () => [], updateMany: async () => (writes.push("pay"), {}) },
      cashTransaction: { updateMany: async () => (writes.push("txn"), {}) },
    }) as never;
  const closed = (e: unknown) => (e as { code?: string }).code === "CASH_SESSION_CLOSED" && (e as { status?: number }).status === 409;
  await assert.rejects(
    s.runCreateSettlement(mk(null), { tenantId: "t1", actorId: "u1", branchId: "b1", customerId: "c1", orderIds: ["o1"], method: "CASH", occurredAt: new Date(), note: null, expectedAmount: undefined } as never),
    closed,
  );
  await assert.rejects(
    s.runVoidSettlement(mk({ id: "s1", branchId: "b1", amount: 1, voidedAt: null, payments: [], transactions: [] }), { tenantId: "t1", actorId: "u1", settlementId: "s1", scope: null, reason: "r" }),
    closed,
  );
  assert.deepEqual(writes, []);
});
