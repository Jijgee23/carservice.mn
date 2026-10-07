// Postpaid settlement «Тооцоо нийлэх» (Phase C2): ONE lump-sum payment allocated
// across several postpaid orders and posted as ONE cash-ledger entry.
//
// Concurrency model (money code):
//  * create: every order row is locked FOR UPDATE one by one in ascending id
//    order (the same row lock createOrderPaymentCommand takes), so two
//    settlements — or a settlement and a single payment — can never deadlock
//    and never both see the same outstanding balance.
//  * void: the settlement row is locked first, then the
//    orders in ascending id order. Nothing takes locks in the opposite order
//    (single payment paths only ever hold ONE order lock), so no cycle exists.
// Every write below happens inside that one transaction, ledger included.
import { Prisma } from "@/app/generated/prisma/client";
import { logAudit } from "@/lib/audit";
import { assertPaymentBank, bankLabel, PaymentBankError } from "@/lib/banks";
import { hasPermission } from "@/lib/auth/roles";
import { ORDER_PAYMENT_METHOD_LABEL, POSTPAID_SETTLEMENT_FORBIDDEN_MESSAGE, formatTugrik } from "@/lib/orders";
import { recomputeOrderPaymentTotals } from "@/lib/orders/order-payment-totals";
import {
  defaultQPayCancelDeps,
  QPAY_CANCEL_FAILED_MESSAGE,
  QPAY_INVOICE_PARTIALLY_PAID_MESSAGE,
  sweepPendingQPayAtProvider,
  type QPayCancelDeps,
} from "@/lib/orders/qpay-cancel";
import { prisma, withBookingTransaction, type PrismaTransactionClient } from "@/lib/prisma";
import { CASH_ENTRY_SELECT, parseBound, serializeCashEntry } from "./ledger";
import {
  CashError,
  cashForbidden,
  MAX_CASH_AMOUNT,
  MAX_NOTE_LENGTH,
  normalizeOptionalText,
  parseCashAmount,
  requireManualMethod,
  requireVoidReason,
  resolveOccurredAt,
  VOID_REASON_SETTLEMENT_VOIDED,
  type CashManualMethod,
} from "./rules";
import { assertCashSessionOpen, assertEntryNotInClosedSession, CASH_SESSION_CLOSED_CODE, CASH_SESSION_CLOSED_MESSAGE, resolveCashSessionId } from "./session-attach";
import { getSystemTypeId, type CashActor } from "./types";
import { effectiveBranchScope } from "@/lib/cash/scope";

/** Branch scope: string = pinned branch, null = all branches. undefined -> derive from the actor's working branch. */
export type SettlementScope = string | null | undefined;

export const MAX_SETTLEMENT_ORDERS = 100;

// --- permissions ------------------------------------------------------------

/** Create/void need BOTH `orders.closeUnpaidPostpaid` (D-200) and `cash.manage`. */
export function assertSettlementPermissions(actor: CashActor): void {
  if (!hasPermission(actor, "orders.closeUnpaidPostpaid")) {
    throw new CashError(POSTPAID_SETTLEMENT_FORBIDDEN_MESSAGE, 403, "POSTPAID_SETTLEMENT_FORBIDDEN");
  }
  if (!hasPermission(actor, "cash.manage")) throw cashForbidden();
}

function assertCashManage(actor: CashActor): void {
  if (!hasPermission(actor, "cash.manage")) throw cashForbidden();
}

// --- pure rules (unit-tested) ------------------------------------------------

export type SettlementOrderRow = {
  id: string;
  number: string;
  branchId: string;
  customerId: string;
  isPostpaid: boolean;
  isInternal: boolean;
  status: string;
  totalAmount: Prisma.Decimal | null;
  completedAt: Date | null;
};

export type SettlementAllocation = {
  orderId: string;
  orderNumber: string;
  orderTotal: Prisma.Decimal;
  amount: Prisma.Decimal;
  completedAt: Date | null;
};

/** total − sum(PAID payments); never negative-looking math is hidden: callers test `.gt(0)`. */
export function computeOutstanding(total: Prisma.Decimal | null | undefined, paid: ReadonlyArray<Prisma.Decimal>): Prisma.Decimal {
  const paidSum = paid.reduce((sum, amount) => sum.plus(amount), new Prisma.Decimal(0));
  return (total ?? new Prisma.Decimal(0)).minus(paidSum);
}

export type SettlementInvalidReason =
  | "NOT_FOUND"
  | "BRANCH_MISMATCH"
  | "CUSTOMER_MISMATCH"
  | "NOT_POSTPAID"
  | "INTERNAL"
  | "NOT_COMPLETED"
  | "NO_BALANCE";

