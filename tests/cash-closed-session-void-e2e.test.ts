import assert from "node:assert/strict";
import { test } from "node:test";

process.env.DATABASE_URL ??= "postgresql://unused/unused";
process.env.SESSION_SECRET ??= "unit-test-placeholder-secret-value-not-real-00";

// Behavioural tests against a stateful in-memory ledger: entries of a CLOSED cash session are locked for every
// user void/reverse (409 CASH_SESSION_ENTRY_LOCKED, any method); system paths and open/no-session entries are not.

type Entry = Record<string, unknown> & { id: string };

function ledger(init: { sessions: Array<{ id: string; branchId: string; closedAt: Date | null }>; entries: Entry[] }) {
  const { entries, sessions } = init;
  const closedSessionIds = () => new Set(sessions.filter((s) => s.closedAt).map((s) => s.id));
  const matches = (e: Entry, w: Record<string, unknown>) => {
    for (const [k, v] of Object.entries(w)) {
      if (k === "session") {
        if (!(e.sessionId && closedSessionIds().has(e.sessionId as string))) return false;
      } else if (k === "orderPaymentId" && v && typeof v === "object") {
        if (!(v as { in: unknown[] }).in.includes(e.orderPaymentId)) return false;
      } else if (k === "sessionId" && v && typeof v === "object") {
        if (e.sessionId == null) return false;
      } else if (k === "type") {
        if ((e.systemKey ?? null) !== (v as { systemKey: string }).systemKey) return false;
      } else if ((e[k] ?? null) !== v) return false;
    }
    return true;
  };
  const tx = {
    $queryRaw: async () => [],
    auditLog: { create: async () => ({}) },
    cashSession: { findFirst: async ({ where }: { where: { branchId: string } }) => sessions.find((s) => s.branchId === where.branchId && s.closedAt == null) ?? null },
    cashTransaction: {
      findFirst: async ({ where }: { where: Record<string, unknown> }) => {
        const e = entries.find((x) => matches(x, where));
        return e ? { ...e, type: { systemKey: e.systemKey ?? null } } : null;
      },
      findMany: async ({ where }: { where: Record<string, unknown> }) => entries.filter((e) => matches(e, where)),
      findUniqueOrThrow: async ({ where }: { where: { id: string } }) => entries.find((x) => x.id === where.id)!,
      updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        const hit = entries.filter((e) => matches(e, where));
        for (const e of hit) Object.assign(e, data);
        return { count: hit.length };
      },
    },
  };
  return { tx: tx as never, entries };
}

const ACTOR = { id: "u1", tenantId: "t1", isOwner: true } as never;
const base = { tenantId: "t1", voidedAt: null, method: "CASH", orderPaymentId: null, orderId: null, settlementId: null, customerId: null };
const CLOSED = new Date("2026-10-05T10:00:00Z");
const SESSIONS = [{ id: "s1", branchId: "b1", closedAt: CLOSED }, { id: "s2", branchId: "b1", closedAt: null }];
const code = (e: unknown) => (e as { code?: string }).code;
const isLocked = (e: unknown) => code(e) === "CASH_SESSION_ENTRY_LOCKED" && (e as { status?: number }).status === 409 && (e as Error).message === "Хаагдсан ээлжийн гүйлгээг буцаах боломжгүй.";
const METHODS = ["CASH", "CARD", "BANK_TRANSFER", "QPAY", "OTHER"];

test("manual entry void: open-session and no-session (legacy) entries stay voidable", async () => {
  const { runVoidCashEntry } = await import("../lib/cash/ledger");
  const l = ledger({
    sessions: SESSIONS,
    entries: [
      { ...base, id: "e1", branchId: "b1", direction: "INCOME", amount: 5000, sessionId: "s2" },
      { ...base, id: "e2", branchId: "b1", direction: "INCOME", amount: 5000, sessionId: null },
    ],
  });
  await runVoidCashEntry(l.tx, { actor: ACTOR, scope: null, entryId: "e1", reason: "oops" });
  await runVoidCashEntry(l.tx, { actor: ACTOR, scope: null, entryId: "e2", reason: "legacy" });
  assert.ok(l.entries.every((e) => e.voidedAt != null));
  assert.equal(l.entries.length, 2, "nothing is auto-posted any more (B2 compensation removed)");
});

