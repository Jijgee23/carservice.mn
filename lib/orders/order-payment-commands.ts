import { Prisma } from "@/app/generated/prisma/client";
import { logAudit } from "@/lib/audit";
import { canEditOrder, canViewOrder, type OrderAccessUser } from "@/lib/auth/order-access";
import { assertPostpaidSettlementAllowed, isOrderBranchInScope, OrderCommandError, type OrderCommandScope } from "@/lib/orders/order-commands";
import {
  ORDER_PAYMENT_METHODS,
  ORDER_PAYMENT_METHOD_LABEL,
  formatTugrik,
  type OrderPaymentMethod,
} from "@/lib/orders";
import { internalNoPaymentViolation } from "@/lib/orders/order-internal";
import { withOrderTransaction } from "@/lib/order-time-booking";
import { paidLedger, recomputeOrderPaymentTotals } from "@/lib/orders/order-payment-totals";

export { recomputeOrderPaymentTotals };
import { prisma, type PrismaTransactionClient } from "@/lib/prisma";
import { TenantQPayService } from "@/lib/qpay-tenant";
import { QPAY_IN_TX_FETCH_TIMEOUT_MS, withQPayTimeout } from "@/lib/qpay-core";
import { createNotification } from "@/lib/notifications";
import { BANK_REF_SELECT, bankRef, PaymentAccountError, resolvePaymentAccount } from "@/lib/payment-accounts";
import { assertCashSessionOpen, assertEntryNotInClosedSession, CASH_SESSION_CLOSED_CODE, CASH_SESSION_CLOSED_MESSAGE, CASH_SESSION_ENTRY_LOCKED_CODE, CASH_SESSION_ENTRY_LOCKED_MESSAGE, findLockedPaymentIds } from "@/lib/cash/session-attach";
import { postPaymentIncome, voidPaymentIncome } from "@/lib/cash/sync";
import { creditQPayPaymentInTx, qpayCreditBlockMessage } from "@/lib/orders/qpay-credit";
import {
  defaultQPayCancelDeps,
  QPAY_CANCEL_FAILED_MESSAGE,
  QPAY_INVOICE_PARTIALLY_PAID_MESSAGE,
  QPAY_PREVIOUS_PAID_MESSAGE,
  sweepPendingQPayAtProvider,
  type QPayCancelSweep,
} from "@/lib/orders/qpay-cancel";

export type OrderPaymentCommandActor = OrderAccessUser & {
  tenantId: string;
  branchId?: string | null;
  assignableBranchIds?: string[];
  workingBranchId?: string | null;
};

export type AnyOrderPaymentMethod = OrderPaymentMethod | "OTHER";

export class OrderPaymentCommandError extends OrderCommandError {
  constructor(message: string, status = 422, code = "ORDER_PAYMENT_REJECTED", fieldErrors?: Record<string, string>) {
    super(message, status, code, fieldErrors);
    this.name = "OrderPaymentCommandError";
  }
}

export const MAX_PAYMENT_AMOUNT = new Prisma.Decimal("9999999999.99");

/**
 * QPay's client currently accepts a number even though order amounts are
 * decimal values. Keep that lossy boundary in one place and reject values
 * that cannot round-trip through the provider's number API exactly.
 */
export function decimalToQPayAmount(value: Prisma.Decimal): number {
  if (!value.isFinite() || value.lte(0) || value.gt(MAX_PAYMENT_AMOUNT) || value.decimalPlaces() > 2) {
    throw new OrderPaymentCommandError("Дүнг зөв оруулна уу.", 422, "PAYMENT_AMOUNT_INVALID", { amount: "Дүнг зөв оруулна уу." });
  }
  const numeric = Number(value.toString());
  if (!Number.isFinite(numeric) || new Prisma.Decimal(numeric.toString()).comparedTo(value) !== 0) {
    throw new OrderPaymentCommandError("QPay дүнгийн формат дэмжигдэхгүй байна.", 422, "QPAY_AMOUNT_UNSUPPORTED");
  }
  return numeric;
}

export function parseOrderPaymentAmount(value: unknown): Prisma.Decimal | null {
  if (value instanceof Prisma.Decimal) return value.isFinite() && value.gt(0) && value.lte(MAX_PAYMENT_AMOUNT) && value.decimalPlaces() <= 2 ? value : null;
  if (typeof value !== "string") return null;
  const raw = value.trim().replace(/[\s,]/g, "");
  if (!/^\d+(?:\.\d{1,2})?$/.test(raw)) return null;
  try {
    const amount = new Prisma.Decimal(raw);
    return amount.isFinite() && amount.gt(0) && amount.lte(MAX_PAYMENT_AMOUNT) ? amount : null;
  } catch {
    return null;
  }
}

/**
 * QPay invoice amount: missing/blank = the whole remaining balance. Otherwise
 * a positive 2-dp decimal that must not exceed the remaining balance.
 */
export function resolveQPayInvoiceAmount(requested: unknown, remaining: Prisma.Decimal): Prisma.Decimal {
  if (requested === undefined || requested === null || (typeof requested === "string" && requested.trim() === "")) return remaining;
  const amount = parseOrderPaymentAmount(requested);
  if (!amount) throw new OrderPaymentCommandError("Дүн буруу байна.", 422, "QPAY_AMOUNT_INVALID");
  if (amount.gt(remaining)) throw new OrderPaymentCommandError("Дүн үлдэгдлээс их байж болохгүй.", 422, "QPAY_AMOUNT_EXCEEDS");
  return amount;
}

export function isOrderPaymentMethod(value: unknown): value is AnyOrderPaymentMethod {
  return value === "OTHER" || (typeof value === "string" && (ORDER_PAYMENT_METHODS as readonly string[]).includes(value));
}

type LockedPaymentOrder = {
  id: string;
  number: string;
  branchId: string;
  assignedToId: string | null;
  status: string;
  isPostpaid: boolean;
  isInternal: boolean;
  totalAmount: Prisma.Decimal | null;
  appointment: { id: string; accountId: string | null; status: string } | null;
  customer: { fullName: string; phone: string };
};

const PAYMENT_ORDER_SELECT = {
  id: true,
  number: true,
  branchId: true,
  assignedToId: true,
  status: true,
  isPostpaid: true,
  isInternal: true,
  totalAmount: true,
  appointment: { select: { id: true, accountId: true, status: true } },
  customer: { select: { fullName: true, phone: true } },
} satisfies Prisma.ServiceOrderSelect;

export const ORDER_CANCELLED_PAYMENT_MESSAGE = "Цуцлагдсан засварын хуудсанд төлбөр бүртгэх боломжгүй.";

/** New money (cash/card/transfer payment or QPay invoice) is never recorded against a CANCELLED order: 409 ORDER_CANCELLED. */
export function assertOrderOpenForPayment(order: Pick<LockedPaymentOrder, "status">) {
  if (order.status === "CANCELLED") throw new OrderPaymentCommandError(ORDER_CANCELLED_PAYMENT_MESSAGE, 409, "ORDER_CANCELLED");
}

