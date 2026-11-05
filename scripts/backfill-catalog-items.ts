/**
 * Одоо байгаа ажил (LABOR) / сэлбэг (GOODS)-ийг НЭГДСЭН санд (CatalogItem)
 * оруулж холбоно — `20261105150000_catalog_items` migration-ийн дараа НЭГ удаа.
 *
 *   npx tsx scripts/backfill-catalog-items.ts --dry-run   # юу хийхийг л хэвлэнэ
 *   npx tsx scripts/backfill-catalog-items.ts             # бичнэ
 *
 * Дүрэм (app-тай ижил — lib/catalog/normalize.ts, catalog-commands.ts):
 *   - Түлхүүр: кодтой бол (type, codeKey), кодгүй бол (type, nameKey).
 *   - Ижил түлхүүртэй service-үүд НЭГ сангийн мөрд нэгтгэгдэнэ; мөрийн
 *     нэр/код/нэгж/үнэ/тайлбар нь хамгийн эрт үүссэн service-ээс, ангилал нь
 *     системийн ангилал бол л.
 *   - Санд аль хэдийн таарах мөр байвал (давтан ажиллуулах) түүнийг ашиглана —
 *     idempotent.
 *   - Нэг тенант нэг түлхүүрт хоёр service-тэй бол эхнийхийг л холбоно
 *     (Service @@unique[tenantId, catalogItemId]); бусад нь холбоогүй үлдэж
 *     тайланд гарна.
 *   - Холбогдсон service-ийн нэр/код сангийнхаар солигдоно (тенант дотор код
 *     давхцах бол нэрийг л sync хийж, кодыг хэвээр үлдээнэ).
 */
import "dotenv/config";
import { normalizeCatalogCode, normalizeCatalogName, cleanCatalogName } from "@/lib/catalog/normalize";
import { prisma } from "@/lib/prisma";
import { setBypassContext } from "@/lib/tenant-context";

type Kind = "LABOR" | "GOODS";

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  setBypassContext();

  const services = await prisma.service.findMany({
    where: { type: { in: ["LABOR", "GOODS"] }, catalogItemId: null },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      tenantId: true,
      type: true,
      name: true,
      code: true,
      price: true,
      description: true,
      durationValue: true,
      unit: { select: { name: true } },
      durationUnit: { select: { name: true } },
      category: { select: { id: true, tenantId: true } },
    },
  });

  const keyOf = (type: Kind, name: string, code: string | null) => {
    const codeKey = normalizeCatalogCode(code);
    return codeKey ? `${type}|c|${codeKey}` : `${type}|n|${normalizeCatalogName(name)}`;
  };

  // Санд аль хэдийн байгаа мөрүүд (давтан ажиллуулах үед).
  const existing = await prisma.catalogItem.findMany({ select: { id: true, type: true, name: true, code: true, codeKey: true, nameKey: true } });
  const itemByKey = new Map<string, { id: string; name: string; code: string | null }>();
  for (const it of existing) {
    const k = it.codeKey ? `${it.type}|c|${it.codeKey}` : `${it.type}|n|${it.nameKey}`;
    itemByKey.set(k, it);
  }
  const linkedPairs = new Set(
    (await prisma.service.findMany({ where: { catalogItemId: { not: null } }, select: { tenantId: true, catalogItemId: true } }))
      .map((s) => `${s.tenantId}|${s.catalogItemId}`),
  );

  let createdItems = 0;
  let linked = 0;
  const skipped: string[] = [];

  for (const svc of services) {
    const type = svc.type as Kind;
    const key = keyOf(type, svc.name, svc.code);
    let item = itemByKey.get(key);
    if (!item) {
      const name = cleanCatalogName(svc.name);
      const code = normalizeCatalogCode(svc.code);
      if (dryRun) {
        item = { id: `dry-${createdItems}`, name, code };
      } else {
        item = await prisma.catalogItem.create({
          data: {
            type,
            name,
            nameKey: normalizeCatalogName(name),
            code,
            codeKey: code,
            unitName: svc.unit?.name ?? "",
            durationValue: type === "LABOR" ? svc.durationValue : null,
            durationUnitName: type === "LABOR" ? (svc.durationUnit?.name ?? null) : null,
            categoryId: svc.category && svc.category.tenantId === null ? svc.category.id : null,
            price: svc.price,
            description: svc.description,
            createdByTenantId: svc.tenantId,
          },
          select: { id: true, name: true, code: true },
        });
      }
      itemByKey.set(key, item);
      createdItems++;
    }

    const pair = `${svc.tenantId}|${item.id}`;
    if (linkedPairs.has(pair)) {
      skipped.push(`${svc.tenantId} · ${svc.name}${svc.code ? ` (${svc.code})` : ""} — тенантад ижил мөр аль хэдийн холбогдсон`);
      continue;
    }
    linkedPairs.add(pair);
    if (!dryRun) {
      try {
        await prisma.service.update({ where: { id: svc.id }, data: { catalogItemId: item.id, name: item.name, code: item.code } });
      } catch {
        // Тенант дотор код давхцвал нэрийг л sync хийнэ.
        await prisma.service.update({ where: { id: svc.id }, data: { catalogItemId: item.id, name: item.name } });
      }
    }
    linked++;
  }

  console.log(`${dryRun ? "[dry-run] " : ""}service: ${services.length}, шинэ сангийн мөр: ${createdItems}, холбосон: ${linked}, алгассан: ${skipped.length}`);
  for (const line of skipped.slice(0, 50)) console.log("  алгассан:", line);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