test("manual entry void: a closed-session entry is locked for EVERY method and direction, and stays untouched", async () => {
  const { runVoidCashEntry } = await import("../lib/cash/ledger");
  for (const method of METHODS) {
    for (const direction of ["INCOME", "EXPENSE"]) {
      const l = ledger({ sessions: SESSIONS, entries: [{ ...base, id: "e1", branchId: "b1", direction, amount: 100, sessionId: "s1", method }] });
      await assert.rejects(runVoidCashEntry(l.tx, { actor: ACTOR, scope: null, entryId: "e1", reason: "r" }), isLocked, `${method}/${direction}`);
      assert.equal(l.entries[0].voidedAt, null);
      assert.equal(l.entries.length, 1);
    }
  }
});

test("settlement void: open-session lump entry is voided; closed-session one is locked (every method)", async () => {
  const { runVoidSettlement } = await import("../lib/cash/settlement");
  const wire = (l: ReturnType<typeof ledger>) => {
    const inner = l.tx as unknown as Record<string, Record<string, unknown>>;
    inner.postpaidSettlement = {
      findFirst: async () => ({ id: "st1", branchId: "b1", amount: 80000, voidedAt: null, payments: [], transactions: [{ id: "t1", voidedAt: null }] }),
      update: async () => ({}),
    };
    inner.orderPayment = { updateMany: async () => ({ count: 0 }) };
    inner.serviceOrder = { findMany: async () => [] };
  };
  const open = ledger({ sessions: SESSIONS, entries: [{ ...base, id: "t1", branchId: "b1", direction: "INCOME", amount: 80000, sessionId: "s2", settlementId: "st1" }] });
  wire(open);
  await runVoidSettlement(open.tx, { tenantId: "t1", actorId: "u1", settlementId: "st1", scope: null, reason: "r" });
  assert.notEqual(open.entries[0].voidedAt, null);
  for (const method of METHODS) {
    const l = ledger({ sessions: SESSIONS, entries: [{ ...base, id: "t1", branchId: "b1", direction: "INCOME", amount: 80000, sessionId: "s1", settlementId: "st1", method }] });
    wire(l);
    await assert.rejects(runVoidSettlement(l.tx, { tenantId: "t1", actorId: "u1", settlementId: "st1", scope: null, reason: "r" }), isLocked, method);
    assert.equal(l.entries[0].voidedAt, null);
  }
});

test("order payment guard (reverse / reverse-all): open allowed, closed locked for each method, a mixed set rejects the whole call", async () => {
  const { assertPaymentsNotInClosedSession, OrderPaymentCommandError } = await import("../lib/orders/order-payment-commands");
  const mk = (id: string, pid: string, sessionId: string | null, method = "CASH"): Entry => ({ ...base, id, branchId: "b1", direction: "INCOME", amount: 1, sessionId, orderPaymentId: pid, method });
  const open = ledger({ sessions: SESSIONS, entries: [mk("e1", "p1", "s2"), mk("e2", "p2", null)] });
  await assert.doesNotReject(assertPaymentsNotInClosedSession(open.tx, "t1", ["p1", "p2"]));
  for (const method of METHODS) {
    const l = ledger({ sessions: SESSIONS, entries: [mk("e1", "p1", "s1", method)] });
    await assert.rejects(assertPaymentsNotInClosedSession(l.tx, "t1", ["p1"]), (e) => e instanceof OrderPaymentCommandError && isLocked(e), method);
  }
  const mixed = ledger({ sessions: SESSIONS, entries: [mk("e1", "p1", "s2"), mk("e2", "p2", "s1", "QPAY"), mk("e3", "p3", "s2", "CARD")] });
  await assert.rejects(assertPaymentsNotInClosedSession(mixed.tx, "t1", ["p1", "p2", "p3"]), isLocked);
  assert.ok(mixed.entries.every((e) => e.voidedAt == null), "the guard never writes");
  await assert.doesNotReject(assertPaymentsNotInClosedSession(mixed.tx, "t1", []));
  // a voided entry in a closed session no longer locks anything
  const voided = ledger({ sessions: SESSIONS, entries: [{ ...mk("e1", "p1", "s1"), voidedAt: new Date() }] });
  await assert.doesNotReject(assertPaymentsNotInClosedSession(voided.tx, "t1", ["p1"]));
});

