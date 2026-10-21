// «Excel-ээс ажил / сэлбэг оруулах» + export: шалгалтын дүрэм (вэб формтой
// ижил), тааруулалт, бүртгэлтэй код алгасах, багцын хязгаар, export ↔ import гарчиг.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import ExcelJS from "exceljs";

process.env.DATABASE_URL ??= "postgresql://unused/unused";
process.env.SESSION_SECRET ??= "unit-test-placeholder-secret-value-not-real-00";

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

const categories = [
  { id: "c-engine", name: "Хөдөлгүүр" },
  { id: "c-brake", name: "Тоормос" },
];
const units = [
  { id: "u-pcs", name: "ширхэг", code: "ш" },
  { id: "u-min", name: "мин", code: null },
  { id: "u-hr", name: "цаг", code: "ц" },
];
const refs = { unitIds: new Set(units.map((u) => u.id)), categoryIds: new Set(categories.map((c) => c.id)) };

function row(overrides: Record<string, string | number> = {}) {
  return {
    key: "r2",
    excelRow: 2,
    name: "Тосны шүүлтүүр",
    code: "OF-1",
    categoryId: "c-engine",
    categoryRaw: "",
    unitId: "u-pcs",
    unitRaw: "",
    price: "25000",
    costPrice: "",
    stock: "",
    durationValue: "",
    durationUnitId: "",
    durationUnitRaw: "",
    reminderIntervalMonths: "",
    description: "",
    ...overrides,
  } as import("../lib/services/import").ServiceImportRow;
}

test("validateServiceCreate keeps the web-form rules per type", async () => {
  const { validateServiceCreate } = await import("../lib/services/service-create-rules");
  const base = {
    type: "GOODS", name: "Шүүлтүүр", code: " of-1 ", unitId: "u-pcs", price: "25,000", costPrice: "18000", stock: "",
    durationValue: "", durationUnitId: "", reminderIntervalMonths: "", description: "", categoryId: "c-engine", isActive: true,
  };
  const ok = validateServiceCreate(base, refs);
  assert.equal(ok.values?.code, "OF-1");
  assert.equal(ok.values?.price, "25000");
  assert.equal(ok.values?.stock, "0"); // хоосон үлдэгдэл → 0
  const bad = validateServiceCreate({ ...base, name: "", price: "10ш", unitId: "ghost", categoryId: "" }, refs);
  assert.equal(bad.errors.name, "Нэр оруулна уу.");
  assert.equal(bad.errors.price, "Үнэ буруу.");
  assert.equal(bad.errors.unitId, "Сонгосон нэгж олдсонгүй.");
  assert.equal(bad.errors.categoryId, "Ангилал сонгоно уу.");
  // Ажил: хугацааны утга ба нэгж хамт; сэлбэгийн талбарууд орохгүй.
  const labor = { ...base, type: "LABOR", stock: "5", costPrice: "1", durationValue: "30", durationUnitId: "" };
  assert.equal(validateServiceCreate(labor, refs).errors.durationUnitId, "Хугацааны нэгжээ сонгоно уу.");
  const laborOk = validateServiceCreate({ ...labor, durationUnitId: "u-min", reminderIntervalMonths: "6" }, refs);
  assert.equal(laborOk.values?.stock, null);
  assert.equal(laborOk.values?.costPrice, null);
  assert.equal(laborOk.values?.reminderIntervalMonths, 6);
  assert.equal(validateServiceCreate({ ...labor, durationUnitId: "u-min", durationValue: "0" }, refs).errors.durationValue, "Хугацаа эерэг тоо байх ёстой.");
  assert.equal(validateServiceCreate({ ...base, reminderIntervalMonths: "6abc" }, refs).errors.reminderIntervalMonths, "Сар эерэг бүхэл тоо байх ёстой.");
});

test("mapping guesses headers; export headers round-trip into the same mapping", async () => {
  const { guessServiceMapping, SERVICE_IMPORT_FIELDS } = await import("../lib/services/import");
  for (const type of ["GOODS", "LABOR"] as const) {
    const headers = SERVICE_IMPORT_FIELDS[type].map((f) => f.label);
    const m = guessServiceMapping(type, [...headers, "Төлөв"]);
    SERVICE_IMPORT_FIELDS[type].forEach((f, i) => assert.equal(m[f.key], i, `${type}:${f.key}`));
  }
  const loose = guessServiceMapping("GOODS", ["SKU", "Барааны нэр", "Төрөл", "Хэмжих нэгж", "Зарах үнэ", "Авах үнэ", "Нөөц"]);
  assert.deepEqual(
    [loose.code, loose.name, loose.category, loose.unit, loose.price, loose.costPrice, loose.stock],
    [0, 1, 2, 3, 4, 5, 6],
  );
});

test("rows auto-match category by name and unit by name or code", async () => {
  const { buildServiceImportRows } = await import("../lib/services/import");
  const rows = buildServiceImportRows(
    {
      headers: ["Нэр", "Код", "Ангилал", "Нэгж", "Үнэ", "Хугацаа", "Хугацааны нэгж"],
      rows: [
        { excelRow: 2, cells: ["Тос солих", "ts-1", "хөдөлгүүр", "Ц", "30000", "45", "МИН"] },
        { excelRow: 3, cells: ["Угаалга", "", "Угаалга", "м2", "15000", "", ""] },
      ],
    },
    { name: 0, code: 1, category: 2, unit: 3, price: 4, durationValue: 5, durationUnit: 6, costPrice: null, stock: null, reminderIntervalMonths: null, description: null },
    categories,
    units,
  );
  assert.equal(rows[0]!.code, "TS-1");
  assert.equal(rows[0]!.categoryId, "c-engine");
  assert.equal(rows[0]!.unitId, "u-hr");
  assert.equal(rows[0]!.durationUnitId, "u-min");
  assert.equal(rows[1]!.categoryId, "");
  assert.equal(rows[1]!.categoryRaw, "Угаалга");
});

