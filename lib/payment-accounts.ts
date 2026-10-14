// Tenant-defined payment methods (Төлбөрийн аргууд: Бэлэн / Данс / POS). Replaces the fixed catalog in the old lib/banks.ts.
// CASH <-> CASH, BANK_ACCOUNT <-> BANK_TRANSFER, POS <-> CARD. Payments reference an account by bankId (FK).
// CASH accounts are optional: a CASH payment without one stays valid (bankId null) — the drawer is one per shift.

export const PAYMENT_ACCOUNT_TYPES = ["CASH", "BANK_ACCOUNT", "POS"] as const;
export type PaymentAccountTypeValue = (typeof PAYMENT_ACCOUNT_TYPES)[number];

/** Types a tenant adds itself. «Бэлэн» is not one: every tenant has exactly one, created automatically. */
export const CREATABLE_PAYMENT_ACCOUNT_TYPES = ["BANK_ACCOUNT", "POS"] as const;
export const DEFAULT_CASH_ACCOUNT_NAME = "Бэлэн";

/** Төлбөрийн аргууд, банк/данс заавал шаардлагатай. */
export const BANK_REQUIRED_METHODS: readonly string[] = ["BANK_TRANSFER", "CARD"];

/** Шинэ данс нэмэх формын нэрийн санал (чөлөөт бичиж болно). */
export const BANK_NAME_SUGGESTIONS: readonly string[] = [
  "Хаан банк",
  "Голомт банк",
  "Худалдаа хөгжлийн банк",
  "Төрийн банк",
  "Хас банк",
  "Капитрон банк",
  "Ариг банк",
  "Богд банк",
  "Тээвэр хөгжлийн банк",
  "Үндэсний хөрөнгө оруулалтын банк",
  "Чингис хаан банк",
];

export const TEST_BADGE = "Туршилт";
export const INACTIVE_SUFFIX = " (идэвхгүй)";
export const PAYMENT_ACCOUNTS_EMPTY = "Төлбөрийн арга бүртгээгүй байна";
export const PAYMENT_ACCOUNTS_ADD_LINK = "Төлбөрийн арга нэмэх";

export const PAYMENT_ACCOUNT_TYPE_LABEL: Record<PaymentAccountTypeValue, string> = {
  CASH: "Бэлэн",
  BANK_ACCOUNT: "Данс",
  POS: "POS",
};

export type PaymentAccountErrorCode =
  | "PAYMENT_BANK_REQUIRED"
  | "PAYMENT_BANK_NOT_ENABLED"
  | "PAYMENT_BANK_TYPE_MISMATCH"
  | "PAYMENT_ACCOUNT_DUPLICATE"
  | "PAYMENT_ACCOUNT_INVALID"
  | "PAYMENT_ACCOUNT_NOT_FOUND"
  | "CASH_MANAGE_FORBIDDEN";

export class PaymentAccountError extends Error {
  constructor(
    message: string,
    readonly code: PaymentAccountErrorCode,
    readonly status = 422,
    readonly fieldErrors?: Record<string, string>,
  ) {
    super(message);
    this.name = "PaymentAccountError";
  }
}

export function typeForMethod(method: string): PaymentAccountTypeValue | null {
  if (method === "CASH") return "CASH";
  if (method === "BANK_TRANSFER") return "BANK_ACCOUNT";
  if (method === "CARD") return "POS";
  return null;
}

export function methodForType(type: PaymentAccountTypeValue): "CASH" | "BANK_TRANSFER" | "CARD" {
  if (type === "CASH") return "CASH";
  return type === "POS" ? "CARD" : "BANK_TRANSFER";
}

/** Digits only; null when nothing usable is left. Length rules live in the service validator. */
export function normalizeAccountNumber(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const digits = raw.replace(/\D+/g, "");
  return digits.length > 0 ? digits : null;
}

export function maskAccountNumber(number: string | null | undefined): string {
  if (!number) return "";
  return `••••${number.length > 4 ? number.slice(-4) : ""}`;
}

/**
 * Creates the tenant's one «Бэлэн» row if it is missing (signup; the migration backfilled existing tenants).
 * skipDuplicates = ON CONFLICT DO NOTHING, so the partial unique index makes concurrent calls safe.
 */
export async function ensureCashAccount(
  client: { paymentAccount: { createMany(args: never): Promise<unknown> } },
  tenantId: string,
): Promise<void> {
  const writer = client.paymentAccount as unknown as { createMany(args: unknown): Promise<unknown> };
  await writer.createMany({ data: [{ tenantId, type: "CASH", name: DEFAULT_CASH_ACCOUNT_NAME }], skipDuplicates: true });
}

export type ResolvedPaymentAccount = {
  id: string;
  type: PaymentAccountTypeValue;
  name: string;
  isTest: boolean;
  legacyCode: string | null;
};

type AccountRow = {
  id: string;
  type: string;
  name: string;
  isTest: boolean;
  isActive: boolean;
  legacyCode: string | null;
};

/** Structural so both the real transaction client and test fakes satisfy it. */
export type PaymentAccountReader = {
  paymentAccount: { findFirst(args: never): Promise<unknown> };
};

const RESOLVE_SELECT = { id: true, type: true, name: true, isTest: true, isActive: true, legacyCode: true } as const;

