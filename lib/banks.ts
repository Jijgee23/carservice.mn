// Хүлээн авсан банкны тогтмол жагсаалт. DB-д String код хэлбэрээр хадгална
// (enum биш) — шинэ банк нэмэхэд зөвхөн энд нэмнэ.
// Tenant.enabledBanks хоосон бол БҮХ банк идэвхтэй.

export const BANKS = [
  { code: "KHAN", label: "Хаан банк" },
  { code: "GOLOMT", label: "Голомт банк" },
  { code: "TDB", label: "Худалдаа хөгжлийн банк" },
  { code: "STATE", label: "Төрийн банк" },
  { code: "XAC", label: "Хас банк" },
  { code: "CAPITRON", label: "Капитрон банк" },
  { code: "ARIG", label: "Ариг банк" },
  { code: "BOGD", label: "Богд банк" },
  { code: "TRANS", label: "Тээвэр хөгжлийн банк" },
  { code: "NIBANK", label: "Үндэсний хөрөнгө оруулалтын банк" },
  { code: "CHINGGIS", label: "Чингис хаан банк" },
] as const;

export type BankCode = (typeof BANKS)[number]["code"];

export const BANK_CODES: readonly BankCode[] = BANKS.map((b) => b.code);

export const BANK_LABEL: Record<BankCode, string> = Object.fromEntries(
  BANKS.map((b) => [b.code, b.label]),
) as Record<BankCode, string>;

/** Банк заавал шаардлагатай төлбөрийн аргууд. */
export const BANK_REQUIRED_METHODS: readonly string[] = ["BANK_TRANSFER", "CARD"];

export function isBankCode(value: unknown): value is BankCode {
  return typeof value === "string" && (BANK_CODES as readonly string[]).includes(value);
}

/** Хадгалсан банкийг үргэлж харуулна — үл мэдэгдэх/идэвхгүй код бол кодыг өөрийг нь. */
export function bankLabel(code: string | null | undefined): string {
  if (!code) return "";
  return isBankCode(code) ? BANK_LABEL[code] : code;
}

/** Tenant.enabledBanks → идэвхтэй кодууд. Хоосон (эсвэл танигдах код байхгүй) = бүх банк. */
export function enabledBanksFor(enabledBanks: readonly string[] | null | undefined): BankCode[] {
  const known = BANK_CODES.filter((code) => (enabledBanks ?? []).includes(code));
  return known.length > 0 ? known : [...BANK_CODES];
}

export class PaymentBankError extends Error {
  readonly status = 422;
  constructor(
    message: string,
    readonly code: "PAYMENT_BANK_REQUIRED" | "PAYMENT_BANK_NOT_ENABLED",
  ) {
    super(message);
    this.name = "PaymentBankError";
  }
}

/**
 * Төлбөр бүртгэхэд хадгалах банкийг шалгаж буцаана.
 * - BANK_TRANSFER/CARD: заавал; идэвхтэй жагсаалтад байх ёстой.
 * - Бусад арга (CASH/QPAY/OTHER): илгээсэн банкийг үл тооцож null.
 * `enabled` нь enabledBanksFor()-ийн үр дүн (хоосон ирвэл бүх банк гэж үзнэ).
 */
export function assertPaymentBank(
  method: string,
  bank: unknown,
  enabled: readonly string[] | null | undefined,
): BankCode | null {
  if (!BANK_REQUIRED_METHODS.includes(method)) return null;
  const raw = typeof bank === "string" ? bank.trim() : "";
  if (!raw) throw new PaymentBankError("Банкаа сонгоно уу.", "PAYMENT_BANK_REQUIRED");
  const allowed = enabledBanksFor(enabled);
  if (!isBankCode(raw) || !allowed.includes(raw)) {
    throw new PaymentBankError("Энэ банк идэвхгүй байна.", "PAYMENT_BANK_NOT_ENABLED");
  }
  return raw;
}

/** PUT /banks/enabled: кодуудыг шалгаж, давхардлыг арилгана; танигдаагүй код байвал null. */
export function normalizeEnabledBanks(input: unknown): BankCode[] | null {
  if (!Array.isArray(input)) return null;
  const out: BankCode[] = [];
  for (const item of input) {
    if (!isBankCode(item)) return null;
    if (!out.includes(item)) out.push(item);
  }
  return BANK_CODES.filter((code) => out.includes(code));
}
