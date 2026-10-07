// QA #11 — "Авлага" (receivable) = outstanding balance of EVERY completed,
// non-internal order, postpaid or not. Outstanding per order is
// `total − sum(PAID payments)` (the same `computeOutstanding` the postpaid
// settlement flow uses); only balances > 0 count (an overpaid order never
// offsets another order's debt).
import { Prisma } from "@/app/generated/prisma/client";
import { computeOutstanding } from "@/lib/cash/settlement";

/** Where-fragment (without tenant/branch scope): completed, not internal, not cancelled, total > 0. */
export const RECEIVABLE_ORDER_WHERE = {
  status: "COMPLETED",
  isInternal: false,
  totalAmount: { gt: 0 },
  // paymentStatus is recomputed from the PAID ledger on every payment, settlement
  // and item/total change (recomputeOrderPaymentTotals), so PAID <=> outstanding <= 0.
  // This lets the DB skip fully paid orders; sumReceivable still computes exactly.
  paymentStatus: { not: "PAID" },
} as const;

/** Select fragment: total + PAID payment amounts only. */
export const RECEIVABLE_ORDER_SELECT = {
  totalAmount: true,
  payments: { where: { status: "PAID" as const }, select: { amount: true } },
} satisfies Prisma.ServiceOrderSelect;

export type ReceivableOrderRow = {
  totalAmount: Prisma.Decimal | null;
  payments: ReadonlyArray<{ amount: Prisma.Decimal }>;
};

/** Sum of per-order outstanding balances that are > 0. */
export function sumReceivable(rows: ReadonlyArray<ReceivableOrderRow>): Prisma.Decimal {
  return rows.reduce((sum, row) => {
    const outstanding = computeOutstanding(row.totalAmount, row.payments.map((p) => p.amount));
    return outstanding.gt(0) ? sum.plus(outstanding) : sum;
  }, new Prisma.Decimal(0));
}
