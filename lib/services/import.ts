// «Excel-ээс ажил / сэлбэг оруулах» — client + server safe (Prisma/exceljs-гүй).
// Төрөл (LABOR = ажил, GOODS = сэлбэг) хуудсаар тогтоно. Мөр бүрийг
// validateServiceCreate (вэб формтой ижил дүрэм) шалгана; server дахин шалгана.
// Export (app/dashboard/services/export) ижил гарчигтай тул татсан файлаа
// засаад буцааж оруулж болно.

import {
  guessFieldMapping,
  MAX_IMPORT_ROWS,
  mappedCell,
  normalizeLabel,
  type FieldMapping,
  type ImportFieldDef,
  type ParsedSheet,
} from "@/lib/import/mapping";
import { validateServiceCreate, type ServiceCreateRaw } from "./service-create-rules";

export type ImportServiceKind = "LABOR" | "GOODS";

export type ServiceImportField =
  | "name"
  | "code"
  | "category"
  | "unit"
  | "price"
  | "costPrice"
  | "stock"
  | "durationValue"
  | "durationUnit"
  | "reminderIntervalMonths"
  | "description";

const COMMON_HEAD: ImportFieldDef<ServiceImportField>[] = [
  { key: "code", label: "Код", required: false, aliases: ["код", "sku", "code", "барааны код"] },
  { key: "name", label: "Нэр", required: true, aliases: ["нэр", "нэрс", "ажлын нэр", "барааны нэр", "сэлбэгийн нэр", "name"] },
  { key: "category", label: "Ангилал", required: true, aliases: ["ангилал", "төрөл", "бүлэг", "category"] },
  { key: "unit", label: "Нэгж", required: true, aliases: ["нэгж", "хэмжих нэгж", "unit"] },
  { key: "price", label: "Үнэ", required: true, aliases: ["үнэ", "зарах үнэ", "борлуулах үнэ", "price"] },
];
const DESCRIPTION: ImportFieldDef<ServiceImportField> = {
  key: "description",
  label: "Тайлбар",
  required: false,
  aliases: ["тайлбар", "тэмдэглэл", "description"],
};

export const SERVICE_IMPORT_FIELDS: Record<ImportServiceKind, ReadonlyArray<ImportFieldDef<ServiceImportField>>> = {
  GOODS: [
    ...COMMON_HEAD,
    { key: "costPrice", label: "Өртөг", required: false, aliases: ["өртөг", "өртөг үнэ", "авах үнэ", "cost"] },
    { key: "stock", label: "Үлдэгдэл", required: false, aliases: ["үлдэгдэл", "нөөц", "тоо ширхэг", "stock", "qty"] },
    DESCRIPTION,
  ],
  LABOR: [
    ...COMMON_HEAD,
    { key: "durationValue", label: "Хугацаа", required: false, aliases: ["хугацаа", "үргэлжлэх хугацаа", "duration"] },
    { key: "durationUnit", label: "Хугацааны нэгж", required: false, aliases: ["хугацааны нэгж", "duration unit"] },
    {
      key: "reminderIntervalMonths",
      label: "Сануулга (сар)",
      required: false,
      aliases: ["сануулга (сар)", "сануулга сар", "сануулга", "давтамж"],
    },
    DESCRIPTION,
  ],
};

export const SERVICE_KIND_IMPORT_LABEL: Record<ImportServiceKind, string> = { LABOR: "ажил", GOODS: "сэлбэг" };

export type ServiceImportMapping = FieldMapping<ServiceImportField>;

export function guessServiceMapping(type: ImportServiceKind, headers: readonly string[]): ServiceImportMapping {
  const fields = SERVICE_IMPORT_FIELDS[type];
  const base = guessFieldMapping(fields, headers);
  // Тухайн төрөлд хамаарахгүй талбарууд ч түлхүүртэй байна (null).
  const all: ServiceImportField[] = [
    "name", "code", "category", "unit", "price", "costPrice", "stock",
    "durationValue", "durationUnit", "reminderIntervalMonths", "description",
  ];
  return Object.fromEntries(all.map((k) => [k, base[k] ?? null])) as ServiceImportMapping;
}

export type UnitOption = { id: string; name: string; code: string | null };
export type CategoryOption = { id: string; name: string };

/** Нэгжийг нэр эсвэл кодоор (жижиг/том, зай үл хамааран). */
export function matchUnit(units: readonly UnitOption[], raw: string): string {
  const needle = normalizeLabel(raw);
  if (!needle) return "";
  return (
    units.find((u) => normalizeLabel(u.name) === needle)?.id ??
    units.find((u) => u.code && normalizeLabel(u.code) === needle)?.id ??
    ""
  );
}

export function matchCategory(categories: readonly CategoryOption[], raw: string): string {
  const needle = normalizeLabel(raw);
  if (!needle) return "";
  return categories.find((c) => normalizeLabel(c.name) === needle)?.id ?? "";
}

/** Wizard-ийн засах боломжтой мөр (server рүү илгээх payload). */
export type ServiceImportRow = {
  key: string;
  excelRow: number;
  name: string;
  code: string;
  categoryId: string;
  categoryRaw: string;
  unitId: string;
  unitRaw: string;
  price: string;
  costPrice: string;
  stock: string;
  durationValue: string;
  durationUnitId: string;
  durationUnitRaw: string;
  reminderIntervalMonths: string;
  description: string;
};

