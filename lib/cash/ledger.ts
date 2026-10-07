import { Prisma } from "@/app/generated/prisma/client";
import { logAudit } from "@/lib/audit";
import { assertPaymentBank, bankLabel, isBankCode, PaymentBankError } from "@/lib/banks";
import { hasPermission } from "@/lib/auth/roles";
import { bookingDayBounds } from "@/lib/booking-time";
import { ORDER_PAYMENT_METHOD_LABEL, formatTugrik } from "@/lib/orders";
import { prisma, type PrismaTransactionClient } from "@/lib/prisma";
import {
  assertManuallyVoidable,
  assertTypeUsableForEntry,
  CashError,
  cashForbidden,
  isCashDirection,
  isManualCashMethod,
  isSystemEntry,
  MAX_COUNTERPARTY_LENGTH,
  MAX_NOTE_LENGTH,
  normalizeOptionalText,
  requireCashAmount,
  requireManualMethod,
  requireVoidReason,
  resolveOccurredAt,
  resolveTaxIncluded,
  type CashDirectionValue,
} from "./rules";
import { assertCashSessionOpen, assertEntryNotInClosedSession, resolveCashSessionId } from "./session-attach";
import { ensureSystemTypes, type CashActor } from "./types";
import { effectiveBranchScope } from "@/lib/cash/scope";

/** Branch scope: string = pinned branch, null = all branches. undefined -> derive from the actor's working branch. */
export type CashScope = string | null | undefined;

function assertCashManage(actor: CashActor) {
  if (!hasPermission(actor, "cash.manage")) throw cashForbidden();
}

export const CASH_ENTRY_SELECT = {
  id: true,
  direction: true,
  amount: true,
  method: true,
  bank: true,
  occurredAt: true,
  note: true,
  attachmentPath: true,
  taxIncluded: true,
  counterparty: true,
  orderPaymentId: true,
  orderId: true,
  settlementId: true,
  sessionId: true,
  session: { select: { closedAt: true } },
  voidedAt: true,
  voidReason: true,
  createdAt: true,
  branch: { select: { id: true, name: true } },
  type: { select: { id: true, name: true, systemKey: true } },
  customer: { select: { id: true, fullName: true } },
  createdBy: { select: { id: true, firstName: true, lastName: true } },
  voidedBy: { select: { id: true, firstName: true, lastName: true } },
} satisfies Prisma.CashTransactionSelect;

export type CashEntryRow = Prisma.CashTransactionGetPayload<{ select: typeof CASH_ENTRY_SELECT }>;

function person(user: { id: string; firstName: string; lastName: string } | null) {
  return user ? { id: user.id, name: `${user.firstName} ${user.lastName}`.trim() } : null;
}

/** Live entry in a closed session (any method). Voided or no-session (legacy) entries are never locked. */
export function isEntryLocked(entry: { voidedAt: Date | null; session?: { closedAt: Date | null } | null }): boolean {
  return entry.voidedAt == null && entry.session?.closedAt != null;
}

