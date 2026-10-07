import assert from "node:assert/strict";
import { before, test } from "node:test";

process.env.DATABASE_URL ??= "postgresql://unused/unused";
process.env.SESSION_SECRET ??= "unit-test-placeholder-secret-value-not-real-00";

type Row = Record<string, unknown>;
const OPS = ["gte", "lte", "lt", "gt", "not", "in"];

function isOp(v: unknown): v is Row {
  return v !== null && typeof v === "object" && !(v instanceof Date) && Object.keys(v as Row).some((k) => OPS.includes(k));
}
const num = (v: unknown) => (v instanceof Date ? v.getTime() : (v as number));

let data_payments: Row[] = [];
function matches(row: Row, where: Row): boolean {
  for (const [key, cond] of Object.entries(where)) {
    if (key === "OR") {
      if (!(cond as Row[]).some((w) => matches(row, w))) return false;
      continue;
    }
    if (key === "payments" && cond && typeof cond === "object" && "some" in (cond as Row)) {
      const some = (cond as { some: Row }).some;
      if (!(data_payments.some((p) => p.order === row && matches(p, some)))) return false;
      continue;
    }
    const val = row[key];
    if (cond === null) {
      if (val != null) return false;
    } else if (isOp(cond)) {
      const c = cond as Row;
      if ("not" in c && (c.not === null ? val == null : val === c.not)) return false;
      if ("gte" in c && !(val != null && num(val) >= num(c.gte))) return false;
      if ("lte" in c && !(val != null && num(val) <= num(c.lte))) return false;
      if ("gt" in c && !(val != null && num(val) > num(c.gt))) return false;
      if ("lt" in c && !(val != null && num(val) < num(c.lt))) return false;
      if ("in" in c && !(c.in as unknown[]).includes(val)) return false;
    } else if (cond !== null && typeof cond === "object" && !(cond instanceof Date)) {
      if (!val || !matches(val as Row, cond as Row)) return false;
    } else if (val !== cond) return false;
  }
  return true;
}

const D = async (v: string | number) => new (await import("../app/generated/prisma/client")).Prisma.Decimal(v);

function fake(data: { tx: Row[]; sessions: Row[]; orders: Row[]; payments: Row[]; types: Row[]; frozen?: Row[] }) {
  const queries: Row[] = [];
  data_payments = data.payments;
  const sumOf = (rows: Row[], field: string) => rows.reduce((a, r) => a + Number(r[field] ?? 0), 0);
  const group = (rows: Row[], by: string[], where: Row, sumField: string) => {
    queries.push(where);
    const map = new Map<string, Row[]>();
    for (const r of rows.filter((r) => matches(r, where))) {
      const k = JSON.stringify(by.map((b) => r[b] ?? null));
      map.set(k, [...(map.get(k) ?? []), r]);
    }
    return [...map.values()].map((rs) => ({
      ...Object.fromEntries(by.map((b) => [b, rs[0][b] ?? null])),
      _sum: { [sumField]: String(sumOf(rs, sumField)) },
      _count: { _all: rs.length },
    }));
  };
  const agg = (rows: Row[], where: Row, field: string) => {
    queries.push(where);
    const rs = rows.filter((r) => matches(r, where));
    return { _sum: { [field]: rs.length ? String(sumOf(rs, field)) : null }, _count: { _all: rs.length } };
  };
  const client = {
    cashTransaction: { groupBy: async (a: { by: string[]; where: Row }) => group(data.tx, a.by, a.where, "amount") },
    cashSessionMethodCount: {
      findMany: async (a: { where: Row }) => {
        queries.push(a.where);
        return (data.frozen ?? []).filter((r) => matches(r, a.where));
      },
    },
    cashTransactionType: { findMany: async () => data.types },
    cashSession: {
      findMany: async (a: { where: Row }) => {
        queries.push(a.where);
        return data.sessions.filter((s) => matches(s, a.where));
      },
    },
    serviceOrder: {
      aggregate: async (a: { where: Row }) => agg(data.orders, a.where, "totalAmount"),
      findMany: async (a: { where: Row; select: { payments: { where: Row } } }) => {
        queries.push(a.where);
        return data.orders
          .filter((o) => matches(o, a.where))
          .map((o) => ({ totalAmount: o.totalAmount, payments: data.payments.filter((p) => p.order === o && matches(p, a.select.payments.where)) }));
      },
    },
    orderPayment: { aggregate: async (a: { where: Row }) => agg(data.payments, a.where, "amount") },
  };
  return { client: client as never, queries };
}

