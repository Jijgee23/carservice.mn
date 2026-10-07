// Ledger sync hooks. Every function takes the caller's transaction client so the
// ledger entry commits (or rolls back) together with the payment / order change
// that caused it. Call them while the order row lock (withOrderTransaction) is
// held — that is what makes "at most one live entry per order" race-free.
import type { Prisma } from "@/app/generated/prisma/client";
import type { PrismaTransactionClient } from "@/lib/prisma";
import { getSystemTypeId } from "./types";
import { VOID_REASON_PAYMENT_REVERSED } from "./rules";
import { lockBranchShared, resolveCashSessionId } from "./session-attach";

export type PaymentForLedger = {
  id: string;
  orderId: string;
  amount: Prisma.Decimal;
  method: string;
  bank: string | null;
  paidAt: Date | null;
  /** Payments closed by a postpaid settlement are posted as one lump entry (Phase C2) — skipped here. */
  settlementId?: string | null;
};

/**
 * A payment just became PAID -> one INCOME entry (type ORDER_PAYMENT) copying
 * amount/method/bank, branch + customer from the order,
 * occurredAt = paidAt. Idempotent via the unique orderPaymentId (ON CONFLICT
 * DO NOTHING, so a repeat never aborts the surrounding transaction).
 * Returns true when a row was created.
 */
export async function postPaymentIncome(
  tx: PrismaTransactionClient,
  input: { tenantId: string; actorId: string; payment: PaymentForLedger; now?: Date; /** Optional free-text description stored on the income entry. */ note?: string | null },
): Promise<boolean> {
  const { tenantId, actorId, payment } = input;
  if (payment.settlementId) return false;
  const order = await tx.serviceOrder.findFirst({
    where: { id: payment.orderId, tenantId },
    select: { branchId: true, customerId: true },
  });
  if (!order) return false;
  const typeId = await getSystemTypeId(tx, tenantId, "ORDER_PAYMENT");
  // Every payment (any method) attaches to the branch's open cash session (same tx).
  const sessionId = await resolveCashSessionId(tx, { tenantId, branchId: order.branchId, method: payment.method });
  const result = await tx.cashTransaction.createMany({
    data: [{
      tenantId,
      branchId: order.branchId,
      direction: "INCOME",
      typeId,
      amount: payment.amount,
      method: payment.method as "CASH" | "BANK_TRANSFER" | "CARD" | "QPAY" | "OTHER",
      bank: payment.bank,
      occurredAt: payment.paidAt ?? input.now ?? new Date(),
      customerId: order.customerId,
      orderPaymentId: payment.id,
      orderId: payment.orderId,
      sessionId,
      ...(input.note?.trim() ? { note: input.note.trim() } : {}),
      createdById: actorId,
    }],
    skipDuplicates: true,
  });
  return result.count > 0;
}

/**
 * Payment(s) reversed/cancelled after being PAID -> void their live entries.
 * USER callers (order payment reverse / reverse-all) MUST call assertEntryNotInClosedSession first; this function
 * itself does not block.
 */
export async function voidPaymentIncome(
  tx: PrismaTransactionClient,
  input: { tenantId: string; actorId: string; paymentIds: readonly string[]; now?: Date },
): Promise<number> {
  if (input.paymentIds.length === 0) return 0;
  // Phase C3: voiding a session-attached entry must serialise with «Касс хаах» (shared Branch lock, after the caller's order lock).
  const attached = await tx.cashTransaction.findMany({
    where: { tenantId: input.tenantId, orderPaymentId: { in: [...input.paymentIds] }, voidedAt: null, sessionId: { not: null } },
    select: { branchId: true },
  });
  for (const branchId of [...new Set(attached.map((e) => e.branchId))].sort()) await lockBranchShared(tx, input.tenantId, branchId);
  const result = await tx.cashTransaction.updateMany({
    where: { tenantId: input.tenantId, orderPaymentId: { in: [...input.paymentIds] }, voidedAt: null },
    data: { voidedAt: input.now ?? new Date(), voidedById: input.actorId, voidReason: VOID_REASON_PAYMENT_REVERSED },
  });
  return result.count;
}

/**
 * Internal order reached COMPLETED -> one EXPENSE entry (type INTERNAL_REPAIR,
 * amount = order total, method OTHER, occurredAt = completion time). Skipped
 * for a zero/absent total (amounts must be > 0) and when a live entry already
 * exists for the order.
 */
export async function postInternalRepairExpense(
  tx: PrismaTransactionClient,
  input: {
    tenantId: string;
    actorId: string;
    orderId: string;
    branchId: string;
    amount: Prisma.Decimal | null | undefined;
    occurredAt: Date;
  },
): Promise<boolean> {
  const { tenantId } = input;
  if (!input.amount || input.amount.lte(0)) return false;
  const typeId = await getSystemTypeId(tx, tenantId, "INTERNAL_REPAIR");
  const live = await tx.cashTransaction.findFirst({
    where: { tenantId, orderId: input.orderId, typeId, voidedAt: null },
    select: { id: true },
  });
  if (live) return false;
  // System path (never blocked by a closed register): attach to the open session if there is one, else stay outside.
  const sessionId = await resolveCashSessionId(tx, { tenantId, branchId: input.branchId, method: "OTHER" });
  await tx.cashTransaction.create({
    data: {
      tenantId,
      branchId: input.branchId,
      direction: "EXPENSE",
      typeId,
      amount: input.amount,
      method: "OTHER",
      occurredAt: input.occurredAt,
      orderId: input.orderId,
      sessionId,
      createdById: input.actorId,
    },
    select: { id: true },
  });
  return true;
}

/**
 * Internal order cancelled / reopened / deleted -> void its live INTERNAL_REPAIR entry.
 * DELIBERATE SYSTEM PATH: NOT blocked by a closed session (no assertEntryNotInClosedSession). The entry is method OTHER
 * (no drawer effect) and must never stop an order status change. Pending the shelved refund plan, which will decide how
 * a closed-session internal-repair void is treated.
 */
export async function voidInternalRepairExpense(
  tx: PrismaTransactionClient,
  input: { tenantId: string; actorId: string; orderId: string; reason: string; now?: Date },
): Promise<number> {
  // Voiding a session-attached entry serialises with «Касс хаах» (shared Branch lock).
  const attached = await tx.cashTransaction.findMany({
    where: { tenantId: input.tenantId, orderId: input.orderId, orderPaymentId: null, voidedAt: null, sessionId: { not: null }, type: { systemKey: "INTERNAL_REPAIR" } },
    select: { branchId: true },
  });
  for (const branchId of [...new Set(attached.map((e) => e.branchId))].sort()) await lockBranchShared(tx, input.tenantId, branchId);
  const result = await tx.cashTransaction.updateMany({
    where: {
      tenantId: input.tenantId,
      orderId: input.orderId,
      orderPaymentId: null,
      voidedAt: null,
      type: { systemKey: "INTERNAL_REPAIR" },
    },
    data: { voidedAt: input.now ?? new Date(), voidedById: input.actorId, voidReason: input.reason },
  });
  return result.count;
}
