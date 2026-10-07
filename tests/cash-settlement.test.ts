import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";

process.env.DATABASE_URL ??= "postgresql://unused/unused";
process.env.SESSION_SECRET ??= "unit-test-placeholder-secret-value-not-real-00";

const src = (rel: string) => readFile(new URL(`../${rel}`, import.meta.url), "utf8");
const D = async (v: string | number) => new (await import("../app/generated/prisma/client")).Prisma.Decimal(v);
const code = (c: string) => (e: unknown) => (e as { code?: string }).code === c;

function fnBody(source: string, header: string): string {
  const start = source.indexOf(header);
  assert.notEqual(start, -1, `missing ${header}`);
  const next = source.indexOf("\nexport ", start + header.length);
  return source.slice(start, next === -1 ? undefined : next);
}

// ---- pure rules -------------------------------------------------------------------

function order(over: Record<string, unknown> = {}) {
  return { id: "o1", number: "100", branchId: "b1", customerId: "c1", isPostpaid: true, isInternal: false, status: "COMPLETED", totalAmount: null as unknown, completedAt: new Date("2026-10-01T00:00:00Z"), ...over };
}

test("computeOutstanding = total - sum(PAID); allocateSettlement pays exactly each outstanding in id order", async () => {
  const s = await import("../lib/cash/settlement");
  assert.equal(s.computeOutstanding(await D(100), [await D(30), await D(20)]).toString(), "50");
  assert.equal(s.computeOutstanding(null, []).toString(), "0");
  const orders = [order({ id: "o2", number: "2", totalAmount: await D(200) }), order({ id: "o1", number: "1", totalAmount: await D(100) })] as never[];
  const paid = new Map([["o1", [await D(40)]]]);
  const { allocations, total } = s.allocateSettlement(["o2", "o1", "o1"], orders, paid, { branchId: "b1", customerId: "c1" });
  assert.deepEqual(allocations.map((a) => [a.orderId, a.amount.toString()]), [["o1", "60"], ["o2", "200"]]);
  assert.equal(total.toString(), "260");
});

test("allocateSettlement rejects every ineligible order with SETTLEMENT_ORDER_INVALID naming it", async () => {
  const s = await import("../lib/cash/settlement");
  const target = { branchId: "b1", customerId: "c1" };
  const bad: Array<[Record<string, unknown>, string]> = [
    [{ branchId: "b2" }, "BRANCH_MISMATCH"],
    [{ customerId: "c2" }, "CUSTOMER_MISMATCH"],
    [{ isPostpaid: false }, "NOT_POSTPAID"],
    [{ isInternal: true }, "INTERNAL"],
    [{ status: "IN_PROGRESS" }, "NOT_COMPLETED"],
  ];
  const total = await D(100);
  for (const [over, reason] of bad) {
    try {
      s.allocateSettlement(["o1"], [order({ totalAmount: total, ...over })] as never[], new Map(), target);
      assert.fail(`expected ${reason}`);
    } catch (e) {
      const err = e as { code: string; status: number; details?: Record<string, unknown> };
      assert.equal(err.code, "SETTLEMENT_ORDER_INVALID");
      assert.equal(err.status, 422);
      assert.deepEqual(err.details, { orderId: "o1", reason });
    }
  }
  // fully paid -> NO_BALANCE; unknown id -> NOT_FOUND; empty -> SETTLEMENT_EMPTY
  assert.throws(() => s.allocateSettlement(["o1"], [order({ totalAmount: total })] as never[], new Map([["o1", [total]]]), target), (e: unknown) => (e as { details?: { reason?: string } }).details?.reason === "NO_BALANCE");
  assert.throws(() => s.allocateSettlement(["zzz"], [], new Map(), target), (e: unknown) => (e as { details?: { reason?: string } }).details?.reason === "NOT_FOUND");
  assert.throws(() => s.allocateSettlement([], [], new Map(), target), code("SETTLEMENT_EMPTY"));
});

test("expectedAmount mismatch is a 409 SETTLEMENT_AMOUNT_CHANGED; absent is fine; garbage is CASH_AMOUNT_INVALID", async () => {
  const s = await import("../lib/cash/settlement");
  const total = await D("250000");
  s.assertExpectedAmount(total, undefined);
  s.assertExpectedAmount(total, "");
  s.assertExpectedAmount(total, "250,000");
  assert.throws(() => s.assertExpectedAmount(total, "249999"), (e: unknown) => code("SETTLEMENT_AMOUNT_CHANGED")(e) && (e as { status: number }).status === 409);
  assert.throws(() => s.assertExpectedAmount(total, "abc"), code("CASH_AMOUNT_INVALID"));
});