/** resolvePaymentAccount with PaymentAccountError mapped to the command error (shared by the pre-step validate and the tx). */
async function resolveAccountOrThrow(tx: PrismaTransactionClient, tenantId: string, method: AnyOrderPaymentMethod, bank: string | null | undefined) {
  try {
    return await resolvePaymentAccount(tx, tenantId, method, bank);
  } catch (error) {
    if (error instanceof PaymentAccountError) throw new OrderPaymentCommandError(error.message, error.status, error.code, { bank: error.message });
    throw error;
  }
}

export function assertPaymentAccess(
  actor: OrderPaymentCommandActor,
  order: Pick<LockedPaymentOrder, "branchId" | "assignedToId" | "status" | "isPostpaid" | "isInternal">,
  scope: OrderCommandScope,
) {
  if (!isOrderBranchInScope(actor, order.branchId, scope)) {
    throw new OrderPaymentCommandError("Зөвхөн өөрийн салбарын засварын хуудсыг удирдана.", 404, "ORDER_OUT_OF_SCOPE");
  }
  if (!canEditOrder(actor, order)) {
    throw new OrderPaymentCommandError("Танд энэ төлбөрийг засах эрх байхгүй.", 403, "ORDER_EDIT_FORBIDDEN");
  }
  // Дотоод засвар: төлбөр бүртгэхгүй (record/reverse/QPay бүгд).
  const internalViolation = internalNoPaymentViolation(order);
  if (internalViolation) {
    throw new OrderPaymentCommandError(internalViolation.message, internalViolation.status, internalViolation.code);
  }
  // Дууссан дараа тооцоот захиалгын төлбөр: orders.closeUnpaidPostpaid (owner implicit).
  try {
    assertPostpaidSettlementAllowed(actor, order);
  } catch (error) {
    if (error instanceof OrderCommandError) throw new OrderPaymentCommandError(error.message, error.status, error.code);
    throw error;
  }
}


/**
 * LOCAL cancel of an order's pending QPay payments (inside the order-locked tx).
 * It only moves rows whose provider invoice was already cancelled/verified gone
 * by `sweepPendingQPayAtProvider` (`providerCancelledIds`) or that never had an
 * invoice. A pending row with an invoice that is NOT in `providerCancelledIds`
 * (appeared after the provider pre-step, or could not be cancelled) stays PENDING
 * so the local record keeps matching QPay.
 */
/** User-initiated money write needs an open register at the order's branch (409 CASH_SESSION_CLOSED). Call inside the order tx. */
async function assertOrderRegisterOpen(tx: PrismaTransactionClient, tenantId: string, branchId: string) {
  await assertCashSessionOpen(tx, tenantId, branchId, () => new OrderPaymentCommandError(CASH_SESSION_CLOSED_MESSAGE, 409, CASH_SESSION_CLOSED_CODE));
}

/**
 * Closed-session lock for a user reverse (any method): 409 CASH_SESSION_ENTRY_LOCKED. Call inside the order tx AFTER
 * assertOrderRegisterOpen (order row lock, then Branch lock), so it cannot race «Касс хаах».
 */
export async function assertPaymentsNotInClosedSession(tx: PrismaTransactionClient, tenantId: string, paymentIds: readonly string[]) {
  if (paymentIds.length === 0) return;
  await assertEntryNotInClosedSession(
    tx,
    { tenantId, orderPaymentId: { in: [...paymentIds] } },
    () => new OrderPaymentCommandError(CASH_SESSION_ENTRY_LOCKED_MESSAGE, 409, CASH_SESSION_ENTRY_LOCKED_CODE),
  );
}

async function cancelPendingQPay(tx: PrismaTransactionClient, tenantId: string, orderId: string, providerCancelledIds: readonly string[]) {
  await tx.orderPayment.updateMany({
    where: {
      tenantId,
      orderId,
      method: "QPAY",
      status: "PENDING",
      OR: [{ qpayInvoiceId: null }, { id: { in: [...providerCancelledIds] } }],
    },
    data: { status: "CANCELLED" },
  });
}

const PENDING_QPAY_SELECT = { id: true, orderId: true, amount: true, qpayInvoiceId: true } satisfies Prisma.OrderPaymentSelect;

/** Wire the provider-cancel helper to the existing confirm path ("Шалгах"), recording the payment and notifying the customer. */
function qpayCancelDepsFor(actor: OrderPaymentCommandActor, orderId: string, scope: OrderCommandScope) {
  return defaultQPayCancelDeps(async (paymentId) => {
    // siblings "keep": a confirm triggered from inside a provider sweep must not itself cancel other pending invoices.
    let result;
    try {
      result = await confirmOrderQPayPaymentCommand({ actor, orderId, paymentId, scope, siblings: "keep" });
    } catch (e) {
      // Blocked credit (cancelled order / overpayment): the row is FAILED now, so the sweep must not report "paid".
      if (e instanceof OrderPaymentCommandError && e.code === "QPAY_ORDER_CANCELLED") return { blocked: "ORDER_CANCELLED" as const };
      if (e instanceof OrderPaymentCommandError && e.code === "QPAY_OVERPAYMENT") return { blocked: "OVERPAYMENT" as const };
      throw e;
    }
    if (!result.paid) return false;
    if (result.newlyPaid) await notifyOrderPaymentReceived({ tenantId: actor.tenantId, orderId: result.orderId, amount: result.amount, accountId: result.accountId, appointmentId: result.appointmentId });
    return true;
  });
}

type ProviderCancelBlock = { paidCode?: string; paidMessage?: string };

/** Map a sweep with any non-cancellable payment to the spec'd command errors. paid > partial > failed. */
function assertSweepAllowsLocalCancel(sweep: QPayCancelSweep, block: ProviderCancelBlock = {}) {
  if (sweep.paid.length > 0) {
    throw new OrderPaymentCommandError(block.paidMessage ?? "QPay нэхэмжлэх төлөгдсөн байна. Төлбөрийн мэдээллийг шалгана уу.", 409, block.paidCode ?? "QPAY_INVOICE_PAID");
  }
  if (sweep.partial.length > 0) throw new OrderPaymentCommandError(QPAY_INVOICE_PARTIALLY_PAID_MESSAGE, 409, "QPAY_INVOICE_PARTIALLY_PAID");
  if (sweep.failed.length > 0) throw new OrderPaymentCommandError(QPAY_CANCEL_FAILED_MESSAGE, 502, "QPAY_CANCEL_FAILED");
}

/**
 * Provider pre-step for EVERY local cancel of an order's pending QPay payments.
 * 1) preflight tx (access check + optional validation + list pending) — so a user
 *    without rights can never trigger a provider cancel;
 * 2) QPay calls, OUTSIDE any transaction.
 * The caller then cancels locally in its own tx via `cancelPendingQPay(..., sweep.cancellable)`.
 */
