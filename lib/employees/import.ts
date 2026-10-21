// Framework-free logic for «Excel-ээс ажилтан оруулах» (client + server safe —
// no Prisma, no exceljs). The wizard (app/dashboard/employees/import) uses it
// to auto-map columns, build editable rows and validate them before sending;
// the server re-validates every row through `prepareCreateEmployee`, so these
// checks are UX only, never the security boundary.

import {
  guessFieldMapping,
  isCalendarDate,
  matchByName,
  MAX_IMPORT_ROWS,
  normalizeDateCell,
  type NamedOption,
  type ParsedSheet,
} from "@/lib/import/mapping";
import { normalizePhone } from "@/lib/phone";

// Ерөнхий туслахуудыг (lib/import/mapping.ts) хуучин импортын замаар ч хүртээмжтэй.
export {
  isCalendarDate,
  matchByName,
  MAX_IMPORT_BYTES,
  MAX_IMPORT_ROWS,
  normalizeDateCell,
  normalizeLabel,
  type NamedOption,
  type ParsedSheet,
} from "@/lib/import/mapping";
import { validateCommon } from "./validate";

export type ImportField =
  | "lastName"
  | "firstName"
  | "phone"
  | "email"
  | "role"
  | "branch"
  | "activeUntil";

export const IMPORT_FIELDS: ReadonlyArray<{
  key: ImportField;
  label: string;
  required: boolean;
  /** Normalized header spellings recognised by `guessMapping`. */
  aliases: readonly string[];
}> = [
  { key: "lastName", label: "Овог", required: true, aliases: ["овог", "эцэг эхийн нэр", "lastname", "last name", "surname"] },
  { key: "firstName", label: "Нэр", required: true, aliases: ["нэр", "өөрийн нэр", "firstname", "first name", "name"] },
  { key: "phone", label: "Утас", required: true, aliases: ["утас", "утасны дугаар", "гар утас", "phone", "mobile", "tel"] },
  { key: "email", label: "Имэйл", required: true, aliases: ["имэйл", "и-мэйл", "и мэйл", "мэйл", "email", "e-mail", "mail"] },
  { key: "role", label: "Үүрэг", required: false, aliases: ["үүрэг", "албан тушаал", "эрх", "role", "position"] },
  { key: "branch", label: "Үндсэн салбар", required: false, aliases: ["салбар", "үндсэн салбар", "branch"] },
  {
    key: "activeUntil",
    label: "Идэвхтэй хүртэл",
    required: false,
    aliases: ["идэвхтэй хүртэл", "хугацаа", "дуусах огноо", "ажиллах хугацаа", "active until"],
  },
];

/** Column index per field; null = not mapped. */
export type ImportMapping = Record<ImportField, number | null>;

/** One editable row in the wizard (and the payload sent to the server). */
export type ImportRow = {
  key: string;
  excelRow: number;
  lastName: string;
  firstName: string;
  phone: string;
  email: string;
  roleId: string;
  branchId: string;
  /** "YYYY-MM-DD" or "" — same format the employee form's DatePicker posts. */
  activeUntil: string;
  /** Raw Excel text for role/branch, kept to explain an unmatched value. */
  roleRaw: string;
  branchRaw: string;
};

/** Auto-map Excel headers to employee fields; each column is used at most once. */
export function guessMapping(headers: readonly string[]): ImportMapping {
  return guessFieldMapping(IMPORT_FIELDS, headers);
}

export function buildImportRows(
  sheet: ParsedSheet,
  mapping: ImportMapping,
  roles: readonly NamedOption[],
  branches: readonly NamedOption[],
): ImportRow[] {
  const cell = (cells: string[], field: ImportField) => {
    const idx = mapping[field];
    return idx === null ? "" : (cells[idx] ?? "").trim();
  };
  return sheet.rows.map(({ excelRow, cells }) => {
    const roleRaw = cell(cells, "role");
    const branchRaw = cell(cells, "branch");
    return {
      key: `r${excelRow}`,
      excelRow,
      lastName: cell(cells, "lastName"),
      firstName: cell(cells, "firstName"),
      phone: cell(cells, "phone"),
      email: cell(cells, "email"),
      roleId: matchByName(roles, roleRaw),
      branchId: matchByName(branches, branchRaw),
      activeUntil: normalizeDateCell(cell(cells, "activeUntil")),
      roleRaw,
      branchRaw,
    };
  });
}

