// Ажилтан Excel-ээс оруулах ДУНДЫН сервис: вэб action (app/_actions/employee-import.ts) болон
// мобайл API (/api/v1/employees/import[/preview]) хоёул ИЖИЛ логикийг дуудна.
// Дуудагч tenant context тавьсан, employees.create эрх + идэвхтэй захиалгыг шалгасан байх ёстой.

import type { Prisma } from "@/app/generated/prisma/client";
import { logAudit } from "@/lib/audit";
import type { FieldMapping, ParsedSheet } from "@/lib/import/mapping";
import { prisma } from "@/lib/prisma";
import { importEmployees } from "./core";
import {
  buildImportRows,
  duplicateKeys,
  findInFileDuplicates,
  guessMapping,
  IMPORT_FIELDS,
  validateImportRow,
  type ImportEmployeesResult,
  type ImportField,
  type ImportMapping,
  type ImportRow,
} from "./import";
import type { EmployeeActor } from "./types";

export const EMPLOYEE_IMPORT_FIELD_KEYS: readonly ImportField[] = IMPORT_FIELDS.map((f) => f.key);

export type ImportTaken = Record<string, { phone?: boolean; email?: boolean }>;

/**
 * Утас/имэйл тенантын бусад ажилтанд бүртгэлтэй эсэх. RLS-ээр зөвхөн өөрийн тенант харагдана — өөр
 * тенантын давхцлыг санаатайгаар илрүүлэхгүй (500 мөрөөр бусдын утас/имэйл шалгах oracle болохгүйн тулд);
 * тийм мөр импорт хийхэд P2002-оор алдаа буцна.
 */
export async function checkEmployeeImportTaken(
  tenantId: string,
  rows: ReadonlyArray<Pick<ImportRow, "key" | "phone" | "email">>,
): Promise<ImportTaken> {
  const keyed = rows.map((r) => ({ key: r.key, ...duplicateKeys(r) }));
  const phones = [...new Set(keyed.map((r) => r.phone).filter(Boolean))];
  const emails = [...new Set(keyed.map((r) => r.email).filter(Boolean))];
  if (phones.length === 0 && emails.length === 0) return {};

  const existing = await prisma.user.findMany({
    where: { tenantId, OR: [{ phone: { in: phones } }, { email: { in: emails } }] },
    select: { phone: true, email: true },
  });
  const takenPhones = new Set(existing.map((u) => u.phone));
  const takenEmails = new Set(existing.map((u) => u.email));

  const taken: ImportTaken = {};
  for (const r of keyed) {
    const hit = {
      ...(r.phone && takenPhones.has(r.phone) ? { phone: true } : {}),
      ...(r.email && takenEmails.has(r.email) ? { email: true } : {}),
    };
    if (hit.phone || hit.email) taken[r.key] = hit;
  }
  return taken;
}

export async function loadEmployeeImportOptions(tenantId: string) {
  const [branches, roles] = await Promise.all([
    prisma.branch.findMany({ where: { tenantId, isActive: true }, orderBy: { createdAt: "asc" }, select: { id: true, name: true } }),
    prisma.role.findMany({ where: { isActive: true }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }], select: { id: true, name: true } }),
  ]);
  return { branches, roles };
}

export type EmployeeImportPreview = {
  headers: string[];
  mapping: ImportMapping;
  fields: Array<{ key: ImportField; label: string; required: boolean }>;
  rows: ImportRow[];
  /** Мөр бүрийн талбарын алдаа (key → {field: message}); алдаагүй мөр орохгүй. */
  rowErrors: Record<string, Record<string, string>>;
  /** Файл дотор өмнөх мөртэй давхардсан утас/имэйл (key → эхний мөрийн Excel дугаар). */
  inFileDuplicates: Record<string, { phone?: number; email?: number }>;
  /** Тенантад аль хэдийн бүртгэлтэй утас/имэйл. */
  taken: ImportTaken;
  roles: Array<{ id: string; name: string }>;
  branches: Array<{ id: string; name: string }>;
  /** Импортлоход бэлэн (алдаа, давхцалгүй) мөрийн тоо. */
  readyCount: number;
};

/** parse хийсэн хүснэгтээс (вэбийн wizard-ийн 1–3-р алхмыг) нэг дор урьдчилан харах мөр бүрдүүлнэ. */
export async function previewEmployeeImport(input: {
  tenantId: string;
  sheet: ParsedSheet;
  /** Заасан бол баганын тааруулалт; үгүй бол гарчгаар автоматаар таана. */
  mapping: FieldMapping<ImportField> | null;
}): Promise<EmployeeImportPreview> {
  const { roles, branches } = await loadEmployeeImportOptions(input.tenantId);
  const mapping = input.mapping ?? guessMapping(input.sheet.headers);
  const rows = buildImportRows(input.sheet, mapping, roles, branches);

  const rowErrors: EmployeeImportPreview["rowErrors"] = {};
  for (const row of rows) {
    const errors = validateImportRow(row);
    if (Object.keys(errors).length > 0) rowErrors[row.key] = errors;
  }
  const dup = findInFileDuplicates(rows);
  const taken = await checkEmployeeImportTaken(input.tenantId, rows);
  const readyCount = rows.filter((r) => !rowErrors[r.key] && !dup.has(r.key) && !taken[r.key]).length;

  return {
    headers: input.sheet.headers,
    mapping,
    fields: IMPORT_FIELDS.map((f) => ({ key: f.key, label: f.label, required: f.required })),
    rows,
    rowErrors,
    inFileDuplicates: Object.fromEntries(dup),
    taken,
    roles,
    branches,
    readyCount,
  };
}

/** Мөр бүрийг тусад нь үүсгэнэ (all-or-nothing биш); амжилттай бүрд аудит бичнэ. */
export async function runEmployeeImport(
  actor: EmployeeActor,
  rows: readonly ImportRow[],
): Promise<Extract<ImportEmployeesResult, { ok: true }>> {
  const result = await importEmployees(prisma, actor, rows, {
    onCreated: (created) =>
      logAudit({
        tenantId: actor.tenantId,
        userId: actor.id,
        entity: "User",
        entityId: created.id,
        action: "CREATE",
        summary: `${created.summary} · Excel-ээс`,
        after: created.after as Prisma.InputJsonValue,
      }),
  });
  return { ok: true, ...result };
}
