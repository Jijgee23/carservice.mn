// Байгууллагын холбоо барих тогтмол мэдээлэл (footer + /contact + /privacy).
export const CONTACT = {
  org: "Инфосистемс",
  website: "infosystems.mn",
  email: "contact@infosystems.mn",
  phones: ["8870116399", "70126399", "91916549"],
  address:
    "Улаанбаатар хот, Чингэлтэй дүүрэг, 5-р хороо, Баянбогд плаза, 402 тоот",
  copyright: "© 2026 он. infosystems.mn зохиогчийн эрхээр хамгаалагдсан.",
  developerUrl: "https://www.infosystems.mn",
  developerName: "Infosystems LLC",
} as const;

/**
 * Super admin-ийн оруулсан утасны жагсаалтыг задлана (таслал/шинэ мөрөөр).
 * Зөвшөөрөх тэмдэгт: цифр, зай, +, -, (, ). Цифрийн тоо 6–15. Давхардлыг хасна.
 */
export function parseContactPhones(raw: string): { ok: true; phones: string[] } | { ok: false; error: string } {
  const parts = raw
    .split(/[,\n;]+/)
    .map((p) => p.trim().replace(/\s+/g, " "))
    .filter(Boolean);
  if (parts.length > 6) return { ok: false, error: "Хамгийн ихдээ 6 дугаар оруулна." };
  const phones: string[] = [];
  for (const p of parts) {
    const digits = p.replace(/\D/g, "");
    if (!/^[\d\s+()-]+$/.test(p) || digits.length < 6 || digits.length > 15) {
      return { ok: false, error: `«${p}» буруу утасны дугаар байна.` };
    }
    if (!phones.includes(p)) phones.push(p);
  }
  return { ok: true, phones };
}