async function providerCancelPendingQPay(input: {
  actor: OrderPaymentCommandActor;
  orderId: string;
  scope?: OrderCommandScope;
  excludePaymentId?: string;
  validate?: (tx: PrismaTransactionClient, order: LockedPaymentOrder) => Promise<void>;
  /** Narrow the pending set to sweep (default: all pending QPay payments of the order). */
  selectPending?: <T extends { id: string; amount: Prisma.Decimal }>(rows: T[]) => T[];
}): Promise<QPayCancelSweep> {
  const preflight = await withOrderTransaction(input.actor.tenantId, input.orderId, PAYMENT_ORDER_SELECT, async (tx, raw) => {
    const order = raw as LockedPaymentOrder | null;
    if (!order) throw new OrderPaymentCommandError("Засварын хуудас олдсонгүй.", 404, "ORDER_NOT_FOUND");
    assertPaymentAccess(input.actor, order, input.scope);
    if (input.validate) await input.validate(tx, order);
    const pending = await tx.orderPayment.findMany({
      where: { tenantId: input.actor.tenantId, orderId: order.id, method: "QPAY", status: "PENDING", ...(input.excludePaymentId ? { id: { not: input.excludePaymentId } } : {}) },
      select: PENDING_QPAY_SELECT,
    });
    return { branchId: order.branchId, pending: input.selectPending ? input.selectPending(pending) : pending };
  });
  if (preflight.pending.length === 0) return { cancellable: [], paid: [], blocked: [], partial: [], failed: [] };
  return sweepPendingQPayAtProvider(
    { tenantId: input.actor.tenantId, userId: input.actor.id, branchId: preflight.branchId, payments: preflight.pending },
    qpayCancelDepsFor(input.actor, input.orderId, input.scope),
  );
}

export type RecordedOrderPayment = {
  id: string;
  amount: string;
  method: string;
  status: string;
  paidAt: Date | null;
  createdAt: Date;
};

/** Shared select for payment rows returned to web/staff API (bank). */
export const PAYMENT_LEDGER_SELECT = {
  id: true,
  amount: true,
  method: true,
  status: true,
  paidAt: true,
  createdAt: true,
  bankId: true,
  bankAccount: { select: BANK_REF_SELECT },
  settlementId: true,
} satisfies Prisma.OrderPaymentSelect;

type LedgerPaymentRow = Prisma.OrderPaymentGetPayload<{ select: typeof PAYMENT_LEDGER_SELECT }>;

/** JSON shape of a payment row for the staff API (and mobile). */
export function serializeLedgerPayment(payment: LedgerPaymentRow, locked = false) {
  return {
    id: payment.id,
    amount: payment.amount.toString(),
    method: payment.method,
    status: payment.status,
    paidAt: payment.paidAt?.toISOString() ?? null,
    createdAt: payment.createdAt.toISOString(),
    ...bankRef(payment.bankAccount),
    settlementId: payment.settlementId,
    /** true when the payment's ledger entry is in a CLOSED cash session: reverse is refused (409 CASH_SESSION_ENTRY_LOCKED). */
    locked,
  };
}

/**
 * A payment closed by a postpaid settlement (Phase C2) can only be reversed
 * through its settlement — one lump ledger entry stands behind all
 * of the settlement's payments, so touching one in isolation would desync it.
 */
export function assertNotSettlementPayment(payments: ReadonlyArray<{ settlementId?: string | null }>) {
  if (payments.some((p) => p.settlementId != null)) {
    throw new OrderPaymentCommandError("Нэгдсэн тооцооны төлбөрийг тооцоогоор нь цуцална уу.", 422, "SETTLEMENT_PAYMENT_LOCKED");
  }
}

export function applyTender(
  method: string,
  tendered: Prisma.Decimal,
  remaining: Prisma.Decimal,
  allowCashChange: boolean,
): { applied: Prisma.Decimal; change: Prisma.Decimal } | null {
  if (tendered.lte(remaining)) return { applied: tendered, change: new Prisma.Decimal(0) };
  if (method !== "CASH" || !allowCashChange) return null;
  return { applied: remaining, change: tendered.minus(remaining) };
}

export const MAX_PAYMENT_NOTE_LENGTH = 1000;

/** Trim; empty -> null; over MAX_PAYMENT_NOTE_LENGTH -> 422. */
export function normalizePaymentNote(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length > MAX_PAYMENT_NOTE_LENGTH) {
    throw new OrderPaymentCommandError(`Тайлбар ${MAX_PAYMENT_NOTE_LENGTH} тэмдэгтээс хэтрэхгүй байх ёстой.`, 422, "PAYMENT_NOTE_TOO_LONG", { note: "Тайлбар хэт урт байна." });
  }
  return trimmed;
}