const ACTOR = { id: "u1", tenantId: "t1", isOwner: true, workingBranchId: undefined } as never;
const FROM = new Date("2026-10-01T00:00:00+08:00");
const TO = new Date("2026-10-31T23:59:59.999+08:00");
const IN_RANGE = new Date("2026-10-10T12:00:00+08:00");

const TYPES = [
  { id: "ty-pay", name: "Засварын орлого", systemKey: "ORDER_PAYMENT" },
  { id: "ty-set", name: "Дараа тооцоо", systemKey: "POSTPAID_SETTLEMENT" },
  { id: "ty-int", name: "Дотоод засварын зардал", systemKey: "INTERNAL_REPAIR" },
  { id: "ty-rent", name: "Түрээс", systemKey: null },
];
const tx = (o: Row): Row => ({ tenantId: "t1", branchId: "b1", voidedAt: null, occurredAt: IN_RANGE, sessionId: null, bank: null, taxIncluded: null, ...o });

test("income by method/bank per-bank totals; voided and tax are excluded; net per method", async () => {
  const { buildCashSummary } = await import("../lib/cash/report");
  const { client } = fake({
    types: TYPES,
    sessions: [],
    orders: [],
    payments: [],
    tx: [
      tx({ direction: "INCOME", typeId: "ty-pay", method: "CASH", amount: 100000 }),
      tx({ direction: "INCOME", typeId: "ty-pay", method: "BANK_TRANSFER", bank: "KHAN", amount: 50000 }),
      tx({ direction: "INCOME", typeId: "ty-pay", method: "BANK_TRANSFER", bank: "KHAN", amount: 30000 }),
      tx({ direction: "INCOME", typeId: "ty-pay", method: "BANK_TRANSFER", bank: null, amount: 7000 }),
      tx({ direction: "INCOME", typeId: "ty-pay", method: "CARD", bank: "GOLOMT", amount: 20000 }),
      tx({ direction: "INCOME", typeId: "ty-pay", method: "QPAY", amount: 9000 }),
      tx({ direction: "INCOME", typeId: "ty-pay", method: "CASH", amount: 999999, voidedAt: IN_RANGE }),
      tx({ direction: "EXPENSE", typeId: "ty-rent", method: "CASH", amount: 40000, taxIncluded: 4000 }),
      tx({ direction: "EXPENSE", typeId: "ty-int", method: "OTHER", amount: 15000 }),
      tx({ direction: "INCOME", typeId: "ty-pay", method: "CASH", amount: 5, occurredAt: new Date("2026-09-30T12:00:00+08:00") }),
      tx({ direction: "INCOME", typeId: "ty-pay", method: "CASH", amount: 7, branchId: "b2" }),
    ],
  });
  const s = await buildCashSummary({ actor: ACTOR, from: FROM, to: TO, client, branchId: "b1" });
  const m = (name: string) => s.incomeByMethod.find((r) => r.method === name)!;
  assert.equal(m("CASH").total, "100000");
  assert.equal(m("CASH").banks.length, 0);
  const bt = m("BANK_TRANSFER");
  assert.equal(bt.total, "87000");
  assert.deepEqual(bt.banks.map((b) => [b.bank, b.bankLabel, b.total, b.count]), [
    ["KHAN", "Хаан банк", "80000", 2],
    [null, "Банк тодорхойгүй", "7000", 1],
  ]);
  assert.deepEqual(m("CARD").banks.map((b) => [b.bank, b.total]), [["GOLOMT", "20000"]]);
  assert.equal(m("QPAY").total, "9000");
  assert.equal(s.totals.income, "216000");
  assert.equal(s.totals.expense, "55000");
  assert.equal(s.totals.net, "161000");
  const net = (name: string) => s.netByMethod.find((r) => r.method === name)!;
  assert.equal(net("CASH").net, "60000");
  assert.equal(s.netCash, "60000");
  assert.equal(net("OTHER").net, "-15000");
  assert.deepEqual(s.expenseByType.map((r) => [r.name, r.total]), [["Түрээс", "40000"], ["Дотоод засварын зардал", "15000"]]);
  assert.equal(s.expenseByMethod.find((r) => r.method === "OTHER")!.total, "15000");
  assert.deepEqual(s.incomeByType.map((r) => [r.systemKey, r.total]), [["ORDER_PAYMENT", "216000"]]);
  assert.deepEqual(s.internalCost, { total: "15000", count: 1 });
});

