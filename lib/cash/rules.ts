// Pure rules for the cash ledger (Phase C1). No Prisma client / env imports
// beyond the Decimal class, so plain unit tests can exercise them.
import { Prisma } from "@/app/generated/prisma/client";
import { bookingDateKey, bookingDayBounds, parseBusinessLocalDateTime } from "@/lib/booking-time";

export const CASH_DIRECTIONS = ["INCOME", "EXPENSE"] as const;
export type CashDirectionValue = (typeof CASH_DIRECTIONS)[number];

/** QPAY is never a manual method — it only ever arrives through the payment sync. */
export const CASH_MANUAL_METHODS = ["CASH", "BANK_TRANSFER", "CARD", "OTHER"] as const;
export type CashManualMethod = (typeof CASH_MANUAL_METHODS)[number];

export const SYSTEM_TYPE_KEYS = ["ORDER_PAYMENT", "POSTPAID_SETTLEMENT", "INTERNAL_REPAIR"] as const;
export type SystemTypeKey = (typeof SYSTEM_TYPE_KEYS)[number];

export const SYSTEM_TYPE_DEFS: ReadonlyArray<{ systemKey: SystemTypeKey; direction: CashDirectionValue; name: string }> = [
  { systemKey: "ORDER_PAYMENT", direction: "INCOME", name: "Засварын орлого" },
  { systemKey: "POSTPAID_SETTLEMENT", direction: "INCOME", name: "Дараа тооцоо" },
  { systemKey: "INTERNAL_REPAIR", direction: "EXPENSE", name: "Дотоод засварын зардал" },
];

/** LEGACY keys of the removed B2 compensation: never seeded; existing dev rows keep their systemKey and stay uneditable system entries. */
export const LEGACY_SYSTEM_TYPE_KEYS: readonly string[] = ["CLOSED_SESSION_VOID_OUT", "CLOSED_SESSION_VOID_IN"];

export const DEFAULT_TYPE_DEFS: ReadonlyArray<{ direction: CashDirectionValue; name: string }> = [
  { direction: "INCOME", name: "Бусад орлого" },
  { direction: "INCOME", name: "Сэлбэг худалдаа" },
  { direction: "EXPENSE", name: "Сэлбэг худалдан авалт" },
  { direction: "EXPENSE", name: "Цалин, урьдчилгаа" },
  { direction: "EXPENSE", name: "Түрээс" },
  { direction: "EXPENSE", name: "Ашиглалтын зардал" },
  { direction: "EXPENSE", name: "Бусад зардал" },
];

export const VOID_REASON_PAYMENT_REVERSED = "Төлбөр буцаагдсан";
export const VOID_REASON_ORDER_REOPENED = "Захиалга дахин нээгдсэн";
export const VOID_REASON_ORDER_CANCELLED = "Захиалга цуцлагдсан";
export const VOID_REASON_ORDER_DELETED = "Захиалга устгагдсан";
export const VOID_REASON_SETTLEMENT_VOIDED = "Тооцоо цуцлагдсан";

export const MAX_CASH_AMOUNT = new Prisma.Decimal("9999999999.99");
export const MAX_NOTE_LENGTH = 1000;
export const MAX_COUNTERPARTY_LENGTH = 200;
export const MAX_TYPE_NAME_LENGTH = 60;
export const MAX_VOID_REASON_LENGTH = 500;
/** occurredAt may be at most this far in the future (clock skew / «өнөөдөр»). */
export const MAX_FUTURE_MS = 24 * 60 * 60 * 1000;

export type CashErrorCode =
  | "CASH_MANAGE_FORBIDDEN"
  | "CASH_TYPE_INVALID"
  | "CASH_AMOUNT_INVALID"
  | "CASH_METHOD_INVALID"
  | "CASH_DATE_INVALID"
  | "CASH_BRANCH_INVALID"
  | "CASH_VOID_REASON_REQUIRED"
  | "CASH_ALREADY_VOIDED"
  | "CASH_SYSTEM_ENTRY"
  | "CASH_TYPE_SYSTEM"
  | "CASH_TYPE_DUPLICATE"
  | "CASH_TYPE_NAME_INVALID"
  | "CASH_TAX_INVALID"
  | "CASH_FIELD_INVALID"
  | "CASH_ENTRY_NOT_FOUND"
  | "CASH_ATTACHMENT_INVALID"
  | "PAYMENT_BANK_REQUIRED"
  | "PAYMENT_BANK_NOT_ENABLED"
  | "POSTPAID_SETTLEMENT_FORBIDDEN"
  | "SETTLEMENT_ORDER_INVALID"
  | "SETTLEMENT_AMOUNT_CHANGED"
  | "QPAY_CANCEL_FAILED"
  | "QPAY_INVOICE_PARTIALLY_PAID"
  | "SETTLEMENT_ALREADY_VOIDED"
  | "SETTLEMENT_NOT_FOUND"
  | "SETTLEMENT_PAYMENT_LOCKED"
  | "SETTLEMENT_EMPTY"
  | "CASH_SESSION_ALREADY_OPEN"
  | "CASH_SESSION_NOT_OPEN"
  | "CASH_SESSION_NOT_FOUND"
  | "CASH_SESSION_CLOSED"
  | "CASH_SESSION_ENTRY_LOCKED";