/**
 * Resolves the account a CASH / BANK_TRANSFER / CARD payment is recorded against, inside the caller's transaction.
 * `raw` is a PaymentAccount id, or (older apps) a legacy bank code such as "KHAN" which maps to this tenant's
 * legacy row of the type the method implies. CASH: the account is optional — empty `raw`, or anything that is not
 * one of this tenant's CASH rows (older clients may send a stale bank code), resolves to null as before.
 * Other methods return null and ignore `raw`.
 * Errors (all 422): REQUIRED, NOT_ENABLED (unknown / other tenant / inactive), TYPE_MISMATCH.
 */
export async function resolvePaymentAccount(
  tx: PaymentAccountReader,
  tenantId: string,
  method: string,
  raw: unknown,
): Promise<ResolvedPaymentAccount | null> {
  const wantedType = typeForMethod(method);
  if (!wantedType) return null;
  const key = typeof raw === "string" ? raw.trim() : "";
  if (!key && wantedType === "CASH") return null;
  if (!key) throw new PaymentAccountError("Банк / данс сонгоно уу.", "PAYMENT_BANK_REQUIRED");
  const reader = tx.paymentAccount as unknown as { findFirst(args: unknown): Promise<AccountRow | null> };
  let row = await reader.findFirst({ where: { tenantId, id: key }, select: RESOLVE_SELECT });
  if (wantedType === "CASH") {
    if (!row || row.type !== "CASH") return null;
  } else if (!row) {
    // Legacy bank code from an older client: this tenant's legacy row of the type the method implies.
    row = await reader.findFirst({ where: { tenantId, legacyCode: key, type: wantedType }, select: RESOLVE_SELECT });
  }
  if (!row || !row.isActive) throw new PaymentAccountError("Энэ банк / данс идэвхгүй байна.", "PAYMENT_BANK_NOT_ENABLED");
  if (row.type !== wantedType) {
    throw new PaymentAccountError("Төлбөрийн аргад тохирохгүй банк / данс байна.", "PAYMENT_BANK_TYPE_MISMATCH");
  }
  return { id: row.id, type: row.type as PaymentAccountTypeValue, name: row.name, isTest: row.isTest, legacyCode: row.legacyCode };
}

export const BANK_REF_SELECT = { id: true, name: true, type: true, isTest: true, isActive: true, legacyCode: true, accountNumber: true, terminalId: true } as const;

export type BankRefSource = {
  id: string;
  name: string;
  type: string;
  isTest: boolean;
  isActive: boolean;
  legacyCode: string | null;
  accountNumber?: string | null;
  terminalId?: string | null;
} | null | undefined;

type AccountHintSource = { type: string; accountNumber?: string | null; terminalId?: string | null };

/**
 * Short identifier that tells same-named accounts apart: POS -> «TID …» (falls back to the account number),
 * account -> the full account number. CASH has none.
 */
export function paymentAccountHint(account: AccountHintSource): string | null {
  const tid = account.terminalId?.trim();
  if (account.type === "POS" && tid) return `TID ${tid}`;
  const number = account.accountNumber?.replace(/\s+/g, "") ?? "";
  return number || null;
}

/** Full display label: «Нэр 5012345678 · Туршилт (идэвхгүй)». Used where accounts are listed side by side (shift, report). */
export function paymentAccountLabel(account: AccountHintSource & { name: string; isTest: boolean; isActive: boolean }): string {
  const hint = paymentAccountHint(account);
  return `${account.name}${hint ? ` ${hint}` : ""}${account.isTest ? ` · ${TEST_BADGE}` : ""}${account.isActive ? "" : INACTIVE_SUFFIX}`;
}

/** The bank fields every payment / ledger / settlement payload carries. `bank` is the legacy code (or null). */
export function bankRef(account: BankRefSource) {
  if (!account) {
    return { bankId: null as string | null, bank: null as string | null, bankLabel: null as string | null, bankHint: null as string | null, bankType: null as PaymentAccountTypeValue | null, bankIsTest: false };
  }
  return {
    bankId: account.id as string | null,
    bank: account.legacyCode as string | null,
    bankLabel: (account.isActive ? account.name : `${account.name}${INACTIVE_SUFFIX}`) as string | null,
    bankHint: paymentAccountHint(account),
    bankType: account.type as PaymentAccountTypeValue | null,
    bankIsTest: account.isTest,
  };
}

export type LabelReader = {
  paymentAccount: { findMany(args: never): Promise<unknown> };
};

/** id -> display label (see paymentAccountLabel). One tenant-scoped query; none for an empty list. */
export async function loadPaymentAccountLabels(client: LabelReader, tenantId: string, ids: readonly string[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter((id) => id))];
  const out = new Map<string, string>();
  if (unique.length === 0) return out;
  const reader = client.paymentAccount as unknown as {
    findMany(args: unknown): Promise<Array<{ id: string; name: string; type: string; accountNumber: string | null; terminalId: string | null; isTest: boolean; isActive: boolean }>>;
  };
  const rows = await reader.findMany({
    where: { tenantId, id: { in: unique } },
    select: { id: true, name: true, type: true, accountNumber: true, terminalId: true, isTest: true, isActive: true },
  });
  for (const r of rows) out.set(r.id, paymentAccountLabel(r));
  return out;
}
