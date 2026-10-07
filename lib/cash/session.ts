// Phase C3: cash drawer sessions «Касс нээх / хаах» — one open session per branch.
// Expected cash = openingCash + Σ(live CASH INCOME with sessionId) − Σ(live CASH EXPENSE with sessionId).
// CASH ledger entries attach to the open session inside the writer's own transaction (see session-attach.ts).
// Entries voided after the session closed never change the frozen expectedCash/difference; they are reported
// separately as «post-close voids».
import { Prisma } from "@/app/generated/prisma/client";
import { logAudit } from "@/lib/audit";
import { hasPermission } from "@/lib/auth/roles";
import { formatTugrik } from "@/lib/orders";
import { prisma, type PrismaTransactionClient } from "@/lib/prisma";
import { CASH_ENTRY_SELECT, parseBound, serializeCashEntry, type CashScope } from "./ledger";
import {
  CashError,
  cashForbidden,
  MAX_CASH_AMOUNT,
  MAX_NOTE_LENGTH,
  normalizeOptionalText,
  parseCashAmount,
} from "./rules";
import type { CashActor } from "./types";
import { effectiveBranchScope } from "@/lib/cash/scope";

export { resolveCashSessionId } from "./session-attach";

/** Method order used in every per-method breakdown (CASH first, then the rest). */
export const SESSION_METHOD_ORDER = ["CASH", "CARD", "BANK_TRANSFER", "QPAY", "OTHER"] as const;
export type SessionMethod = (typeof SESSION_METHOD_ORDER)[number];
export function isSessionMethod(value: unknown): value is SessionMethod {
  return typeof value === "string" && (SESSION_METHOD_ORDER as readonly string[]).includes(value);
}

function assertCashManage(actor: CashActor) {
  if (!hasPermission(actor, "cash.manage")) throw cashForbidden();
}

const ZERO = new Prisma.Decimal(0);

/** ≥ 0 money (opening / counted cash), ≤ 2 decimals. Invalid -> 422 CASH_AMOUNT_INVALID with a field error. */
export function parseNonNegativeCash(value: unknown, field: string): Prisma.Decimal {
  const fail = () => new CashError("Дүнг зөв оруулна уу.", 422, "CASH_AMOUNT_INVALID", { [field]: "Дүнг зөв оруулна уу." });
  if (value === null || value === undefined || value === "") throw fail();
  // Explicit zero: parseCashAmount only accepts > 0, so 0 / "0" / "0.00" are recognised here and nothing else is.
  const isZero =
    (typeof value === "number" && Number.isFinite(value) && value === 0) ||
    (typeof value === "string" && /^0+(?:\.0{1,2})?$/.test(value.trim().replace(/[\s,]/g, "")));
  if (isZero) return ZERO;
  const amount = parseCashAmount(value);
  if (!amount || amount.gt(MAX_CASH_AMOUNT)) throw fail();
  return amount;
}

/** Pure: opening + income − expense. */
export function expectedCashFrom(openingCash: Prisma.Decimal, income: Prisma.Decimal, expense: Prisma.Decimal): Prisma.Decimal {
  return openingCash.plus(income).minus(expense);
}

type SessionClient = Pick<PrismaTransactionClient, "cashTransaction">;

/** Live CASH in/out of a session: non-voided entries only. */
export async function sessionCashTotals(client: SessionClient, tenantId: string, sessionId: string) {
  const groups = await client.cashTransaction.groupBy({
    by: ["direction"],
    where: { tenantId, sessionId, method: "CASH", voidedAt: null },
    _sum: { amount: true },
    _count: { _all: true },
  });
  const sum = (d: "INCOME" | "EXPENSE") => new Prisma.Decimal((groups.find((g) => g.direction === d)?._sum?.amount ?? 0).toString());
  const count = (d: "INCOME" | "EXPENSE") => groups.find((g) => g.direction === d)?._count?._all ?? 0;
  return { cashIn: sum("INCOME"), cashOut: sum("EXPENSE"), entryCount: count("INCOME") + count("EXPENSE") };
}