/** Same FormData shape the employee form posts — validated by `validateCommon`. */
export function importRowToFormData(row: ImportRow): FormData {
  const fd = new FormData();
  fd.set("lastName", row.lastName);
  fd.set("firstName", row.firstName);
  fd.set("phone", row.phone);
  fd.set("email", row.email);
  fd.set("roleId", row.roleId);
  if (row.branchId) fd.set("branchId", row.branchId);
  if (row.activeUntil) fd.set("activeUntil", row.activeUntil);
  return fd;
}

export function validateImportRow(row: ImportRow): Record<string, string> {
  const { errors } = validateCommon(importRowToFormData(row));
  if (!row.roleId && row.roleRaw && errors.roleId) {
    errors.roleId = `«${row.roleRaw}» үүрэг олдсонгүй — сонгоно уу.`;
  }
  // `new Date("2026-02-30")` rolls over to March 2 instead of failing, so
  // validateCommon would accept it — require a real calendar date here.
  if (row.activeUntil && !errors.activeUntil && !isCalendarDate(row.activeUntil)) {
    errors.activeUntil = "Огноо буруу.";
  }
  if (!row.branchId && row.branchRaw) {
    errors.branchId = `«${row.branchRaw}» салбар олдсонгүй — сонгоно уу эсвэл хоосон үлдээнэ.`;
  }
  return errors;
}

/** Canonical keys used for duplicate detection (matches what is stored). */
export function duplicateKeys(row: Pick<ImportRow, "phone" | "email">): { phone: string; email: string } {
  return {
    phone: normalizePhone(row.phone) ?? "",
    email: row.email.trim().toLowerCase(),
  };
}

/** Rows whose phone/email repeats an earlier row of the same file. */
export function findInFileDuplicates(
  rows: readonly ImportRow[],
): Map<string, { phone?: number; email?: number }> {
  const seenPhone = new Map<string, number>();
  const seenEmail = new Map<string, number>();
  const out = new Map<string, { phone?: number; email?: number }>();
  for (const row of rows) {
    const { phone, email } = duplicateKeys(row);
    const dup: { phone?: number; email?: number } = {};
    if (phone) {
      const first = seenPhone.get(phone);
      if (first !== undefined) dup.phone = first;
      else seenPhone.set(phone, row.excelRow);
    }
    if (email) {
      const first = seenEmail.get(email);
      if (first !== undefined) dup.email = first;
      else seenEmail.set(email, row.excelRow);
    }
    if (dup.phone !== undefined || dup.email !== undefined) out.set(row.key, dup);
  }
  return out;
}

export type ImportRowResult = {
  key: string;
  ok: boolean;
  error?: string;
  fieldErrors?: Record<string, string>;
};

export type ImportEmployeesResult =
  | { ok: true; succeeded: number; failed: number; results: ImportRowResult[] }
  | { ok: false; message: string };

const ROW_STRING_FIELDS = [
  "key",
  "lastName",
  "firstName",
  "phone",
  "email",
  "roleId",
  "branchId",
  "activeUntil",
  "roleRaw",
  "branchRaw",
] as const;
const MAX_CELL_LENGTH = 200;

/**
 * Server-action payload guard: the client sends plain objects, so every field
 * is re-shaped to a bounded string (anything else → null = reject request).
 */
export function parseImportRowsPayload(input: unknown): ImportRow[] | null {
  if (!Array.isArray(input) || input.length === 0 || input.length > MAX_IMPORT_ROWS) return null;
  const rows: ImportRow[] = [];
  for (const item of input) {
    if (!item || typeof item !== "object") return null;
    const rec = item as Record<string, unknown>;
    const row = { excelRow: Number(rec.excelRow) } as ImportRow;
    if (!Number.isInteger(row.excelRow) || row.excelRow < 1) return null;
    for (const field of ROW_STRING_FIELDS) {
      const v = rec[field] ?? "";
      if (typeof v !== "string") return null;
      row[field] = v.slice(0, MAX_CELL_LENGTH);
    }
    if (!row.key) return null;
    rows.push(row);
  }
  return rows;
}
