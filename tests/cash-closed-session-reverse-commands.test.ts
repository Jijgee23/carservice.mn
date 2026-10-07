import assert from "node:assert/strict";
import { test } from "node:test";

process.env.DATABASE_URL ??= "postgresql://unused/unused";
process.env.SESSION_SECRET ??= "unit-test-placeholder-secret-value-not-real-00";

// Behavioural: the real reverse / reverse-all commands against a fake booking client (no DB).

type Row = Record<string, unknown> & { id: string };

async function setup(payments: Array<{ id: string; method: string; sessionId: string | null }>) {
  const { Prisma } = await import("../app/generated/prisma/client");
  const sessions = [{ id: "s1", branchId: "b1", closedAt: new Date("2026-10-05T10:00:00Z") }, { id: "s2", branchId: "b1", closedAt: null }];
  const pays: Row[] = payments.map((p) => ({ id: p.id, orderId: "o1", tenantId: "t1", method: p.method, status: "PAID", amount: new Prisma.Decimal(100), paidAt: new Date(), settlementId: null }));
  const entries: Row[] = payments.map((p) => ({ id: `e-${p.id}`, tenantId: "t1", orderPaymentId: p.id, sessionId: p.sessionId, voidedAt: null, branchId: "b1" }));
  const closed = (sid: unknown) => sessions.some((s) => s.id === sid && s.closedAt);
  const order = { id: "o1", number: "1", branchId: "b1", assignedToId: null, status: "IN_PROGRESS", isPostpaid: false, isInternal: false, totalAmount: new Prisma.Decimal(100 * payments.length), appointment: null, customer: { fullName: "x", phone: "1" } };
  const entryMatch = (e: Row, w: Record<string, unknown>) => {
    const ids = (w.orderPaymentId as { in?: string[] } | undefined)?.in;
    if (ids && !ids.includes(e.orderPaymentId as string)) return false;
    if ("voidedAt" in w && (e.voidedAt ?? null) !== w.voidedAt) return false;
    if (w.session && !closed(e.sessionId)) return false;
    if (w.sessionId && e.sessionId == null) return false;
    return true;
  };
  const tx = {
    $queryRaw: async () => [{ id: "o1" }],
    $executeRaw: async () => 0,
    auditLog: { create: async () => ({}) },
    serviceOrder: { findFirst: async () => order, update: async () => ({}) },
    cashSession: { findFirst: async () => sessions.find((s) => s.closedAt == null) ?? null },
    orderPayment: {
      findFirst: async ({ where }: { where: { id?: string } }) => pays.find((p) => p.status === "PAID" && (!where.id || p.id === where.id)) ?? null,
      findMany: async ({ where }: { where: { status?: string } }) => pays.filter((p) => !where.status || p.status === where.status),
      update: async ({ where, data }: { where: { id: string }; data: Row }) => Object.assign(pays.find((p) => p.id === where.id)!, data),
      updateMany: async ({ where, data }: { where: { status?: string }; data: Row }) => (pays.filter((p) => !where.status || p.status === where.status).forEach((p) => Object.assign(p, data)), { count: 1 }),
    },
    cashTransaction: {
      findFirst: async ({ where }: { where: Record<string, unknown> }) => entries.find((e) => entryMatch(e, where)) ?? null,
      findMany: async ({ where }: { where: Record<string, unknown> }) => entries.filter((e) => entryMatch(e, where)),
      updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Row }) => {
        const hit = entries.filter((e) => entryMatch(e, where));
        hit.forEach((e) => Object.assign(e, data));
        return { count: hit.length };
      },
    },
  };
  (globalThis as unknown as { bookingBaseClient: unknown }).bookingBaseClient = { $transaction: async (fn: (t: unknown) => unknown) => fn(tx) };
  return { pays, entries };
}

const ACTOR = { id: "u1", tenantId: "t1", isOwner: true } as never;
const locked = (e: unknown) => (e as { code?: string; status?: number }).code === "CASH_SESSION_ENTRY_LOCKED" && (e as { status?: number }).status === 409;

