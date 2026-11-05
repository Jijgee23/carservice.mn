// Нэгдсэн сангийн мөр (CatalogItem) бүртгэх оролтын дүрэм — super admin-ий
// гараар бүртгэх маягт болон Excel импорт хоёулаа (client + server safe).

import {
  type FieldMapping,
  type ImportFieldDef,
  type ParsedSheet,
  guessFieldMapping,
  mappedCell,
} from "@/lib/import/mapping";
import { cleanCatalogName, isValidBarcode, normalizeBarcode, normalizeCatalogCode } from "./normalize";

export type CatalogType = "LABOR" | "GOODS";

export const CATALOG_TYPE_LABEL: Record<CatalogType, string> = { LABOR: "Ажил", GOODS: "Сэлбэг / Бараа" };

export function parseCatalogType(v: unknown): CatalogType | null {
  return v === "LABOR" || v === "GOODS" ? v : null;
}

/** Маягт/Excel-ийн түүхий утга (бүгд string). `category` = системийн ангиллын НЭР (Excel) эсвэл id (маягт). */
export type CatalogRaw = {
  name: string;
  code: string;
  /** Баркод — зөвхөн GOODS (заавал биш). Хуучин клиент илгээхгүй байж болно. */
  barcode?: string;
  unitName: string;
  price: string;
  category: string;
  durationValue: string;
  durationUnitName: string;
  description: string;
};

export type CatalogValues = {
  type: CatalogType;
  name: string;
  code: string | null;
  barcode: string | null;
  unitName: string;
  price: string;
  category: string | null;
  durationValue: string | null;
  durationUnitName: string | null;
  description: string | null;
};

export type CatalogFieldErrors = Partial<Record<keyof CatalogRaw, string>>;

function decimal(raw: string): string | null {
  const cleaned = raw.replace(/[,\s₮]/g, "");
  return cleaned && /^\d+(?:\.\d+)?$/.test(cleaned) ? cleaned : null;
}

export function parseCatalogInput(
  type: CatalogType,
  raw: CatalogRaw,
): { ok: true; values: CatalogValues } | { ok: false; errors: CatalogFieldErrors } {
  const errors: CatalogFieldErrors = {};
  const name = cleanCatalogName(raw.name);
  if (!name) errors.name = "Нэр оруулна уу.";
  else if (name.length > 200) errors.name = "Нэр хэт урт байна.";

  const unitName = raw.unitName.trim();
  if (!unitName) errors.unitName = "Нэгж оруулна уу.";
  else if (unitName.length > 40) errors.unitName = "Нэгж хэт урт байна.";

  const price = decimal(raw.price.trim());
  if (!price) errors.price = "Үнэ буруу.";

  const code = normalizeCatalogCode(raw.code);
  if (code && code.length > 60) errors.code = "Код хэт урт байна.";

  const barcode = type === "GOODS" ? normalizeBarcode(raw.barcode) : null;
  if (barcode && !isValidBarcode(barcode)) errors.barcode = "Баркод буруу (4–64 тэмдэгт: тоо, үсэг, - .).";

  let durationValue: string | null = null;
  let durationUnitName: string | null = null;
  if (type === "LABOR" && (raw.durationValue.trim() || raw.durationUnitName.trim())) {
    durationValue = decimal(raw.durationValue.trim());
    if (!durationValue || Number(durationValue) <= 0) errors.durationValue = "Хугацаа эерэг тоо байх ёстой.";
    durationUnitName = raw.durationUnitName.trim() || null;
    if (!durationUnitName) errors.durationUnitName = "Хугацааны нэгж оруулна уу.";
  }

  const description = raw.description.trim();
  if (description.length > 1000) errors.description = "Тайлбар хэт урт байна.";

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    values: {
      type,
      name,
      code,
      barcode,
      unitName,
      price: price!,
      category: raw.category.trim() || null,
      durationValue,
      durationUnitName,
      description: description || null,
    },
  };
}

// --- Excel ------------------------------------------------------------------

type CatalogField = keyof CatalogRaw;

const COMMON: ImportFieldDef<CatalogField>[] = [
  { key: "code", label: "Код", required: false, aliases: ["код", "sku", "code", "барааны код", "oem"] },
  { key: "name", label: "Нэр", required: true, aliases: ["нэр", "ажлын нэр", "барааны нэр", "сэлбэгийн нэр", "name"] },
  { key: "unitName", label: "Нэгж", required: true, aliases: ["нэгж", "хэмжих нэгж", "unit"] },
  { key: "price", label: "Санал болгох үнэ", required: true, aliases: ["санал болгох үнэ", "үнэ", "зарах үнэ", "price"] },
];
const DESCRIPTION: ImportFieldDef<CatalogField> = {
  key: "description",
  label: "Тайлбар",
  required: false,
  aliases: ["тайлбар", "тэмдэглэл", "description"],
};

export const CATALOG_IMPORT_FIELDS: Record<CatalogType, ReadonlyArray<ImportFieldDef<CatalogField>>> = {
  GOODS: [
    ...COMMON,
    { key: "barcode", label: "Баркод", required: false, aliases: ["баркод", "barcode", "bar code", "ean", "upc"] },
    { key: "category", label: "Ангилал", required: false, aliases: ["ангилал", "бүлэг", "category"] },
    DESCRIPTION,
  ],
  LABOR: [
    ...COMMON,
    { key: "durationValue", label: "Хугацаа", required: false, aliases: ["хугацаа", "үргэлжлэх хугацаа", "duration"] },
    { key: "durationUnitName", label: "Хугацааны нэгж", required: false, aliases: ["хугацааны нэгж", "duration unit"] },
    DESCRIPTION,
  ],
};

export type CatalogImportRow = { excelRow: number; raw: CatalogRaw };

/** Хуудсын гарчгийг талбарт тааруулж мөр бүрийг түүхий утга болгоно (хоосон мөрийг алгасна). */
export function sheetToCatalogRows(type: CatalogType, sheet: ParsedSheet): {
  rows: CatalogImportRow[];
  missingColumns: string[];
} {
  const fields = CATALOG_IMPORT_FIELDS[type];
  const mapping = guessFieldMapping(fields, sheet.headers) as FieldMapping<CatalogField>;
  const missingColumns = fields.filter((f) => f.required && mapping[f.key] == null).map((f) => f.label);
  const cell = (cells: readonly string[], key: CatalogField) => (mapping[key] == null ? "" : mappedCell(cells, mapping, key));
  const rows = sheet.rows
    .filter((r) => r.cells.some((c) => c.trim()))
    .map((r) => ({
      excelRow: r.excelRow,
      raw: {
        name: cell(r.cells, "name"),
        code: cell(r.cells, "code"),
        barcode: cell(r.cells, "barcode"),
        unitName: cell(r.cells, "unitName"),
        price: cell(r.cells, "price"),
        category: cell(r.cells, "category"),
        durationValue: cell(r.cells, "durationValue"),
        durationUnitName: cell(r.cells, "durationUnitName"),
        description: cell(r.cells, "description"),
      },
    }));
  return { rows, missingColumns };
}