export class CashError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code: CashErrorCode,
    public readonly fieldErrors?: Record<string, string>,
    /** Extra machine-readable context for the API envelope (e.g. the offending order id). */
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "CashError";
  }
}

export function cashForbidden(): CashError {
  return new CashError("Танд кассыг удирдах эрх байхгүй.", 403, "CASH_MANAGE_FORBIDDEN");
}

export function isCashDirection(value: unknown): value is CashDirectionValue {
  return typeof value === "string" && (CASH_DIRECTIONS as readonly string[]).includes(value);
}

export function isManualCashMethod(value: unknown): value is CashManualMethod {
  return typeof value === "string" && (CASH_MANUAL_METHODS as readonly string[]).includes(value);
}

/** Positive money, ≤ 2 decimals, ≤ MAX_CASH_AMOUNT. Accepts "1,500.50" strings or finite numbers. */
export function parseCashAmount(value: unknown): Prisma.Decimal | null {
  let raw: string;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return null;
    raw = String(value);
  } else if (typeof value === "string") {
    raw = value.trim().replace(/[\s,]/g, "");
  } else {
    return null;
  }
  if (!/^\d+(?:\.\d{1,2})?$/.test(raw)) return null;
  try {
    const amount = new Prisma.Decimal(raw);
    return amount.gt(0) && amount.lte(MAX_CASH_AMOUNT) ? amount : null;
  } catch {
    return null;
  }
}

export function requireCashAmount(value: unknown): Prisma.Decimal {
  const amount = parseCashAmount(value);
  if (!amount) throw new CashError("Дүнг зөв оруулна уу.", 422, "CASH_AMOUNT_INVALID", { amount: "Дүнг зөв оруулна уу." });
  return amount;
}

export function requireManualMethod(value: unknown): CashManualMethod {
  if (!isManualCashMethod(value)) {
    throw new CashError("Төлбөрийн арга буруу.", 422, "CASH_METHOD_INVALID", { method: "Төлбөрийн арга буруу." });
  }
  return value;
}

/** Offset-free «YYYY-MM-DDTHH:mm» = Asia/Ulaanbaatar local; date-only = today -> now, else noon local that day; anything with an offset/Z is absolute. */
function parseOccurredAtString(raw: string, now: Date): Date {
  const text = raw.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    try {
      const { start } = bookingDayBounds(text);
      return bookingDateKey(now) === text ? now : new Date(start.getTime() + 12 * 60 * 60 * 1000);
    } catch {
      return new Date(Number.NaN);
    }
  }
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(text)) return parseBusinessLocalDateTime(text);
  return new Date(text);
}

/** undefined/null/"" -> now; otherwise a valid date no more than 1 day in the future. */
export function resolveOccurredAt(value: unknown, now: Date = new Date()): Date {
  if (value === undefined || value === null || value === "") return now;
  const date = value instanceof Date ? value : typeof value === "string" ? parseOccurredAtString(value, now) : new Date(Number.NaN);
  if (Number.isNaN(date.getTime())) {
    throw new CashError("Огноо буруу байна.", 422, "CASH_DATE_INVALID", { occurredAt: "Огноо буруу байна." });
  }
  if (date.getTime() > now.getTime() + MAX_FUTURE_MS) {
    throw new CashError("Ирээдүйн огноо оруулах боломжгүй.", 422, "CASH_DATE_INVALID", { occurredAt: "Ирээдүйн огноо оруулах боломжгүй." });
  }
  return date;
}

export function normalizeOptionalText(value: unknown, field: string, max: number): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") throw new CashError("Талбар буруу байна.", 422, "CASH_FIELD_INVALID", { [field]: "Талбар буруу байна." });
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length > max) throw new CashError(`Хамгийн ихдээ ${max} тэмдэгт.`, 422, "CASH_FIELD_INVALID", { [field]: `Хамгийн ихдээ ${max} тэмдэгт.` });
  return trimmed;
}

