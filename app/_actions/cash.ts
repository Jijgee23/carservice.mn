"use server";

import { unstable_rethrow } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { hasPermission } from "@/lib/auth/roles";
import { createCashEntry, voidCashEntry } from "@/lib/cash/ledger";
import { safeCashActionMessage } from "@/lib/cash/action-failure";
import { revalidateCashPaths } from "@/lib/cash/revalidate";
import { CashError } from "@/lib/cash/rules";
import { closeCashSession, getSessionCloseFigures, openCashSession, type SerializedCashSession } from "@/lib/cash/session";
import { createCashType, updateCashType } from "@/lib/cash/types";
import { prisma } from "@/lib/prisma";
import { saveUpload, validateUpload } from "@/lib/storage";
import { assertActiveSubscription } from "@/lib/subscription-server";
import { customerTextSearchClauses } from "@/lib/customers/customer-search";

/** useActionState shape shared by every cash form. */
export type CashActionState = {
  ok: boolean;
  message?: string;
  fieldErrors?: Record<string, string>;
  /** createCashEntryAction: new entry id. */
  entryId?: string;
  /** createCashTypeAction / updateCashTypeAction: type id. */
  typeId?: string;
  /** openCashSessionAction / closeCashSessionAction: session id. */
  sessionId?: string;
} | null;