test("every query is tenant scoped, voids excluded, and a pinned scope beats the requested branch", async () => {
  const { buildCashSummary } = await import("../lib/cash/report");
  const { client, queries } = fake({ types: TYPES, sessions: [], orders: [], payments: [], tx: [] });
  const s = await buildCashSummary({ actor: ACTOR, from: FROM, to: TO, client, branchId: "other", scope: "b1" });
  assert.equal(s.branchId, "b1");
  assert.equal(queries.length, 6);
  for (const q of queries) {
    assert.equal(q.tenantId, "t1");
    assert.equal(q.branchId ?? (q.order as Row | undefined)?.branchId ?? "b1", "b1");
  }
  const none = await buildCashSummary({ actor: ACTOR, from: FROM, to: TO, client, scope: null });
  assert.equal(none.branchId, null);
  assert.equal(none.totals.net, "0");
  assert.equal(none.postpaid.outstanding.total, "0");
});

test("non cash.manage actors are refused with CASH_MANAGE_FORBIDDEN", async () => {
  const { buildCashSummary } = await import("../lib/cash/report");
  const { client } = fake({ types: [], sessions: [], orders: [], payments: [], tx: [] });
  const staff = { id: "u2", tenantId: "t1", isOwner: false, permissions: [] } as never;
  await assert.rejects(buildCashSummary({ actor: staff, from: FROM, to: TO, client }), (e: unknown) => (e as { code?: string }).code === "CASH_MANAGE_FORBIDDEN");
});

test("postpaid: work done in range, collected = settlements + direct payments, outstanding as of range end", async () => {
  const { buildCashSummary } = await import("../lib/cash/report");
  const late = new Date("2026-11-05T12:00:00+08:00");
  const early = new Date("2026-09-15T12:00:00+08:00");
  const order = (o: Row): Row => ({ tenantId: "t1", branchId: "b1", status: "COMPLETED", isPostpaid: true, isInternal: false, completedAt: IN_RANGE, ...o });
  const pay = (o: Row, orderRow: Row): Row => ({ tenantId: "t1", status: "PAID", settlementId: null, paidAt: IN_RANGE, order: orderRow, ...o });
  const o1 = order({ totalAmount: 100000 }); // done in range, paid 30000 in range (direct) + 20000 after range end
  const o2 = order({ totalAmount: 50000, completedAt: early }); // done before range, unpaid
  const o3 = order({ totalAmount: 70000, completedAt: late }); // completed after range end: not outstanding as of end
  const oInternal = order({ totalAmount: 11111, isInternal: true });
  const oRegular = order({ totalAmount: 22222, isPostpaid: false });
  const o4 = order({ totalAmount: 80000, completedAt: early }); // settled in range through a settlement
  const { client } = fake({
    types: TYPES,
    sessions: [],
    tx: [tx({ direction: "INCOME", typeId: "ty-set", method: "CASH", amount: 80000 })],
    orders: [o1, o2, o3, oInternal, oRegular, o4],
    payments: [
      pay({ amount: 30000 }, o1),
      pay({ amount: 20000, paidAt: late }, o1),
      pay({ amount: 80000, settlementId: "s1" }, o4),
      pay({ amount: 999, status: "PENDING" }, o1),
      pay({ amount: 5000 }, oRegular),
    ],
  });
  const s = await buildCashSummary({ actor: ACTOR, from: FROM, to: TO, client, branchId: "b1" });
  assert.deepEqual(s.postpaid.workDone, { total: "100000", count: 1 });
  assert.equal(s.postpaid.collected.settlements.total, "80000");
  assert.equal(s.postpaid.collected.directPayments.total, "30000");
  assert.equal(s.postpaid.collected.total, "110000");
  // as of TO (QA #11: non-postpaid completed orders count too, clamped per order): o1 100000-30000(paid ≤ TO)
  // + o2 50000 + o4 80000-80000 + oRegular 22222-5000 = 137222 (o3 completes later, 20000 paid after TO; internal excluded)
  assert.equal(s.postpaid.outstanding.total, "137222");
  assert.equal(s.postpaid.outstanding.asOf, TO.toISOString());
});