/** JSON shape of a ledger entry for the staff API / web UI. `orderNumber` is resolved by the list/get helpers. */
export function serializeCashEntry(entry: CashEntryRow, orderNumber: string | null = null) {
  return {
    id: entry.id,
    direction: entry.direction as CashDirectionValue,
    type: { id: entry.type.id, name: entry.type.name, systemKey: entry.type.systemKey, isSystem: entry.type.systemKey != null },
    branch: { id: entry.branch.id, name: entry.branch.name },
    amount: entry.amount.toString(),
    method: entry.method,
    methodLabel: ORDER_PAYMENT_METHOD_LABEL[entry.method as keyof typeof ORDER_PAYMENT_METHOD_LABEL] ?? entry.method,
    bank: entry.bank,
    bankLabel: entry.bank ? bankLabel(entry.bank) : null,
    occurredAt: entry.occurredAt.toISOString(),
    note: entry.note,
    attachmentPath: entry.attachmentPath,
    // «Татвар (туршилт)» — informational only, never part of any total.
    taxIncluded: entry.taxIncluded ? entry.taxIncluded.toString() : null,
    customer: entry.customer ? { id: entry.customer.id, name: entry.customer.fullName } : null,
    counterparty: entry.counterparty,
    orderId: entry.orderId,
    orderNumber,
    orderPaymentId: entry.orderPaymentId,
    settlementId: entry.settlementId,
    sessionId: entry.sessionId,
    /** true when this live entry belongs to a CLOSED cash session: it can no longer be voided/reversed (409 CASH_SESSION_ENTRY_LOCKED). */
    locked: isEntryLocked(entry),
    isSystem: isSystemEntry(entry),
    createdBy: person(entry.createdBy),
    createdAt: entry.createdAt.toISOString(),
    voidedAt: entry.voidedAt?.toISOString() ?? null,
    voidedBy: person(entry.voidedBy),
    voidReason: entry.voidReason,
  };
}

export type SerializedCashEntry = ReturnType<typeof serializeCashEntry>;

async function orderNumbers(tenantId: string, orderIds: Array<string | null>): Promise<Map<string, string>> {
  const ids = [...new Set(orderIds.filter((id): id is string => id != null))];
  if (ids.length === 0) return new Map();
  const orders = await prisma.serviceOrder.findMany({ where: { tenantId, id: { in: ids } }, select: { id: true, number: true } });
  return new Map(orders.map((o) => [o.id, o.number]));
}

async function serializeMany(tenantId: string, rows: CashEntryRow[]): Promise<SerializedCashEntry[]> {
  const numbers = await orderNumbers(tenantId, rows.map((r) => r.orderId));
  return rows.map((r) => serializeCashEntry(r, r.orderId ? numbers.get(r.orderId) ?? null : null));
}

function assertAttachmentPath(value: unknown, tenantId: string): string | null {
  if (value === undefined || value === null || value === "") return null;
  const prefix = `/uploads/cash/${tenantId}/`;
  if (typeof value !== "string" || !value.startsWith(prefix) || value.length > 300 || value.includes("..") || value.includes("\\")) {
    throw new CashError("Хавсралт буруу байна.", 422, "CASH_ATTACHMENT_INVALID", { attachmentPath: "Хавсралт буруу байна." });
  }
  return value;
}

export type CreateCashEntryInput = {
  actor: CashActor;
  scope?: CashScope;
  direction: unknown;
  typeId: unknown;
  branchId: unknown;
  amount: unknown;
  method: unknown;
  bank?: unknown;
  occurredAt?: unknown;
  note?: unknown;
  attachmentPath?: unknown;
  taxIncluded?: unknown;
  customerId?: unknown;
  counterparty?: unknown;
  now?: Date;
};