function s(fd: FormData, key: string): string {
  const value = fd.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function failure(error: unknown, fallback: string): CashActionState {
  if (error instanceof CashError) return { ok: false, message: error.message, fieldErrors: error.fieldErrors };
  return { ok: false, message: safeCashActionMessage("action", error, fallback) };
}

function revalidateCash() {
  revalidateCashPaths();
}

/**
 * Manual income/expense entry (cash.manage). formData: direction (INCOME|EXPENSE), typeId, branchId,
 * amount, method (CASH|BANK_TRANSFER|CARD|OTHER), bank?, occurredAt? (YYYY-MM-DD or YYYY-MM-DDTHH:mm, business time),
 * note?, attachmentPath? (from uploadCashAttachmentAction), taxIncluded? (EXPENSE only), customerId?, counterparty?.
 */
export async function createCashEntryAction(_prev: CashActionState, formData: FormData): Promise<CashActionState> {
  try {
    const user = await requireUser();
    await assertActiveSubscription(user.tenantId);
    const entry = await createCashEntry({
      actor: user,
      direction: s(formData, "direction"),
      typeId: s(formData, "typeId"),
      branchId: s(formData, "branchId"),
      amount: s(formData, "amount"),
      method: s(formData, "method"),
      bank: s(formData, "bank") || null,
      occurredAt: s(formData, "occurredAt") || null,
      note: s(formData, "note") || null,
      attachmentPath: s(formData, "attachmentPath") || null,
      taxIncluded: s(formData, "taxIncluded") || null,
      customerId: s(formData, "customerId") || null,
      counterparty: s(formData, "counterparty") || null,
    });
    revalidateCash();
    return { ok: true, entryId: entry.id };
  } catch (error) {
    unstable_rethrow(error);
    return failure(error, "Хадгалахад алдаа.");
  }
}

/** Void a manual entry (cash.manage). formData: entryId, reason (required). */
export async function voidCashEntryAction(_prev: CashActionState, formData: FormData): Promise<CashActionState> {
  try {
    const user = await requireUser();
    await assertActiveSubscription(user.tenantId);
    const entryId = s(formData, "entryId");
    if (!entryId) return { ok: false, message: "Бичлэг шаардлагатай." };
    await voidCashEntry({ actor: user, entryId, reason: s(formData, "reason") });
    revalidateCash();
    return { ok: true, entryId };
  } catch (error) {
    unstable_rethrow(error);
    return failure(error, "Хүчингүй болгоход алдаа.");
  }
}

/** Create an editable type (cash.manage). formData: direction, name. */
export async function createCashTypeAction(_prev: CashActionState, formData: FormData): Promise<CashActionState> {
  try {
    const user = await requireUser();
    await assertActiveSubscription(user.tenantId);
    const type = await createCashType({ actor: user, direction: s(formData, "direction"), name: s(formData, "name") });
    revalidateCash();
    return { ok: true, typeId: type.id };
  } catch (error) {
    unstable_rethrow(error);
    return failure(error, "Хадгалахад алдаа.");
  }
}

/** Rename and/or (de)activate an editable type (cash.manage). formData: typeId, name?, isActive? ("1" | "0"). */
export async function updateCashTypeAction(_prev: CashActionState, formData: FormData): Promise<CashActionState> {
  try {
    const user = await requireUser();
    await assertActiveSubscription(user.tenantId);
    const typeId = s(formData, "typeId");
    if (!typeId) return { ok: false, message: "Төрөл шаардлагатай." };
    const isActiveRaw = s(formData, "isActive");
    const type = await updateCashType({
      actor: user,
      typeId,
      name: formData.has("name") ? s(formData, "name") : undefined,
      isActive: isActiveRaw === "" ? undefined : isActiveRaw === "1",
    });
    revalidateCash();
    return { ok: true, typeId: type.id };
  } catch (error) {
    unstable_rethrow(error);
    return failure(error, "Хадгалахад алдаа.");
  }
}

/**
 * Upload a receipt image (PNG/JPG/WEBP <= 2MB) for a manual entry. formData: file.
 * Returns the `/uploads/cash/{tenantId}/...` path to pass as `attachmentPath`.
 */
export async function uploadCashAttachmentAction(formData: FormData): Promise<{ ok: boolean; path?: string; message?: string }> {
  try {
    const user = await requireUser();
    if (!hasPermission(user, "cash.manage")) return { ok: false, message: "Танд кассыг удирдах эрх байхгүй." };
    await assertActiveSubscription(user.tenantId);
    const file = formData.get("file");
    if (!(file instanceof File) || file.size === 0) return { ok: false, message: "Зураг сонгоно уу." };
    validateUpload(file);
    const saved = await saveUpload(file, `cash/${user.tenantId}`);
    return { ok: true, path: saved.path };
  } catch (error) {
    unstable_rethrow(error);
    return { ok: false, message: safeCashActionMessage("upload-attachment", error, "Файл хадгалахад алдаа.") };
  }
}

/** Open a cash drawer session (cash.manage). formData: branchId, openingCash (>= 0), note?. 409 CASH_SESSION_ALREADY_OPEN surfaces as message. */
export async function openCashSessionAction(_prev: CashActionState, formData: FormData): Promise<CashActionState> {
  try {
    const user = await requireUser();
    await assertActiveSubscription(user.tenantId);
    const session = await openCashSession({
      actor: user,
      branchId: s(formData, "branchId"),
      openingCash: s(formData, "openingCash"),
      note: s(formData, "note") || null,
    });
    revalidateCash();
    return { ok: true, sessionId: session.id };
  } catch (error) {
    unstable_rethrow(error);
    return failure(error, "Касс нээхэд алдаа.");
  }
}

/** Close a cash drawer session (cash.manage). formData: sessionId, countedCash (>= 0), methodCounts? (JSON array [{method, bank?, counted?}] for non-CASH groups), note?. */
export async function closeCashSessionAction(_prev: CashActionState, formData: FormData): Promise<CashActionState> {
  try {
    const user = await requireUser();
    await assertActiveSubscription(user.tenantId);
    const sessionId = s(formData, "sessionId");
    if (!sessionId) return { ok: false, message: "Ээлж шаардлагатай." };
    const methodCountsRaw = s(formData, "methodCounts");
    let methodCounts: unknown;
    if (methodCountsRaw) {
      try {
        methodCounts = JSON.parse(methodCountsRaw);
      } catch {
        return { ok: false, message: "Төлбөрийн аргын тооллого буруу байна." };
      }
    }
    await closeCashSession({ actor: user, sessionId, countedCash: s(formData, "countedCash"), methodCounts, note: s(formData, "note") || null });
    revalidateCash();
    return { ok: true, sessionId };
  } catch (error) {
    unstable_rethrow(error);
    return failure(error, "Касс хаахад алдаа.");
  }
}

export type CustomerSearchResult = { ok: true; customers: { id: string; name: string }[] } | { ok: false; message: string };

/** Tenant-scoped customer search for the manual-entry picker (cash.manage). Empty/short `q` returns the first 20 by name. */
export async function searchCashCustomersAction(q: string): Promise<CustomerSearchResult> {
  try {
    const user = await requireUser();
    if (!hasPermission(user, "cash.manage")) return { ok: false, message: "Танд кассыг удирдах эрх байхгүй." };
    const term = typeof q === "string" ? q.trim().slice(0, 100) : "";
    const rows = await prisma.customer.findMany({
      where: {
        tenantId: user.tenantId,
        ...(term
          ? { OR: customerTextSearchClauses(term) }
          : {}),
      },
      orderBy: { fullName: "asc" },
      take: 20,
      select: { id: true, fullName: true, phone: true, isOrganization: true, orgRegnum: true },
    });
    return {
      ok: true,
      customers: rows.map((c) => ({
        id: c.id,
        name: [c.fullName, c.isOrganization && c.orgRegnum ? `РД ${c.orgRegnum}` : null, c.phone || null]
          .filter(Boolean)
          .join(" · "),
      })),
    };
  } catch (error) {
    unstable_rethrow(error);
    return { ok: false, message: "Хайлт амжилтгүй." };
  }
}

export type CloseFiguresResult =
  | { ok: true; expectedCash: string; byMethod: SerializedCashSession["byMethod"] }
  | { ok: false; message: string };

/** Fresh expected figures for the close-session dialog (cash.manage); the page props can be stale by the time it opens. */
export async function getCloseSessionFiguresAction(sessionId: string): Promise<CloseFiguresResult> {
  try {
    const user = await requireUser();
    if (typeof sessionId !== "string" || !sessionId) return { ok: false, message: "Ээлж шаардлагатай." };
    const figures = await getSessionCloseFigures({ actor: user, sessionId });
    return { ok: true, ...figures };
  } catch (error) {
    unstable_rethrow(error);
    return failureMessage(error, "Тооцоолсон дүнг ачаалахад алдаа гарлаа.");
  }
}

function failureMessage(error: unknown, fallback: string): { ok: false; message: string } {
  if (error instanceof CashError) return { ok: false, message: error.message };
  return { ok: false, message: safeCashActionMessage("action", error, fallback) };
}
