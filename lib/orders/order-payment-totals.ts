// Order paid-amount / payment-status derivation from the PAID payment ledger.
// Kept apart from order-payment-commands so item/status commands can call it
// without an import cycle (payment-commands -> order-commands -> item-commands).
import { Prisma } from "@/app/generated/prisma/client";
import type { PrismaTransactionClient } from "@/lib/prisma";

export async function paidLedger(tx: PrismaTransactionClient, tenantId: string, orderId: string) {
  const rows = await tx.orderPayment.findMany({
    where: { tenantId, orderId, status: "PAID" },
    select: { amount: true, paidAt: true },
  });
  const paid = rows.reduce((sum, row) => sum.plus(row.amount), new Prisma.Decimal(0));
  const paidAt = rows.reduce<Date | null>((latest, row) => {
    if (!row.paidAt) return latest;
    return !latest || row.paidAt > latest ? row.paidAt : latest;
  }, null);
  return { paid, paidAt };
}

export async function recomputeOrderPaymentTotals(
  tx: PrismaTransactionClient,
  tenantId: string,
  order: { id: string; totalAmount: Prisma.Decimal | null },
) {
  const { paid, paidAt } = await paidLedger(tx, tenantId, order.id);
  const total = order.totalAmount ?? new Prisma.Decimal(0);
  const status = paid.lte(0) ? "UNPAID" : paid.gte(total) ? "PAID" : "PARTIAL";
  await tx.serviceOrder.update({
    where: { id: order.id },
    data: {
      paidAmount: paid.lte(0) ? null : paid,
      paymentStatus: status,
      paidAt: status === "PAID" ? paidAt ?? new Date() : null,
    },
  });
  return { paid, status, paidAt, total, remaining: total.minus(paid) };
}

/**
 * Shared "Шууд төлсөн" rule: the order is COMPLETED, fully PAID, and the latest
 * PAID payment was made no later than completion. `payments` only needs the
 * PAID rows' `paidAt` (select that alone to avoid heavy list queries).
 */
export function computePaidInFullBeforeCompletion(order: {
  status: string;
  paymentStatus: string;
  completedAt: Date | null;
  payments?: ReadonlyArray<{ paidAt: Date | null }> | null;
}): boolean {
  if (order.status !== "COMPLETED" || order.paymentStatus !== "PAID" || !order.completedAt) return false;
  let latest: Date | null = null;
  for (const row of order.payments ?? []) {
    if (row.paidAt && (!latest || row.paidAt > latest)) latest = row.paidAt;
  }
  return latest != null && latest.getTime() <= order.completedAt.getTime();
}

/** Select fragment: PAID payments' paidAt only (no N+1 in list/detail payloads). */
export const PAID_AT_SELECT = {
  payments: { where: { status: "PAID" as const }, select: { paidAt: true } },
} satisfies Prisma.ServiceOrderSelect;

/** Replace the selected `payments` rows with the API's `paidInFullBeforeCompletion` flag. */
export function withPaidInFull<
  T extends {
    status: string;
    paymentStatus: string;
    completedAt: Date | null;
    payments: ReadonlyArray<{ paidAt: Date | null }>;
  },
>(order: T): Omit<T, "payments"> & { paidInFullBeforeCompletion: boolean } {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { payments, ...rest } = order;
  return { ...rest, paidInFullBeforeCompletion: computePaidInFullBeforeCompletion(order) };
}
