"use server";

import { revalidatePath } from "next/cache";
import { redirect, unstable_rethrow } from "next/navigation";
import { knownAuthorizationMessage } from "@/lib/action-errors";
import { requireUser } from "@/lib/auth";
import type { ConfirmActionResult } from "@/lib/confirm-action";
import { StockCountError, cancelStockCount, completeStockCount, saveStockCountLines, startStockCount } from "@/lib/stock-counts";
import { assertActiveSubscription } from "@/lib/subscription-server";

export type StockCountActionState = {
  ok: boolean;
  message?: string;
  /** Keyed by form field, or by line id for counted quantities. */
  fieldErrors?: Record<string, string>;
} | null;

const BASE = "/dashboard/services/stock-counts";

function failure(error: unknown): StockCountActionState {
  if (error instanceof StockCountError) return { ok: false, message: error.message, fieldErrors: error.fieldErrors };
  const known = knownAuthorizationMessage(error);
  if (known) return { ok: false, message: known };
  return { ok: false, message: "Хадгалахад алдаа гарлаа." };
}

function refresh(id?: string) {
  revalidatePath(BASE);
  if (id) revalidatePath(`${BASE}/${id}`);
  // Stock changed: the goods list, item pages and the stock report.
  revalidatePath("/dashboard/services", "layout");
  revalidatePath("/dashboard/reports/stock");
}

/** formData: categoryId? (empty = all active goods), note?. Opens the new count. */
export async function startStockCountAction(_prev: StockCountActionState, fd: FormData): Promise<StockCountActionState> {
  let id: string;
  try {
    const user = await requireUser();
    await assertActiveSubscription(user.tenantId);
    const str = (k: string) => (typeof fd.get(k) === "string" ? (fd.get(k) as string) : "");
    id = (await startStockCount({ actor: user, categoryId: str("categoryId") || null, note: str("note") || null })).id;
  } catch (error) {
    unstable_rethrow(error);
    // An open count already exists: take the user to it instead of failing.
    if (error instanceof StockCountError && error.code === "STOCK_COUNT_DRAFT_EXISTS" && error.draftId) redirect(`${BASE}/${error.draftId}`);
    return failure(error);
  }
  refresh(id);
  redirect(`${BASE}/${id}`);
}

/** Saves the counted quantities that changed (null / "" = not counted). */
export async function saveStockCountLinesAction(
  countId: string,
  entries: Array<{ lineId: string; countedQty: string | null }>,
): Promise<StockCountActionState> {
  try {
    const user = await requireUser();
    await assertActiveSubscription(user.tenantId);
    const { saved } = await saveStockCountLines({ actor: user, countId, entries });
    revalidatePath(`${BASE}/${countId}`);
    return { ok: true, message: `${saved} мөр хадгалагдлаа.` };
  } catch (error) {
    unstable_rethrow(error);
    return failure(error);
  }
}

/** Saves the pending entries first (same request), then closes the count and applies it to stock. */
export async function completeStockCountAction(
  countId: string,
  pending: Array<{ lineId: string; countedQty: string | null }>,
): Promise<StockCountActionState> {
  try {
    const user = await requireUser();
    await assertActiveSubscription(user.tenantId);
    if (pending.length > 0) await saveStockCountLines({ actor: user, countId, entries: pending });
    const done = await completeStockCount({ actor: user, countId });
    refresh(countId);
    return { ok: true, message: `Тооллого дууслаа: ${done.diffCount} барааны үлдэгдэл засагдлаа.` };
  } catch (error) {
    unstable_rethrow(error);
    return failure(error);
  }
}

export async function cancelStockCountAction(countId: string): Promise<ConfirmActionResult> {
  try {
    const user = await requireUser();
    await assertActiveSubscription(user.tenantId);
    await cancelStockCount({ actor: user, countId });
  } catch (error) {
    unstable_rethrow(error);
    return { error: failure(error)?.message ?? "Алдаа гарлаа." };
  }
  refresh(countId);
}