export type SessionMethodTotal = {
  method: SessionMethod;
  /** "" = no bank (the stored key); the JSON shape maps it to null. */
  bank: string;
  income: Prisma.Decimal;
  expense: Prisma.Decimal;
  net: Prisma.Decimal;
  count: number;
};

const groupKey = (method: string, bank: string) => `${method}|${bank}`;

/** Live per-(method, bank) totals of a session: non-voided entries of ANY method, one row per group present. */
export async function sessionMethodTotals(client: SessionClient, tenantId: string, sessionId: string): Promise<SessionMethodTotal[]> {
  const groups = await client.cashTransaction.groupBy({
    by: ["method", "bank", "direction"],
    where: { tenantId, sessionId, voidedAt: null },
    _sum: { amount: true },
    _count: { _all: true },
  });
  const byKey = new Map<string, SessionMethodTotal>();
  for (const g of groups) {
    const bank = g.bank ?? "";
    const key = groupKey(g.method, bank);
    const row = byKey.get(key) ?? { method: g.method as SessionMethod, bank, income: ZERO, expense: ZERO, net: ZERO, count: 0 };
    const amount = new Prisma.Decimal((g._sum?.amount ?? 0).toString());
    if (g.direction === "INCOME") row.income = row.income.plus(amount);
    else row.expense = row.expense.plus(amount);
    row.net = row.income.minus(row.expense);
    row.count += g._count?._all ?? 0;
    byKey.set(key, row);
  }
  return [...byKey.values()].sort(
    (a, b) => SESSION_METHOD_ORDER.indexOf(a.method) - SESSION_METHOD_ORDER.indexOf(b.method) || a.bank.localeCompare(b.bank),
  );
}

type LedgerGroup = {
  method: string;
  bank: string | null;
  direction: string;
  _sum: { amount: Prisma.Decimal | number | string | null } | null;
  _count: { _all: number } | null;
};

/** Pure: one session's live totals from its (method, bank, direction) groups (CASH figures + per-method breakdown). */
export function liveTotalsFromGroups(openingCash: Prisma.Decimal, groups: ReadonlyArray<LedgerGroup>) {
  const amountOf = (g: LedgerGroup) => new Prisma.Decimal((g._sum?.amount ?? 0).toString());
  const cash = groups.filter((g) => g.method === "CASH");
  const cashIn = cash.filter((g) => g.direction === "INCOME").reduce((s, g) => s.plus(amountOf(g)), ZERO);
  const cashOut = cash.filter((g) => g.direction === "EXPENSE").reduce((s, g) => s.plus(amountOf(g)), ZERO);
  const entryCount = cash.reduce((n, g) => n + (g._count?._all ?? 0), 0);
  const byKey = new Map<string, SessionMethodTotal>();
  for (const g of groups) {
    const bank = g.bank ?? "";
    const key = groupKey(g.method, bank);
    const row = byKey.get(key) ?? { method: g.method as SessionMethod, bank, income: ZERO, expense: ZERO, net: ZERO, count: 0 };
    if (g.direction === "INCOME") row.income = row.income.plus(amountOf(g));
    else row.expense = row.expense.plus(amountOf(g));
    row.net = row.income.minus(row.expense);
    row.count += g._count?._all ?? 0;
    byKey.set(key, row);
  }
  const byMethod = [...byKey.values()].sort(
    (a, b) => SESSION_METHOD_ORDER.indexOf(a.method) - SESSION_METHOD_ORDER.indexOf(b.method) || a.bank.localeCompare(b.bank),
  );
  return {
    cashIn,
    cashOut,
    entryCount,
    expectedCash: expectedCashFrom(openingCash, cashIn, cashOut),
    byMethod,
    totalEntryCount: byMethod.reduce((n, g) => n + g.count, 0),
  };
}

