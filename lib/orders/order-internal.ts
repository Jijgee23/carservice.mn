// Pure rules for internal repairs ("Дотоод засвар"). No Prisma/env imports so
// plain unit tests can exercise them. Contract: isInternal and isPostpaid are
// mutually exclusive; internal orders take no payments.
import {
  INTERNAL_HAS_PAYMENTS_MESSAGE,
  INTERNAL_NO_PAYMENT_MESSAGE,
  INTERNAL_POSTPAID_CONFLICT_MESSAGE,
} from "@/lib/orders";

export const ORDER_INTERNAL_POSTPAID_CONFLICT = "ORDER_INTERNAL_POSTPAID_CONFLICT";
export const ORDER_INTERNAL_NO_PAYMENT = "ORDER_INTERNAL_NO_PAYMENT";
export const ORDER_INTERNAL_HAS_PAYMENTS = "ORDER_INTERNAL_HAS_PAYMENTS";

export type InternalRuleViolation = { status: number; code: string; message: string };

/** Both flags true in one input -> 422 conflict. */
export function internalPostpaidConflict(
  isInternal: boolean | undefined,
  isPostpaid: boolean | undefined,
): InternalRuleViolation | null {
  if (isInternal === true && isPostpaid === true) {
    return { status: 422, code: ORDER_INTERNAL_POSTPAID_CONFLICT, message: INTERNAL_POSTPAID_CONFLICT_MESSAGE };
  }
  return null;
}

/** Toggling internal on while PAID payments exist -> 409. */
export function internalHasPaymentsViolation(
  nextIsInternal: boolean | undefined,
  currentIsInternal: boolean,
  hasPaidPayments: boolean,
): InternalRuleViolation | null {
  if (nextIsInternal === true && !currentIsInternal && hasPaidPayments) {
    return { status: 409, code: ORDER_INTERNAL_HAS_PAYMENTS, message: INTERNAL_HAS_PAYMENTS_MESSAGE };
  }
  return null;
}

export function internalNoPaymentViolation(order: { isInternal: boolean }): InternalRuleViolation | null {
  return order.isInternal
    ? { status: 409, code: ORDER_INTERNAL_NO_PAYMENT, message: INTERNAL_NO_PAYMENT_MESSAGE }
    : null;
}

/**
 * Resulting isPostpaid for an update. Internal orders are always false (the DB
 * CHECK forbids both); a vehicle change never re-derives postpaid on an
 * internal order. `undefined` = leave the column untouched.
 */
export function resolveUpdatedIsPostpaid(input: {
  nextIsInternal: boolean;
  explicitPostpaid: boolean | undefined;
  vehicleChanged: boolean;
  vehicleIsPostpaid: boolean;
}): boolean | undefined {
  if (input.nextIsInternal) return false;
  return input.explicitPostpaid ?? (input.vehicleChanged ? input.vehicleIsPostpaid : undefined);
}

type SplitRow = { key: string; isInternal: boolean; amount: { toString(): string } | null | undefined; count: number };

/**
 * groupBy(..., isInternal) rows -> one row per key: `count` counts all
 * completed work (internal included), `revenue` only non-internal amounts,
 * `internalCost` only internal amounts.
 */
export function mergeInternalSplit(rows: SplitRow[]) {
  const merged = new Map<string, { key: string; revenue: number; internalCost: number; count: number }>();
  for (const r of rows) {
    const entry = merged.get(r.key) ?? { key: r.key, revenue: 0, internalCost: 0, count: 0 };
    const amount = Number.parseFloat(r.amount?.toString() ?? "0") || 0;
    if (r.isInternal) entry.internalCost += amount;
    else entry.revenue += amount;
    entry.count += r.count;
    merged.set(r.key, entry);
  }
  return [...merged.values()];
}