export function buildServiceImportRows(
  sheet: ParsedSheet,
  mapping: ServiceImportMapping,
  categories: readonly CategoryOption[],
  units: readonly UnitOption[],
): ServiceImportRow[] {
  return sheet.rows.map(({ excelRow, cells }) => {
    const get = (f: ServiceImportField) => mappedCell(cells, mapping, f);
    const categoryRaw = get("category");
    const unitRaw = get("unit");
    const durationUnitRaw = get("durationUnit");
    return {
      key: `r${excelRow}`,
      excelRow,
      name: get("name"),
      code: get("code").toUpperCase(),
      categoryId: matchCategory(categories, categoryRaw),
      categoryRaw,
      unitId: matchUnit(units, unitRaw),
      unitRaw,
      price: get("price"),
      costPrice: get("costPrice"),
      stock: get("stock"),
      durationValue: get("durationValue"),
      durationUnitId: matchUnit(units, durationUnitRaw),
      durationUnitRaw,
      reminderIntervalMonths: get("reminderIntervalMonths"),
      description: get("description"),
    };
  });
}

export function serviceRowToRaw(type: ImportServiceKind, row: ServiceImportRow): ServiceCreateRaw {
  return {
    type,
    name: row.name,
    code: row.code,
    unitId: row.unitId,
    price: row.price,
    costPrice: type === "GOODS" ? row.costPrice : "",
    stock: type === "GOODS" ? row.stock : "",
    durationValue: type === "LABOR" ? row.durationValue : "",
    durationUnitId: type === "LABOR" ? row.durationUnitId : "",
    reminderIntervalMonths: type === "LABOR" ? row.reminderIntervalMonths : "",
    description: row.description,
    categoryId: row.categoryId,
    isActive: true,
  };
}

/** Client-ийн урьдчилсан шалгалт (server адил дүрмээр дахин шалгана). */
export function validateServiceImportRow(type: ImportServiceKind, row: ServiceImportRow): Record<string, string> {
  const { errors } = validateServiceCreate(serviceRowToRaw(type, row), null);
  if (!row.categoryId && row.categoryRaw) errors.categoryId = `«${row.categoryRaw}» ангилал олдсонгүй — сонгоно уу.`;
  if (!row.unitId && row.unitRaw) errors.unitId = `«${row.unitRaw}» нэгж олдсонгүй — сонгоно уу.`;
  if (type === "LABOR" && !row.durationUnitId && row.durationUnitRaw) {
    errors.durationUnitId = `«${row.durationUnitRaw}» нэгж олдсонгүй — сонгоно уу.`;
  }
  return errors;
}

/** Файл дотор өмнөх мөртэй давхардсан код → эхний мөрийн Excel дугаар. */
export function findInFileDuplicateCodes(rows: readonly ServiceImportRow[]): Map<string, number> {
  const seen = new Map<string, number>();
  const out = new Map<string, number>();
  for (const row of rows) {
    const code = row.code.trim().toUpperCase();
    if (!code) continue;
    const first = seen.get(code);
    if (first !== undefined) out.set(row.key, first);
    else seen.set(code, row.excelRow);
  }
  return out;
}

export const SERVICE_CODE_EXISTS_MESSAGE = "Энэ код бүртгэлтэй — алгасна.";

const ROW_STRING_FIELDS = [
  "key", "name", "code", "categoryId", "categoryRaw", "unitId", "unitRaw", "price", "costPrice",
  "stock", "durationValue", "durationUnitId", "durationUnitRaw", "reminderIntervalMonths", "description",
] as const;
const MAX_CELL = 300;

/** Server-action payload guard: string талбарууд хязгаартай, бусад нь → null (татгалзана). */
export function parseServiceImportPayload(input: unknown): ServiceImportRow[] | null {
  if (!Array.isArray(input) || input.length === 0 || input.length > MAX_IMPORT_ROWS) return null;
  const rows: ServiceImportRow[] = [];
  for (const item of input) {
    if (!item || typeof item !== "object") return null;
    const rec = item as Record<string, unknown>;
    const row = { excelRow: Number(rec.excelRow) } as ServiceImportRow;
    if (!Number.isInteger(row.excelRow) || row.excelRow < 1) return null;
    for (const f of ROW_STRING_FIELDS) {
      const v = rec[f] ?? "";
      if (typeof v !== "string") return null;
      row[f] = v.slice(0, MAX_CELL);
    }
    if (!row.key) return null;
    rows.push(row);
  }
  return rows;
}

export type ServiceImportRowResult = { key: string; ok: boolean; error?: string; fieldErrors?: Record<string, string> };
export type ServiceImportResult =
  | { ok: true; succeeded: number; failed: number; results: ServiceImportRowResult[] }
  | { ok: false; message: string };

export function parseImportKind(slug: string | undefined | null): ImportServiceKind | null {
  return slug === "labor" ? "LABOR" : slug === "goods" ? "GOODS" : null;
}