const INVALID_REASON_TEXT: Record<SettlementInvalidReason, string> = {
  NOT_FOUND: "олдсонгүй",
  BRANCH_MISMATCH: "өөр салбарынх",
  CUSTOMER_MISMATCH: "өөр үйлчлүүлэгчийнх",
  NOT_POSTPAID: "дараа төлбөрт биш",
  INTERNAL: "дотоод засвар",
  NOT_COMPLETED: "дуусаагүй",
  NO_BALANCE: "үлдэгдэлгүй",
};

export function settlementOrderInvalid(orderId: string, orderNumber: string | null, reason: SettlementInvalidReason): CashError {
  return new CashError(
    `Захиалга ${orderNumber ? `#${orderNumber} ` : ""}тооцоонд тохирохгүй: ${INVALID_REASON_TEXT[reason]}.`,
    422,
    "SETTLEMENT_ORDER_INVALID",
    { orderIds: "Тооцоонд тохирохгүй захиалга байна." },
    { orderId, reason },
  );
}

/** Why `order` cannot be part of a settlement for (branch, customer), or null when eligible. */
export function settlementIneligibleReason(
  order: SettlementOrderRow,
  outstanding: Prisma.Decimal,
  target: { branchId: string; customerId: string },
): SettlementInvalidReason | null {
  if (order.branchId !== target.branchId) return "BRANCH_MISMATCH";
  if (order.customerId !== target.customerId) return "CUSTOMER_MISMATCH";
  if (!order.isPostpaid) return "NOT_POSTPAID";
  if (order.isInternal) return "INTERNAL";
  if (order.status !== "COMPLETED") return "NOT_COMPLETED";
  if (!outstanding.gt(0)) return "NO_BALANCE";
  return null;
}

/**
 * Full-settlement allocation: each requested order pays exactly its outstanding
 * balance. Any missing/ineligible order throws SETTLEMENT_ORDER_INVALID naming it.
 * Result is in ascending order-id order (the lock order).
 */
export function allocateSettlement(
  requestedIds: readonly string[],
  orders: readonly SettlementOrderRow[],
  paidByOrder: ReadonlyMap<string, ReadonlyArray<Prisma.Decimal>>,
  target: { branchId: string; customerId: string },
): { allocations: SettlementAllocation[]; total: Prisma.Decimal } {
  const ids = [...new Set(requestedIds)].sort();
  if (ids.length === 0) throw new CashError("Тооцоонд захиалга сонгоно уу.", 422, "SETTLEMENT_EMPTY", { orderIds: "Захиалга сонгоно уу." });
  const byId = new Map(orders.map((o) => [o.id, o]));
  const allocations: SettlementAllocation[] = [];
  let total = new Prisma.Decimal(0);
  for (const id of ids) {
    const order = byId.get(id);
    if (!order) throw settlementOrderInvalid(id, null, "NOT_FOUND");
    const outstanding = computeOutstanding(order.totalAmount, paidByOrder.get(id) ?? []);
    const reason = settlementIneligibleReason(order, outstanding, target);
    if (reason) throw settlementOrderInvalid(id, order.number, reason);
    allocations.push({ orderId: id, orderNumber: order.number, orderTotal: order.totalAmount ?? new Prisma.Decimal(0), amount: outstanding, completedAt: order.completedAt });
    total = total.plus(outstanding);
  }
  if (total.gt(MAX_CASH_AMOUNT)) throw new CashError("Нийт дүн хэт их байна.", 422, "CASH_AMOUNT_INVALID", { amount: "Нийт дүн хэт их байна." });
  return { allocations, total };
}

/** Optional client `expectedAmount` (what the user saw): any difference means the view is stale -> 409. */
export function assertExpectedAmount(total: Prisma.Decimal, expectedRaw: unknown): void {
  if (expectedRaw === undefined || expectedRaw === null || expectedRaw === "") return;
  const expected = parseCashAmount(expectedRaw);
  if (!expected) throw new CashError("Дүнг зөв оруулна уу.", 422, "CASH_AMOUNT_INVALID", { expectedAmount: "Дүнг зөв оруулна уу." });
  if (!expected.equals(total)) {
    throw new CashError("Үлдэгдэл өөрчлөгдсөн байна. Дахин шалгана уу.", 409, "SETTLEMENT_AMOUNT_CHANGED", undefined, { expectedAmount: expected.toString(), actualAmount: total.toString() });
  }
}