test("parseOrderIds dedupes + sorts, rejects empty/non-string/too many; occurredAt cannot predate completion", async () => {
  const s = await import("../lib/cash/settlement");
  assert.deepEqual(s.parseOrderIds(["b", "a", "b"]), ["a", "b"]);
  for (const bad of [undefined, [], "a"]) assert.throws(() => s.parseOrderIds(bad), code("SETTLEMENT_EMPTY"));
  assert.throws(() => s.parseOrderIds([1]), code("CASH_FIELD_INVALID"));
  assert.throws(() => s.parseOrderIds(Array.from({ length: s.MAX_SETTLEMENT_ORDERS + 1 }, (_, i) => `o${i}`)), code("CASH_FIELD_INVALID"));
  const completedAt = new Date("2026-10-02T00:00:00Z");
  assert.throws(() => s.assertOccurredAfterCompletion([{ orderNumber: "9", completedAt }], new Date("2026-10-01T00:00:00Z")), code("CASH_DATE_INVALID"));
  s.assertOccurredAfterCompletion([{ orderNumber: "9", completedAt }], completedAt);
});

test("settlement permissions need BOTH orders.closeUnpaidPostpaid and cash.manage (owner implicit)", async () => {
  const s = await import("../lib/cash/settlement");
  const rules = await import("../lib/cash/rules");
  void rules;
  const owner = { id: "u", tenantId: "t", isOwner: true, role: null } as never;
  s.assertSettlementPermissions(owner);
  const nobody = { id: "u", tenantId: "t", isOwner: false, role: { permissions: [] } } as never;
  assert.throws(() => s.assertSettlementPermissions(nobody), code("POSTPAID_SETTLEMENT_FORBIDDEN"));
  const onlyPostpaid = { id: "u", tenantId: "t", isOwner: false, role: { permissions: ["orders.closeUnpaidPostpaid"] } } as never;
  assert.throws(() => s.assertSettlementPermissions(onlyPostpaid), code("CASH_MANAGE_FORBIDDEN"));
  const onlyCash = { id: "u", tenantId: "t", isOwner: false, role: { permissions: ["cash.manage"] } } as never;
  assert.throws(() => s.assertSettlementPermissions(onlyCash), code("POSTPAID_SETTLEMENT_FORBIDDEN"));
});

test("assertNotSettlementPayment blocks any payment carrying a settlementId", async () => {
  const c = await import("../lib/orders/order-payment-commands");
  c.assertNotSettlementPayment([{ settlementId: null }, {}]);
  assert.throws(() => c.assertNotSettlementPayment([{ settlementId: null }, { settlementId: "s1" }]), (e: unknown) => code("SETTLEMENT_PAYMENT_LOCKED")(e) && (e as { status: number; message: string }).status === 422 && (e as { message: string }).message === "Нэгдсэн тооцооны төлбөрийг тооцоогоор нь цуцална уу.");
  const row = c.serializeLedgerPayment({ id: "p", amount: await D(5), method: "CASH", status: "PAID", paidAt: null, createdAt: new Date(), bank: null, settlementId: "s1" } as never);
  assert.equal(row.settlementId, "s1");
});

// ---- fake-transaction behaviour --------------------------------------------------------

