import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { Prisma } from "../app/generated/prisma/client";
import { CATALOG_ITEM_NOT_FOUND, type CatalogDb, isCatalogKind, resolveCatalogItem } from "../lib/catalog/catalog-commands";
import { cleanCatalogName, normalizeCatalogCode, normalizeCatalogName } from "../lib/catalog/normalize";

type Row = { id: string; type: string; name: string; nameKey: string; code: string | null; codeKey: string | null; barcode: string | null; isActive: boolean };

function fakeDb(rows: Row[] = []): { db: CatalogDb; rows: Row[] } {
  const matches = (r: Row, w: Record<string, unknown>) =>
    Object.entries(w).every(([k, v]) => (r as Record<string, unknown>)[k] === v);
  const db: CatalogDb = {
    catalogItem: {
      async findFirst({ where }) {
        const r = rows.find((x) => matches(x, where as Record<string, unknown>));
        return r ? { id: r.id, name: r.name, code: r.code, barcode: r.barcode } : null;
      },
      async create({ data }) {
        const r: Row = {
          id: `c${rows.length + 1}`,
          type: data.type as string,
          name: data.name,
          nameKey: data.nameKey,
          code: data.code ?? null,
          codeKey: data.codeKey ?? null,
          barcode: data.barcode ?? null,
          isActive: true,
        };
        rows.push(r);
        return { id: r.id, name: r.name, code: r.code, barcode: r.barcode };
      },
    },
  };
  return { db, rows };
}

const base = {
  type: "GOODS" as const,
  catalogItemId: null,
  name: "  Тосны   шүүлтүүр ",
  code: null,
  barcode: null,
  unitName: "ширхэг",
  durationValue: null,
  durationUnitName: null,
  systemCategoryId: null,
  price: new Prisma.Decimal(25000),
  description: null,
  tenantId: "t1",
};

test("normalisation: name lower-cased with collapsed spaces; code upper-cased without spaces", () => {
  assert.equal(normalizeCatalogName("  Тосны   ШҮҮЛТҮҮР "), "тосны шүүлтүүр");
  assert.equal(cleanCatalogName("  Тосны   шүүлтүүр "), "Тосны шүүлтүүр");
  assert.equal(normalizeCatalogCode(" of - 1 "), "OF-1");
  assert.equal(normalizeCatalogCode("   "), null);
  assert.equal(isCatalogKind("DIAGNOSTIC"), false);
});

test("a new manual entry is added to the shared catalog", async () => {
  const { db, rows } = fakeDb();
  const r = await resolveCatalogItem(db, base);
  assert.ok(r.ok && r.item.created);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].name, "Тосны шүүлтүүр");
  assert.equal(rows[0].nameKey, "тосны шүүлтүүр");
});

test("same name (no code) from another tenant links to the existing row instead of duplicating", async () => {
  const { db, rows } = fakeDb();
  await resolveCatalogItem(db, base);
  const r = await resolveCatalogItem(db, { ...base, tenantId: "t2", name: "тосны шүүлтүүр" });
  assert.ok(r.ok && !r.item.created);
  assert.equal(rows.length, 1);
});

test("a code matches by code only — same name with a different code stays a separate item", async () => {
  const { db, rows } = fakeDb();
  await resolveCatalogItem(db, { ...base, code: "OF-1" });
  const same = await resolveCatalogItem(db, { ...base, tenantId: "t2", name: "Өөр нэр", code: "of-1" });
  assert.ok(same.ok && !same.item.created && same.item.name === "Тосны шүүлтүүр");
  const other = await resolveCatalogItem(db, { ...base, tenantId: "t3", code: "OF-2" });
  assert.ok(other.ok && other.item.created);
  assert.equal(rows.length, 2);
});

test("picking a catalog row uses it; an unknown/inactive id is rejected", async () => {
  const { db } = fakeDb([{ id: "x1", type: "GOODS", name: "Тормозны колодк", nameKey: "тормозны колодк", code: "BP-1", codeKey: "BP-1", barcode: null, isActive: true }]);
  const picked = await resolveCatalogItem(db, { ...base, catalogItemId: "x1", name: "whatever" });
  assert.ok(picked.ok && picked.item.id === "x1" && picked.item.code === "BP-1");
  const missing = await resolveCatalogItem(db, { ...base, catalogItemId: "nope" });
  assert.deepEqual(missing, { ok: false, message: CATALOG_ITEM_NOT_FOUND });
});

test("a barcode match wins over code/name and the new item keeps the barcode", async () => {
  const { db, rows } = fakeDb();
  const first = await resolveCatalogItem(db, { ...base, code: "OF-1", barcode: " 8801234567890 " });
  assert.ok(first.ok && first.item.created && first.item.barcode === "8801234567890");
  // Different code and name, same barcode → same catalog item.
  const again = await resolveCatalogItem(db, { ...base, tenantId: "t2", name: "Oil filter", code: "ZZ-9", barcode: "8801234567890" });
  assert.ok(again.ok && !again.item.created && again.item.id === first.item.id);
  assert.equal(rows.length, 1);
  // Barcodes are ignored for labour.
  const labor = await resolveCatalogItem(db, { ...base, type: "LABOR", name: "Тос солих", barcode: "8801234567890" });
  assert.ok(labor.ok && labor.item.created && labor.item.barcode === null);
});

test("every create path goes through the catalog link; tenant edits cannot rename a linked service", () => {
  const read = (rel: string) => fs.readFileSync(path.join(__dirname, "..", rel), "utf8");
  assert.match(read("lib/services/service-create.ts"), /linkServiceToCatalog\(actor\.tenantId/);
  assert.match(read("app/api/v1/services/route.ts"), /linkServiceToCatalog\(auth\.user\.tenantId/);
  const update = read("lib/services/service-commands.ts");
  assert.match(update, /if \(current\?\.catalogItemId\) \{\s*data\.name = current\.name;\s*data\.code = current\.code;/);
});