/** Batched live totals for many sessions: ONE groupBy over all ids (no per-session queries). Keyed by session id. */
export async function computeExpectedCashBatch(
  client: SessionClient,
  tenantId: string,
  sessions: ReadonlyArray<{ id: string; openingCash: Prisma.Decimal }>,
) {
  const result = new Map<string, ReturnType<typeof liveTotalsFromGroups>>();
  if (sessions.length === 0) return result;
  const groups = await client.cashTransaction.groupBy({
    by: ["sessionId", "method", "bank", "direction"],
    where: { tenantId, sessionId: { in: sessions.map((s) => s.id) }, voidedAt: null },
    _sum: { amount: true },
    _count: { _all: true },
  });
  const bySession = new Map<string, LedgerGroup[]>();
  for (const g of groups) {
    if (g.sessionId == null) continue;
    const list = bySession.get(g.sessionId) ?? [];
    list.push(g as LedgerGroup);
    bySession.set(g.sessionId, list);
  }
  for (const s of sessions) result.set(s.id, liveTotalsFromGroups(s.openingCash, bySession.get(s.id) ?? []));
  return result;
}

/** Expected drawer cash for a session (live: excludes voided entries) plus the per-method breakdown. */
export async function computeExpectedCash(client: SessionClient, tenantId: string, session: { id: string; openingCash: Prisma.Decimal }) {
  const totals = await sessionCashTotals(client, tenantId, session.id);
  const byMethod = await sessionMethodTotals(client, tenantId, session.id);
  return {
    ...totals,
    expectedCash: expectedCashFrom(session.openingCash, totals.cashIn, totals.cashOut),
    byMethod,
    totalEntryCount: byMethod.reduce((n, g) => n + g.count, 0),
  };
}

const SESSION_SELECT = {
  id: true,
  branchId: true,
  openedAt: true,
  openingCash: true,
  closedAt: true,
  countedCash: true,
  expectedCash: true,
  difference: true,
  note: true,
  methodCounts: { select: { method: true, bank: true, expected: true, counted: true, difference: true } },
  branch: { select: { id: true, name: true } },
  openedBy: { select: { id: true, firstName: true, lastName: true } },
  closedBy: { select: { id: true, firstName: true, lastName: true } },
} satisfies Prisma.CashSessionSelect;

type SessionRow = Prisma.CashSessionGetPayload<{ select: typeof SESSION_SELECT }>;

function person(user: { id: string; firstName: string; lastName: string } | null) {
  return user ? { id: user.id, name: `${user.firstName} ${user.lastName}`.trim() } : null;
}

type LiveTotals = {
  cashIn: Prisma.Decimal;
  cashOut: Prisma.Decimal;
  entryCount: number;
  expectedCash: Prisma.Decimal;
  byMethod: SessionMethodTotal[];
  totalEntryCount: number;
};

/**
 * Per-(method, bank) rows. income/expense/net/count are live. CASH row: expected/counted/difference mirror the
 * session's drawer figures (expected INCLUDES opening cash). Non-CASH rows: open -> expected = live net, counted/difference
 * null; closed -> the frozen CashSessionMethodCount values (a frozen group with no live entries any more is kept, zeros).
 */
function serializeByMethod(row: SessionRow, live: LiveTotals, closed: boolean) {
  const frozen = new Map((row.methodCounts ?? []).map((m) => [groupKey(m.method, m.bank), m]));
  const rows = [...live.byMethod];
  if (closed) {
    for (const m of row.methodCounts ?? []) {
      if (!rows.some((r) => r.method === m.method && r.bank === m.bank)) {
        rows.push({ method: m.method as SessionMethod, bank: m.bank, income: ZERO, expense: ZERO, net: ZERO, count: 0 });
      }
    }
  }
  return rows.map((g) => {
    let expected: string | null;
    let counted: string | null = null;
    let difference: string | null = null;
    if (g.method === "CASH") {
      expected = closed ? (row.expectedCash?.toString() ?? null) : live.expectedCash.toString();
      counted = row.countedCash?.toString() ?? null;
      difference = row.difference?.toString() ?? null;
    } else if (closed) {
      const f = frozen.get(groupKey(g.method, g.bank));
      expected = f?.expected.toString() ?? null;
      counted = f?.counted?.toString() ?? null;
      difference = f?.difference?.toString() ?? null;
    } else {
      expected = g.net.toString();
    }
    return {
      method: g.method,
      bank: g.bank === "" ? null : g.bank,
      income: g.income.toString(),
      expense: g.expense.toString(),
      net: g.net.toString(),
      count: g.count,
      expected,
      counted,
      difference,
    };
  });
}

