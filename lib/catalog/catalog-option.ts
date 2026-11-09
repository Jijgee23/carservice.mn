// Server + client хоёуланд ашиглана ("use client" файлд БИШ — server component
// "use client" модулиас тогтмол import хийвэл string биш client reference болно).

/**
 * Засварын хуудасны «мөр нэмэх» сонгогчид нэгдсэн сангийн (тенант хараахан
 * холбоогүй) мөрийн id-ийн угтвар. Илгээхэд `catalogItemId` болж явна —
 * server тенантын ажил/сэлбэг болгон автоматаар холбоно (lib/services/catalog-adopt.ts).
 */
export const CATALOG_OPTION_PREFIX = "catalog:";
