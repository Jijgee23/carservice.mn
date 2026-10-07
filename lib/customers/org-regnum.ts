// Phase 4a — Байгууллагын регистрийн дугаарын цэвэр (pure) validator. Байгууллагын
// регистр = яг 7 оронтой тоо. Хүний регистр (2 үсэг + 8 цифр) болон бусад бүх
// хэлбэр татгалзагдана. `lib/hur_service.ts#ownerKindFromRegnum` ижил дүрмээр
// "Байгууллага"-ыг танина.

export const ORG_REGNUM_MESSAGE = "Байгууллагын регистр 7 оронтой тоо байна.";

const ORG_REGNUM_RE = /^\d{7}$/;

export function isValidOrgRegnum(value: string | null | undefined): boolean {
  return ORG_REGNUM_RE.test((value ?? "").trim());
}

/** Зөв бол trim хийсэн 7 оронтой утга, эс бөгөөс null. */
export function normalizeOrgRegnum(value: string | null | undefined): string | null {
  const v = (value ?? "").trim();
  return ORG_REGNUM_RE.test(v) ? v : null;
}

/** Алдаа байвал мессеж, үгүй бол null. */
export function orgRegnumError(value: string | null | undefined): string | null {
  return isValidOrgRegnum(value) ? null : ORG_REGNUM_MESSAGE;
}