/** JSON shape. Open: expectedCash is live and counted/difference are null. Closed: the frozen stored values. */
export function serializeCashSession(row: SessionRow, live: LiveTotals | null) {
  const closed = row.closedAt != null;
  return {
    id: row.id,
    status: closed ? ("CLOSED" as const) : ("OPEN" as const),
    branch: { id: row.branch.id, name: row.branch.name },
    openedAt: row.openedAt.toISOString(),
    openedBy: person(row.openedBy),
    openingCash: row.openingCash.toString(),
    closedAt: row.closedAt?.toISOString() ?? null,
    closedBy: person(row.closedBy),
    countedCash: row.countedCash?.toString() ?? null,
    expectedCash: closed ? (row.expectedCash?.toString() ?? null) : (live?.expectedCash.toString() ?? row.openingCash.toString()),
    difference: row.difference?.toString() ?? null,
    note: row.note,
    // Live totals of non-voided CASH entries (for a closed session: as of now, i.e. after any post-close voids).
    cashIn: live?.cashIn.toString() ?? null,
    cashOut: live?.cashOut.toString() ?? null,
    entryCount: live?.entryCount ?? null,
    // All methods (non-voided): total entries and the per-(method, bank) breakdown. Cash-only fields above are unchanged.
    totalEntryCount: live?.totalEntryCount ?? null,
    byMethod: live ? serializeByMethod(row, live, closed) : [],
  };
}

export type SerializedCashSession = ReturnType<typeof serializeCashSession>;

async function lockBranch(tx: PrismaTransactionClient, tenantId: string, branchId: string): Promise<void> {
  await tx.$queryRaw`SELECT id FROM "Branch" WHERE id = ${branchId} AND "tenantId" = ${tenantId} FOR UPDATE`;
}

/** The branch's open session (closedAt null) or null. */
export async function getOpenSession(client: Pick<PrismaTransactionClient, "cashSession">, tenantId: string, branchId: string) {
  return client.cashSession.findFirst({ where: { tenantId, branchId, closedAt: null }, orderBy: { openedAt: "desc" }, select: SESSION_SELECT });
}

/** Light flag for the «Касс нээгдээгүй байна» warning. */
export async function hasOpenSession(client: Pick<PrismaTransactionClient, "cashSession">, tenantId: string, branchId: string): Promise<boolean> {
  const open = await client.cashSession.findFirst({ where: { tenantId, branchId, closedAt: null }, select: { id: true } });
  return open != null;
}

async function liveSerialize(row: SessionRow, tenantId: string): Promise<SerializedCashSession> {
  return serializeCashSession(row, await computeExpectedCash(prisma, tenantId, row));
}

function branchRequired(): CashError {
  return new CashError("Салбар сонгоно уу.", 422, "CASH_BRANCH_INVALID", { branchId: "Салбар сонгоно уу." });
}

/** Resolves the branch for read endpoints: pinned scope wins, else the requested id; neither -> 422. */
export function resolveSessionBranch(actor: CashActor, scope: CashScope, requested: unknown): string {
  const pinned = effectiveBranchScope(actor, scope);
  if (pinned != null) return pinned;
  if (typeof requested !== "string" || !requested) throw branchRequired();
  return requested;
}