test("client row validation explains unmatched names and in-file code duplicates", async () => {
  const { validateServiceImportRow, findInFileDuplicateCodes } = await import("../lib/services/import");
  const e = validateServiceImportRow("GOODS", row({ categoryId: "", categoryRaw: "Угаалга", unitId: "", unitRaw: "м2" }));
  assert.match(e.categoryId!, /«Угаалга» ангилал олдсонгүй/);
  assert.match(e.unitId!, /«м2» нэгж олдсонгүй/);
  const dups = findInFileDuplicateCodes([row(), row({ key: "r3", excelRow: 3, code: "of-1" }), row({ key: "r4", excelRow: 4, code: "" })]);
  assert.equal(dups.get("r3"), 2);
  assert.equal(dups.has("r4"), false);
});

test("runServiceImport: skips existing codes, validates, enforces the plan quota", async () => {
  const { runServiceImport } = await import("../lib/services/service-import-run");
  const created: string[] = [];
  const result = await runServiceImport({
    type: "GOODS",
    rows: [
      row({ key: "r2", excelRow: 2, code: "OF-1" }), // бүртгэлтэй → алгасна
      row({ key: "r3", excelRow: 3, code: "AF-1", name: "Агаарын шүүлтүүр" }),
      row({ key: "r4", excelRow: 4, code: "BAD", price: "үнэгүй" }),
      row({ key: "r5", excelRow: 5, code: "", name: "Кодгүй" }),
      row({ key: "r6", excelRow: 6, code: "X-9", name: "Хязгаараас хэтэрсэн" }),
    ],
    refs,
    existingCodes: new Set(["OF-1"]),
    remaining: 2,
    limitMessage: "Багцын хязгаар",
    create: async (v) => {
      created.push(v.name);
      return { ok: true, id: `id-${created.length}` };
    },
  });
  assert.deepEqual(result.results.map((r) => [r.key, r.ok]), [["r2", false], ["r3", true], ["r4", false], ["r5", true], ["r6", false]]);
  assert.match(result.results[0]!.error!, /бүртгэлтэй — алгасна/);
  assert.equal(result.results[2]!.fieldErrors?.price, "Үнэ буруу.");
  assert.equal(result.results[4]!.error, "Багцын хязгаар");
  assert.deepEqual(created, ["Агаарын шүүлтүүр", "Кодгүй"]);
  assert.equal(result.succeeded, 2);
});

test("payload guard rejects non-string fields and oversized batches", async () => {
  const { parseServiceImportPayload } = await import("../lib/services/import");
  assert.equal(parseServiceImportPayload([]), null);
  assert.equal(parseServiceImportPayload([{ ...row(), price: 5 }]), null);
  assert.equal(parseServiceImportPayload(Array.from({ length: 501 }, () => row())), null);
  assert.equal(parseServiceImportPayload([{ ...row(), name: "x".repeat(400) }])?.[0]?.name.length, 300);
});

test("export workbook columns equal the import fields (+ Төлөв) and parse back", async () => {
  const { buildServiceWorkbook } = await import("../lib/services/service-export");
  const { parseImportWorkbook } = await import("../lib/import/xlsx-server");
  const { guessServiceMapping, buildServiceImportRows } = await import("../lib/services/import");
  const buffer = await buildServiceWorkbook({
    type: "GOODS",
    withStatus: true,
    rows: [{ code: "OF-1", name: "Шүүлтүүр", category: "Хөдөлгүүр", unit: "ширхэг", price: "25000", costPrice: "18000", stock: "7", durationValue: null, durationUnit: null, reminderIntervalMonths: null, description: null, isActive: true }],
  });
  const sheet = await parseImportWorkbook(buffer);
  assert.deepEqual(sheet.headers, ["Код", "Нэр", "Ангилал", "Нэгж", "Үнэ", "Өртөг", "Үлдэгдэл", "Тайлбар", "Төлөв"]);
  const rows = buildServiceImportRows(sheet, guessServiceMapping("GOODS", sheet.headers), categories, units);
  assert.equal(rows[0]!.categoryId, "c-engine");
  assert.equal(rows[0]!.unitId, "u-pcs");
  assert.equal(rows[0]!.stock, "7");
  void ExcelJS;
});

test("actions and routes are permission-gated; list toolbar links them", () => {
  const actions = read("app/_actions/service-import.ts");
  assert.match(actions, /canCreate\(user, "services"\)/);
  assert.match(actions, /assertActiveSubscription\(user\.tenantId\)/);
  assert.match(actions, /PLAN_LIMIT_CODES\.MAX_SERVICES/);
  assert.match(actions, /auditSuffix: " · Excel-ээс"/);
  assert.match(read("app/dashboard/services/export/route.ts"), /canView\(user, "services"\)/);
  assert.match(read("app/dashboard/services/import/template/route.ts"), /canCreate\(user, "services"\)/);
  const list = read("app/dashboard/services/service-list.tsx");
  assert.match(list, /\/dashboard\/services\/export\?type=/);
  assert.match(list, /\/dashboard\/services\/import\?type=/);
});