/** A payment cannot predate the order's completion (it would read as «Шууд төлсөн»). */
export function assertOccurredAfterCompletion(allocations: ReadonlyArray<Pick<SettlementAllocation, "orderNumber" | "completedAt">>, occurredAt: Date): void {
  for (const allocation of allocations) {
    if (allocation.completedAt && occurredAt.getTime() < allocation.completedAt.getTime()) {
      throw new CashError(`Огноо захиалга #${allocation.orderNumber}-ийн дууссан огнооноос өмнө байж болохгүй.`, 422, "CASH_DATE_INVALID", { occurredAt: "Захиалга дууссанаас өмнөх огноо." });
    }
  }
}

export function parseOrderIds(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new CashError("Тооцоонд захиалга сонгоно уу.", 422, "SETTLEMENT_EMPTY", { orderIds: "Захиалга сонгоно уу." });
  }
  const ids = new Set<string>();
  for (const raw of value) {
    if (typeof raw !== "string" || !raw.trim()) throw new CashError("Захиалгын ID буруу.", 422, "CASH_FIELD_INVALID", { orderIds: "Захиалгын ID буруу." });
    ids.add(raw.trim());
  }
  if (ids.size > MAX_SETTLEMENT_ORDERS) {
    throw new CashError(`Нэг тооцоонд хамгийн ихдээ ${MAX_SETTLEMENT_ORDERS} захиалга.`, 422, "CASH_FIELD_INVALID", { orderIds: `Хамгийн ихдээ ${MAX_SETTLEMENT_ORDERS} захиалга.` });
  }
  return [...ids].sort();
}

// --- locking ------------------------------------------------------------------

type LockClient = { $queryRaw: <R = unknown>(strings: TemplateStringsArray, ...values: unknown[]) => Promise<R> };

/** FOR UPDATE on each order row, strictly ascending id, one statement per row (deterministic lock order). */
export async function lockOrdersInOrder(tx: unknown, tenantId: string, orderIds: readonly string[]): Promise<void> {
  const raw = tx as LockClient;
  for (const id of [...new Set(orderIds)].sort()) {
    await raw.$queryRaw`SELECT id FROM "ServiceOrder" WHERE id = ${id} AND "tenantId" = ${tenantId} FOR UPDATE`;
  }
}

async function lockSettlementRow(tx: unknown, tenantId: string, settlementId: string): Promise<void> {
  await (tx as LockClient).$queryRaw`SELECT id FROM "PostpaidSettlement" WHERE id = ${settlementId} AND "tenantId" = ${tenantId} FOR UPDATE`;
}

// --- serialization ------------------------------------------------------------

function person(user: { id: string; firstName: string; lastName: string } | null) {
  return user ? { id: user.id, name: `${user.firstName} ${user.lastName}`.trim() } : null;
}

const PERSON_SELECT = { select: { id: true, firstName: true, lastName: true } } as const;

const SETTLEMENT_LIST_SELECT = {
  id: true,
  amount: true,
  method: true,
  bank: true,
  createdAt: true,
  voidedAt: true,
  voidReason: true,
  branch: { select: { id: true, name: true } },
  customer: { select: { id: true, fullName: true } },
  createdBy: PERSON_SELECT,
  voidedBy: PERSON_SELECT,
  transactions: { select: CASH_ENTRY_SELECT, orderBy: { createdAt: "asc" as const }, take: 1 },
  _count: { select: { payments: true } },
} satisfies Prisma.PostpaidSettlementSelect;

const SETTLEMENT_DETAIL_SELECT = {
  id: true,
  amount: true,
  method: true,
  bank: true,
  createdAt: true,
  voidedAt: true,
  voidReason: true,
  branch: { select: { id: true, name: true } },
  customer: { select: { id: true, fullName: true } },
  createdBy: PERSON_SELECT,
  voidedBy: PERSON_SELECT,
  transactions: { select: CASH_ENTRY_SELECT, orderBy: { createdAt: "asc" as const }, take: 1 },
  payments: {
    orderBy: { createdAt: "asc" as const },
    select: {
      id: true,
      orderId: true,
      amount: true,
      status: true,
      order: { select: { id: true, number: true, plateSnapshot: true, totalAmount: true, paymentStatus: true } },
    },
  },
} satisfies Prisma.PostpaidSettlementSelect;

type SettlementListRow = Prisma.PostpaidSettlementGetPayload<{ select: typeof SETTLEMENT_LIST_SELECT }>;
type SettlementDetailRow = Prisma.PostpaidSettlementGetPayload<{ select: typeof SETTLEMENT_DETAIL_SELECT }>;

