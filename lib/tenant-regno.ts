// Tenant (бүртгүүлэгч)-ийн регистр: байгууллага = 7 оронтой тоо,
// хувь хүн = 2 кирилл үсэг + 8 цифр (ж: ҮҮ99993333). Хэлбэрээр нь төрлийг ялгана.

export type RegnoKind = "org" | "person";

const ORG_RE = /^\d{7}$/;
const PERSON_RE = /^[А-ЯЁӨҮ]{2}\d{8}$/u;

export const TENANT_REGNO_MESSAGE =
  "Регистр буруу: байгууллага бол 7 оронтой тоо, хувь хүн бол 2 үсэг + 8 цифр (ж: ҮҮ99993333).";

/** Зай хасаад үсгийг том болгоно. */
export function normalizeRegno(raw: string): string {
  return raw.replace(/\s+/g, "").toUpperCase();
}

/** Хэлбэрээс нь байгууллага/хувь хүн гэж ялгана; таарахгүй бол null. */
export function regnoKind(raw: string): RegnoKind | null {
  const v = normalizeRegno(raw);
  if (ORG_RE.test(v)) return "org";
  if (PERSON_RE.test(v)) return "person";
  return null;
}

/**
 * Хувь хүний бүтэн нэрийг (eBarimt-аас ирсэн эсвэл гараар бичсэн) овог/нэр болгон
 * хуваана: "Бат Дорж" → Бат / Дорж, "Б.Дорж" → Б / Дорж, ганц үг → овоггүй.
 */
export function splitPersonName(full: string): { lastName: string; firstName: string } {
  const parts = full.trim().split(/[\s.]+/).filter(Boolean);
  if (parts.length === 0) return { lastName: "", firstName: "" };
  const firstName = parts.pop()!;
  return { lastName: parts.join(" "), firstName };
}

/** Хувь хүн бол админы талбарын алдааг 1-р алхмын харгалзах талбар руу шилжүүлнэ. */
const PERSON_ADMIN_FIELD_MAP: Record<string, string> = {
  lastName: "orgName",
  firstName: "orgName",
  adminPhone: "phone1",
  adminEmail: "orgEmail",
};

export function mapPersonAdminErrors(fe: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(fe)) out[PERSON_ADMIN_FIELD_MAP[k] ?? k] ??= v;
  return out;
}
