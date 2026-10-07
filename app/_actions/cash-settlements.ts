"use server";

import { revalidatePath } from "next/cache";
import { revalidateCashPaths } from "@/lib/cash/revalidate";
import { unstable_rethrow } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { safeCashActionMessage } from "@/lib/cash/action-failure";
import { CashError } from "@/lib/cash/rules";
import {
  createPostpaidSettlement,
  getSettlement,
  listEligiblePostpaidOrders,
  listSettlements,
  voidPostpaidSettlement,
  type SerializedSettlement,
} from "@/lib/cash/settlement";
import { assertActiveSubscription } from "@/lib/subscription-server";

/** useActionState shape shared by the settlement forms. */
export type SettlementActionState = {
  ok: boolean;
  message?: string;
  fieldErrors?: Record<string, string>;
  /** createPostpaidSettlementAction: the new settlement id. */
  settlementId?: string;
  /** Machine code of a CashError (e.g. SETTLEMENT_AMOUNT_CHANGED -> reload the eligible list). */
  code?: string;
} | null;

function s(fd: FormData, key: string): string {
  const value = fd.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function failure(error: unknown, fallback: string): SettlementActionState {
  if (error instanceof CashError) return { ok: false, message: error.message, fieldErrors: error.fieldErrors, code: error.code };
  return { ok: false, message: safeCashActionMessage("settlement-action", error, fallback) };
}

function revalidateSettlements(orderIds: readonly string[] = []) {
  revalidateCashPaths();
  revalidatePath("/dashboard/orders");
  for (const id of orderIds) revalidatePath(`/dashboard/orders/${id}`);
}

/**
 * Create a settlement («Тооцоо нийлэх»). Needs cash.manage AND orders.closeUnpaidPostpaid.
 * formData: branchId, customerId, orderIds (repeat the key once per order), method (CASH|BANK_TRANSFER|CARD|OTHER),
 * bank? (transfer/card), occurredAt? (YYYY-MM-DD | YYYY-MM-DDTHH:mm business time), note?, expectedAmount? (what the user saw).
 * Success -> { ok: true, settlementId }. Stale amount -> { ok: false, code: "SETTLEMENT_AMOUNT_CHANGED" }.
 */
export async function createPostpaidSettlementAction(_prev: SettlementActionState, formData: FormData): Promise<SettlementActionState> {
  try {
    const user = await requireUser();
    await assertActiveSubscription(user.tenantId);
    const orderIds = formData.getAll("orderIds").filter((v): v is string => typeof v === "string");
    const settlement = await createPostpaidSettlement({
      actor: user,
      branchId: s(formData, "branchId"),
      customerId: s(formData, "customerId"),
      orderIds,
      method: s(formData, "method"),
      bank: s(formData, "bank") || undefined,
      occurredAt: s(formData, "occurredAt") || undefined,
      note: s(formData, "note") || undefined,
      expectedAmount: s(formData, "expectedAmount") || undefined,
    });
    revalidateSettlements(settlement.orders.map((o) => o.orderId));
    return { ok: true, settlementId: settlement.id };
  } catch (error) {
    unstable_rethrow(error);
    return failure(error, "Тооцоо бүртгэхэд алдаа гарлаа.");
  }
}

/** Void a whole settlement (cash.manage + orders.closeUnpaidPostpaid). formData: settlementId, reason (required). */
export async function voidPostpaidSettlementAction(_prev: SettlementActionState, formData: FormData): Promise<SettlementActionState> {
  try {
    const user = await requireUser();
    await assertActiveSubscription(user.tenantId);
    const settlementId = s(formData, "settlementId");
    if (!settlementId) return { ok: false, message: "Тооцоо шаардлагатай." };
    const settlement = await voidPostpaidSettlement({ actor: user, settlementId, reason: s(formData, "reason") });
    revalidateSettlements(settlement.orders.map((o) => o.orderId));
    return { ok: true, settlementId };
  } catch (error) {
    unstable_rethrow(error);
    return failure(error, "Цуцлахад алдаа гарлаа.");
  }
}

export type SettlementReadResult<T> = { ok: true; data: T } | { ok: false; message: string; code?: string };

function readFailure(error: unknown, fallback: string): { ok: false; message: string; code?: string } {
  if (error instanceof CashError) return { ok: false, message: error.message, code: error.code };
  return { ok: false, message: fallback };
}

/** Eligible postpaid orders (outstanding > 0) for the settlement picker. Args: customerId, branchId (both required). */
export async function listEligiblePostpaidOrdersAction(customerId: string, branchId: string): Promise<SettlementReadResult<Awaited<ReturnType<typeof listEligiblePostpaidOrders>>>> {
  try {
    const user = await requireUser();
    return { ok: true, data: await listEligiblePostpaidOrders({ actor: user, customerId, branchId }) };
  } catch (error) {
    unstable_rethrow(error);
    return readFailure(error, "Жагсаалт ачаалахад алдаа гарлаа.");
  }
}

export type SettlementListFilters = { from?: string; to?: string; branchId?: string; customerId?: string; includeVoided?: boolean; page?: number; pageSize?: number };

/** Settlements list (cash.manage). page is 1-based, pageSize default 50 (max 200). */
export async function listSettlementsAction(filters: SettlementListFilters = {}): Promise<SettlementReadResult<Awaited<ReturnType<typeof listSettlements>> & { page: number; pageSize: number }>> {
  try {
    const user = await requireUser();
    const pageSize = Math.min(200, Math.max(1, Math.trunc(filters.pageSize ?? 50)));
    const page = Math.max(1, Math.trunc(filters.page ?? 1));
    const result = await listSettlements({
      actor: user,
      filters: { from: filters.from || null, to: filters.to || null, branchId: filters.branchId || null, customerId: filters.customerId || null, includeVoided: filters.includeVoided },
      skip: (page - 1) * pageSize,
      take: pageSize,
    });
    return { ok: true, data: { ...result, page, pageSize } };
  } catch (error) {
    unstable_rethrow(error);
    return readFailure(error, "Жагсаалт ачаалахад алдаа гарлаа.");
  }
}

/** One settlement with its orders, ledger entry (cash.manage). */
export async function getSettlementAction(settlementId: string): Promise<SettlementReadResult<SerializedSettlement>> {
  try {
    const user = await requireUser();
    return { ok: true, data: await getSettlement({ actor: user, settlementId }) };
  } catch (error) {
    unstable_rethrow(error);
    return readFailure(error, "Тооцоо ачаалахад алдаа гарлаа.");
  }
}