type SettlementSummaryInput = {
  id: string;
  amount: Prisma.Decimal;
  method: string;
  bank: string | null;
  createdAt: Date;
  voidedAt: Date | null;
  voidReason: string | null;
  branch: { id: string; name: string };
  customer: { id: string; fullName: string };
  createdBy: { id: string; firstName: string; lastName: string };
  voidedBy: { id: string; firstName: string; lastName: string } | null;
  transactions: ReadonlyArray<{ id: string; occurredAt: Date; note: string | null; voidedAt?: Date | null; session?: { closedAt: Date | null } | null }>;
};

function serializeSummary(row: SettlementSummaryInput, orderCount: number) {
  const entry = row.transactions[0] ?? null;
  return {
    id: row.id,
    branch: { id: row.branch.id, name: row.branch.name },
    customer: { id: row.customer.id, name: row.customer.fullName },
    amount: row.amount.toString(),
    method: row.method,
    methodLabel: ORDER_PAYMENT_METHOD_LABEL[row.method] ?? row.method,
    bank: row.bank,
    bankLabel: row.bank ? bankLabel(row.bank) : null,
    occurredAt: (entry?.occurredAt ?? row.createdAt).toISOString(),
    note: entry?.note ?? null,
    orderCount,
    entryId: entry?.id ?? null,
    /** true when the lump entry belongs to a CLOSED cash session: void is refused (409 CASH_SESSION_ENTRY_LOCKED). */
    locked: entry ? entry.voidedAt == null && entry.session?.closedAt != null : false,
    createdAt: row.createdAt.toISOString(),
    createdBy: person(row.createdBy),
    voidedAt: row.voidedAt?.toISOString() ?? null,
    voidedBy: person(row.voidedBy),
    voidReason: row.voidReason,
  };
}

export function serializeSettlementListItem(row: SettlementListRow) {
  return serializeSummary(row, row._count.payments);
}

export function serializeSettlementDetail(row: SettlementDetailRow) {
  const entry = row.transactions[0] ?? null;
  return {
    ...serializeSummary(row, row.payments.length),
    orders: row.payments.map((p) => ({
      orderId: p.orderId,
      orderNumber: p.order.number,
      plate: p.order.plateSnapshot,
      orderTotal: (p.order.totalAmount ?? new Prisma.Decimal(0)).toString(),
      orderPaymentStatus: p.order.paymentStatus,
      paymentId: p.id,
      paymentStatus: p.status,
      amount: p.amount.toString(),
    })),
    entry: entry ? serializeCashEntry(entry) : null,
  };
}

export type SerializedSettlement = ReturnType<typeof serializeSettlementDetail>;

// --- reads ----------------------------------------------------------------------

const ELIGIBLE_ORDERS_CAP = 500;

/** Postpaid COMPLETED orders of a customer in a branch that still owe money (outstanding > 0). */
export async function listEligiblePostpaidOrders(input: { actor: CashActor; scope?: SettlementScope; customerId: unknown; branchId: unknown }) {
  const { actor } = input;
  assertCashManage(actor);
  if (typeof input.customerId !== "string" || !input.customerId) throw new CashError("Харилцагч сонгоно уу.", 422, "CASH_FIELD_INVALID", { customerId: "Харилцагч сонгоно уу." });
  if (typeof input.branchId !== "string" || !input.branchId) throw new CashError("Салбар сонгоно уу.", 422, "CASH_BRANCH_INVALID", { branchId: "Салбар сонгоно уу." });
  const scope = effectiveBranchScope(actor, input.scope);
  if (scope != null && scope !== input.branchId) throw new CashError("Энэ салбарт хандах эрхгүй.", 422, "CASH_BRANCH_INVALID", { branchId: "Энэ салбарт хандах эрхгүй." });
  const rows = await prisma.serviceOrder.findMany({
    where: {
      tenantId: actor.tenantId,
      customerId: input.customerId,
      branchId: input.branchId,
      isPostpaid: true,
      isInternal: false,
      status: "COMPLETED",
      // Filter before limiting so fully paid old orders never crowd out newer unpaid ones.
      paymentStatus: { not: "PAID" },
      totalAmount: { gt: 0 },
    },
    orderBy: [{ completedAt: "asc" }, { id: "asc" }],
    take: ELIGIBLE_ORDERS_CAP + 1,
    select: {
      id: true,
      number: true,
      plateSnapshot: true,
      completedAt: true,
      totalAmount: true,
      payments: { where: { status: "PAID" }, select: { amount: true } },
    },
  });
  const truncated = rows.length > ELIGIBLE_ORDERS_CAP;
  const orders = rows
    .slice(0, ELIGIBLE_ORDERS_CAP)
    .map((row) => {
      const outstanding = computeOutstanding(row.totalAmount, row.payments.map((p) => p.amount));
      return {
        id: row.id,
        number: row.number,
        plate: row.plateSnapshot,
        completedAt: row.completedAt?.toISOString() ?? null,
        totalAmount: (row.totalAmount ?? new Prisma.Decimal(0)).toString(),
        paidAmount: row.payments.reduce((sum, p) => sum.plus(p.amount), new Prisma.Decimal(0)).toString(),
        outstanding,
      };
    })
    .filter((o) => o.outstanding.gt(0));
  const total = orders.reduce((sum, o) => sum.plus(o.outstanding), new Prisma.Decimal(0));
  return {
    orders: orders.map((o) => ({ ...o, outstanding: o.outstanding.toString() })),
    total: total.toString(),
    truncated,
  };
}

