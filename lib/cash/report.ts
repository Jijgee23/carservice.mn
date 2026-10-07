// Phase D: cash summary report «Мөнгөн гүйлгээний тайлан». Read-only aggregation over the C1–C3 ledger
// (CashTransaction / CashSession) plus ServiceOrder/OrderPayment for the postpaid figures. Every figure is a DB
// aggregate (groupBy/aggregate), tenant- and branch-scoped; voided entries are always excluded and taxIncluded is
// never summed. Money leaves as Decimal strings.
import { Prisma } from "@/app/generated/prisma/client";
import { bankLabel } from "@/lib/banks";
import { hasPermission } from "@/lib/auth/roles";
import { ORDER_PAYMENT_METHOD_LABEL } from "@/lib/orders";
import { prisma } from "@/lib/prisma";
import { cashForbidden } from "./rules";
import type { CashScope } from "./ledger";
import type { CashActor } from "./types";
import { effectiveBranchScope } from "@/lib/cash/scope";

export const CASH_REPORT_METHODS = ["CASH", "BANK_TRANSFER", "CARD", "QPAY", "OTHER"] as const;
export type CashReportMethod = (typeof CASH_REPORT_METHODS)[number];
const BANK_METHODS: readonly string[] = ["BANK_TRANSFER", "CARD"];
export const UNKNOWN_BANK_LABEL = "Банк тодорхойгүй";

const ZERO = new Prisma.Decimal(0);
const dec = (v: { toString(): string } | null | undefined) => new Prisma.Decimal((v ?? 0).toString());

export type CashReportBankRow = {
  bank: string | null;
  bankLabel: string;
  total: string;
  count: number;
};
export type CashReportMethodRow = { method: CashReportMethod; methodLabel: string; total: string; count: number; banks: CashReportBankRow[] };
export type CashReportTypeRow = { typeId: string; name: string; systemKey: string | null; total: string; count: number };
export type CashReportMethodNetRow = { method: CashReportMethod; methodLabel: string; income: string; expense: string; net: string };
export type CashReportSessionMethodRow = {
  method: CashReportMethod;
  bank: string | null;
  income: string;
  expense: string;
  net: string;
  count: number;
  expected: string | null;
  counted: string | null;
  difference: string | null;
};
export type CashReportSessionRow = {
  /** All methods (cash + non-cash), non-voided entries. */
  totalIncome: string;
  totalExpense: string;
  /** One row per (method, bank): live movement plus expected/counted/difference (open: expected live, counted null). */
  byMethod: CashReportSessionMethodRow[];
  id: string;
  branch: { id: string; name: string };
  status: "OPEN" | "CLOSED";
  openedAt: string;
  closedAt: string | null;
  openingCash: string;
  cashIn: string;
  cashOut: string;
  expectedCash: string;
  countedCash: string | null;
  difference: string | null;
  postCloseVoids: { count: number; incomeAmount: string; expenseAmount: string; netAmount: string };
};

export type CashSummary = {
  range: { from: string; to: string };
  branchId: string | null;
  incomeByMethod: CashReportMethodRow[];
  incomeByType: CashReportTypeRow[];
  expenseByType: CashReportTypeRow[];
  expenseByMethod: Array<{ method: CashReportMethod; methodLabel: string; total: string; count: number }>;
  netByMethod: CashReportMethodNetRow[];
  /** = netByMethod CASH row .net — expected drawer movement. */
  netCash: string;
  postpaid: {
    workDone: { total: string; count: number };
    collected: { total: string; settlements: { total: string; count: number }; directPayments: { total: string; count: number } };
    outstanding: { total: string; asOf: string };
  };
  /** Ledger INTERNAL_REPAIR expenses (system of record). */
  internalCost: { total: string; count: number };
  sessions: { items: CashReportSessionRow[]; outsideSession: { income: string; expense: string; net: string; count: number } };
  totals: { income: string; expense: string; net: string };
};

type Client = typeof prisma;

const methodLabel = (m: string) => ORDER_PAYMENT_METHOD_LABEL[m] ?? m;

/**
 * from/to are instants (from inclusive, to inclusive — use `parseRange` bounds). Pinned scope wins over `branchId`.
 * Requires cash.manage (owner implicit).
 */