async function makeDb(seed: { orders: Array<Record<string, unknown>>; payments?: Array<Record<string, unknown>> }) {
  const locks: string[] = [];
  const db = {
    orders: seed.orders.map((o) => ({ ...o })),
    payments: (seed.payments ?? []).map((p) => ({ ...p })),
    settlements: [] as Array<Record<string, unknown>>,
    openSessionId: "sess-default" as string | null, // an open register is now required for every settlement write
    txns: [] as Array<Record<string, unknown>>,
    audits: [] as Array<Record<string, unknown>>,
    locks,
  };
  let seq = 0;
  const id = (p: string) => `${p}${++seq}`;
  const tx = {
    $queryRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => {
      if (strings[0].includes('"Branch"')) return [{ id: values[0] }]; // Phase C3 attach lock — not an order/settlement lock
      locks.push(`${strings[0].includes("PostpaidSettlement") ? "S" : "O"}:${values[0]}`);
      return [{ id: values[0] }];
    },
    branch: { findFirst: async () => ({ id: "b1", isActive: true }) },
    cashSession: { findFirst: async () => (db.openSessionId ? { id: db.openSessionId } : null) },
    customer: { findFirst: async () => ({ id: "c1" }) },
    tenant: { findUnique: async () => ({ enabledBanks: [] }) },
    cashTransactionType: { findFirst: async () => ({ id: "type-settle" }) },
    serviceOrder: {
      findMany: async ({ where }: { where: { id: { in: string[] } } }) => db.orders.filter((o) => where.id.in.includes(o.id as string)),
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => { Object.assign(db.orders.find((o) => o.id === where.id)!, data); },
    },
    orderPayment: {
      findMany: async ({ where }: { where: { orderId?: string | { in: string[] }; status?: string } }) =>
        db.payments.filter((p) => {
          const oid = where.orderId;
          const okOrder = oid === undefined || (typeof oid === "string" ? p.orderId === oid : oid.in.includes(p.orderId as string));
          return okOrder && (where.status === undefined || p.status === where.status);
        }),
      create: async ({ data }: { data: Record<string, unknown> }) => { const row = { id: id("p"), ...data }; db.payments.push(row); return row; },
      updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        let n = 0;
        for (const p of db.payments) {
          if (where.settlementId !== undefined && p.settlementId !== where.settlementId) continue;
          if (where.method !== undefined && p.method !== where.method) continue;
          if (where.status !== undefined && p.status !== where.status) continue;
          Object.assign(p, data); n += 1;
        }
        return { count: n };
      },
    },
    postpaidSettlement: {
      create: async ({ data }: { data: Record<string, unknown> }) => { const row = { id: id("s"), voidedAt: null, ...data }; db.settlements.push(row); return { id: row.id }; },
      findFirst: async ({ where }: { where: { id: string } }) => {
        const s = db.settlements.find((x) => x.id === where.id);
        if (!s) return null;
        return {
          ...s,
          payments: db.payments.filter((p) => p.settlementId === s.id && p.status === "PAID"),
          transactions: db.txns.filter((t) => t.settlementId === s.id && t.voidedAt == null),
        };
      },
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => { Object.assign(db.settlements.find((x) => x.id === where.id)!, data); },
    },
    cashTransaction: {
      create: async ({ data }: { data: Record<string, unknown> }) => { const row = { id: id("t"), voidedAt: null, ...data }; db.txns.push(row); return { id: row.id }; },
      findMany: async () => [],
      findFirst: async () => null, // closed-session lock lookup -> none (open session)
      updateMany: async ({ where, data }: { where: { settlementId: string; voidedAt?: null }; data: Record<string, unknown> }) => {
        let n = 0;
        for (const t of db.txns) if (t.settlementId === where.settlementId && (where.voidedAt === undefined || t.voidedAt == null)) { Object.assign(t, data); n += 1; }
        return { count: n };
      },
    },
    auditLog: { create: async ({ data }: { data: Record<string, unknown> }) => { db.audits.push(data); } },
  };
  return { db, tx };
}

const createInput = (over: Record<string, unknown> = {}) => ({
  tenantId: "t1", actorId: "u1", branchId: "b1", customerId: "c1", orderIds: ["o1", "o2"], method: "CASH" as const, bankInput: undefined,
  occurredAt: new Date("2026-10-05T00:00:00Z"), note: "lump", expectedAmount: undefined, ...over,
});

test("runCreateSettlement: locks orders ascending, one payment per order, ONE lump ledger entry, totals recomputed", async () => {
  const s = await import("../lib/cash/settlement");
  const { db, tx } = await makeDb({
    orders: [
      order({ id: "o2", number: "2", totalAmount: await D(200), paymentStatus: "UNPAID" }),
      order({ id: "o1", number: "1", totalAmount: await D(100), paymentStatus: "PARTIAL" }),
    ],
    payments: [{ id: "old", orderId: "o1", amount: await D(40), status: "PAID", method: "CASH", settlementId: null, paidAt: new Date("2026-10-02T00:00:00Z") }],
  });
  const id = await s.runCreateSettlement(tx, createInput({ orderIds: ["o2", "o1"], expectedAmount: "260" }));
  assert.deepEqual(db.locks, ["O:o1", "O:o2"]);
  assert.equal(db.settlements.length, 1);
  assert.equal(db.settlements[0].id, id);
  assert.equal(String(db.settlements[0].amount), "260");
  const newPayments = db.payments.filter((p) => p.settlementId === id);
  assert.deepEqual(newPayments.map((p) => [p.orderId, String(p.amount), p.status]), [["o1", "60", "PAID"], ["o2", "200", "PAID"]]);
  assert.equal(db.txns.length, 1, "exactly one ledger entry");
  assert.equal(String(db.txns[0].amount), "260");
  assert.equal(db.txns[0].direction, "INCOME");
  assert.equal(db.txns[0].typeId, "type-settle");
  assert.equal(db.txns[0].settlementId, id);
  assert.equal(db.txns[0].customerId, "c1");
  assert.equal(db.txns[0].orderPaymentId, undefined);
  assert.equal(db.txns[0].orderId, undefined);
  assert.deepEqual(db.orders.map((o) => [o.id, o.paymentStatus]).sort(), [["o1", "PAID"], ["o2", "PAID"]]);
  assert.equal(db.audits.length, 1);
});

