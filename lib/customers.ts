import { formatPhone } from "@/lib/phone";

// Нэр байхгүй үед автоматаар тавьдаг placeholder-ууд — эдгээрийг "нэргүй" гэж
// үзэж, оронд нь утасны дугаарыг харуулна.
const PLACEHOLDER_NAMES = new Set([
  "Нэргүй",
  "Цаг захиалсан хэрэглэгч",
  "Цаг захиалсан үйлчлүүлэгч",
]);

// Үйлчлүүлэгчийн дэлгэцэнд харуулах нэр. Бодит нэр байвал түүнийг, эс бөгөөс
// (хоосон эсвэл placeholder) утасны дугаарыг форматлаж харуулна. Placeholder
// текст ("Нэргүй", "Цаг захиалсан хэрэглэгч") хаана ч харагдахгүй.
// Сервер ба клиент component хоёуланд хэрэглэнэ.
export function customerLabel(
  c: { fullName?: string | null; phone?: string | null } | null | undefined,
): string {
  const name = c?.fullName?.trim();
  if (name && !PLACEHOLDER_NAMES.has(name)) return name;
  const phone = c?.phone?.trim();
  if (phone) return formatPhone(phone);
  return "Нэргүй";
}

/**
 * Phase 4a: жагсаалт/дэлгэрэнгүйд харуулах гарчиг. Байгууллагад orgName үндсэн,
 * холбогдох хүний нэр (customerLabel) хоёрдогч; хувь хүнд хоёрдогч байхгүй.
 */
export function customerDisplay(
  c:
    | {
        fullName?: string | null;
        phone?: string | null;
        isOrganization?: boolean | null;
        orgName?: string | null;
      }
    | null
    | undefined,
): { primary: string; secondary: string | null; isOrganization: boolean } {
  const contact = customerLabel(c);
  const orgName = c?.orgName?.trim();
  if (c?.isOrganization && orgName) {
    return { primary: orgName, secondary: contact, isOrganization: true };
  }
  return { primary: contact, secondary: null, isOrganization: Boolean(c?.isOrganization) };
}

/** Байгууллагын регистрийн шошго — «РД 1234567». Хувь хүн/регистргүй бол null. */
export function orgRegnumLabel(
  c: { isOrganization?: boolean | null; orgRegnum?: string | null } | null | undefined,
): string | null {
  const regnum = c?.orgRegnum?.trim();
  return c?.isOrganization && regnum ? `РД ${regnum}` : null;
}

/**
 * Select-ийн hint: хайлт label+hint дээр явдаг тул регистр энд орсноор
 * picker-ууд регистрээр хайна. «Байгууллага · РД 1234567 · 99112233».
 */
export function customerPickerHint(
  c:
    | {
        phone?: string | null;
        isOrganization?: boolean | null;
        orgRegnum?: string | null;
      }
    | null
    | undefined,
  extra?: string | null,
): string {
  return [c?.isOrganization ? "Байгууллага" : null, extra, orgRegnumLabel(c), c?.phone]
    .filter(Boolean)
    .join(" · ");
}
