// Server-only .xlsx parsing for the Excel import wizards (ажилтан, ажил/сэлбэг).
// exceljs (~1MB) stays out of the client bundle: the wizard uploads the file to
// a server action and receives plain string cells back.

import ExcelJS from "exceljs";
import { MAX_IMPORT_ROWS, type ParsedSheet } from "./mapping";

export class ImportParseError extends Error {}

const BUSINESS_OFFSET_MS = 8 * 60 * 60 * 1000;

/** Any exceljs cell value → trimmed display string. */
export function cellToString(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) {
    // exceljs returns date cells as UTC midnight of the typed calendar date;
    // a cell with a time-of-day is shifted to Ulaanbaatar before taking the day.
    const ms = value.getTime();
    const day = ms % 86_400_000 === 0 ? value : new Date(ms + BUSINESS_OFFSET_MS);
    return day.toISOString().slice(0, 10);
  }
  if (typeof value === "number") {
    // Phones typed as numbers come back as 99112233 (never 9.9e7 here), but
    // guard against float noise like 99112233.00000001.
    return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(6)));
  }
  if (typeof value === "string") return value.trim();
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  if (typeof value === "object") {
    if ("richText" in value) return value.richText.map((t) => t.text).join("").trim();
    if ("text" in value && typeof value.text === "string") return value.text.trim(); // hyperlink
    if ("result" in value) return cellToString(value.result as ExcelJS.CellValue); // formula
    if ("error" in value) return "";
  }
  return String(value).trim();
}

/**
 * First worksheet; the first non-empty row is the header. Fully empty rows are
 * skipped. Throws ImportParseError with a user-facing (Mongolian) message.
 */
export async function parseImportWorkbook(buffer: ArrayBuffer): Promise<ParsedSheet> {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buffer);
  } catch {
    throw new ImportParseError("Файлыг уншиж чадсангүй. .xlsx форматтай Excel файл оруулна уу.");
  }
  const sheet = wb.worksheets[0];
  if (!sheet) throw new ImportParseError("Excel файлд хуудас (sheet) алга.");

  let headers: string[] | null = null;
  const rows: ParsedSheet["rows"] = [];
  let tooMany = false;

  sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (tooMany) return;
    // row.values is 1-based (index 0 is empty).
    const values = Array.isArray(row.values) ? row.values.slice(1) : [];
    const cells = values.map((v) => cellToString(v as ExcelJS.CellValue));
    if (cells.every((c) => c === "")) return;
    if (!headers) {
      headers = cells;
      return;
    }
    if (rows.length >= MAX_IMPORT_ROWS) {
      tooMany = true;
      return;
    }
    rows.push({ excelRow: rowNumber, cells });
  });

  if (!headers) throw new ImportParseError("Excel файл хоосон байна.");
  if (tooMany) {
    throw new ImportParseError(`Нэг удаад хамгийн ихдээ ${MAX_IMPORT_ROWS} мөр оруулна. Файлаа хувааж оруулна уу.`);
  }
  if (rows.length === 0) throw new ImportParseError("Гарчгийн доор өгөгдөлтэй мөр алга.");

  const finalHeaders: string[] = headers;
  const width = Math.max(finalHeaders.length, ...rows.map((r) => r.cells.length));
  return {
    headers: Array.from({ length: width }, (_, i) => finalHeaders[i] || `Багана ${i + 1}`),
    rows: rows.map((r) => ({ excelRow: r.excelRow, cells: Array.from({ length: width }, (_, i) => r.cells[i] ?? "") })),
  };
}
