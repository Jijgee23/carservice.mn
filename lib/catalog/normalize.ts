// Нэгдсэн сангийн (CatalogItem) давхардлын түлхүүр — client/server хоёуланд
// (Prisma-гүй). DB-ийн partial unique индексүүд эдгээрийг ашиглана
// (prisma/migrations/20261105150000_catalog_items). Түлхүүрийг үргэлж энд
// (JS) тооцно — Postgres-ийн lower() кирилл үсэгт locale-оос хамаарч зөрж болно.

/** Нэр: хоёр талын зай хасаж, дотоод олон зайг нэг болгож, жижиг үсгээр. */
export function normalizeCatalogName(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

/** Код: бүх зайг хасаж том үсгээр; хоосон бол null. */
export function normalizeCatalogCode(code: string | null | undefined): string | null {
  const key = (code ?? "").replace(/\s+/g, "").toUpperCase();
  return key || null;
}

/** Баркод: зай хасаж том үсгээр; хоосон бол null. */
export function normalizeBarcode(barcode: string | null | undefined): string | null {
  const v = (barcode ?? "").replace(/\s+/g, "").toUpperCase();
  return v || null;
}

/** Баркодын хэлбэр: 4–64 тэмдэгт, үсэг/тоо/-/. (EAN-13, UPC-A, Code128 г.м.). */
export function isValidBarcode(barcode: string): boolean {
  return /^[0-9A-Z.\-]{4,64}$/.test(barcode);
}

/** Харагдах нэр — зай цэвэрлэсэн (жижиг үсгээр биш). */
export function cleanCatalogName(name: string): string {
  return name.trim().replace(/\s+/g, " ");
}