export type SettlementFilters = {
  from?: string | null;
  to?: string | null;
  branchId?: string | null;
  customerId?: string | null;
  includeVoided?: boolean;
};

export async function listSettlements(input: { actor: CashActor; scope?: SettlementScope; filters?: SettlementFilters; skip?: number; take?: number }) {
  const { actor } = input;
  assertCashManage(actor);
  const tenantId = actor.tenantId;
  const filters = input.filters ?? {};
  const scope = effectiveBranchScope(actor, input.scope);
  const where: Prisma.PostpaidSettlementWhereInput = { tenantId };
  if (scope != null) where.branchId = scope;
  else if (filters.branchId) where.branchId = filters.branchId;
  if (filters.customerId) where.customerId = filters.customerId;
  if (!filters.includeVoided) where.voidedAt = null;
  if (filters.from || filters.to) {
    const occurredAt: Prisma.DateTimeFilter = {};
    if (filters.from) Object.assign(occurredAt, parseBound(filters.from, "from", "from"));
    if (filters.to) Object.assign(occurredAt, parseBound(filters.to, "to", "to"));
    where.transactions = { some: { occurredAt } };
  }
  const [rows, total] = await Promise.all([
    prisma.postpaidSettlement.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip: input.skip ?? 0, take: input.take ?? 50, select: SETTLEMENT_LIST_SELECT }),
    prisma.postpaidSettlement.count({ where }),
  ]);
  return { settlements: rows.map(serializeSettlementListItem), total };
}

export async function getSettlement(input: { actor: CashActor; scope?: SettlementScope; settlementId: string }): Promise<SerializedSettlement> {
  const { actor } = input;
  assertCashManage(actor);
  const scope = effectiveBranchScope(actor, input.scope);
  const row = await prisma.postpaidSettlement.findFirst({ where: { id: input.settlementId, tenantId: actor.tenantId, ...(scope != null ? { branchId: scope } : {}) }, select: SETTLEMENT_DETAIL_SELECT });
  if (!row) throw new CashError("Тооцоо олдсонгүй.", 404, "SETTLEMENT_NOT_FOUND");
  return serializeSettlementDetail(row);
}

// --- create -----------------------------------------------------------------------

export type CreateSettlementInput = {
  actor: CashActor;
  scope?: SettlementScope;
  branchId: unknown;
  customerId: unknown;
  orderIds: unknown;
  method: unknown;
  bank?: unknown;
  occurredAt?: unknown;
  note?: unknown;
  expectedAmount?: unknown;
  now?: Date;
};

type ParsedCreate = {
  tenantId: string;
  actorId: string;
  branchId: string;
  customerId: string;
  orderIds: string[];
  method: CashManualMethod;
  bankInput: unknown;
  occurredAt: Date;
  note: string | null;
  expectedAmount: unknown;
  /** Pending QPay payments already cancelled at the QPay provider by `providerCancelSettlementQPay` (see there). */
  providerCancelledPaymentIds?: readonly string[];
};

/**
 * Provider pre-step for settlement create. The settlement locally cancels every pending QPay invoice of the settled
 * orders, so each one is cancelled at QPay FIRST — here, OUTSIDE any DB transaction (external call). Only orders that
 * belong to this branch/customer and are postpaid are touched (the tx re-validates everything).
 *  - an invoice that turned out PAID is confirmed (existing confirm path) and the settlement aborts with the existing
 *    409 SETTLEMENT_AMOUNT_CHANGED so the user reloads;
 *  - partial money -> 409 QPAY_INVOICE_PARTIALLY_PAID; provider failure -> 502 QPAY_CANCEL_FAILED.
 * Returns the ids it cancelled at the provider.
 */