test("sessions: frozen expected for closed, live for open, post-close voids, outside-session total", async () => {
  const { buildCashSummary } = await import("../lib/cash/report");
  const closedAt = new Date("2026-10-10T18:00:00+08:00");
  const after = new Date("2026-10-11T09:00:00+08:00");
  const branch = { id: "b1", name: "Төв" };
  const sClosed = { id: "s1", tenantId: "t1", branchId: "b1", branch, openedAt: new Date("2026-10-10T08:00:00+08:00"), closedAt, openingCash: await D(50000), countedCash: await D(148000), expectedCash: await D(150000), difference: await D(-2000) };
  const sOpen = { id: "s2", tenantId: "t1", branchId: "b1", branch, openedAt: new Date("2026-10-12T08:00:00+08:00"), closedAt: null, openingCash: await D(10000), countedCash: null, expectedCash: null, difference: null };
  const sOutOfRange = { id: "s3", tenantId: "t1", branchId: "b1", branch, openedAt: new Date("2026-09-01T08:00:00+08:00"), closedAt: null, openingCash: await D(1), countedCash: null, expectedCash: null, difference: null };
  const { client } = fake({
    types: TYPES,
    orders: [],
    payments: [],
    sessions: [sClosed, sOpen, sOutOfRange],
    tx: [
      tx({ direction: "INCOME", typeId: "ty-pay", method: "CASH", amount: 120000, sessionId: "s1" }),
      tx({ direction: "EXPENSE", typeId: "ty-rent", method: "CASH", amount: 20000, sessionId: "s1" }),
      // voided after close: not in live totals, reported as a post-close void; frozen expected stays 150000
      tx({ direction: "INCOME", typeId: "ty-pay", method: "CASH", amount: 3000, sessionId: "s1", voidedAt: after }),
      // voided before close: not a post-close void
      tx({ direction: "INCOME", typeId: "ty-pay", method: "CASH", amount: 700, sessionId: "s1", voidedAt: new Date("2026-10-10T10:00:00+08:00") }),
      tx({ direction: "INCOME", typeId: "ty-pay", method: "CASH", amount: 5000, sessionId: "s2", occurredAt: new Date("2026-10-12T10:00:00+08:00") }),
      tx({ direction: "EXPENSE", typeId: "ty-rent", method: "CASH", amount: 1500, sessionId: "s2", occurredAt: new Date("2026-10-12T11:00:00+08:00") }),
      // outside any session
      tx({ direction: "INCOME", typeId: "ty-pay", method: "CASH", amount: 8000 }),
      tx({ direction: "EXPENSE", typeId: "ty-rent", method: "CASH", amount: 2500 }),
      tx({ direction: "INCOME", typeId: "ty-pay", method: "CARD", bank: "KHAN", amount: 9999 }),
    ],
  });
  const s = await buildCashSummary({ actor: ACTOR, from: FROM, to: TO, client, branchId: "b1" });
  assert.deepEqual(s.sessions.items.map((i) => i.id), ["s1", "s2"]);
  const [closed, open] = s.sessions.items;
  assert.equal(closed.status, "CLOSED");
  assert.equal(closed.expectedCash, "150000"); // frozen, not 50000+120000-20000 = 150000 coincidence -> check live cols too
  assert.equal(closed.cashIn, "120000");
  assert.equal(closed.cashOut, "20000");
  assert.equal(closed.countedCash, "148000");
  assert.equal(closed.difference, "-2000");
  assert.deepEqual(closed.postCloseVoids, { count: 1, incomeAmount: "3000", expenseAmount: "0", netAmount: "3000" });
  assert.equal(open.status, "OPEN");
  assert.equal(open.expectedCash, "13500"); // live: 10000 + 5000 - 1500
  assert.equal(open.countedCash, null);
  assert.deepEqual(open.postCloseVoids.count, 0);
  assert.deepEqual(s.sessions.outsideSession, { income: "17999", expense: "2500", net: "15499", count: 3 });
});