test("runCreateSettlement: stale expectedAmount, ineligible order and missing bank all abort before any write", async () => {
  const s = await import("../lib/cash/settlement");
  for (const [over, expected] of [
    [{ expectedAmount: "1" }, "SETTLEMENT_AMOUNT_CHANGED"],
    [{ orderIds: ["o1", "nope"] }, "SETTLEMENT_ORDER_INVALID"],
    [{ method: "BANK_TRANSFER" }, "PAYMENT_BANK_REQUIRED"],
    [{ occurredAt: new Date("2026-09-01T00:00:00Z") }, "CASH_DATE_INVALID"],
  ] as Array<[Record<string, unknown>, string]>) {
    const { db, tx } = await makeDb({ orders: [order({ id: "o1", totalAmount: await D(100) }), order({ id: "o2", totalAmount: await D(50) })] });
    await assert.rejects(s.runCreateSettlement(tx, createInput(over)), code(expected));
    assert.equal(db.settlements.length + db.txns.length + db.payments.length, 0, expected);
  }
});

test("runVoidSettlement: cancels every settlement payment, recomputes orders, voids the single entry; guards", async () => {
  const s = await import("../lib/cash/settlement");
  const { db, tx } = await makeDb({ orders: [order({ id: "o1", totalAmount: await D(100) }), order({ id: "o2", totalAmount: await D(200) })] });
  const id = await s.runCreateSettlement(tx, createInput());
  db.locks.length = 0;
  const base = { tenantId: "t1", actorId: "u2", settlementId: id, scope: null, reason: "oops" };
  // out-of-scope branch -> 404
  await assert.rejects(s.runVoidSettlement(tx, { ...base, scope: "other" }), code("SETTLEMENT_NOT_FOUND"));
  db.locks.length = 0;
  await s.runVoidSettlement(tx, base);
  assert.deepEqual(db.locks, [`S:${id}`, "O:o1", "O:o2"]);
  assert.ok(db.settlements[0].voidedAt);
  assert.equal(db.settlements[0].voidReason, "oops");
  assert.deepEqual(db.payments.map((p) => p.status), ["CANCELLED", "CANCELLED"]);
  assert.equal(db.txns[0].voidReason, "Тооцоо цуцлагдсан");
  assert.ok(db.txns[0].voidedAt);
  assert.deepEqual(db.orders.map((o) => o.paymentStatus), ["UNPAID", "UNPAID"]);
  await assert.rejects(s.runVoidSettlement(tx, base), code("SETTLEMENT_ALREADY_VOIDED"));
  await assert.rejects(s.runVoidSettlement(tx, { ...base, settlementId: "missing" }), code("SETTLEMENT_NOT_FOUND"));
});

// ---- structural guards ---------------------------------------------------------------------

test("every individual payment path rejects settlement payments before touching them", async () => {
  const commands = await src("lib/orders/order-payment-commands.ts");
  const reverse = fnBody(commands, "export async function reverseOrderPaymentCommand");
  assert.match(reverse, /settlementId: true/);
  assert.ok(reverse.indexOf("assertNotSettlementPayment([payment])") > -1);
  assert.ok(reverse.indexOf("assertNotSettlementPayment") < reverse.indexOf("tx.orderPayment.update"));
  const reverseAll = fnBody(commands, "export async function reverseAllOrderPaymentsCommand");
  assert.match(reverseAll, /settlementId: true/);
  assert.ok(reverseAll.indexOf("assertNotSettlementPayment(paid)") > -1);
  assert.ok(reverseAll.indexOf("assertNotSettlementPayment") < reverseAll.indexOf("tx.orderPayment.updateMany"));
  // creation/QPay paths never set settlementId, so the ledger hook always runs for them
  const create = fnBody(commands, "export async function createOrderPaymentCommand");
  assert.doesNotMatch(create, /settlementId:\s*[^n]/);
  // the legacy PATCH adapter funnels through the same commands
  const legacy = await src("app/api/v1/orders/[id]/payment/route.ts");
  assert.match(legacy, /reverseAllOrderPaymentsCommand/);
  assert.match(commands, /PAYMENT_LEDGER_SELECT = \{[\s\S]*?settlementId: true,\s*\} satisfies/);
});