export async function providerCancelSettlementQPay(
  input: { tenantId: string; actorId: string; branchId: string; customerId: string; orderIds: string[] },
  deps?: QPayCancelDeps,
): Promise<string[]> {
  const pending = await prisma.orderPayment.findMany({
    where: {
      tenantId: input.tenantId,
      orderId: { in: input.orderIds },
      method: "QPAY",
      status: "PENDING",
      qpayInvoiceId: { not: null },
      order: { branchId: input.branchId, customerId: input.customerId, isPostpaid: true },
    },
    select: { id: true, orderId: true, amount: true, qpayInvoiceId: true },
  });
  if (pending.length === 0) return [];
  const sweep = await sweepPendingQPayAtProvider(
    { tenantId: input.tenantId, userId: input.actorId, branchId: input.branchId, payments: pending },
    deps ??
      defaultQPayCancelDeps(async (paymentId) => {
        // Existing confirm path (lazy: server-only module).
        const { confirmOrderQPayPayment } = await import("@/lib/order-payments");
        const r = await confirmOrderQPayPayment(input.tenantId, input.actorId, paymentId);
        return r.ok && r.paid;
      }),
  );
  if (sweep.paid.length > 0) throw new CashError("Үлдэгдэл өөрчлөгдсөн байна. Дахин шалгана уу.", 409, "SETTLEMENT_AMOUNT_CHANGED");
  if (sweep.partial.length > 0) throw new CashError(QPAY_INVOICE_PARTIALLY_PAID_MESSAGE, 409, "QPAY_INVOICE_PARTIALLY_PAID");
  if (sweep.failed.length > 0) throw new CashError(QPAY_CANCEL_FAILED_MESSAGE, 502, "QPAY_CANCEL_FAILED");
  return sweep.cancellable;
}