test("closed session expectedCash is the frozen stored value even when live totals differ", async () => {
  const { buildCashSummary } = await import("../lib/cash/report");
  const closedAt = new Date("2026-10-10T18:00:00+08:00");
  const sClosed = { id: "s1", tenantId: "t1", branchId: "b1", branch: { id: "b1", name: "Төв" }, openedAt: new Date("2026-10-10T08:00:00+08:00"), closedAt, openingCash: await D(0), countedCash: await D(1000), expectedCash: await D(1000), difference: await D(0) };
  const { client } = fake({
    types: TYPES, orders: [], payments: [], sessions: [sClosed],
    tx: [tx({ direction: "INCOME", typeId: "ty-pay", method: "CASH", amount: 1000, sessionId: "s1", voidedAt: new Date("2026-10-11T00:00:00+08:00") })],
  });
  const s = await buildCashSummary({ actor: ACTOR, from: FROM, to: TO, client });
  assert.equal(s.sessions.items[0].expectedCash, "1000");
  assert.equal(s.sessions.items[0].cashIn, "0");
  assert.equal(s.sessions.items[0].postCloseVoids.netAmount, "1000");
});

test("session byMethod: live per-method rows for open, frozen counts for closed, totals across methods", async () => {
  const { buildCashSummary } = await import("../lib/cash/report");
  const { buildCashSummaryWorkbook } = await import("../lib/cash/report-export");
  const closedAt = new Date("2026-10-10T18:00:00+08:00");
  const branch = { id: "b1", name: "Төв" };
  const sClosed = { id: "s1", tenantId: "t1", branchId: "b1", branch, openedAt: new Date("2026-10-10T08:00:00+08:00"), closedAt, openingCash: await D(50000), countedCash: await D(148000), expectedCash: await D(150000), difference: await D(-2000) };
  const sOpen = { id: "s2", tenantId: "t1", branchId: "b1", branch, openedAt: new Date("2026-10-12T08:00:00+08:00"), closedAt: null, openingCash: await D(10000), countedCash: null, expectedCash: null, difference: null };
  const { client, queries } = fake({
    types: TYPES, orders: [], payments: [],
    sessions: [sClosed, sOpen],
    frozen: [
      { tenantId: "t1", sessionId: "s1", method: "CARD", bank: "KHAN", expected: "30000", counted: "29000", difference: "-1000" },
      { tenantId: "t1", sessionId: "s1", method: "QPAY", bank: "", expected: "9000", counted: "9000", difference: "0" },
    ],
    tx: [
      tx({ direction: "INCOME", typeId: "ty-pay", method: "CASH", amount: 120000, sessionId: "s1" }),
      tx({ direction: "EXPENSE", typeId: "ty-rent", method: "CASH", amount: 20000, sessionId: "s1" }),
      tx({ direction: "INCOME", typeId: "ty-pay", method: "CARD", bank: "KHAN", amount: 30000, sessionId: "s1" }),
      tx({ direction: "INCOME", typeId: "ty-pay", method: "QPAY", amount: 9000, sessionId: "s1" }),
      tx({ direction: "INCOME", typeId: "ty-pay", method: "CARD", bank: "KHAN", amount: 999, sessionId: "s1", voidedAt: IN_RANGE }),
      tx({ direction: "INCOME", typeId: "ty-pay", method: "BANK_TRANSFER", bank: "GOLOMT", amount: 7000, sessionId: "s2" }),
      tx({ direction: "EXPENSE", typeId: "ty-int", method: "OTHER", amount: 500, sessionId: "s2" }),
    ],
  });
  const s = await buildCashSummary({ actor: ACTOR, from: FROM, to: TO, client, branchId: "b1" });
  const [closed, open] = s.sessions.items;
  assert.equal(closed.totalIncome, "159000");
  assert.equal(closed.totalExpense, "20000");
  assert.deepEqual(closed.byMethod.map((r) => [r.method, r.bank, r.income, r.expense, r.net, r.count, r.expected, r.counted, r.difference]), [
    ["CASH", null, "120000", "20000", "100000", 2, "150000", "148000", "-2000"],
    ["CARD", "KHAN", "30000", "0", "30000", 1, "30000", "29000", "-1000"],
    ["QPAY", null, "9000", "0", "9000", 1, "9000", "9000", "0"],
  ]);
  assert.equal(open.totalIncome, "7000");
  assert.equal(open.totalExpense, "500");
  assert.deepEqual(open.byMethod.map((r) => [r.method, r.bank, r.net, r.expected, r.counted, r.difference]), [
    ["CASH", null, "0", "10000", null, null],
    ["BANK_TRANSFER", "GOLOMT", "7000", "7000", null, null],
    ["OTHER", null, "-500", "-500", null, null],
  ]);
  // one tenant-scoped grouped query for all listed sessions (no N+1)
  const grouped = queries.filter((q) => (q as { sessionId?: { in?: string[] } }).sessionId?.in && q.voidedAt === null && !q.method);
  assert.equal(grouped.length, 1);
  assert.equal(grouped[0].tenantId, "t1");

  const buf = await buildCashSummaryWorkbook(s);
  const wb = new Workbook();
  await wb.xlsx.load(buf as unknown as ArrayBuffer);
  const ws = wb.getWorksheet("Ээлж — аргаар")!;
  assert.deepEqual((ws.getRow(1).values as unknown[]).slice(1), ["Нээсэн", "Салбар", "Төлөв", "Арга", "Банк", "Орлого", "Зарлага", "Цэвэр", "Тооцоолсон", "Тоолсон", "Зөрүү", "Бичлэг"]);
  assert.equal(ws.rowCount, 7); // header + 3 closed + 3 open
  const card = (ws.getRow(3).values as unknown[]).slice(1);
  assert.deepEqual(card.slice(2), ["Хаагдсан", "Карт", "Хаан банк", 30000, 0, 30000, 30000, 29000, -1000, 1]);
  const openBt = (ws.getRow(6).values as unknown[]).slice(1);
  assert.equal(openBt[2], "Нээлттэй");
  assert.equal(openBt[4], "Голомт банк");
  const shift = wb.getWorksheet("Кассын ээлж")!;
  const h = (shift.getRow(1).values as unknown[]).slice(1);
  assert.ok(h.includes("Нийт орлого") && h.includes("Нийт зарлага"));
  assert.equal((shift.getRow(2).values as unknown[])[h.indexOf("Нийт орлого") + 1], 159000);
});