export function requireVoidReason(value: unknown): string {
  const reason = typeof value === "string" ? value.trim() : "";
  if (!reason) throw new CashError("Хүчингүй болгох шалтгаанаа бичнэ үү.", 422, "CASH_VOID_REASON_REQUIRED", { reason: "Шалтгаан шаардлагатай." });
  if (reason.length > MAX_VOID_REASON_LENGTH) {
    throw new CashError(`Шалтгаан хамгийн ихдээ ${MAX_VOID_REASON_LENGTH} тэмдэгт.`, 422, "CASH_VOID_REASON_REQUIRED", { reason: "Шалтгаан хэт урт байна." });
  }
  return reason;
}

/** taxIncluded: EXPENSE only; positive, ≤ amount. null/undefined/"" -> null. */
export function resolveTaxIncluded(direction: CashDirectionValue, value: unknown, amount: Prisma.Decimal): Prisma.Decimal | null {
  if (value === undefined || value === null || value === "") return null;
  if (direction !== "EXPENSE") {
    throw new CashError("Татвар зөвхөн зарлагад бүртгэгдэнэ.", 422, "CASH_TAX_INVALID", { taxIncluded: "Татвар зөвхөн зарлагад бүртгэгдэнэ." });
  }
  const tax = parseCashAmount(value);
  if (!tax || tax.gt(amount)) {
    throw new CashError("Татварын дүн буруу байна.", 422, "CASH_TAX_INVALID", { taxIncluded: "Татварын дүн буруу байна." });
  }
  return tax;
}

export function normalizeTypeName(value: unknown): string {
  const name = typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
  if (!name || name.length > MAX_TYPE_NAME_LENGTH) {
    throw new CashError(`Нэр 1–${MAX_TYPE_NAME_LENGTH} тэмдэгт байна.`, 422, "CASH_TYPE_NAME_INVALID", { name: `Нэр 1–${MAX_TYPE_NAME_LENGTH} тэмдэгт байна.` });
  }
  return name;
}

/** A system type's name / active flag are locked. */
export function assertTypeEditable(type: { systemKey: string | null }): void {
  if (type.systemKey) throw new CashError("Системийн төрлийг өөрчлөх боломжгүй.", 422, "CASH_TYPE_SYSTEM");
}

/** Manual entries may only use active types of the matching direction (system types are auto-only). */
export function assertTypeUsableForEntry(
  type: { direction: string; isActive: boolean; systemKey: string | null } | null,
  direction: CashDirectionValue,
): void {
  if (!type || !type.isActive || type.direction !== direction || type.systemKey) {
    throw new CashError("Төрөл буруу байна.", 422, "CASH_TYPE_INVALID", { typeId: "Төрөл буруу байна." });
  }
}

/** An entry created by payment/order sync (or a settlement) can only be voided by its source action. */
export function isSystemEntry(entry: { orderPaymentId: string | null; orderId: string | null; settlementId: string | null }): boolean {
  return entry.orderPaymentId != null || entry.orderId != null || entry.settlementId != null;
}

export function assertManuallyVoidable(entry: { voidedAt: Date | null; orderPaymentId: string | null; orderId: string | null; settlementId: string | null; type?: { systemKey: string | null } | null }): void {
  if (entry.voidedAt) throw new CashError("Бичлэг аль хэдийн хүчингүй болсон.", 422, "CASH_ALREADY_VOIDED");
  // Legacy B2 rows (CLOSED_SESSION_VOID_*) may still exist in dev DBs; they stay uneditable system entries.
  if (entry.type?.systemKey != null && LEGACY_SYSTEM_TYPE_KEYS.includes(entry.type.systemKey)) {
    throw new CashError("Хаагдсан ээлжийн буцаалтын бичлэгийг гараар хүчингүй болгох боломжгүй.", 422, "CASH_SYSTEM_ENTRY");
  }
  if (isSystemEntry(entry)) {
    throw new CashError("Автомат бичлэгийг гараар хүчингүй болгох боломжгүй.", 422, "CASH_SYSTEM_ENTRY");
  }
}

export type TotalsRow = {
  direction: string;
  amount: { toString(): string };
  voidedAt: Date | null;
  /** Informational only — never part of a total. */
  taxIncluded?: { toString(): string } | null;
};

/** Income / expense / net over live (non-voided) rows. taxIncluded is NOT summed anywhere. */
export function computeCashTotals(rows: readonly TotalsRow[]) {
  let income = new Prisma.Decimal(0);
  let expense = new Prisma.Decimal(0);
  let count = 0;
  for (const row of rows) {
    if (row.voidedAt) continue;
    const amount = new Prisma.Decimal(row.amount.toString());
    if (row.direction === "INCOME") income = income.plus(amount);
    else if (row.direction === "EXPENSE") expense = expense.plus(amount);
    else continue;
    count += 1;
  }
  return { income, expense, net: income.minus(expense), count };
}