test("settlement core: single transaction, lock helper, no per-payment ledger hook, void reason constant", async () => {
  const text = await src("lib/cash/settlement.ts");
  const create = fnBody(text, "export async function runCreateSettlement");
  assert.ok(create.indexOf("lockOrdersInOrder") > -1 && create.indexOf("lockOrdersInOrder") < create.indexOf("tx.orderPayment.create"));
  assert.match(create, /recomputeOrderPaymentTotals\(tx,/);
  assert.match(create, /tx\.cashTransaction\.create/);
  assert.match(create, /settlementId: settlement\.id/);
  assert.doesNotMatch(text, /postPaymentIncome\(/);
  assert.match(text, /\.sort\(\)/);
  assert.match(text, /FOR UPDATE/);
  assert.equal((text.match(/withBookingTransaction\(/g) ?? []).length, 2);
  const rules = await src("lib/cash/rules.ts");
  assert.match(rules, /VOID_REASON_SETTLEMENT_VOIDED = "Тооцоо цуцлагдсан"/);
});

test("settlement staff API: cash.manage gate, branch scope, subscription lock on writes, server actions exported", async () => {
  const files = [
    "app/api/v1/cash/settlements/route.ts",
    "app/api/v1/cash/settlements/eligible/route.ts",
    "app/api/v1/cash/settlements/[id]/route.ts",
    "app/api/v1/cash/settlements/[id]/void/route.ts",
  ];
  for (const file of files) {
    const text = await src(file);
    assert.match(text, /requireCashApiUser\(req\)/, file);
    assert.match(text, /resolveWorkingBranch/, file);
    if (/export async function (POST|DELETE)|async function handle/.test(text)) assert.match(text, /requireActiveSubscriptionApi/, file);
  }
  const actions = await src("app/_actions/cash-settlements.ts");
  for (const name of ["createPostpaidSettlementAction", "voidPostpaidSettlementAction", "listEligiblePostpaidOrdersAction", "listSettlementsAction", "getSettlementAction"]) {
    assert.match(actions, new RegExp(`export async function ${name}`));
  }
  assert.match(actions, /assertActiveSubscription/);
  const http = await src("lib/cash/http.ts");
  assert.match(http, /error\.details/);
});

test("a CANCELLED QPay payment can never become PAID or post a ledger entry (legacy + command confirm)", async () => {
  const legacy = fnBody(await src("lib/order-payments.ts"), "export async function confirmOrderQPayPayment");
  // early exit for anything that is not PENDING (PAID handled above), before QPay is even asked
  assert.ok(legacy.indexOf('payment.status !== "PENDING"') > -1 && legacy.indexOf('payment.status !== "PENDING"') < legacy.indexOf("checkPayment"));
  // locked, conditional PENDING -> PAID transition; ledger hook only after a successful transition
  assert.match(legacy, /withOrderTransaction\(tenantId, payment\.orderId/);
  assert.match(legacy, /updateMany\(\{\s*where: \{ id: payment\.id, tenantId, status: "PENDING" \}/);
  assert.match(legacy, /if \(moved\.count === 0\) return false;/);
  assert.ok(legacy.indexOf("moved.count === 0") < legacy.indexOf("postPaymentIncome(tx,"));
  assert.match(legacy, /recomputeOrderPaymentTotals\(tx,/);
  assert.doesNotMatch(legacy, /prevPaid/);
  // command path: PENDING-only guard under the order lock precedes the PAID update + ledger hook
  const confirm = fnBody(await src("lib/orders/order-payment-commands.ts"), "export async function confirmOrderQPayPaymentCommand");
  const guard = confirm.lastIndexOf('fresh.status !== "PENDING"');
  assert.ok(guard > -1 && guard < confirm.indexOf('data: { status: "PAID", paidAt: qpayPaidAt'));
  assert.ok(confirm.indexOf('data: { status: "PAID", paidAt: qpayPaidAt') < confirm.lastIndexOf("postPaymentIncome(tx,"));
});

test("settlement create cancels pending QPay invoices of the settled orders (so they cannot be revived)", async () => {
  const create = fnBody(await src("lib/cash/settlement.ts"), "export async function runCreateSettlement");
  assert.match(create, /method: "QPAY", status: "PENDING" \}, data: \{ status: "CANCELLED" \}/);
  // ...and the provider-side cancel ran before the transaction (tests/qpay-cancel.test.ts) — here only the safety net is checked.
});

test("runCreateSettlement refuses a live QPay invoice that was not cancelled at the provider first; cancels locally once it was", async () => {
  const s = await import("../lib/cash/settlement");
  const seed = async () => makeDb({
    orders: [order({ id: "o1", number: "1", totalAmount: await D(100), paymentStatus: "UNPAID" })],
    payments: [{ id: "q1", orderId: "o1", amount: await D(100), status: "PENDING", method: "QPAY", qpayInvoiceId: "inv1", settlementId: null }],
  });
  const a = await seed();
  await assert.rejects(() => s.runCreateSettlement(a.tx, createInput({ orderIds: ["o1"] })), (e: unknown) => code("SETTLEMENT_AMOUNT_CHANGED")(e) && (e as { status: number }).status === 409);
  assert.equal(a.db.payments.find((p) => p.id === "q1")!.status, "PENDING", "not cancelled locally");
  const b = await seed();
  await s.runCreateSettlement(b.tx, createInput({ orderIds: ["o1"], providerCancelledPaymentIds: ["q1"] }));
  assert.equal(b.db.payments.find((p) => p.id === "q1")!.status, "CANCELLED");
});

test("runCreateSettlement attaches the lump entry to the open cash session for every method (CASH and non-CASH)", async () => {
  const s = await import("../lib/cash/settlement");
  for (const [method, expected] of [["CASH", "sess-1"], ["BANK_TRANSFER", "sess-1"]] as const) {
    const { db, tx } = await makeDb({ orders: [order({ id: "o1", number: "1", totalAmount: await D(100), paymentStatus: "UNPAID" })] });
    db.openSessionId = "sess-1";
    await s.runCreateSettlement(tx, createInput({ orderIds: ["o1"], method, bankInput: method === "CASH" ? undefined : "KHAN" }));
    assert.equal(db.txns[0].sessionId ?? null, expected, method);
  }
  const { db, tx } = await makeDb({ orders: [order({ id: "o1", number: "1", totalAmount: await D(100), paymentStatus: "UNPAID" })] });
  db.openSessionId = null;
  await assert.rejects(s.runCreateSettlement(tx, createInput({ orderIds: ["o1"] })), (e: unknown) => (e as { code?: string; status?: number }).code === "CASH_SESSION_CLOSED" && (e as { status?: number }).status === 409);
  assert.equal(db.txns.length, 0, "no open session -> nothing written");
});

// ---- B5: eligible orders filter before limiting ---------------------------------------------------

test("listEligiblePostpaidOrders filters unpaid in the DB query and flags truncation", async () => {
  const { prisma } = await import("../lib/prisma");
  const { listEligiblePostpaidOrders } = await import("../lib/cash/settlement");
  const { Prisma } = await import("../app/generated/prisma/client");
  const mk = (i: number) => ({ id: `o${i}`, number: `N${i}`, plateSnapshot: null, completedAt: new Date(2026, 0, 1 + (i % 28)), totalAmount: new Prisma.Decimal(100), payments: [] });
  let seen: { where: Record<string, unknown>; take: number } | null = null;
  const orig = prisma.serviceOrder.findMany;
  (prisma.serviceOrder as { findMany: unknown }).findMany = async (args: { where: Record<string, unknown>; take: number }) => {
    seen = args;
    return Array.from({ length: args.take }, (_, i) => mk(i));
  };
  try {
    const actor = { id: "u", tenantId: "t", isOwner: true, permissions: [], workingBranchId: "ALL" } as never;
    const res = await listEligiblePostpaidOrders({ actor, customerId: "c", branchId: "b" });
    assert.deepEqual(seen!.where.paymentStatus, { not: "PAID" });
    assert.deepEqual(seen!.where.totalAmount, { gt: 0 });
    assert.equal(seen!.take, 501);
    assert.equal(res.orders.length, 500);
    assert.equal(res.truncated, true);
    assert.equal(res.total, "50000");
  } finally {
    (prisma.serviceOrder as { findMany: unknown }).findMany = orig;
  }
});