test("byMethod: CASH collapses to one row even with mixed bank values; frozen-only and no-CASH-entry cases", async () => {
  const { buildCashSummary } = await import("../lib/cash/report");
  const closedAt = new Date("2026-10-10T18:00:00+08:00");
  const branch = { id: "b1", name: "Төв" };
  const mk = async (id: string, branchId: string, closed: boolean) => ({ id, tenantId: "t1", branchId, branch: { id: branchId, name: branchId }, openedAt: new Date("2026-10-10T08:00:00+08:00"), closedAt: closed ? closedAt : null, openingCash: await D(1000), countedCash: closed ? await D(900) : null, expectedCash: closed ? await D(1100) : null, difference: closed ? await D(-200) : null });
  void branch;
  const { client, queries } = fake({
    types: TYPES, orders: [], payments: [],
    sessions: [await mk("s1", "b1", false), await mk("s2", "b1", true), await mk("s3", "b1", true), await mk("s4", "b2", false)],
    frozen: [
      { tenantId: "t1", sessionId: "s2", method: "CARD", bank: "KHAN", expected: "500", counted: "400", difference: "-100" },
      { tenantId: "t1", sessionId: "s3", method: "CASH", bank: "KHAN", expected: "1", counted: "1", difference: "0" },
      { tenantId: "t1", sessionId: "s4", method: "CARD", bank: "KHAN", expected: "5", counted: "5", difference: "0" },
    ],
    tx: [
      tx({ direction: "INCOME", typeId: "ty-pay", method: "CASH", amount: 100, sessionId: "s1" }),
      tx({ direction: "INCOME", typeId: "ty-pay", method: "CASH", bank: "KHAN", amount: 40, sessionId: "s1" }),
      tx({ direction: "EXPENSE", typeId: "ty-rent", method: "CASH", bank: "GOLOMT", amount: 10, sessionId: "s1" }),
      tx({ direction: "INCOME", typeId: "ty-pay", method: "CASH", amount: 7, sessionId: "s4", branchId: "b2" }),
    ],
  });
  const s = await buildCashSummary({ actor: ACTOR, from: FROM, to: TO, client, branchId: "b1" });
  const byId = new Map(s.sessions.items.map((i) => [i.id, i]));
  assert.equal(byId.has("s4"), false); // other branch excluded
  // (a) mixed banks -> single CASH row, summed
  const a = byId.get("s1")!.byMethod;
  assert.deepEqual(a.map((r) => [r.method, r.bank, r.income, r.expense, r.net, r.count]), [["CASH", null, "140", "10", "130", 3]]);
  // (b) frozen CARD row, no entries
  const b = byId.get("s2")!.byMethod.find((r) => r.method === "CARD")!;
  assert.deepEqual([b.bank, b.income, b.expense, b.net, b.count, b.expected, b.counted, b.difference], ["KHAN", "0", "0", "0", 0, "500", "400", "-100"]);
  // (c) closed session without CASH entries: CASH row still present, from session columns (even with a stray frozen CASH+bank row)
  const c = byId.get("s3")!.byMethod;
  assert.deepEqual(c.map((r) => [r.method, r.bank, r.income, r.expense, r.net, r.count, r.expected, r.counted, r.difference]), [["CASH", null, "0", "0", "0", 0, "1100", "900", "-200"]]);
  // (d) tenant scope on the frozen query, (e) branch scope on sessions; grouped + frozen restricted to branch sessions
  const frozenQ = queries.filter((q) => q.tenantId === "t1" && (q as { sessionId?: { in?: string[] } }).sessionId?.in && !("voidedAt" in q));
  assert.equal(frozenQ.length, 1);
  assert.deepEqual([...(frozenQ[0].sessionId as { in: string[] }).in].sort(), ["s2", "s3"]);
  const sessQ = queries.filter((q) => q.tenantId === "t1" && q.branchId === "b1" && !("sessionId" in q) && !("voidedAt" in q));
  assert.ok(sessQ.length >= 1);
  const grouped = queries.filter((q) => (q as { sessionId?: { in?: string[] } }).sessionId?.in && q.voidedAt === null && !q.method);
  assert.equal(grouped.length, 1);
  assert.equal(grouped[0].tenantId, "t1");
  assert.deepEqual([...(grouped[0].sessionId as { in: string[] }).in].sort(), ["s1", "s2", "s3"]);
});