/** The transactional core; `tx` must be a transaction client already bound to the tenant. Exported for tests. */
export async function runCreateSettlement(txIn: unknown, input: ParsedCreate): Promise<string> {
  const tx = txIn as PrismaTransactionClient;
  const { tenantId } = input;
  await lockOrdersInOrder(tx, tenantId, input.orderIds);

  const branch = await tx.branch.findFirst({ where: { id: input.branchId, tenantId }, select: { id: true, isActive: true } });
  if (!branch || !branch.isActive) throw new CashError("Салбар олдсонгүй.", 422, "CASH_BRANCH_INVALID", { branchId: "Салбар олдсонгүй." });
  // No register, no settlement (any method): 409 CASH_SESSION_CLOSED.
  await assertCashSessionOpen(tx, tenantId, input.branchId);
  const customer = await tx.customer.findFirst({ where: { id: input.customerId, tenantId }, select: { id: true } });
  if (!customer) throw new CashError("Харилцагч олдсонгүй.", 422, "CASH_FIELD_INVALID", { customerId: "Харилцагч олдсонгүй." });

  const orders = await tx.serviceOrder.findMany({
    where: { tenantId, id: { in: input.orderIds } },
    select: { id: true, number: true, branchId: true, customerId: true, isPostpaid: true, isInternal: true, status: true, totalAmount: true, completedAt: true },
  });
  const paidRows = await tx.orderPayment.findMany({ where: { tenantId, orderId: { in: input.orderIds }, status: "PAID" }, select: { orderId: true, amount: true } });
  const paidByOrder = new Map<string, Prisma.Decimal[]>();
  for (const row of paidRows) paidByOrder.set(row.orderId, [...(paidByOrder.get(row.orderId) ?? []), row.amount]);

  const { allocations, total } = allocateSettlement(input.orderIds, orders, paidByOrder, { branchId: input.branchId, customerId: input.customerId });
  assertExpectedAmount(total, input.expectedAmount);
  assertOccurredAfterCompletion(allocations, input.occurredAt);

  let bank: string | null = null;
  if (input.method === "BANK_TRANSFER" || input.method === "CARD") {
    const tenant = await tx.tenant.findUnique({ where: { id: tenantId }, select: { enabledBanks: true } });
    try {
      bank = assertPaymentBank(input.method, input.bankInput, tenant?.enabledBanks);
    } catch (error) {
      if (error instanceof PaymentBankError) throw new CashError(error.message, error.status, error.code, { bank: error.message });
      throw error;
    }
  }

  const typeId = await getSystemTypeId(tx, tenantId, "POSTPAID_SETTLEMENT");
  const settlement = await tx.postpaidSettlement.create({
    data: { tenantId, branchId: input.branchId, customerId: input.customerId, amount: total, method: input.method, bank, createdById: input.actorId },
    select: { id: true },
  });
  // A pending QPay invoice must not later add a second payment on a now-settled order (same as the single-payment path).
  // Every invoice was cancelled at QPay before this tx (providerCancelSettlementQPay); one that appeared since is still
  // live at the provider, so abort rather than cancel it locally.
  const livePending = await tx.orderPayment.findMany({ where: { tenantId, orderId: { in: input.orderIds }, method: "QPAY", status: "PENDING" }, select: { id: true, qpayInvoiceId: true } });
  const handled = new Set(input.providerCancelledPaymentIds ?? []);
  if (livePending.some((row) => row.qpayInvoiceId && !handled.has(row.id))) {
    throw new CashError("Үлдэгдэл өөрчлөгдсөн байна. Дахин шалгана уу.", 409, "SETTLEMENT_AMOUNT_CHANGED");
  }
  await tx.orderPayment.updateMany({ where: { tenantId, orderId: { in: input.orderIds }, method: "QPAY", status: "PENDING" }, data: { status: "CANCELLED" } });
  for (const allocation of allocations) {
    await tx.orderPayment.create({
      data: { tenantId, orderId: allocation.orderId, amount: allocation.amount, method: input.method, status: "PAID", paidAt: input.occurredAt, bank, settlementId: settlement.id },
      select: { id: true },
    });
    await recomputeOrderPaymentTotals(tx, tenantId, { id: allocation.orderId, totalAmount: allocation.orderTotal });
  }
  // ONE ledger entry for the whole settlement. The per-payment hook (postPaymentIncome) is deliberately not
  // used: these payments carry settlementId and the lump entry below is their only income record.
  // Phase C3: a CASH settlement attaches to the branch's open cash session (same tx).
  const sessionId = await resolveCashSessionId(tx, { tenantId, branchId: input.branchId, method: input.method });
  await tx.cashTransaction.create({
    data: {
      tenantId,
      branchId: input.branchId,
      direction: "INCOME",
      typeId,
      amount: total,
      method: input.method,
      bank,
      occurredAt: input.occurredAt,
      note: input.note,
      customerId: input.customerId,
      settlementId: settlement.id,
      sessionId,
      createdById: input.actorId,
    },
    select: { id: true },
  });
  await logAudit({
    tenantId,
    userId: input.actorId,
    branchId: input.branchId,
    entity: "PostpaidSettlement",
    entityId: settlement.id,
    action: "PAYMENT_CHANGE",
    summary: `Дараа тооцоо · ${allocations.length} захиалга · ${formatTugrik(total.toString())}`,
    after: { amount: total.toString(), method: input.method, bank, customerId: input.customerId, orders: allocations.map((a) => ({ orderId: a.orderId, number: a.orderNumber, amount: a.amount.toString() })) },
  }, tx);
  return settlement.id;
}

export async function createPostpaidSettlement(input: CreateSettlementInput): Promise<SerializedSettlement> {
  const { actor } = input;
  assertSettlementPermissions(actor);
  if (typeof input.branchId !== "string" || !input.branchId) throw new CashError("Салбар сонгоно уу.", 422, "CASH_BRANCH_INVALID", { branchId: "Салбар сонгоно уу." });
  if (typeof input.customerId !== "string" || !input.customerId) throw new CashError("Харилцагч сонгоно уу.", 422, "CASH_FIELD_INVALID", { customerId: "Харилцагч сонгоно уу." });
  const orderIds = parseOrderIds(input.orderIds);
  const method = requireManualMethod(input.method);
  const occurredAt = resolveOccurredAt(input.occurredAt, input.now);
  const note = normalizeOptionalText(input.note, "note", MAX_NOTE_LENGTH);
  const scope = effectiveBranchScope(actor, input.scope);
  if (scope != null && scope !== input.branchId) throw new CashError("Энэ салбарт бичлэг хийх эрхгүй.", 422, "CASH_BRANCH_INVALID", { branchId: "Энэ салбарт бичлэг хийх эрхгүй." });
  // Early refusal BEFORE any provider-side QPay cancel (the authoritative, locked check is inside runCreateSettlement).
  if (!(await prisma.cashSession.findFirst({ where: { tenantId: actor.tenantId, branchId: input.branchId, closedAt: null }, select: { id: true } }))) {
    throw new CashError(CASH_SESSION_CLOSED_MESSAGE, 409, CASH_SESSION_CLOSED_CODE);
  }
  const providerCancelledPaymentIds = await providerCancelSettlementQPay({ tenantId: actor.tenantId, actorId: actor.id, branchId: input.branchId, customerId: input.customerId, orderIds });
  const settlementId = await withBookingTransaction(actor.tenantId, (tx) =>
    runCreateSettlement(tx, {
      providerCancelledPaymentIds,
      tenantId: actor.tenantId,
      actorId: actor.id,
      branchId: input.branchId as string,
      customerId: input.customerId as string,
      orderIds,
      method,
      bankInput: input.bank,
      occurredAt,
      note,
      expectedAmount: input.expectedAmount,
    }),
  );
  return getSettlement({ actor, scope: input.scope, settlementId });
}