export async function createOrderPaymentCommand(input: {
  actor: OrderPaymentCommandActor;
  orderId: string;
  method: AnyOrderPaymentMethod;
  amount: Prisma.Decimal | null;
  bank?: string | null;
  scope?: OrderCommandScope;
  /**
   * Cash tender above the balance is applied up to the balance with change. Deliberately web-only (the dashboard
   * server action passes true, cashier flow); the /payments and /payment API routes stay strict and answer 422
   * PAYMENT_OVERPAYMENT (spec: 2026-10-01 QA low-severity #26).
   */
  allowCashChange?: boolean;
  /** Optional description (trimmed, max 1000) stored on the auto-posted income CashTransaction.note. */
  note?: string | null;
}) {
  const note = normalizePaymentNote(input.note);
  if (input.amount && (!input.amount.isFinite() || input.amount.lte(0) || input.amount.gt(MAX_PAYMENT_AMOUNT) || input.amount.decimalPlaces() > 2)) {
    throw new OrderPaymentCommandError("Дүнг зөв оруулна уу.", 422, "PAYMENT_AMOUNT_INVALID", { amount: "Дүнг зөв оруулна уу." });
  }
  // Provider pre-step: this payment locally cancels the order's pending QPay invoices, so
  // cancel them at QPay first (outside any tx). Validation runs first so a rejected payment
  // does not kill a live QR.
  const providerSweep = await providerCancelPendingQPay({
    actor: input.actor,
    orderId: input.orderId,
    scope: input.scope,
    validate: async (tx, order) => {
      assertOrderOpenForPayment(order); // before any provider-side QPay cancel
      await assertOrderRegisterOpen(tx, input.actor.tenantId, order.branchId); // before any provider-side QPay cancel
      const ledger = await paidLedger(tx, input.actor.tenantId, order.id);
      const remaining = (order.totalAmount ?? new Prisma.Decimal(0)).minus(ledger.paid);
      if (remaining.lte(0)) throw new OrderPaymentCommandError("Энэ захиалга бүрэн төлөгдсөн байна.", 422, "PAYMENT_ALREADY_PAID");
      if (!applyTender(input.method, input.amount ?? remaining, remaining, input.allowCashChange ?? false)) {
        throw new OrderPaymentCommandError(`Дүн үлдэгдэл (${formatTugrik(remaining.toString())})-ээс их байж болохгүй.`, 422, "PAYMENT_OVERPAYMENT", { amount: "Үлдэгдлээс их байна." });
      }
      // The account is validated BEFORE the provider cancel too, so a rejected account never kills a live QR.
      await resolveAccountOrThrow(tx, input.actor.tenantId, input.method, input.bank);
    },
  });
  assertSweepAllowsLocalCancel(providerSweep);
  const result = await withOrderTransaction(input.actor.tenantId, input.orderId, PAYMENT_ORDER_SELECT, async (tx, raw) => {
    const order = raw as LockedPaymentOrder | null;
    if (!order) throw new OrderPaymentCommandError("Засварын хуудас олдсонгүй.", 404, "ORDER_NOT_FOUND");
    assertPaymentAccess(input.actor, order, input.scope);
    assertOrderOpenForPayment(order);
    await assertOrderRegisterOpen(tx, input.actor.tenantId, order.branchId);
    const ledger = await paidLedger(tx, input.actor.tenantId, order.id);
    const total = order.totalAmount ?? new Prisma.Decimal(0);
    const remaining = total.minus(ledger.paid);
    if (remaining.lte(0)) throw new OrderPaymentCommandError("Энэ захиалга бүрэн төлөгдсөн байна.", 422, "PAYMENT_ALREADY_PAID");
    const tender = applyTender(input.method, input.amount ?? remaining, remaining, input.allowCashChange ?? false);
    if (!tender) {
      throw new OrderPaymentCommandError(`Дүн үлдэгдэл (${formatTugrik(remaining.toString())})-ээс их байж болохгүй.`, 422, "PAYMENT_OVERPAYMENT", { amount: "Үлдэгдлээс их байна." });
    }
    const amount = tender.applied;
    const paidAt = new Date();
    const account = await resolveAccountOrThrow(tx, input.actor.tenantId, input.method, input.bank);
    const bankId = account?.id ?? null;
    const payment = await tx.orderPayment.create({
      data: { tenantId: input.actor.tenantId, orderId: order.id, amount, method: input.method, status: "PAID", paidAt, bankId },
      select: PAYMENT_LEDGER_SELECT,
    });
    // Cash ledger: this payment is PAID from birth -> income entry, same transaction.
    await postPaymentIncome(tx, {
      tenantId: input.actor.tenantId,
      actorId: input.actor.id,
      payment: { id: payment.id, orderId: order.id, amount: payment.amount, method: payment.method, bankId: payment.bankId, paidAt: payment.paidAt },
      note,
    });
    await cancelPendingQPay(tx, input.actor.tenantId, order.id, providerSweep.cancellable);
    const totals = await recomputeOrderPaymentTotals(tx, input.actor.tenantId, order);
    await logAudit({
      tenantId: input.actor.tenantId,
      userId: input.actor.id,
      branchId: order.branchId,
      entity: "ServiceOrder",
      entityId: order.id,
      action: "PAYMENT_CHANGE",
      summary: `${ORDER_PAYMENT_METHOD_LABEL[input.method]}${account ? ` (${account.name})` : ""} · ${formatTugrik(amount.toString())} бүртгэв`,
      after: { paymentId: payment.id, method: input.method, bankId, amount: amount.toString(), paidAmount: totals.paid.toString(), paymentStatus: totals.status },
    }, tx);
    return { payment, orderId: order.id, accountId: order.appointment?.accountId ?? null, appointmentId: order.appointment?.id ?? null, totals, change: tender.change };
  });
  return result;
}

export async function reverseOrderPaymentCommand(input: {
  actor: OrderPaymentCommandActor;
  orderId?: string;
  paymentId: string;
  scope?: OrderCommandScope;
}) {
  const resolvedOrderId = input.orderId ?? (await prisma.orderPayment.findFirst({
    where: { id: input.paymentId, tenantId: input.actor.tenantId },
    select: { orderId: true },
  }))?.orderId;
  if (!resolvedOrderId) throw new OrderPaymentCommandError("Төлбөр олдсонгүй.", 404, "PAYMENT_NOT_FOUND");
  // Provider pre-step (reversal also locally cancels the order's pending QPay invoices).
  const providerSweep = await providerCancelPendingQPay({
    actor: input.actor,
    orderId: resolvedOrderId,
    scope: input.scope,
    validate: async (tx, order) => {
      await assertOrderRegisterOpen(tx, input.actor.tenantId, order.branchId); // before any provider-side QPay cancel
      const payment = await tx.orderPayment.findFirst({
        where: { id: input.paymentId, tenantId: input.actor.tenantId, orderId: resolvedOrderId, status: "PAID" },
        select: { settlementId: true },
      });
      if (!payment) throw new OrderPaymentCommandError("Төлбөр олдсонгүй эсвэл аль хэдийн цуцлагдсан байна.", 404, "PAYMENT_NOT_FOUND");
      assertNotSettlementPayment([payment]);
      await assertPaymentsNotInClosedSession(tx, input.actor.tenantId, [input.paymentId]); // before any provider-side QPay cancel
    },
  });
  assertSweepAllowsLocalCancel(providerSweep);
  return withOrderTransaction(input.actor.tenantId, resolvedOrderId, {
    ...PAYMENT_ORDER_SELECT,
  }, async (tx, raw) => {
    const order = raw as LockedPaymentOrder | null;
    if (!order) throw new OrderPaymentCommandError("Засварын хуудас олдсонгүй.", 404, "ORDER_NOT_FOUND");
    assertPaymentAccess(input.actor, order, input.scope);
    await assertOrderRegisterOpen(tx, input.actor.tenantId, order.branchId);
    const payment = await tx.orderPayment.findFirst({
      where: { id: input.paymentId, tenantId: input.actor.tenantId, orderId: resolvedOrderId, status: "PAID" },
      select: { id: true, amount: true, method: true, settlementId: true },
    });
    if (!payment) throw new OrderPaymentCommandError("Төлбөр олдсонгүй эсвэл аль хэдийн цуцлагдсан байна.", 404, "PAYMENT_NOT_FOUND");
    assertNotSettlementPayment([payment]);
    await assertPaymentsNotInClosedSession(tx, input.actor.tenantId, [payment.id]);
    await tx.orderPayment.update({ where: { id: payment.id }, data: { status: "CANCELLED" } });
    await voidPaymentIncome(tx, { tenantId: input.actor.tenantId, actorId: input.actor.id, paymentIds: [payment.id] });
    await cancelPendingQPay(tx, input.actor.tenantId, order.id, providerSweep.cancellable);
    const totals = await recomputeOrderPaymentTotals(tx, input.actor.tenantId, order);
    await logAudit({
      tenantId: input.actor.tenantId,
      userId: input.actor.id,
      branchId: order.branchId,
      entity: "ServiceOrder",
      entityId: order.id,
      action: "PAYMENT_CHANGE",
      summary: `${ORDER_PAYMENT_METHOD_LABEL[payment.method] ?? payment.method} · ${formatTugrik(payment.amount.toString())} бүртгэлийг цуцлав`,
      after: { paymentId: payment.id, status: "CANCELLED", paidAmount: totals.paid.toString(), paymentStatus: totals.status },
    }, tx);
    return { paymentId: payment.id, orderId: order.id, totals };
  });
}