let Workbook: typeof import("exceljs").Workbook;
before(async () => {
  const mod = await import("exceljs");
  Workbook = (mod as unknown as { default: typeof import("exceljs") }).default?.Workbook ?? mod.Workbook;
});

test("cash summary workbook has a sheet per section with Mongolian headers", async () => {
  const { buildCashSummary } = await import("../lib/cash/report");
  const { buildCashSummaryWorkbook, cashSummaryFilename } = await import("../lib/cash/report-export");
  const { client } = fake({
    types: TYPES, orders: [], payments: [], sessions: [],
    tx: [
      tx({ direction: "INCOME", typeId: "ty-pay", method: "CARD", bank: "KHAN", amount: 1000 }),
      tx({ direction: "EXPENSE", typeId: "ty-rent", method: "CASH", amount: 400 }),
    ],
  });
  const s = await buildCashSummary({ actor: ACTOR, from: FROM, to: TO, client });
  const buf = await buildCashSummaryWorkbook(s);
  const wb = new Workbook();
  await wb.xlsx.load(buf as unknown as ArrayBuffer);
  assert.deepEqual(wb.worksheets.map((w) => w.name), [
    "Хураангуй", "Арга-аар орлого", "Төрлөөр орлого", "Төрлөөр зарлага", "Арга-аар зарлага", "Цэвэр дүн", "Дараа тооцоо", "Кассын ээлж", "Ээлж — аргаар",
  ]);
  const header = (name: string) => (wb.getWorksheet(name)!.getRow(1).values as unknown[]).slice(1);
  assert.deepEqual(header("Арга-аар орлого"), ["Төлбөрийн арга", "Банк", "Нийт", "Тоо"]);
  assert.deepEqual(header("Цэвэр дүн"), ["Төлбөрийн арга", "Орлого", "Зарлага", "Цэвэр"]);
  const bankRow = (wb.getWorksheet("Арга-аар орлого")!.getRow(5).values as unknown[]).slice(1);
  assert.deepEqual(bankRow.slice(0, 4), ["Карт", "Хаан банк", 1000, 1]);
  assert.equal(wb.getWorksheet("Кассын ээлж")!.rowCount, 2); // header + «Ээлжээс гадуур»
  assert.match(cashSummaryFilename(FROM, TO), /^mungun-guilgee_2026-10-01_2026-10-31\.xlsx$/);
});