/** Whether the branch has an open session, for anyone who can record payments (payments.create) — no cash.manage needed. */
export async function branchCashSessionOpen(actor: CashActor, branchId: string): Promise<boolean> {
  if (!hasPermission(actor, "payments.create") && !hasPermission(actor, "cash.manage")) throw cashForbidden();
  return hasOpenSession(prisma, actor.tenantId, branchId);
}

export async function openCashSession(input: {
  actor: CashActor;
  scope?: CashScope;
  branchId: unknown;
  openingCash: unknown;
  note?: unknown;
  now?: Date;
}): Promise<SerializedCashSession> {
  const { actor } = input;
  assertCashManage(actor);
  if (typeof input.branchId !== "string" || !input.branchId) throw branchRequired();
  const branchId = input.branchId;
  const openingCash = parseNonNegativeCash(input.openingCash, "openingCash");
  const note = normalizeOptionalText(input.note, "note", MAX_NOTE_LENGTH);
  const scope = effectiveBranchScope(actor, input.scope);
  if (scope != null && scope !== branchId) {
    throw new CashError("Энэ салбарт ээлж нээх эрхгүй.", 422, "CASH_BRANCH_INVALID", { branchId: "Энэ салбарт ээлж нээх эрхгүй." });
  }
  const tenantId = actor.tenantId;
  const created = await prisma.$transaction(async (tx) => {
    const branch = await tx.branch.findFirst({ where: { id: branchId, tenantId }, select: { id: true, isActive: true } });
    if (!branch || !branch.isActive) throw new CashError("Салбар олдсонгүй.", 422, "CASH_BRANCH_INVALID", { branchId: "Салбар олдсонгүй." });
    // The Branch row lock serialises concurrent opens and attach/close; the partial unique index
    // "CashSession_one_open_per_branch_key" (migration 20261006180000) is the DB backstop (P2002 -> ALREADY_OPEN below).
    await lockBranch(tx, tenantId, branchId);
    if (await hasOpenSession(tx, tenantId, branchId)) {
      throw new CashError("Энэ салбарт касс аль хэдийн нээгдсэн байна.", 409, "CASH_SESSION_ALREADY_OPEN");
    }
    let row: SessionRow;
    try {
      row = await tx.cashSession.create({
        data: { tenantId, branchId, openedById: actor.id, openedAt: input.now ?? new Date(), openingCash, note },
        select: SESSION_SELECT,
      });
    } catch (error) {
      if ((error as { code?: string } | null)?.code === "P2002") {
        throw new CashError("Энэ салбарт касс аль хэдийн нээгдсэн байна.", 409, "CASH_SESSION_ALREADY_OPEN");
      }
      throw error;
    }
    await logAudit({
      tenantId,
      userId: actor.id,
      branchId,
      entity: "CashSession",
      entityId: row.id,
      action: "CREATE",
      summary: `Касс нээв · эхний үлдэгдэл ${formatTugrik(openingCash.toString())}`,
      after: { openingCash: openingCash.toString(), note },
    }, tx);
    return row;
  });
  return serializeCashSession(created, { cashIn: ZERO, cashOut: ZERO, entryCount: 0, expectedCash: openingCash, byMethod: [], totalEntryCount: 0 });
}

export type MethodCountInput = { method: SessionMethod; bank: string; counted: Prisma.Decimal | null };

const methodCountInvalid = (field: string, message = "Утга буруу байна.") =>
  new CashError(message, 422, "CASH_FIELD_INVALID", { [field]: message });

/**
 * Shape-validates the optional close input `[{ method, bank?, counted? }]`. counted null/""/absent = not counted.
 * CASH is rejected (the drawer uses countedCash). Duplicate (method, bank) -> 422. Group existence is checked in the tx.
 */
