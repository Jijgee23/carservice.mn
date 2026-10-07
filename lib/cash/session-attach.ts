// Phase C3: the ONE helper every ledger write path uses to attach a CASH entry to the branch's open cash
// session. Kept free of ledger/session imports so sync.ts, settlement.ts and ledger.ts can all use it
// without an import cycle.
import type { Prisma } from "@/app/generated/prisma/client";
import type { PrismaTransactionClient } from "@/lib/prisma";
import { CashError } from "./rules";
import { CASH_SESSION_ENTRY_LOCKED_MESSAGE } from "./locked-copy";

/**
 * Shared Branch FOR SHARE lock. Every writer that can add a CASH entry to a session OR void one takes it inside
 * its own tx, so «Касс хаах» (FOR UPDATE on the same row) serialises with all of them: expected cash is computed
 * only when no attach/void is in flight, and anything committing later is a genuine post-close change.
 * Lock order stays order row -> branch row.
 */
export async function lockBranchShared(tx: PrismaTransactionClient, tenantId: string, branchId: string): Promise<void> {
  await tx.$queryRaw`SELECT id FROM "Branch" WHERE id = ${branchId} AND "tenantId" = ${tenantId} FOR SHARE`;
}

/**
 * Open session id for a ledger entry (ANY method: CASH, CARD, TRANSFER, QPAY, OTHER) being written in `tx`, else null.
 * - Takes a shared row lock on the Branch (FOR SHARE) so a concurrent «Касс хаах» (FOR UPDATE on the same
 *   row) either commits before we look (-> we see it closed) or waits for us (-> its expected cash includes
 *   this entry). Payments from the same branch do not block each other.
 */
export async function resolveCashSessionId(
  tx: PrismaTransactionClient,
  input: { tenantId: string; branchId: string; method: string },
): Promise<string | null> {
  await lockBranchShared(tx, input.tenantId, input.branchId);
  const open = await tx.cashSession.findFirst({
    where: { tenantId: input.tenantId, branchId: input.branchId, closedAt: null },
    orderBy: { openedAt: "desc" },
    select: { id: true },
  });
  return open?.id ?? null;
}

export const CASH_SESSION_CLOSED_MESSAGE = "Касс нээгээгүй байна. Эхлээд кассаа нээнэ үү.";
export const CASH_SESSION_CLOSED_CODE = "CASH_SESSION_CLOSED";

/**
 * Guard for every USER-INITIATED money write (any payment method): the branch must have an open cash session.
 * Run it INSIDE the write's tx. It takes the shared Branch lock first so it serialises with «Касс хаах»
 * (FOR UPDATE): a write either sees the session closed (refused) or finishes before the close computes expected cash.
 * Throws 409 CASH_SESSION_CLOSED; `makeError` lets order-payment commands raise their own error class.
 * NOT for system/provider paths (QPay confirm of a started invoice, auto expense post/void, open/close).
 */
export async function assertCashSessionOpen(
  tx: PrismaTransactionClient,
  tenantId: string,
  branchId: string,
  makeError: () => Error = () => new CashError(CASH_SESSION_CLOSED_MESSAGE, 409, CASH_SESSION_CLOSED_CODE),
): Promise<void> {
  await lockBranchShared(tx, tenantId, branchId);
  const open = await tx.cashSession.findFirst({
    where: { tenantId, branchId, closedAt: null },
    orderBy: { openedAt: "desc" },
    select: { id: true },
  });
  if (!open) throw makeError();
}

export const CASH_SESSION_ENTRY_LOCKED_CODE = "CASH_SESSION_ENTRY_LOCKED";
export { CASH_SESSION_ENTRY_LOCKED_MESSAGE };

/** Closed-session filter shared by the guard and the `locked` payload flag (ANY method; a no-session legacy entry never matches). */
export function closedSessionEntryWhere(where: Prisma.CashTransactionWhereInput): Prisma.CashTransactionWhereInput {
  return { ...where, voidedAt: null, session: { closedAt: { not: null } } };
}

/**
 * Guard for every USER-INITIATED void/reverse (order payment reverse, reverse-all, manual entry void, settlement void):
 * a live ledger entry (ANY method) that belongs to a CLOSED cash session can no longer be touched -> 409
 * CASH_SESSION_ENTRY_LOCKED. Run it INSIDE the write's tx AFTER the order row lock and the shared Branch lock
 * (assertCashSessionOpen / assertOrderRegisterOpen), so a concurrent «Касс хаах» cannot flip the answer.
 * Entries with no session (legacy) stay voidable. NOT for system paths (internal-repair void on order cancel/reopen/delete).
 */
export async function assertEntryNotInClosedSession(
  tx: PrismaTransactionClient,
  where: Prisma.CashTransactionWhereInput,
  makeError: () => Error = () => new CashError(CASH_SESSION_ENTRY_LOCKED_MESSAGE, 409, CASH_SESSION_ENTRY_LOCKED_CODE),
): Promise<void> {
  const locked = await tx.cashTransaction.findFirst({ where: closedSessionEntryWhere(where), select: { id: true } });
  if (locked) throw makeError();
}

/** Payment ids (of `paymentIds`) whose live ledger entry sits in a closed session: the API `locked` flag. Works on prisma or a tx. */
export async function findLockedPaymentIds(
  client: Pick<PrismaTransactionClient, "cashTransaction">,
  tenantId: string,
  paymentIds: readonly string[],
): Promise<Set<string>> {
  if (paymentIds.length === 0) return new Set();
  const rows = await client.cashTransaction.findMany({
    where: closedSessionEntryWhere({ tenantId, orderPaymentId: { in: [...paymentIds] } }),
    select: { orderPaymentId: true },
  });
  return new Set((rows ?? []).flatMap((r) => (r.orderPaymentId ? [r.orderPaymentId] : [])));
}

/**
 * Batched «hasLockedPayment»: ids (of `orderIds`) with ANY PAID payment whose live ledger entry is in a CLOSED cash
 * session. Same closed-session logic as findLockedPaymentIds (+ the lump entry of a postpaid settlement the payment
 * belongs to). At most 3 queries regardless of list size (no N+1).
 */
export async function findOrderIdsWithLockedPayment(
  client: Pick<PrismaTransactionClient, "cashTransaction" | "orderPayment">,
  tenantId: string,
  orderIds: readonly string[],
): Promise<Set<string>> {
  const ids = [...new Set(orderIds)];
  if (ids.length === 0) return new Set();
  const [direct, viaSettlement] = await Promise.all([
    client.cashTransaction.findMany({
      where: closedSessionEntryWhere({ tenantId, orderId: { in: ids }, orderPaymentId: { not: null } }),
      select: { orderId: true },
    }),
    client.orderPayment.findMany({
      where: { tenantId, orderId: { in: ids }, status: "PAID", settlementId: { not: null } },
      select: { orderId: true, settlementId: true },
    }),
  ]);
  const result = new Set<string>((direct ?? []).flatMap((r) => (r.orderId ? [r.orderId] : [])));
  const settlementIds = [...new Set((viaSettlement ?? []).flatMap((p) => (p.settlementId ? [p.settlementId] : [])))];
  if (settlementIds.length > 0) {
    const lumps = await client.cashTransaction.findMany({
      where: closedSessionEntryWhere({ tenantId, settlementId: { in: settlementIds } }),
      select: { settlementId: true },
    });
    const lockedSettlements = new Set((lumps ?? []).flatMap((r) => (r.settlementId ? [r.settlementId] : [])));
    for (const p of viaSettlement ?? []) if (p.settlementId && lockedSettlements.has(p.settlementId)) result.add(p.orderId);
  }
  return result;
}