/** Legacy adapter support: clear the aggregate by reversing every paid ledger
 * row in one locked transaction. The mobile row-level endpoint intentionally
 * remains stricter and reverses exactly one payment. */
export async function reverseAllOrderPaymentsCommand(input: {
  actor: OrderPaymentCommandActor;
  orderId: string;
  scope?: OrderCommandScope;
}) {
  // Provider pre-step (clearing the aggregate also locally cancels the order's pending QPay invoices).
  const providerSweep = await providerCancelPendingQPay({
    actor: input.actor,
    orderId: input.orderId,
    scope: input.scope,
    validate: async (tx, order) => {
      await assertOrderRegisterOpen(tx, input.actor.tenantId, order.branchId); // before any provider-side QPay cancel
      // One locked payment rejects the whole call (nothing is reversed, no provider-side cancel).
      const paidIds = await tx.orderPayment.findMany({ where: { tenantId: input.actor.tenantId, orderId: order.id, status: "PAID" }, select: { id: true, settlementId: true } });
      assertNotSettlementPayment(paidIds); // before any provider-side QPay cancel
      await assertPaymentsNotInClosedSession(tx, input.actor.tenantId, paidIds.map((p) => p.id));
    },
  });
  assertSweepAllowsLocalCancel(providerSweep);
  return withOrderTransaction(input.actor.tenantId, input.orderId, PAYMENT_ORDER_SELECT, async (tx, raw) => {
    const order = raw as LockedPaymentOrder | null;
    if (!order) throw new OrderPaymentCommandError("Засварын хуудас олдсонгүй.", 404, "ORDER_NOT_FOUND");
    assertPaymentAccess(input.actor, order, input.scope);
    await assertOrderRegisterOpen(tx, input.actor.tenantId, order.branchId);
    const paid = await tx.orderPayment.findMany({ where: { tenantId: input.actor.tenantId, orderId: order.id, status: "PAID" }, select: { id: true, amount: true, settlementId: true } });
    assertNotSettlementPayment(paid);
    await assertPaymentsNotInClosedSession(tx, input.actor.tenantId, paid.map((p) => p.id));
    if (paid.length > 0) {
      await tx.orderPayment.updateMany({ where: { tenantId: input.actor.tenantId, orderId: order.id, status: "PAID" }, data: { status: "CANCELLED" } });
      await voidPaymentIncome(tx, { tenantId: input.actor.tenantId, actorId: input.actor.id, paymentIds: paid.map((p) => p.id) });
    }
    await cancelPendingQPay(tx, input.actor.tenantId, order.id, providerSweep.cancellable);
    const totals = await recomputeOrderPaymentTotals(tx, input.actor.tenantId, order);
    await logAudit({ tenantId: input.actor.tenantId, userId: input.actor.id, branchId: order.branchId, entity: "ServiceOrder", entityId: order.id, action: "PAYMENT_CHANGE", summary: "Бүх төлбөрийн бүртгэлийг цуцлав", after: { paymentIds: paid.map((payment) => payment.id), paidAmount: totals.paid.toString(), paymentStatus: totals.status } }, tx);
    return { orderId: order.id, totals };
  });
}

export async function listOrderPaymentsCommand(input: { actor: OrderPaymentCommandActor; orderId: string; scope?: OrderCommandScope }) {
  const order = await prisma.serviceOrder.findFirst({
    where: { id: input.orderId, tenantId: input.actor.tenantId },
    select: { id: true, branchId: true, assignedToId: true },
  });
  if (!order) throw new OrderPaymentCommandError("Засварын хуудас олдсонгүй.", 404, "ORDER_NOT_FOUND");
  if (!isOrderBranchInScope(input.actor, order.branchId, input.scope) || !canViewOrder(input.actor, order)) {
    throw new OrderPaymentCommandError("Танд энэ төлбөрийг харах эрх байхгүй.", 403, "ORDER_VIEW_FORBIDDEN");
  }
  const rows = await prisma.orderPayment.findMany({ where: { tenantId: input.actor.tenantId, orderId: order.id }, orderBy: { createdAt: "desc" }, select: { ...PAYMENT_LEDGER_SELECT, qpayInvoiceId: true, qrImage: true, qrText: true, qpayUrls: true } });
  const lockedIds = await findLockedPaymentIds(prisma, input.actor.tenantId, rows.map((r) => r.id));
  return rows.map((r) => ({ ...r, locked: lockedIds.has(r.id) }));
}