export function parseMethodCounts(raw: unknown): MethodCountInput[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) throw methodCountInvalid("methodCounts");
  const seen = new Set<string>();
  return raw.map((item, i) => {
    const field = `methodCounts.${i}`;
    if (!item || typeof item !== "object" || Array.isArray(item)) throw methodCountInvalid(field);
    const o = item as Record<string, unknown>;
    if (!isSessionMethod(o.method) || o.method === "CASH") throw methodCountInvalid(`${field}.method`, "Төлбөрийн арга буруу.");
    if (o.bank !== undefined && o.bank !== null && typeof o.bank !== "string") throw methodCountInvalid(`${field}.bank`);
    const bank = typeof o.bank === "string" ? o.bank.trim() : "";
    const key = groupKey(o.method, bank);
    if (seen.has(key)) throw methodCountInvalid(field, "Давхардсан мөр байна.");
    seen.add(key);
    const blank = o.counted === undefined || o.counted === null || (typeof o.counted === "string" && o.counted.trim() === "");
    return { method: o.method, bank, counted: blank ? null : parseNonNegativeCash(o.counted, `${field}.counted`) };
  });
}

export async function closeCashSession(input: {
  actor: CashActor;
  scope?: CashScope;
  sessionId: string;
  countedCash: unknown;
  /** Optional per-(method, bank) counted amounts for non-CASH groups, e.g. [{ method: "CARD", bank: "KHAN", counted: "120000" }]. */
  methodCounts?: unknown;
  note?: unknown;
  now?: Date;
}): Promise<SerializedCashSession> {
  const { actor } = input;
  assertCashManage(actor);
  const countedCash = parseNonNegativeCash(input.countedCash, "countedCash");
  const methodInputs = parseMethodCounts(input.methodCounts);
  const closeNote = normalizeOptionalText(input.note, "note", MAX_NOTE_LENGTH);
  const tenantId = actor.tenantId;
  const scope = effectiveBranchScope(actor, input.scope);
  const { closed, totals } = await prisma.$transaction(async (tx) => {
    const found = await tx.cashSession.findFirst({ where: { id: input.sessionId, tenantId }, select: { id: true, branchId: true } });
    if (!found || (scope != null && found.branchId !== scope)) throw new CashError("Ээлж олдсонгүй.", 404, "CASH_SESSION_NOT_FOUND");
    await lockBranch(tx, tenantId, found.branchId);
    // Re-read under the lock: a concurrent close must lose with NOT_OPEN, and attaches queue behind us.
    const session = await tx.cashSession.findFirst({ where: { id: found.id, tenantId }, select: SESSION_SELECT });
    if (!session) throw new CashError("Ээлж олдсонгүй.", 404, "CASH_SESSION_NOT_FOUND");
    if (session.closedAt) throw new CashError("Энэ ээлж аль хэдийн хаагдсан байна.", 422, "CASH_SESSION_NOT_OPEN");
    const live = await computeExpectedCash(tx, tenantId, session);
    const difference = countedCash.minus(live.expectedCash);
    const note = closeNote ? (session.note ? `${session.note}\n${closeNote}` : closeNote) : session.note;
    const updated = await tx.cashSession.updateMany({
      where: { id: session.id, tenantId, closedAt: null },
      data: { closedAt: input.now ?? new Date(), closedById: actor.id, countedCash, expectedCash: live.expectedCash, difference, note },
    });
    if (updated.count === 0) throw new CashError("Энэ ээлж аль хэдийн хаагдсан байна.", 422, "CASH_SESSION_NOT_OPEN");
    // Per-(method, bank) rows for every NON-CASH group present (CASH uses the CashSession columns). QPAY has no count
    // input: counted = expected, difference 0. Input for a group the session does not have -> 422 (tx rolls back).
    const groups = live.byMethod.filter((g) => g.method !== "CASH");
    for (const m of methodInputs) {
      if (!groups.some((g) => g.method === m.method && g.bank === m.bank)) {
        throw methodCountInvalid("methodCounts", "Энэ ээлжид ийм төлбөрийн аргын гүйлгээ байхгүй.");
      }
    }
    if (groups.length) {
      await tx.cashSessionMethodCount.createMany({
        data: groups.map((g) => {
          const given = methodInputs.find((m) => m.method === g.method && m.bank === g.bank)?.counted ?? null;
          const counted = g.method === "QPAY" ? g.net : given;
          return { tenantId, sessionId: session.id, method: g.method, bank: g.bank, expected: g.net, counted, difference: counted ? counted.minus(g.net) : null };
        }),
      });
    }
    await logAudit({
      tenantId,
      userId: actor.id,
      branchId: session.branchId,
      entity: "CashSession",
      entityId: session.id,
      action: "UPDATE",
      summary: `Касс хаав · тооцсон ${formatTugrik(countedCash.toString())} · зөрүү ${formatTugrik(difference.toString())}`,
      before: { open: true },
      after: { open: false, countedCash: countedCash.toString(), expectedCash: live.expectedCash.toString(), difference: difference.toString() },
    }, tx);
    const row = await tx.cashSession.findUniqueOrThrow({ where: { id: session.id }, select: SESSION_SELECT });
    return { closed: row, totals: live };
  });
  return serializeCashSession(closed, totals);
}