test("system path stays unblocked: voidInternalRepairExpense still voids a closed-session entry and posts nothing", async () => {
  const sync = await import("../lib/cash/sync");
  const l = ledger({
    sessions: SESSIONS,
    entries: [
      { ...base, id: "r1", branchId: "b1", direction: "EXPENSE", amount: 9000, sessionId: "s1", orderId: "o1", method: "OTHER", systemKey: "INTERNAL_REPAIR" },
    ],
  });
  assert.equal(await sync.voidInternalRepairExpense(l.tx, { tenantId: "t1", actorId: "u1", orderId: "o1", reason: "cancel" }), 1);
  assert.notEqual(l.entries[0].voidedAt, null);
  assert.equal(l.entries.length, 1, "no compensation entry either");
});

test("locked flag: true only for a live entry in a closed session (entry / settlement / payment ids)", async () => {
  const { isEntryLocked } = await import("../lib/cash/ledger");
  const closed = { closedAt: CLOSED };
  assert.equal(isEntryLocked({ voidedAt: null, session: closed }), true);
  assert.equal(isEntryLocked({ voidedAt: null, session: { closedAt: null } }), false);
  assert.equal(isEntryLocked({ voidedAt: null, session: null }), false, "legacy: no session");
  assert.equal(isEntryLocked({ voidedAt: new Date(), session: closed }), false);

  const { findLockedPaymentIds } = await import("../lib/cash/session-attach");
  const l = ledger({
    sessions: SESSIONS,
    entries: [
      { ...base, id: "e1", branchId: "b1", direction: "INCOME", amount: 1, sessionId: "s1", orderPaymentId: "p1", method: "QPAY" },
      { ...base, id: "e2", branchId: "b1", direction: "INCOME", amount: 1, sessionId: "s2", orderPaymentId: "p2" },
      { ...base, id: "e3", branchId: "b1", direction: "INCOME", amount: 1, sessionId: null, orderPaymentId: "p3" },
    ],
  });
  assert.deepEqual([...(await findLockedPaymentIds(l.tx, "t1", ["p1", "p2", "p3"]))], ["p1"]);
  assert.equal((await findLockedPaymentIds(l.tx, "t1", [])).size, 0);

  const { serializeLedgerPayment } = await import("../lib/orders/order-payment-commands");
  const row = { id: "p1", amount: { toString: () => "5" }, method: "CASH", status: "PAID", paidAt: null, createdAt: new Date(), bank: null, settlementId: null };
  assert.equal(serializeLedgerPayment(row as never, true).locked, true);
  assert.equal(serializeLedgerPayment(row as never).locked, false);
});

test("assertManuallyVoidable still treats legacy compensation rows as system entries", async () => {
  const rules = await import("../lib/cash/rules");
  const plain = { voidedAt: null, orderPaymentId: null, orderId: null, settlementId: null };
  assert.throws(() => rules.assertManuallyVoidable({ ...plain, type: { systemKey: "CLOSED_SESSION_VOID_OUT" } }), (e: unknown) => code(e) === "CASH_SYSTEM_ENTRY");
  assert.doesNotThrow(() => rules.assertManuallyVoidable({ ...plain, type: { systemKey: null } }));
});

test("report: no closedSessionRefunds field; legacy compensation types count in normal totals once", async () => {
  const { buildCashSummary } = await import("../lib/cash/report");
  const groups = [
    { direction: "EXPENSE", method: "CASH", bank: null, typeId: "ty-out", _sum: { amount: "100000" }, _count: { _all: 1 } },
    { direction: "INCOME", method: "CASH", bank: null, typeId: "ty-pay", _sum: { amount: "50000" }, _count: { _all: 2 } },
  ];
  const client = {
    cashTransaction: { groupBy: async (a: { by: string[] }) => (a.by.includes("typeId") ? groups : []) },
    cashSessionMethodCount: { findMany: async () => [] },
    cashTransactionType: { findMany: async () => [{ id: "ty-pay", name: "p", systemKey: "ORDER_PAYMENT" }, { id: "ty-out", name: "o", systemKey: "CLOSED_SESSION_VOID_OUT" }] },
    cashSession: { findMany: async () => [] },
    serviceOrder: { aggregate: async () => ({ _sum: { totalAmount: null }, _count: { _all: 0 } }), findMany: async () => [] },
    orderPayment: { aggregate: async () => ({ _sum: { amount: null }, _count: { _all: 0 } }) },
  };
  const s = await buildCashSummary({
    actor: { id: "u", tenantId: "t1", isOwner: true } as never,
    from: new Date("2026-10-01T00:00:00+08:00"),
    to: new Date("2026-10-31T23:59:59+08:00"),
    client: client as never,
  });
  assert.equal("closedSessionRefunds" in s, false);
  assert.deepEqual(s.totals, { income: "50000", expense: "100000", net: "-50000" });
});
