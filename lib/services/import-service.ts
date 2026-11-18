// Ажил/сэлбэг Excel-ээс оруулах ДУНДЫН сервис: вэб action (app/_actions/service-import.ts) болон мобайл API
// (/api/v1/services/import[/preview]) хоёул ИЖИЛ логикийг дуудна. Дуудагч tenant context тавьсан,
// services.create эрх + идэвхтэй захиалгыг шалгасан байх ёстой.

import { categoriesForKindWhere } from "@/lib/categories";
import type { FieldMapping, ParsedSheet } from "@/lib/import/mapping";
import { prisma } from "@/lib/prisma";
import {
  buildServiceImportRows,
  findInFileDuplicateCodes,
  guessServiceMapping,
  SERVICE_IMPORT_FIELDS,
  validateServiceImportRow,
  type ImportServiceKind,
  type ServiceImportField,
  type ServiceImportResult,
  type ServiceImportRow,
} from "./import";
import { createServiceCommand, loadServiceRefs } from "./service-create";
import { runServiceImport } from "./service-import-run";

/** Тухайн төрөлд хамаарах (мэдэгдэж буй) талбарын түлхүүрүүд; mapping-ийн бүх түлхүүр (хамаарахгүй нь null). */
export const SERVICE_IMPORT_ALL_FIELDS: readonly ServiceImportField[] = [
  "name", "code", "barcode", "category", "unit", "price", "costPrice", "stock",
  "durationValue", "durationUnit", "reminderIntervalMonths", "description",
];

export function isImportServiceKind(v: unknown): v is ImportServiceKind {
  return v === "LABOR" || v === "GOODS";
}

/** Төрөлд аль хэдийн бүртгэлтэй кодууд (UPPER). */
export async function existingServiceCodes(tenantId: string, kind: ImportServiceKind, codes: readonly string[]): Promise<Set<string>> {
  const list = [...new Set(codes.map((c) => c.trim().toUpperCase().slice(0, 300)).filter(Boolean))];
  if (list.length === 0) return new Set();
  const rows = await prisma.service.findMany({
    where: { tenantId, type: kind, code: { in: list } },
    select: { code: true },
  });
  return new Set(rows.map((s) => (s.code ?? "").toUpperCase()).filter(Boolean));
}

export async function loadServiceImportOptions(tenantId: string, kind: ImportServiceKind) {
  const [categories, units] = await Promise.all([
    prisma.category.findMany({
      // Өөрийн + системийн, тухайн төрөлд тохирох (эсвэл бүх төрөлд) ангилал.
      where: { isActive: true, ...categoriesForKindWhere(tenantId, kind) },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    prisma.unit.findMany({ where: { tenantId, isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true, code: true } }),
  ]);
  return { categories, units };
}

export type ServiceImportPreview = {
  type: ImportServiceKind;
  headers: string[];
  mapping: FieldMapping<ServiceImportField>;
  fields: Array<{ key: ServiceImportField; label: string; required: boolean }>;
  rows: ServiceImportRow[];
  rowErrors: Record<string, Record<string, string>>;
  /** Файл дотор өмнөх мөртэй давхардсан код (key → эхний мөрийн Excel дугаар). */
  inFileDuplicates: Record<string, number>;
  /** Системд аль хэдийн бүртгэлтэй кодтой мөрийн key-үүд (импортод алгасна). */
  takenKeys: string[];
  categories: Array<{ id: string; name: string }>;
  units: Array<{ id: string; name: string; code: string | null }>;
  /** Импортлоход бэлэн (алдаа, давхцалгүй) мөрийн тоо. */
  readyCount: number;
};

export async function previewServiceImport(input: {
  tenantId: string;
  type: ImportServiceKind;
  sheet: ParsedSheet;
  mapping: FieldMapping<ServiceImportField> | null;
}): Promise<ServiceImportPreview> {
  const { categories, units } = await loadServiceImportOptions(input.tenantId, input.type);
  const mapping = input.mapping ?? guessServiceMapping(input.type, input.sheet.headers);
  const rows = buildServiceImportRows(input.sheet, mapping, categories, units);

  const rowErrors: ServiceImportPreview["rowErrors"] = {};
  for (const row of rows) {
    const errors = validateServiceImportRow(input.type, row);
    if (Object.keys(errors).length > 0) rowErrors[row.key] = errors;
  }
  const dup = findInFileDuplicateCodes(rows);
  const existing = await existingServiceCodes(input.tenantId, input.type, rows.map((r) => r.code));
  const takenKeys = rows.filter((r) => r.code.trim() && existing.has(r.code.trim().toUpperCase())).map((r) => r.key);
  const takenSet = new Set(takenKeys);
  const readyCount = rows.filter((r) => !rowErrors[r.key] && !dup.has(r.key) && !takenSet.has(r.key)).length;

  return {
    type: input.type,
    headers: input.sheet.headers,
    mapping,
    fields: SERVICE_IMPORT_FIELDS[input.type].map((f) => ({ key: f.key, label: f.label, required: f.required })),
    rows,
    rowErrors,
    inFileDuplicates: Object.fromEntries(dup),
    takenKeys,
    categories,
    units,
    readyCount,
  };
}

/** Мөр бүрийг тусад нь үүсгэнэ (all-or-nothing биш); бүртгэлтэй кодтой мөрийг алгасна. */
export async function runServiceImportForActor(
  actor: { id: string; tenantId: string },
  kind: ImportServiceKind,
  rows: readonly ServiceImportRow[],
): Promise<Extract<ServiceImportResult, { ok: true }>> {
  const codes = rows.map((r) => r.code);
  const [refs, existing] = await Promise.all([loadServiceRefs(actor.tenantId, kind), existingServiceCodes(actor.tenantId, kind, codes)]);
  const result = await runServiceImport({
    type: kind,
    rows,
    refs,
    existingCodes: existing,
    create: (values) => createServiceCommand(actor, values, { auditSuffix: " · Excel-ээс" }),
  });
  return { ok: true, ...result };
}