export async function createOrderQPayInvoiceCommand(input: { actor: OrderPaymentCommandActor; orderId: string; amount?: string | null; scope?: OrderCommandScope }) {
  // Provider pre-step: a pending invoice of a DIFFERENT amount is replaced, so cancel it at QPay first
  // (outside any tx). If it turns out it was paid, abort without creating a new invoice.
  let wantedAmount: Prisma.Decimal | null = null;
  const staleSweep = await providerCancelPendingQPay({
    actor: input.actor,
    orderId: input.orderId,
    scope: input.scope,
    validate: async (tx, order) => {
      assertOrderOpenForPayment(order); // before any provider-side QPay cancel
      await assertOrderRegisterOpen(tx, input.actor.tenantId, order.branchId); // before any provider-side QPay cancel
      const ledger = await paidLedger(tx, input.actor.tenantId, order.id);
      const remaining = (order.totalAmount ?? new Prisma.Decimal(0)).minus(ledger.paid);
      if (remaining.lte(0)) throw new OrderPaymentCommandError("Үлдэгдэл байхгүй.", 422, "PAYMENT_ALREADY_PAID");
      wantedAmount = resolveQPayInvoiceAmount(input.amount, remaining);
    },
    // Only invoices that will be replaced (amount differs) are cancelled; an equal-amount one is reused as-is.
    selectPending: (rows) => rows.filter((row) => wantedAmount !== null && !row.amount.equals(wantedAmount)),
  });
  assertSweepAllowsLocalCancel(staleSweep, { paidCode: "QPAY_PREVIOUS_PAID", paidMessage: QPAY_PREVIOUS_PAID_MESSAGE });
  return withOrderTransaction(input.actor.tenantId, input.orderId, PAYMENT_ORDER_SELECT, async (tx, raw) => {
    const order = raw as LockedPaymentOrder | null;
    if (!order) throw new OrderPaymentCommandError("Засварын хуудас олдсонгүй.", 404, "ORDER_NOT_FOUND");
    assertPaymentAccess(input.actor, order, input.scope);
    assertOrderOpenForPayment(order);
    await assertOrderRegisterOpen(tx, input.actor.tenantId, order.branchId);
    const ledger = await paidLedger(tx, input.actor.tenantId, order.id);
    const total = order.totalAmount ?? new Prisma.Decimal(0);
    const remaining = total.minus(ledger.paid);
    if (remaining.lte(0)) throw new OrderPaymentCommandError("Үлдэгдэл байхгүй.", 422, "PAYMENT_ALREADY_PAID");
    const invoiceAmount = resolveQPayInvoiceAmount(input.amount, remaining);
    const pending = await tx.orderPayment.findFirst({ where: { tenantId: input.actor.tenantId, orderId: order.id, method: "QPAY", status: "PENDING" }, orderBy: { createdAt: "desc" }, select: { id: true, amount: true, qpayInvoiceId: true, qrImage: true, qrText: true, qpayUrls: true } });
    if (pending && pending.amount.equals(invoiceAmount) && pending.qpayInvoiceId) {
      let urls = Array.isArray(pending.qpayUrls) ? pending.qpayUrls : [];
      if (urls.length === 0) {
        urls = (await withQPayTimeout(QPAY_IN_TX_FETCH_TIMEOUT_MS, () => TenantQPayService.getInvoiceUrls(input.actor.tenantId, pending.qpayInvoiceId!))) ?? [];
        if (urls.length > 0) await tx.orderPayment.update({ where: { id: pending.id }, data: { qpayUrls: urls } });
      }
      return { id: pending.id, amount: pending.amount.toString(), qrImage: pending.qrImage ?? null, qrText: pending.qrText ?? null, urls };
    }
    // Never cancel locally what was not cancelled at QPay first (a pending invoice that appeared after the provider pre-step).
    if (pending && pending.qpayInvoiceId && !staleSweep.cancellable.includes(pending.id)) {
      throw new OrderPaymentCommandError("QPay нэхэмжлэхийн төлөв өөрчлөгдлөө. Дахин оролдоно уу.", 409, "QPAY_PENDING_CHANGED");
    }
    if (pending) await tx.orderPayment.updateMany({ where: { id: pending.id, tenantId: input.actor.tenantId, status: "PENDING" }, data: { status: "CANCELLED" } });
    const payment = await tx.orderPayment.create({ data: { tenantId: input.actor.tenantId, orderId: order.id, amount: invoiceAmount, method: "QPAY", status: "PENDING" }, select: { id: true, amount: true, qpayInvoiceId: true, qrImage: true, qrText: true, qpayUrls: true } });
    // Deliberately NOT moved out of the tx: the provider invoice must be created under the same
    // order-row lock as the local pending row, otherwise a concurrent manual payment/cancel could
    // slip between "pending row exists" and "invoice attached" and leave a live invoice that no
    // local row guards (the exact overpayment race this lock closes). The tx timeout is 15s, so every
    // QPay call in here runs with a 4s per-call limit (QPAY_IN_TX_FETCH_TIMEOUT_MS; token + invoice + urls
    // <= 12s). A timed-out create returns QPAY_ERROR and rolls the local pending row back.
    const invoice = await withQPayTimeout(QPAY_IN_TX_FETCH_TIMEOUT_MS, () => TenantQPayService.createInvoice({ tenantId: input.actor.tenantId, senderInvoiceNo: payment.id, invoiceReceiverCode: order.customer.fullName || order.customer.phone, invoiceDescription: `Засварын хуудас #${order.number}`, amount: decimalToQPayAmount(invoiceAmount) }));
    if ("error" in invoice) {
      console.warn("[orders/qpay] invoice creation failed");
      // QPay can only cancel by invoice_id (no lookup by sender_invoice_no), so a create that timed out after QPay
      // accepted it cannot be cancelled here. Record the possible orphan (outside the tx, which is about to roll back).
      await logAudit({ tenantId: input.actor.tenantId, userId: input.actor.id, branchId: order.branchId, entity: "ServiceOrder", entityId: order.id, action: "PAYMENT_CHANGE", summary: `QPay нэхэмжлэх үүсгэх алдаа (QPay талд үлдсэн байж болзошгүй) · sender_invoice_no ${payment.id}`, after: { senderInvoiceNo: payment.id, amount: invoiceAmount.toString() } }).catch(() => undefined);
      throw new OrderPaymentCommandError("QPay үйлчилгээ түр ажиллахгүй байна. Дахин оролдоно уу.", 502, "QPAY_ERROR");
    }
    let urls = Array.isArray(invoice.urls) ? invoice.urls : [];
    if (urls.length === 0) urls = (await withQPayTimeout(QPAY_IN_TX_FETCH_TIMEOUT_MS, () => TenantQPayService.getInvoiceUrls(input.actor.tenantId, invoice.invoice_id))) ?? [];
    const updated = await tx.orderPayment.update({ where: { id: payment.id }, data: { qpayInvoiceId: invoice.invoice_id, qrText: invoice.qr_text, qrImage: invoice.qr_image, qpayUrls: urls.length > 0 ? urls : Prisma.JsonNull }, select: { id: true, amount: true, qrImage: true, qrText: true } });
    await logAudit({ tenantId: input.actor.tenantId, userId: input.actor.id, branchId: order.branchId, entity: "ServiceOrder", entityId: order.id, action: "PAYMENT_CHANGE", summary: `QPay QR үүсгэв · ${formatTugrik(invoiceAmount.toString())}`, after: { paymentId: payment.id, amount: invoiceAmount.toString() } }, tx);
    return { id: updated.id, amount: updated.amount.toString(), qrImage: updated.qrImage ?? null, qrText: updated.qrText ?? null, urls };
  });
}

export type OrderQPayConfirmResult =
  | { paid: true; newlyPaid: boolean; orderId: string; paymentId: string; amount: string; accountId: string | null; appointmentId: string | null }
  | { paid: false; message?: string };