/** Manual income/expense entry. System (auto) entries are never created here. */
export async function createCashEntry(input: CreateCashEntryInput): Promise<SerializedCashEntry> {
  const { actor } = input;
  assertCashManage(actor);
  if (!isCashDirection(input.direction)) {
    throw new CashError("Чиглэл буруу.", 422, "CASH_TYPE_INVALID", { direction: "Орлого эсвэл зарлага сонгоно уу." });
  }
  const direction = input.direction;
  if (typeof input.typeId !== "string" || !input.typeId) {
    throw new CashError("Төрөл буруу байна.", 422, "CASH_TYPE_INVALID", { typeId: "Төрөл сонгоно уу." });
  }
  if (typeof input.branchId !== "string" || !input.branchId) {
    throw new CashError("Салбар сонгоно уу.", 422, "CASH_BRANCH_INVALID", { branchId: "Салбар сонгоно уу." });
  }
  const typeId = input.typeId;
  const branchId = input.branchId;
  const amount = requireCashAmount(input.amount);
  const method = requireManualMethod(input.method);
  const occurredAt = resolveOccurredAt(input.occurredAt, input.now);
  const taxIncluded = resolveTaxIncluded(direction, input.taxIncluded, amount);
  const note = normalizeOptionalText(input.note, "note", MAX_NOTE_LENGTH);
  const counterparty = normalizeOptionalText(input.counterparty, "counterparty", MAX_COUNTERPARTY_LENGTH);
  const tenantId = actor.tenantId;
  const attachmentPath = assertAttachmentPath(input.attachmentPath, tenantId);
  const customerIdRaw = input.customerId;
  if (customerIdRaw !== undefined && customerIdRaw !== null && customerIdRaw !== "" && typeof customerIdRaw !== "string") {
    throw new CashError("Харилцагч буруу байна.", 422, "CASH_FIELD_INVALID", { customerId: "Харилцагч буруу байна." });
  }
  const customerId = typeof customerIdRaw === "string" && customerIdRaw ? customerIdRaw : null;
  const scope = effectiveBranchScope(actor, input.scope);
  if (scope != null && scope !== branchId) {
    throw new CashError("Энэ салбарт бичлэг хийх эрхгүй.", 422, "CASH_BRANCH_INVALID", { branchId: "Энэ салбарт бичлэг хийх эрхгүй." });
  }

  const created = await prisma.$transaction(async (tx) => {
    const branch = await tx.branch.findFirst({ where: { id: branchId, tenantId }, select: { id: true, isActive: true } });
    if (!branch || !branch.isActive) {
      throw new CashError("Салбар олдсонгүй.", 422, "CASH_BRANCH_INVALID", { branchId: "Салбар олдсонгүй." });
    }
    await ensureSystemTypes(tx, tenantId);
    const type = await tx.cashTransactionType.findFirst({
      where: { id: typeId, tenantId },
      select: { direction: true, isActive: true, systemKey: true },
    });
    assertTypeUsableForEntry(type, direction);
    let bank: string | null = null;
    if (method === "BANK_TRANSFER" || method === "CARD") {
      const tenant = await tx.tenant.findUnique({ where: { id: tenantId }, select: { enabledBanks: true } });
      try {
        bank = assertPaymentBank(method, input.bank, tenant?.enabledBanks);
      } catch (error) {
        if (error instanceof PaymentBankError) throw new CashError(error.message, error.status, error.code, { bank: error.message });
        throw error;
      }
    }
    if (customerId) {
      const customer = await tx.customer.findFirst({ where: { id: customerId, tenantId }, select: { id: true } });
      if (!customer) throw new CashError("Харилцагч олдсонгүй.", 422, "CASH_FIELD_INVALID", { customerId: "Харилцагч олдсонгүй." });
    }
    // No register, no money write: any method needs an open session (409 CASH_SESSION_CLOSED).
    await assertCashSessionOpen(tx, tenantId, branchId);
    // Every entry (any method) attaches to the branch's open cash session (same tx).
    const sessionId = await resolveCashSessionId(tx, { tenantId, branchId, method });
    const row = await tx.cashTransaction.create({
      data: {
        tenantId,
        branchId,
        direction,
        typeId,
        amount,
        method,
        bank,
        occurredAt,
        note,
        attachmentPath,
        taxIncluded,
        customerId,
        counterparty,
        sessionId,
        createdById: actor.id,
      },
      select: CASH_ENTRY_SELECT,
    });
    await logAudit({
      tenantId,
      userId: actor.id,
      branchId,
      entity: "CashTransaction",
      entityId: row.id,
      action: "CREATE",
      summary: `${direction === "INCOME" ? "Орлого" : "Зарлага"} · ${row.type.name} · ${formatTugrik(amount.toString())}`,
      after: { direction, typeId, amount: amount.toString(), method, bank, occurredAt: occurredAt.toISOString(), taxIncluded: taxIncluded?.toString() ?? null },
    }, tx);
    return row;
  });
  return serializeCashEntry(created);
}