/** Current (open) session of a branch with live expected cash, or null. */
export async function getCurrentSession(input: { actor: CashActor; scope?: CashScope; branchId: unknown }): Promise<SerializedCashSession | null> {
  assertCashManage(input.actor);
  const branchId = resolveSessionBranch(input.actor, input.scope, input.branchId);
  const row = await getOpenSession(prisma, input.actor.tenantId, branchId);
  return row ? liveSerialize(row, input.actor.tenantId) : null;
}

export type CashSessionFilters = {
  from?: string | null;
  to?: string | null;
  branchId?: string | null;
  /** OPEN | CLOSED */
  status?: string | null;
};

export async function listSessions(input: { actor: CashActor; scope?: CashScope; filters?: CashSessionFilters; skip?: number; take?: number }) {
  const { actor } = input;
  assertCashManage(actor);
  const tenantId = actor.tenantId;
  const filters = input.filters ?? {};
  const scope = effectiveBranchScope(actor, input.scope);
  const where: Prisma.CashSessionWhereInput = { tenantId };
  if (scope != null) where.branchId = scope;
  else if (filters.branchId) where.branchId = filters.branchId;
  if (filters.status) {
    const status = filters.status.toUpperCase();
    if (status === "OPEN") where.closedAt = null;
    else if (status === "CLOSED") where.closedAt = { not: null };
    else throw new CashError("Төлөв буруу.", 422, "CASH_FIELD_INVALID", { status: "Төлөв буруу." });
  }
  if (filters.from || filters.to) {
    const openedAt: Prisma.DateTimeFilter = {};
    if (filters.from) Object.assign(openedAt, parseBound(filters.from, "from", "from"));
    if (filters.to) Object.assign(openedAt, parseBound(filters.to, "to", "to"));
    where.openedAt = openedAt;
  }
  const [rows, total] = await Promise.all([
    prisma.cashSession.findMany({ where, orderBy: [{ openedAt: "desc" }, { id: "desc" }], skip: input.skip ?? 0, take: input.take ?? 50, select: SESSION_SELECT }),
    prisma.cashSession.count({ where }),
  ]);
  // One groupBy for the whole page (was 2 aggregate queries per row).
  const totals = await computeExpectedCashBatch(prisma, tenantId, rows);
  const sessions = rows.map((row) => serializeCashSession(row, totals.get(row.id) ?? liveTotalsFromGroups(row.openingCash, [])));
  return { sessions, total };
}