test("postpaid: PAID payments with null paidAt fall back to updatedAt (direct and outstanding)", async () => {
  const { buildCashSummary } = await import("../lib/cash/report");
  const o: Row = { tenantId: "t1", branchId: "b1", status: "COMPLETED", isPostpaid: true, isInternal: false, completedAt: IN_RANGE, totalAmount: 100000 };
  const { client } = fake({
    types: TYPES, sessions: [], tx: [], orders: [o],
    payments: [
      { tenantId: "t1", status: "PAID", settlementId: null, paidAt: null, updatedAt: IN_RANGE, amount: 40000, order: o },
      { tenantId: "t1", status: "PAID", settlementId: null, paidAt: null, updatedAt: new Date("2026-11-20T00:00:00+08:00"), amount: 9000, order: o },
    ],
  });
  const s = await buildCashSummary({ actor: ACTOR, from: FROM, to: TO, client, branchId: "b1" });
  assert.equal(s.postpaid.collected.directPayments.total, "40000");
  assert.equal(s.postpaid.outstanding.total, "60000");
});

test("outstanding is clamped per order: an overpaid order does not offset another order's debt", async () => {
  const { buildCashSummary } = await import("../lib/cash/report");
  const base: Row = { tenantId: "t1", branchId: "b1", status: "COMPLETED", isPostpaid: false, isInternal: false, completedAt: IN_RANGE };
  const debt: Row = { ...base, totalAmount: 100000 };
  const over: Row = { ...base, totalAmount: 10000 };
  const { client } = fake({
    types: TYPES, sessions: [], tx: [], orders: [debt, over],
    payments: [{ tenantId: "t1", status: "PAID", settlementId: null, paidAt: IN_RANGE, order: over, amount: 15000 }],
  });
  const s = await buildCashSummary({ actor: ACTOR, from: FROM, to: TO, client, branchId: "b1" });
  assert.equal(s.postpaid.outstanding.total, "100000");
});

test("outstanding bound: an order fully paid today but only part paid at range end still counts; fully paid by range end is skipped", async () => {
  const { buildCashSummary } = await import("../lib/cash/report");
  const late = new Date("2026-11-05T12:00:00+08:00");
  const base: Row = { tenantId: "t1", branchId: "b1", status: "COMPLETED", isPostpaid: false, isInternal: false, completedAt: IN_RANGE, paymentStatus: "PAID" };
  const partlyAtEnd: Row = { ...base, totalAmount: 100000 }; // 40000 in range, 60000 after range end => today PAID
  const paidByEnd: Row = { ...base, totalAmount: 50000 }; // fully paid in range
  const { client } = fake({
    types: TYPES, sessions: [], tx: [], orders: [partlyAtEnd, paidByEnd],
    payments: [
      { tenantId: "t1", status: "PAID", settlementId: null, paidAt: IN_RANGE, order: partlyAtEnd, amount: 40000 },
      { tenantId: "t1", status: "PAID", settlementId: null, paidAt: late, order: partlyAtEnd, amount: 60000 },
      { tenantId: "t1", status: "PAID", settlementId: null, paidAt: IN_RANGE, order: paidByEnd, amount: 50000 },
    ],
  });
  const s = await buildCashSummary({ actor: ACTOR, from: FROM, to: TO, client, branchId: "b1" });
  assert.equal(s.postpaid.outstanding.total, "60000");
});