/** Transactional core of voidCashEntry (exported for tests): guards, closed-session lock, void, audit. */
export async function runVoidCashEntry(
  tx: PrismaTransactionClient,
  input: { actor: CashActor; scope: string | null; entryId: string; reason: string; now?: Date },
) {
  const { actor, scope, reason } = input;
  const tenantId = actor.tenantId;
  const entry = await tx.cashTransaction.findFirst({
    where: { id: input.entryId, tenantId },
    select: { id: true, branchId: true, direction: true, amount: true, voidedAt: true, orderPaymentId: true, orderId: true, settlementId: true, type: { select: { systemKey: true } } },
  });
  if (!entry || (scope != null && entry.branchId !== scope)) {
    throw new CashError("Бичлэг олдсонгүй.", 404, "CASH_ENTRY_NOT_FOUND");
  }
  assertManuallyVoidable(entry);
  // Serialise with «Касс хаах» AND require an open register: a void is a money write too (409 CASH_SESSION_CLOSED).
  await assertCashSessionOpen(tx, tenantId, entry.branchId);
  // A closed session's entries (any method) are immutable: 409 CASH_SESSION_ENTRY_LOCKED (after the Branch lock above).
  await assertEntryNotInClosedSession(tx, { id: entry.id, tenantId });
  const changed = await tx.cashTransaction.updateMany({
    where: { id: entry.id, tenantId, voidedAt: null },
    data: { voidedAt: input.now ?? new Date(), voidedById: actor.id, voidReason: reason },
  });
  if (changed.count === 0) throw new CashError("Бичлэг аль хэдийн хүчингүй болсон.", 422, "CASH_ALREADY_VOIDED");
  await logAudit({
    tenantId,
    userId: actor.id,
    branchId: entry.branchId,
    entity: "CashTransaction",
    entityId: entry.id,
    action: "UPDATE",
    summary: `Хүчингүй болгов · ${formatTugrik(entry.amount.toString())} · ${reason}`,
    before: { voided: false },
    after: { voided: true, reason },
  }, tx);
  return tx.cashTransaction.findUniqueOrThrow({ where: { id: entry.id }, select: CASH_ENTRY_SELECT });
}

/** Void (never delete/edit). Auto entries -> 422 CASH_SYSTEM_ENTRY; unknown/out-of-scope -> 404. */
export async function voidCashEntry(input: {
  actor: CashActor;
  scope?: CashScope;
  entryId: string;
  reason: unknown;
  now?: Date;
}): Promise<SerializedCashEntry> {
  const { actor } = input;
  assertCashManage(actor);
  const reason = requireVoidReason(input.reason);
  const tenantId = actor.tenantId;
  const scope = effectiveBranchScope(actor, input.scope);
  const voided = await prisma.$transaction((tx) => runVoidCashEntry(tx, { actor, scope, entryId: input.entryId, reason, now: input.now }));
  const [serialized] = await serializeMany(tenantId, [voided]);
  return serialized;
}

export type CashEntryFilters = {
  /** YYYY-MM-DD (business day, Asia/Ulaanbaatar) or an ISO instant. */
  from?: string | null;
  /** YYYY-MM-DD = through the end of that business day; ISO instant = inclusive. */
  to?: string | null;
  branchId?: string | null;
  direction?: string | null;
  typeId?: string | null;
  method?: string | null;
  bank?: string | null;
  includeVoided?: boolean;
  /** «Ээлжээс гадуур»: no cash session (any method; combine with `method` to narrow). */
  outsideSession?: boolean;
};

export function parseBound(raw: string, edge: "from" | "to", field: string): { gte?: Date; lt?: Date; lte?: Date } {
  const text = raw.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    try {
      const { start, end } = bookingDayBounds(text);
      return edge === "from" ? { gte: start } : { lt: end };
    } catch {
      throw new CashError("Огноо буруу байна.", 422, "CASH_DATE_INVALID", { [field]: "Огноо буруу байна." });
    }
  }
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) throw new CashError("Огноо буруу байна.", 422, "CASH_DATE_INVALID", { [field]: "Огноо буруу байна." });
  return edge === "from" ? { gte: date } : { lte: date };
}