export async function confirmOrderQPayPaymentCommand(input: {
  actor: OrderPaymentCommandActor;
  orderId?: string;
  paymentId: string;
  scope?: OrderCommandScope;
  /** "cancel" (default): after confirming, other pending QPay invoices of the order are cancelled (provider first, best-effort).
   *  "keep": used when this confirm runs INSIDE a provider sweep; never touches sibling invoices. */
  siblings?: "cancel" | "keep";
}): Promise<OrderQPayConfirmResult> {
  const resolvedOrderId = input.orderId ?? (await prisma.orderPayment.findFirst({ where: { id: input.paymentId, tenantId: input.actor.tenantId }, select: { orderId: true } }))?.orderId;
  if (!resolvedOrderId) throw new OrderPaymentCommandError("Төлбөр олдсонгүй.", 404, "PAYMENT_NOT_FOUND");
  const preflight = await withOrderTransaction(input.actor.tenantId, resolvedOrderId, PAYMENT_ORDER_SELECT, async (tx, raw) => {
    const order = raw as LockedPaymentOrder | null;
    if (!order) throw new OrderPaymentCommandError("Засварын хуудас олдсонгүй.", 404, "ORDER_NOT_FOUND");
    assertPaymentAccess(input.actor, order, input.scope);
    const payment = await tx.orderPayment.findFirst({ where: { id: input.paymentId, tenantId: input.actor.tenantId, orderId: order.id }, select: { id: true, amount: true, method: true, status: true, qpayInvoiceId: true } });
    if (!payment) throw new OrderPaymentCommandError("Төлбөр олдсонгүй.", 404, "PAYMENT_NOT_FOUND");
    if (payment.method !== "QPAY") throw new OrderPaymentCommandError("Энэ нь QPay төлбөр биш байна.", 422, "QPAY_PAYMENT_REQUIRED");
    return { order, payment };
  });
  // Sibling pending invoices: provider-cancel first (outside any tx). Best-effort here: this payment IS paid and must be
  // recorded, so a sibling that cannot be cancelled at QPay (failed/partial) is simply left PENDING instead of blocking.
  const cancelSiblingsAtProvider = async (): Promise<string[]> =>
    input.siblings === "keep" ? [] : (await providerCancelPendingQPay({ actor: input.actor, orderId: resolvedOrderId, scope: input.scope, excludePaymentId: input.paymentId })).cancellable;
  if (preflight.payment.status === "PAID") {
    const siblingsCancellable = await cancelSiblingsAtProvider();
    const confirmedPayment = await withOrderTransaction(input.actor.tenantId, resolvedOrderId, PAYMENT_ORDER_SELECT, async (tx, raw) => {
      const order = raw as LockedPaymentOrder | null;
      if (!order) throw new OrderPaymentCommandError("Засварын хуудас олдсонгүй.", 404, "ORDER_NOT_FOUND");
      assertPaymentAccess(input.actor, order, input.scope);
      const fresh = await tx.orderPayment.findFirst({ where: { id: input.paymentId, tenantId: input.actor.tenantId, orderId: order.id }, select: { id: true, amount: true, method: true, status: true } });
      if (!fresh) throw new OrderPaymentCommandError("Төлбөр олдсонгүй.", 404, "PAYMENT_NOT_FOUND");
      if (fresh.method !== "QPAY") throw new OrderPaymentCommandError("Энэ нь QPay төлбөр биш байна.", 422, "QPAY_PAYMENT_REQUIRED");
      if (fresh.status !== "PAID") throw new OrderPaymentCommandError("QPay төлбөрийн төлөв зэрэгцээ өөрчлөгдлөө.", 409, "QPAY_PAYMENT_RACE");
      await cancelPendingQPay(tx, input.actor.tenantId, order.id, siblingsCancellable);
      return { amount: fresh.amount };
    });
    return { paid: true, newlyPaid: false, orderId: resolvedOrderId, paymentId: input.paymentId, amount: confirmedPayment.amount.toString(), accountId: preflight.order.appointment?.accountId ?? null, appointmentId: preflight.order.appointment?.id ?? null };
  }
  if (preflight.payment.status !== "PENDING") throw new OrderPaymentCommandError("Энэ QPay төлбөр хүлээгдэж буй төлөвт биш байна.", 422, "QPAY_PAYMENT_NOT_PENDING");
  if (!preflight.payment.qpayInvoiceId) throw new OrderPaymentCommandError("QPay invoice байхгүй.", 422, "QPAY_INVOICE_MISSING");
  const check = await TenantQPayService.checkPaymentExact(input.actor.tenantId, preflight.payment.qpayInvoiceId, preflight.payment.amount.toString());
  if ("error" in check) {
    console.warn("[orders/qpay] payment check failed");
    throw new OrderPaymentCommandError("QPay төлбөр шалгахад алдаа гарлаа. Дахин оролдоно уу.", 502, "QPAY_ERROR");
  }
  const paidAmount = new Prisma.Decimal(check.paidAmount);
  if (!check.paid) return { paid: false, message: paidAmount.gt(0) ? "Төлбөр бүрэн төлөгдөөгүй байна. Дахин шалгана уу." : "Төлбөр төлөгдөөгүй байна." };
  if (paidAmount.lt(preflight.payment.amount)) return { paid: false, message: "Төлбөр бүрэн төлөгдөөгүй байна. Дахин шалгана уу." };
  const finalSiblingsCancellable = await cancelSiblingsAtProvider();
  const result = await withOrderTransaction(input.actor.tenantId, resolvedOrderId, PAYMENT_ORDER_SELECT, async (tx, raw) => {
    const order = raw as LockedPaymentOrder | null;
    if (!order) throw new OrderPaymentCommandError("Засварын хуудас олдсонгүй.", 404, "ORDER_NOT_FOUND");
    assertPaymentAccess(input.actor, order, input.scope);
    const fresh = await tx.orderPayment.findFirst({ where: { id: input.paymentId, tenantId: input.actor.tenantId, orderId: order.id }, select: { id: true, amount: true, method: true, status: true } });
    if (!fresh) throw new OrderPaymentCommandError("Төлбөр олдсонгүй.", 404, "PAYMENT_NOT_FOUND");
    if (fresh.method !== "QPAY") throw new OrderPaymentCommandError("Энэ нь QPay төлбөр биш байна.", 422, "QPAY_PAYMENT_REQUIRED");
    if (fresh.status === "PAID") {
      await cancelPendingQPay(tx, input.actor.tenantId, order.id, finalSiblingsCancellable);
      return { blocked: null, already: true, amount: fresh.amount };
    }
    if (fresh.status !== "PENDING") throw new OrderPaymentCommandError("Энэ QPay төлбөр хүлээгдэж буй төлөвт биш байна.", 409, "QPAY_PAYMENT_RACE");
    // Shared with the legacy confirm (lib/orders/qpay-credit.ts): a cancelled order / overpay is not credited,
    // the row moves to FAILED (not left PENDING, which would block every sweep) and is flagged once in the audit log.
    const credit = await creditQPayPaymentInTx(tx, {
      tenantId: input.actor.tenantId,
      actorId: input.actor.id,
      order,
      payment: fresh,
      qpayPaymentId: check.paymentId,
      paidAt: check.paidAt ?? new Date(),
    });
    await cancelPendingQPay(tx, input.actor.tenantId, order.id, finalSiblingsCancellable);
    if (!credit.credited) return { blocked: credit.reason, already: false, amount: fresh.amount };
    return { blocked: null, already: false, amount: fresh.amount };
  });
  if (result.blocked) {
    throw result.blocked === "ORDER_CANCELLED"
      ? new OrderPaymentCommandError(qpayCreditBlockMessage("ORDER_CANCELLED"), 409, "QPAY_ORDER_CANCELLED")
      : new OrderPaymentCommandError(qpayCreditBlockMessage("OVERPAYMENT"), 409, "QPAY_OVERPAYMENT");
  }
  return { paid: true, newlyPaid: !result.already, orderId: resolvedOrderId, paymentId: input.paymentId, amount: result.amount.toString(), accountId: preflight.order.appointment?.accountId ?? null, appointmentId: preflight.order.appointment?.id ?? null };
}