export async function buildCashSummary(input: {
  actor: CashActor;
  from: Date;
  to: Date;
  branchId?: string | null;
  scope?: CashScope;
  client?: Client;
}): Promise<CashSummary> {
  const { actor, from, to } = input;
  if (!hasPermission(actor, "cash.manage")) throw cashForbidden();
  const db = input.client ?? prisma;
  const tenantId = actor.tenantId;
  const pinned = effectiveBranchScope(actor, input.scope);
  const branchId = pinned ?? input.branchId ?? null;
  const branchFilter = branchId ? { branchId } : {};
  const range = { gte: from, lte: to };

  const ledgerWhere = { tenantId, ...branchFilter, voidedAt: null, occurredAt: range };
  const [groups, types, outsideGroups, sessionRows, workDone, settlementDirect, outstandingOrders] = await Promise.all([
    db.cashTransaction.groupBy({
      by: ["direction", "method", "bank", "typeId"],
      where: ledgerWhere,
      _sum: { amount: true },
      _count: { _all: true },
    }),
    db.cashTransactionType.findMany({ where: { tenantId }, select: { id: true, name: true, systemKey: true } }),
    db.cashTransaction.groupBy({
      by: ["direction"],
      where: { ...ledgerWhere, sessionId: null },
      _sum: { amount: true },
      _count: { _all: true },
    }),
    db.cashSession.findMany({
      where: { tenantId, ...branchFilter, openedAt: range },
      orderBy: [{ openedAt: "asc" }, { id: "asc" }],
      select: {
        id: true,
        openedAt: true,
        openingCash: true,
        closedAt: true,
        countedCash: true,
        expectedCash: true,
        difference: true,
        branch: { select: { id: true, name: true } },
      },
    }),
    // 5a: repair work done on postpaid terms in the period.
    db.serviceOrder.aggregate({
      where: { tenantId, ...branchFilter, status: "COMPLETED", isPostpaid: true, isInternal: false, completedAt: range },
      _sum: { totalAmount: true },
      _count: { _all: true },
    }),
    // 5b (direct part): paid straight on a postpaid order in the period; settlement-paid payments carry settlementId
    // and are counted through the POSTPAID_SETTLEMENT ledger income instead (no double count).
    db.orderPayment.aggregate({
      where: { tenantId, status: "PAID", OR: [{ paidAt: range }, { paidAt: null, updatedAt: range }], settlementId: null, order: { tenantId, ...branchFilter, isPostpaid: true, isInternal: false } },
      _sum: { amount: true },
      _count: { _all: true },
    }),
    // 5c: outstanding as of range end (not today). QA #11: ALL completed non-internal orders
    // (postpaid or not), clamped per order — max(0, total − PAID as of `to`) — exactly like the
    // dashboard «Авлага (төлөгдөөгүй)» card. paymentStatus is "as of today", so it cannot prefilter here.
    db.serviceOrder.findMany({
      where: { tenantId, ...branchFilter, status: "COMPLETED", isInternal: false, totalAmount: { gt: 0 }, completedAt: { lte: to },
        // Bound the scan: an order that is fully PAID today and has no PAID payment dated after `to`
        // (same paidAt/updatedAt fallback as the as-of logic) was fully paid at `to` too => outstanding 0.
        OR: [
          { paymentStatus: { not: "PAID" } },
          { payments: { some: { status: "PAID", OR: [{ paidAt: { gt: to } }, { paidAt: null, updatedAt: { gt: to } }] } } },
        ],
      },
      select: {
        totalAmount: true,
        payments: {
          where: { status: "PAID", OR: [{ paidAt: { lte: to } }, { paidAt: null, updatedAt: { lte: to } }] },
          select: { amount: true },
        },
      },
    }),
  ]);

  const typeById = new Map(types.map((t) => [t.id, t]));
  const sum = (g: { _sum?: { amount?: { toString(): string } | null } | null }) => dec(g._sum?.amount);
  const cnt = (g: { _count?: { _all?: number } | null }) => g._count?._all ?? 0;

  // --- 1/4: by method, per bank ---
  const incomeGroups = groups.filter((g) => g.direction === "INCOME");
  const expenseGroups = groups.filter((g) => g.direction === "EXPENSE");

  const incomeByMethod: CashReportMethodRow[] = CASH_REPORT_METHODS.map((method) => {
    const rows = incomeGroups.filter((g) => g.method === method);
    const total = rows.reduce((a, g) => a.plus(sum(g)), ZERO);
    const count = rows.reduce((a, g) => a + cnt(g), 0);
    const banks: CashReportBankRow[] = [];
    if (BANK_METHODS.includes(method)) {
      const byBank = new Map<string | null, { total: Prisma.Decimal; count: number }>();
      for (const g of rows) {
        const key = g.bank ?? null;
        const cur = byBank.get(key) ?? { total: ZERO, count: 0 };
        byBank.set(key, { total: cur.total.plus(sum(g)), count: cur.count + cnt(g) });
      }
      const sorted = [...byBank.entries()].sort(([a], [b]) => (a === null ? 1 : 0) - (b === null ? 1 : 0) || (a ?? "").localeCompare(b ?? ""));
      for (const [bank, v] of sorted) {
        banks.push({
          bank,
          bankLabel: bank ? bankLabel(bank) : UNKNOWN_BANK_LABEL,
          total: v.total.toString(),
          count: v.count,
        });
      }
    }
    return { method, methodLabel: methodLabel(method), total: total.toString(), count, banks };
  });

  const byType = (rows: typeof groups): CashReportTypeRow[] => {
    const map = new Map<string, { total: Prisma.Decimal; count: number }>();
    for (const g of rows) {
      const cur = map.get(g.typeId) ?? { total: ZERO, count: 0 };
      map.set(g.typeId, { total: cur.total.plus(sum(g)), count: cur.count + cnt(g) });
    }
    return [...map.entries()]
      .map(([typeId, v]) => {
        const t = typeById.get(typeId);
        return { typeId, name: t?.name ?? typeId, systemKey: t?.systemKey ?? null, total: v.total, count: v.count };
      })
      .sort((a, b) => b.total.comparedTo(a.total) || a.name.localeCompare(b.name))
      .map((r) => ({ ...r, total: r.total.toString() }));
  };
  const incomeByType = byType(incomeGroups);
  const expenseByType = byType(expenseGroups);

  const methodTotals = (rows: typeof groups, method: string) => {
    const m = rows.filter((g) => g.method === method);
    return { total: m.reduce((a, g) => a.plus(sum(g)), ZERO), count: m.reduce((a, g) => a + cnt(g), 0) };
  };
  const expenseByMethod = CASH_REPORT_METHODS.map((method) => {
    const t = methodTotals(expenseGroups, method);
    return { method, methodLabel: methodLabel(method), total: t.total.toString(), count: t.count };
  });
  const netByMethod: CashReportMethodNetRow[] = CASH_REPORT_METHODS.map((method) => {
    const income = methodTotals(incomeGroups, method).total;
    const expense = methodTotals(expenseGroups, method).total;
    return { method, methodLabel: methodLabel(method), income: income.toString(), expense: expense.toString(), net: income.minus(expense).toString() };
  });
  const netCash = netByMethod.find((r) => r.method === "CASH")?.net ?? "0";

  // --- 8 totals ---
  const totalIncome = incomeGroups.reduce((a, g) => a.plus(sum(g)), ZERO);
  const totalExpense = expenseGroups.reduce((a, g) => a.plus(sum(g)), ZERO);

  // --- 6 internal cost (ledger system of record) ---
  const internalTypeIds = new Set(types.filter((t) => t.systemKey === "INTERNAL_REPAIR").map((t) => t.id));
  const internalRows = expenseGroups.filter((g) => internalTypeIds.has(g.typeId));
  const internalCost = {
    total: internalRows.reduce((a, g) => a.plus(sum(g)), ZERO).toString(),
    count: internalRows.reduce((a, g) => a + cnt(g), 0),
  };

  // --- 5 postpaid ---
  const settlementTypeIds = new Set(types.filter((t) => t.systemKey === "POSTPAID_SETTLEMENT").map((t) => t.id));
  const settlementRows = incomeGroups.filter((g) => settlementTypeIds.has(g.typeId));
  const settlementTotal = settlementRows.reduce((a, g) => a.plus(sum(g)), ZERO);
  const directTotal = dec(settlementDirect._sum?.amount);
  const outstanding = outstandingOrders.reduce((acc, o) => {
    const owed = dec(o.totalAmount).minus(o.payments.reduce((a, p) => a.plus(dec(p.amount)), ZERO));
    return owed.gt(0) ? acc.plus(owed) : acc;
  }, ZERO);

  // --- 7 sessions ---
  const sessionIds = sessionRows.map((s) => s.id);
  const closedRows = sessionRows.filter((s) => s.closedAt != null);
  type SessionGroup = { sessionId: string | null; direction: string; _sum?: { amount?: { toString(): string } | null } | null; _count?: { _all?: number } | null };
  let liveGroups: SessionGroup[] = [];
  let postCloseGroups: SessionGroup[] = [];
  type MethodGroup = SessionGroup & { method: string; bank: string | null };
  type FrozenRow = { sessionId: string; method: string; bank: string; expected: { toString(): string }; counted: { toString(): string } | null; difference: { toString(): string } | null };
  let methodGroups: MethodGroup[] = [];
  let frozenRows: FrozenRow[] = [];
  if (sessionIds.length) {
    [liveGroups, postCloseGroups, methodGroups, frozenRows] = await Promise.all([
      db.cashTransaction.groupBy({
        by: ["sessionId", "direction"],
        where: { tenantId, sessionId: { in: sessionIds }, method: "CASH", voidedAt: null },
        _sum: { amount: true },
      }) as Promise<SessionGroup[]>,
      closedRows.length
        ? (db.cashTransaction.groupBy({
            by: ["sessionId", "direction"],
            where: {
              tenantId,
              method: "CASH",
              OR: closedRows.map((s) => ({ sessionId: s.id, voidedAt: { gte: s.closedAt as Date } })),
            },
            _sum: { amount: true },
            _count: { _all: true },
          }) as Promise<SessionGroup[]>)
        : Promise.resolve([] as SessionGroup[]),
      // One grouped query for every listed session (all methods, non-voided) - no per-session queries.
      db.cashTransaction.groupBy({
        by: ["sessionId", "method", "bank", "direction"],
        where: { tenantId, sessionId: { in: sessionIds }, voidedAt: null },
        _sum: { amount: true },
        _count: { _all: true },
      }) as Promise<MethodGroup[]>,
      closedRows.length
        ? (db.cashSessionMethodCount.findMany({
            where: { tenantId, sessionId: { in: closedRows.map((s) => s.id) } },
            select: { sessionId: true, method: true, bank: true, expected: true, counted: true, difference: true },
          }) as Promise<FrozenRow[]>)
        : Promise.resolve([] as FrozenRow[]),
    ]);
  }
  const pick = (rows: SessionGroup[], id: string, d: string) =>
    rows.filter((r) => r.sessionId === id && r.direction === d).reduce((a, r) => a.plus(dec(r._sum?.amount)), ZERO);
  const methodOrder = (m: string) => CASH_REPORT_METHODS.indexOf(m as CashReportMethod);
  const buildMethodRows = (s: (typeof sessionRows)[number], closed: boolean, liveExpectedCash: Prisma.Decimal): CashReportSessionMethodRow[] => {
    const acc = new Map<string, { method: CashReportMethod; bank: string; income: Prisma.Decimal; expense: Prisma.Decimal; count: number }>();
    const touch = (method: string, rawBank: string | null) => {
      // The drawer is one CASH row per session regardless of any stray bank value on entries.
      const bank = method === "CASH" ? null : rawBank;
      const key = `${method}|${bank ?? ""}`;
      let r = acc.get(key);
      if (!r) {
        r = { method: method as CashReportMethod, bank: bank ?? "", income: ZERO, expense: ZERO, count: 0 };
        acc.set(key, r);
      }
      return r;
    };
    for (const g of methodGroups) {
      if (g.sessionId !== s.id) continue;
      const r = touch(g.method, g.bank ?? null);
      if (g.direction === "INCOME") r.income = r.income.plus(sum(g));
      else r.expense = r.expense.plus(sum(g));
      r.count += cnt(g);
    }
    const frozen = new Map(frozenRows.filter((f) => f.sessionId === s.id).map((f) => [`${f.method}|${f.bank ?? ""}`, f]));
    for (const f of frozen.values()) touch(f.method, f.bank);
    touch("CASH", null); // the drawer always has a row
    return [...acc.values()]
      .sort((a, b) => methodOrder(a.method) - methodOrder(b.method) || a.bank.localeCompare(b.bank))
      .map((r) => {
        const net = r.income.minus(r.expense);
        let expected: string;
        let counted: string | null = null;
        let difference: string | null = null;
        if (r.method === "CASH") {
          expected = (closed ? (s.expectedCash ?? liveExpectedCash) : liveExpectedCash).toString();
          counted = s.countedCash?.toString() ?? null;
          difference = s.difference?.toString() ?? null;
        } else if (closed) {
          const f = frozen.get(`${r.method}|${r.bank}`);
          expected = (f ? f.expected : net).toString();
          counted = f?.counted?.toString() ?? null;
          difference = f?.difference?.toString() ?? null;
        } else {
          expected = net.toString();
        }
        return { method: r.method, bank: r.bank || null, income: r.income.toString(), expense: r.expense.toString(), net: net.toString(), count: r.count, expected, counted, difference };
      });
  };
  const items: CashReportSessionRow[] = sessionRows.map((s) => {
    const cashIn = pick(liveGroups, s.id, "INCOME");
    const cashOut = pick(liveGroups, s.id, "EXPENSE");
    const closed = s.closedAt != null;
    const liveExpected = s.openingCash.plus(cashIn).minus(cashOut);
    const voidIn = pick(postCloseGroups, s.id, "INCOME");
    const voidOut = pick(postCloseGroups, s.id, "EXPENSE");
    const voidCount = postCloseGroups.filter((r) => r.sessionId === s.id).reduce((a, r) => a + cnt(r), 0);
    return {
      id: s.id,
      branch: { id: s.branch.id, name: s.branch.name },
      status: closed ? "CLOSED" : "OPEN",
      openedAt: s.openedAt.toISOString(),
      closedAt: s.closedAt?.toISOString() ?? null,
      openingCash: s.openingCash.toString(),
      cashIn: cashIn.toString(),
      cashOut: cashOut.toString(),
      // Closed: the frozen value stored at close; open: live.
      expectedCash: closed ? (s.expectedCash ?? liveExpected).toString() : liveExpected.toString(),
      countedCash: s.countedCash?.toString() ?? null,
      difference: s.difference?.toString() ?? null,
      postCloseVoids: { count: voidCount, incomeAmount: voidIn.toString(), expenseAmount: voidOut.toString(), netAmount: voidIn.minus(voidOut).toString() },
      totalIncome: methodGroups.filter((g) => g.sessionId === s.id && g.direction === "INCOME").reduce((a, g) => a.plus(sum(g)), ZERO).toString(),
      totalExpense: methodGroups.filter((g) => g.sessionId === s.id && g.direction === "EXPENSE").reduce((a, g) => a.plus(sum(g)), ZERO).toString(),
      byMethod: buildMethodRows(s, closed, liveExpected),
    };
  });
  const outIn = outsideGroups.filter((g) => g.direction === "INCOME").reduce((a, g) => a.plus(sum(g)), ZERO);
  const outOut = outsideGroups.filter((g) => g.direction === "EXPENSE").reduce((a, g) => a.plus(sum(g)), ZERO);

  return {
    range: { from: from.toISOString(), to: to.toISOString() },
    branchId,
    incomeByMethod,
    incomeByType,
    expenseByType,
    expenseByMethod,
    netByMethod,
    netCash,
    postpaid: {
      workDone: { total: dec(workDone._sum?.totalAmount).toString(), count: workDone._count?._all ?? 0 },
      collected: {
        total: settlementTotal.plus(directTotal).toString(),
        settlements: { total: settlementTotal.toString(), count: settlementRows.reduce((a, g) => a + cnt(g), 0) },
        directPayments: { total: directTotal.toString(), count: settlementDirect._count?._all ?? 0 },
      },
      outstanding: { total: outstanding.toString(), asOf: to.toISOString() },
    },
    internalCost,
    sessions: {
      items,
      outsideSession: {
        income: outIn.toString(),
        expense: outOut.toString(),
        net: outIn.minus(outOut).toString(),
        count: outsideGroups.reduce((a, g) => a + cnt(g), 0),
      },
    },
    totals: { income: totalIncome.toString(), expense: totalExpense.toString(), net: totalIncome.minus(totalExpense).toString() },
  };
}