/** Builds the tenant-scoped where for list + totals (voided handling is applied by the caller). */
export function buildCashEntryWhere(tenantId: string, filters: CashEntryFilters, scope: string | null): Prisma.CashTransactionWhereInput {
  const where: Prisma.CashTransactionWhereInput = { tenantId };
  if (scope != null) {
    where.branchId = scope; // pinned scope always wins over a requested branch
  } else if (filters.branchId) {
    where.branchId = filters.branchId;
  }
  if (filters.direction) {
    if (!isCashDirection(filters.direction)) throw new CashError("Чиглэл буруу.", 422, "CASH_TYPE_INVALID", { direction: "Чиглэл буруу." });
    where.direction = filters.direction;
  }
  if (filters.typeId) where.typeId = filters.typeId;
  if (filters.method) {
    if (!isManualCashMethod(filters.method) && filters.method !== "QPAY") {
      throw new CashError("Төлбөрийн арга буруу.", 422, "CASH_METHOD_INVALID", { method: "Төлбөрийн арга буруу." });
    }
    where.method = filters.method;
  }
  if (filters.outsideSession) {
    // Every method attaches to an open session now, so "no session" = legacy / system entries of any method.
    where.sessionId = null;
  }
  if (filters.bank) {
    if (!isBankCode(filters.bank)) throw new CashError("Банк буруу.", 422, "PAYMENT_BANK_NOT_ENABLED", { bank: "Банк буруу." });
    where.bank = filters.bank;
  }
  if (filters.from || filters.to) {
    const occurredAt: Prisma.DateTimeFilter = {};
    if (filters.from) Object.assign(occurredAt, parseBound(filters.from, "from", "from"));
    if (filters.to) Object.assign(occurredAt, parseBound(filters.to, "to", "to"));
    where.occurredAt = occurredAt;
  }
  return where;
}

/**
 * Entries newest-first (occurredAt desc, id desc) + totals over the SAME filters
 * that always exclude voided rows and never include taxIncluded.
 */
export async function listCashEntries(input: {
  actor: CashActor;
  scope?: CashScope;
  filters?: CashEntryFilters;
  skip?: number;
  take?: number;
}) {
  const { actor } = input;
  assertCashManage(actor);
  const tenantId = actor.tenantId;
  const filters = input.filters ?? {};
  const where = buildCashEntryWhere(tenantId, filters, effectiveBranchScope(actor, input.scope));
  const listWhere: Prisma.CashTransactionWhereInput = filters.includeVoided ? where : { ...where, voidedAt: null };
  const [rows, total, groups] = await Promise.all([
    prisma.cashTransaction.findMany({
      where: listWhere,
      orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
      skip: input.skip ?? 0,
      take: input.take ?? 50,
      select: CASH_ENTRY_SELECT,
    }),
    prisma.cashTransaction.count({ where: listWhere }),
    prisma.cashTransaction.groupBy({
      by: ["direction"],
      where: { ...where, voidedAt: null },
      _sum: { amount: true },
      _count: { _all: true },
    }),
  ]);
  const sumOf = (direction: CashDirectionValue) => groups.find((g) => g.direction === direction)?._sum.amount ?? new Prisma.Decimal(0);
  const countOf = (direction: CashDirectionValue) => groups.find((g) => g.direction === direction)?._count._all ?? 0;
  const income = new Prisma.Decimal(sumOf("INCOME").toString());
  const expense = new Prisma.Decimal(sumOf("EXPENSE").toString());
  return {
    entries: await serializeMany(tenantId, rows),
    total,
    totals: {
      income: income.toString(),
      expense: expense.toString(),
      net: income.minus(expense).toString(),
      incomeCount: countOf("INCOME"),
      expenseCount: countOf("EXPENSE"),
    },
  };
}