/**
 * Post-commit sweep after an order was cancelled or its total was reduced: pending QPay invoices that would now
 * overpay (amount > remaining; every invoice when the order is CANCELLED) are cancelled at QPay first, then
 * locally. Best-effort and never throws: the order change already committed, and a customer who still pays a
 * stale QR is caught by the remaining/CANCELLED guard in `confirmOrderQPayPaymentCommand` (not credited, flagged).
 * It runs after the commit (not inside the order tx) because provider calls must stay outside any transaction.
 */
export async function sweepStaleOrderQPayCommand(input: { actor: OrderPaymentCommandActor; orderId: string; scope?: OrderCommandScope }): Promise<void> {
  try {
    // Cheap pre-check: no pending QPay row means nothing to sweep, so skip the locked preflight transaction.
    const pendingCount = await prisma.orderPayment.count({ where: { orderId: input.orderId, tenantId: input.actor.tenantId, method: "QPAY", status: "PENDING" } });
    if (pendingCount === 0) return;
    const state = { remaining: null as Prisma.Decimal | null };
    const sweep = await providerCancelPendingQPay({
      actor: input.actor,
      orderId: input.orderId,
      scope: input.scope,
      validate: async (tx, order) => {
        if (order.status === "CANCELLED") {
          state.remaining = new Prisma.Decimal(0);
          return;
        }
        const ledger = await paidLedger(tx, input.actor.tenantId, order.id);
        state.remaining = (order.totalAmount ?? new Prisma.Decimal(0)).minus(ledger.paid);
      },
      selectPending: (rows) => rows.filter((row) => state.remaining !== null && (state.remaining.lte(0) || row.amount.gt(state.remaining))),
    });
    if (sweep.cancellable.length === 0) return;
    await withOrderTransaction(input.actor.tenantId, input.orderId, PAYMENT_ORDER_SELECT, async (tx, raw) => {
      const order = raw as LockedPaymentOrder | null;
      if (!order) return;
      await cancelPendingQPay(tx, input.actor.tenantId, order.id, sweep.cancellable);
    });
  } catch (error) {
    console.warn("[orders/qpay] stale invoice sweep failed:", error instanceof Error ? error.name : "UnknownError");
  }
}

export async function cancelOrderQPayPaymentCommand(input: { actor: OrderPaymentCommandActor; orderId?: string; paymentId: string; scope?: OrderCommandScope }) {
  const resolvedOrderId = input.orderId ?? (await prisma.orderPayment.findFirst({ where: { id: input.paymentId, tenantId: input.actor.tenantId }, select: { orderId: true } }))?.orderId;
  if (!resolvedOrderId) throw new OrderPaymentCommandError("Төлбөр олдсонгүй.", 404, "PAYMENT_NOT_FOUND");
  // Preflight (access + the payment is a pending QPay one), then the provider cancel OUTSIDE any tx.
  const preflight = await withOrderTransaction(input.actor.tenantId, resolvedOrderId, PAYMENT_ORDER_SELECT, async (tx, raw) => {
    const order = raw as LockedPaymentOrder | null;
    if (!order) throw new OrderPaymentCommandError("Засварын хуудас олдсонгүй.", 404, "ORDER_NOT_FOUND");
    assertPaymentAccess(input.actor, order, input.scope);
    const payment = await tx.orderPayment.findFirst({ where: { id: input.paymentId, tenantId: input.actor.tenantId, orderId: order.id, status: "PENDING", method: "QPAY" }, select: PENDING_QPAY_SELECT });
    if (!payment) {
      const existing = await tx.orderPayment.findFirst({ where: { id: input.paymentId, tenantId: input.actor.tenantId, orderId: order.id, method: "QPAY" }, select: { id: true } });
      if (existing) throw new OrderPaymentCommandError("Энэ QPay төлбөр хүлээгдэж буй төлөвт биш байна.", 409, "QPAY_PAYMENT_NOT_PENDING");
      throw new OrderPaymentCommandError("Хүлээгдэж буй QPay төлбөр олдсонгүй.", 404, "PAYMENT_NOT_FOUND");
    }
    return { branchId: order.branchId, payment };
  });
  const sweep = await sweepPendingQPayAtProvider(
    { tenantId: input.actor.tenantId, userId: input.actor.id, branchId: preflight.branchId, payments: [preflight.payment] },
    qpayCancelDepsFor(input.actor, resolvedOrderId, input.scope),
  );
  assertSweepAllowsLocalCancel(sweep, { paidCode: "QPAY_INVOICE_PAID", paidMessage: "Энэ QPay нэхэмжлэх төлөгдсөн байна. Төлбөрийг бүртгэлээ шалгана уу." });
  if (sweep.blocked.length > 0) {
    // The QR was paid at QPay but could not be credited (row is FAILED now): not a race. Reason comes from the locked confirm.
    const reason = sweep.blockedReasons?.[preflight.payment.id] ?? "OVERPAYMENT";
    throw new OrderPaymentCommandError(qpayCreditBlockMessage(reason), 409, reason === "ORDER_CANCELLED" ? "QPAY_ORDER_CANCELLED" : "QPAY_OVERPAYMENT");
  }
  return withOrderTransaction(input.actor.tenantId, resolvedOrderId, PAYMENT_ORDER_SELECT, async (tx, raw) => {
    const order = raw as LockedPaymentOrder | null;
    if (!order) throw new OrderPaymentCommandError("Засварын хуудас олдсонгүй.", 404, "ORDER_NOT_FOUND");
    assertPaymentAccess(input.actor, order, input.scope);
    const payment = preflight.payment;
    // Conditional: only a row still PENDING moves (a concurrent confirm/cancel wins otherwise).
    const moved = await tx.orderPayment.updateMany({ where: { id: payment.id, tenantId: input.actor.tenantId, orderId: order.id, method: "QPAY", status: "PENDING" }, data: { status: "CANCELLED" } });
    if (moved.count === 0) throw new OrderPaymentCommandError("QPay төлбөрийн төлөв зэрэгцээ өөрчлөгдлөө.", 409, "QPAY_PAYMENT_RACE");
    await logAudit({ tenantId: input.actor.tenantId, userId: input.actor.id, branchId: order.branchId, entity: "ServiceOrder", entityId: order.id, action: "PAYMENT_CHANGE", summary: `QPay QR цуцлав · ${formatTugrik(payment.amount.toString())}`, after: { paymentId: payment.id, amount: payment.amount.toString(), status: "CANCELLED" } }, tx);
    return { orderId: order.id, paymentId: payment.id };
  });
}

export async function notifyOrderPaymentReceived(input: { tenantId: string; orderId: string; amount: string; accountId?: string | null; appointmentId?: string | null }) {
  if (!input.accountId || !input.appointmentId) return;
  try {
    await createNotification({ type: "order_payment_received", tenantId: input.tenantId, recipient: { accountId: input.accountId }, input: { orderId: input.orderId, appointmentId: input.appointmentId, amount: input.amount } });
  } catch (error) {
    console.warn("[notify] order_payment_received:", error instanceof Error ? error.name : "UnknownError");
  }
}