// --- void --------------------------------------------------------------------------

/** The transactional core of void. Exported for tests. */
export async function runVoidSettlement(txIn: unknown, input: { tenantId: string; actorId: string; settlementId: string; scope: string | null; reason: string; now?: Date }): Promise<void> {
  const tx = txIn as PrismaTransactionClient;
  const { tenantId } = input;
  await lockSettlementRow(tx, tenantId, input.settlementId);
  const settlement = await tx.postpaidSettlement.findFirst({
    where: { id: input.settlementId, tenantId },
    select: {
      id: true,
      branchId: true,
      amount: true,
      voidedAt: true,
      payments: { where: { status: "PAID" }, select: { id: true, orderId: true } },
      transactions: { select: { id: true, voidedAt: true } },
    },
  });
  if (!settlement || (input.scope != null && settlement.branchId !== input.scope)) throw new CashError("Тооцоо олдсонгүй.", 404, "SETTLEMENT_NOT_FOUND");
  if (settlement.voidedAt) throw new CashError("Тооцоо аль хэдийн цуцлагдсан.", 422, "SETTLEMENT_ALREADY_VOIDED");
  const orderIds = [...new Set(settlement.payments.map((p) => p.orderId))];
  await lockOrdersInOrder(tx, tenantId, orderIds);
  // Serialise with «Касс хаах» (order locks first, then the shared branch lock) and require an open register (409 CASH_SESSION_CLOSED).
  await assertCashSessionOpen(tx, tenantId, settlement.branchId);
  // A closed session's lump entry (any method) is immutable: 409 CASH_SESSION_ENTRY_LOCKED.
  await assertEntryNotInClosedSession(tx, { tenantId, settlementId: settlement.id });
  const now = input.now ?? new Date();
  await tx.postpaidSettlement.update({ where: { id: settlement.id }, data: { voidedAt: now, voidedById: input.actorId, voidReason: input.reason } });
  await tx.orderPayment.updateMany({ where: { tenantId, settlementId: settlement.id, status: "PAID" }, data: { status: "CANCELLED" } });
  const orders = await tx.serviceOrder.findMany({ where: { tenantId, id: { in: orderIds } }, select: { id: true, totalAmount: true } });
  for (const order of [...orders].sort((a, b) => (a.id < b.id ? -1 : 1))) {
    await recomputeOrderPaymentTotals(tx, tenantId, order);
  }
  await tx.cashTransaction.updateMany({
    where: { tenantId, settlementId: settlement.id, voidedAt: null },
    data: { voidedAt: now, voidedById: input.actorId, voidReason: VOID_REASON_SETTLEMENT_VOIDED },
  });
  await logAudit({
    tenantId,
    userId: input.actorId,
    branchId: settlement.branchId,
    entity: "PostpaidSettlement",
    entityId: settlement.id,
    action: "PAYMENT_CHANGE",
    summary: `Тооцоо цуцлав · ${formatTugrik(settlement.amount.toString())} · ${input.reason}`,
    before: { voided: false },
    after: { voided: true, reason: input.reason, paymentIds: settlement.payments.map((p) => p.id) },
  }, tx);
}

export async function voidPostpaidSettlement(input: { actor: CashActor; scope?: SettlementScope; settlementId: string; reason: unknown; now?: Date }): Promise<SerializedSettlement> {
  const { actor } = input;
  assertSettlementPermissions(actor);
  const reason = requireVoidReason(input.reason);
  const scope = effectiveBranchScope(actor, input.scope);
  await withBookingTransaction(actor.tenantId, (tx) =>
    runVoidSettlement(tx, { tenantId: actor.tenantId, actorId: actor.id, settlementId: input.settlementId, scope, reason, now: input.now }),
  );
  return getSettlement({ actor, scope: input.scope, settlementId: input.settlementId });
}