test("reverse command: open-session payment is reversed; closed-session payment is locked for every method and untouched", async () => {
  (await import("../lib/tenant-context")).setTenantContext("t1");
  const { reverseOrderPaymentCommand } = await import("../lib/orders/order-payment-commands");
  const open = await setup([{ id: "p1", method: "CASH", sessionId: "s2" }]);
  await reverseOrderPaymentCommand({ actor: ACTOR, orderId: "o1", paymentId: "p1" });
  assert.equal(open.pays[0].status, "CANCELLED");
  assert.notEqual(open.entries[0].voidedAt, null);
  for (const method of ["CASH", "CARD", "BANK_TRANSFER", "QPAY", "OTHER"]) {
    const s = await setup([{ id: "p1", method, sessionId: "s1" }]);
    await assert.rejects(reverseOrderPaymentCommand({ actor: ACTOR, orderId: "o1", paymentId: "p1" }), locked, method);
    assert.equal(s.pays[0].status, "PAID");
    assert.equal(s.entries[0].voidedAt, null);
  }
});

test("reverse-all command: all-open reverses everything; one closed payment rejects the whole call with nothing written", async () => {
  (await import("../lib/tenant-context")).setTenantContext("t1");
  const { reverseAllOrderPaymentsCommand } = await import("../lib/orders/order-payment-commands");
  const open = await setup([{ id: "p1", method: "CASH", sessionId: "s2" }, { id: "p2", method: "CARD", sessionId: null }]);
  await reverseAllOrderPaymentsCommand({ actor: ACTOR, orderId: "o1" });
  assert.ok(open.pays.every((p) => p.status === "CANCELLED") && open.entries.every((e) => e.voidedAt != null));
  const mixed = await setup([{ id: "p1", method: "CASH", sessionId: "s2" }, { id: "p2", method: "QPAY", sessionId: "s1" }]);
  await assert.rejects(reverseAllOrderPaymentsCommand({ actor: ACTOR, orderId: "o1" }), locked);
  assert.ok(mixed.pays.every((p) => p.status === "PAID") && mixed.entries.every((e) => e.voidedAt == null));
});

test("hasLockedPayment: batched lookup (direct + settlement lump), live entries in closed sessions only, 3 queries max", async () => {
  const { findOrderIdsWithLockedPayment } = await import("../lib/cash/session-attach");
  let calls = 0;
  const closed = new Set(["s1"]);
  const entries = [
    { orderId: "o1", orderPaymentId: "p1", settlementId: null, sessionId: "s1", voidedAt: null },
    { orderId: "o2", orderPaymentId: "p2", settlementId: null, sessionId: "s2", voidedAt: null },
    { orderId: null, orderPaymentId: null, settlementId: "st1", sessionId: "s1", voidedAt: null },
    { orderId: "o4", orderPaymentId: "p4", settlementId: null, sessionId: "s1", voidedAt: new Date() },
  ];
  const client = {
    cashTransaction: {
      findMany: async ({ where }: { where: { orderId?: { in: string[] }; settlementId?: { in: string[] } } }) => {
        calls++;
        return entries.filter((e) => closed.has(e.sessionId) && e.voidedAt == null && (where.orderId ? where.orderId.in.includes(e.orderId as string) && e.orderPaymentId : where.settlementId!.in.includes(e.settlementId as string)));
      },
    },
    orderPayment: { findMany: async () => (calls++, [{ orderId: "o3", settlementId: "st1" }, { orderId: "o5", settlementId: "st9" }]) },
  };
  const got = await findOrderIdsWithLockedPayment(client as never, "t1", ["o1", "o2", "o3", "o4", "o5"]);
  assert.deepEqual([...got].sort(), ["o1", "o3"]);
  assert.equal(calls, 3);
  assert.equal((await findOrderIdsWithLockedPayment(client as never, "t1", [])).size, 0);
});
