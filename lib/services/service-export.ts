// Ажил/сэлбэгийн Excel (export + импортын загвар) — гарчиг нь импортын
// талбаруудтай (SERVICE_IMPORT_FIELDS) ИЖИЛ тул татсан файлаа засаад шууд
// буцааж оруулж болно. Server-only (exceljs).

import ExcelJS from "exceljs";
import { SERVICE_IMPORT_FIELDS, type ImportServiceKind } from "./import";

const WIDTH: Record<string, number> = { name: 32, description: 36, category: 20, unit: 12, durationUnit: 16 };

export type ServiceExportRow = {
  code: string | null;
  name: string;
  category: string | null;
  unit: string | null;
  price: string;
  costPrice: string | null;
  stock: string | null;
  durationValue: string | null;
  durationUnit: string | null;
  reminderIntervalMonths: number | null;
  description: string | null;
  isActive: boolean;
};

export function serviceSheetColumns(type: ImportServiceKind, withStatus: boolean) {
  const cols: Partial<ExcelJS.Column>[] = SERVICE_IMPORT_FIELDS[type].map((f) => ({
    header: f.label,
    key: f.key,
    width: WIDTH[f.key] ?? 14,
    ...(f.key === "price" || f.key === "costPrice" ? { style: { numFmt: "#,##0.##" } } : {}),
  }));
  return withStatus ? [...cols, { header: "Төлөв", key: "status", width: 12 }] : cols;
}

export async function buildServiceWorkbook(input: {
  type: ImportServiceKind;
  rows: readonly ServiceExportRow[];
  withStatus: boolean;
  reference?: { categories: readonly string[]; units: readonly string[] };
}): Promise<ArrayBuffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "carservice.mn";
  wb.created = new Date();
  const ws = wb.addWorksheet(input.type === "LABOR" ? "Ажил" : "Сэлбэг");
  ws.columns = serviceSheetColumns(input.type, input.withStatus);
  const num = (v: string | null) => (v === null || v === "" ? null : Number(v));
  ws.addRows(
    input.rows.map((r) => ({
      code: r.code ?? "",
      name: r.name,
      category: r.category ?? "",
      unit: r.unit ?? "",
      price: num(r.price),
      costPrice: num(r.costPrice),
      stock: num(r.stock),
      durationValue: num(r.durationValue),
      durationUnit: r.durationUnit ?? "",
      reminderIntervalMonths: r.reminderIntervalMonths ?? null,
      description: r.description ?? "",
      status: r.isActive ? "Идэвхтэй" : "Идэвхгүй",
    })),
  );
  ws.getRow(1).font = { bold: true };
  ws.getColumn("code").numFmt = "@";

  if (input.reference) {
    const ref = wb.addWorksheet("Ангилал, нэгж");
    ref.columns = [
      { header: "Ангилал", key: "category", width: 26 },
      { header: "Нэгж", key: "unit", width: 16 },
    ];
    ref.getRow(1).font = { bold: true };
    const n = Math.max(input.reference.categories.length, input.reference.units.length);
    for (let i = 0; i < n; i++) {
      ref.addRow({ category: input.reference.categories[i] ?? "", unit: input.reference.units[i] ?? "" });
    }
    ref.addRow({});
    ref.addRow({
      category:
        input.type === "GOODS"
          ? "Заавар: Нэр, Ангилал, Нэгж, Үнэ заавал. Үлдэгдэл хоосон бол 0. Бүртгэлтэй кодтой мөр алгасагдана."
          : "Заавар: Нэр, Ангилал, Нэгж, Үнэ заавал. Хугацаа оруулбал хугацааны нэгж (мин/цаг) заавал. Бүртгэлтэй кодтой мөр алгасагдана.",
    });
  }
  return (await wb.xlsx.writeBuffer()) as ArrayBuffer;
}

export const XLSX_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