/** Fresh expected cash + per-method breakdown for the close dialog; same permission/tenant/branch checks as getSessionDetail, no entry lists. */
export async function getSessionCloseFigures(input: { actor: CashActor; scope?: CashScope; sessionId: string }) {
  const { actor } = input;
  assertCashManage(actor);
  const tenantId = actor.tenantId;
  const scope = effectiveBranchScope(actor, input.scope);
  const row = await prisma.cashSession.findFirst({ where: { id: input.sessionId, tenantId }, select: SESSION_SELECT });
  if (!row || (scope != null && row.branchId !== scope)) throw new CashError("Ээлж олдсонгүй.", 404, "CASH_SESSION_NOT_FOUND");
  const session = await liveSerialize(row, tenantId);
  return { expectedCash: session.expectedCash ?? session.openingCash, byMethod: session.byMethod };
}

const DETAIL_ENTRY_CAP = 500;

/** Session + its entries, live totals and — for a closed session — the post-close voids (reported apart; frozen values never change). */
export async function getSessionDetail(input: { actor: CashActor; scope?: CashScope; sessionId: string }) {
  const { actor } = input;
  assertCashManage(actor);
  const tenantId = actor.tenantId;
  const scope = effectiveBranchScope(actor, input.scope);
  const row = await prisma.cashSession.findFirst({ where: { id: input.sessionId, tenantId }, select: SESSION_SELECT });
  if (!row || (scope != null && row.branchId !== scope)) throw new CashError("Ээлж олдсонгүй.", 404, "CASH_SESSION_NOT_FOUND");
  const [session, entryRows, voidedRows] = await Promise.all([
    liveSerialize(row, tenantId),
    prisma.cashTransaction.findMany({
      where: { tenantId, sessionId: row.id, voidedAt: null },
      orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
      take: DETAIL_ENTRY_CAP,
      select: CASH_ENTRY_SELECT,
    }),
    prisma.cashTransaction.findMany({
      where: { tenantId, sessionId: row.id, voidedAt: { not: null } },
      orderBy: [{ voidedAt: "desc" }, { id: "desc" }],
      take: DETAIL_ENTRY_CAP,
      select: CASH_ENTRY_SELECT,
    }),
  ]);
  const closedAt = row.closedAt;
  // Totals come from a DB aggregate (not the capped list); voids share the Branch lock with close, so voidedAt >= closedAt is a true post-close void.
  const postCloseWhere: Prisma.CashTransactionWhereInput | null = closedAt ? { tenantId, sessionId: row.id, method: "CASH", voidedAt: { gte: closedAt } } : null;
  const groups = postCloseWhere
    ? await prisma.cashTransaction.groupBy({ by: ["direction"], where: postCloseWhere, _sum: { amount: true }, _count: { _all: true } })
    : [];
  const postClose = closedAt ? voidedRows.filter((e) => e.voidedAt != null && e.voidedAt.getTime() >= closedAt.getTime()) : [];
  const sumOf = (d: "INCOME" | "EXPENSE") => new Prisma.Decimal((groups.find((g) => g.direction === d)?._sum?.amount ?? 0).toString());
  const incomeVoided = sumOf("INCOME");
  const expenseVoided = sumOf("EXPENSE");
  const postCloseCount = groups.reduce((n, g) => n + (g._count?._all ?? 0), 0);
  return {
    session,
    entries: entryRows.map((e) => serializeCashEntry(e)),
    voidedEntries: voidedRows.map((e) => serializeCashEntry(e)),
    /** The entry lists are capped at DETAIL_ENTRY_CAP rows (totals stay exact): true when the cap was hit. */
    truncated: {
      entries: entryRows.length >= DETAIL_ENTRY_CAP,
      postCloseVoids: voidedRows.length >= DETAIL_ENTRY_CAP,
      cap: DETAIL_ENTRY_CAP,
    },
    postCloseVoids: {
      count: postCloseCount,
      incomeAmount: incomeVoided.toString(),
      expenseAmount: expenseVoided.toString(),
      // Cash the frozen expectedCash still counts although it was voided afterwards (income voided − expense voided).
      netAmount: incomeVoided.minus(expenseVoided).toString(),
      entries: postClose.map((e) => serializeCashEntry(e)),
    },
  };
}
