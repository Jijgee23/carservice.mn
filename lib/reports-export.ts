// P7-B0 — the eight-sheet workbook builder moved out of
// `app/dashboard/reports/export/route.ts` so the web export route and the
// mobile-facing `GET /api/v1/reports/export` share it (D-175: mobile reuses
// this exact workbook, no CSV). Pure function of `ReportData` + `Range` in,
// `Buffer` out — no auth, no Prisma, no Response handling here.
import ExcelJS from "exceljs";
import type { Range, ReportData } from "./reports";
import { fmt } from "./reports";

export async function buildReportWorkbook(data: ReportData, range: Range) {
  const wb = new ExcelJS.Workbook();
  wb.creator = "carservice.mn";
  wb.created = new Date();

  const summary = wb.addWorksheet("Хураангуй");
  summary.columns = [
    { header: "Үзүүлэлт", key: "label", width: 28 },
    { header: "Утга", key: "value", width: 20 },
  ];
  summary.addRows([
    { label: "Хугацаа", value: range.label },
    { label: "Нийт орлого", value: data.totalRevenue },
    { label: "Дотоод зардал", value: data.internalCost },
    { label: "Дууссан захиалга", value: data.completedCount },
    { label: "Дундаж дүн", value: Math.round(data.avgTicket) },
    { label: "Идэвхтэй захиалга", value: data.activeCount },
  ]);

  const trend = wb.addWorksheet("Орлогын хандлага");
  trend.columns = [
    { header: "Огноо", key: "label", width: 14 },
    { header: "Орлого", key: "value", width: 16 },
  ];
  trend.addRows(data.income.points);

  const kind = wb.addWorksheet("Ажил vs сэлбэг");
  kind.columns = [
    { header: "Төрөл", key: "label", width: 18 },
    { header: "Дүн", key: "total", width: 16 },
    { header: "%", key: "pct", width: 8 },
  ];
  kind.addRows(data.kindRows);

  const status = wb.addWorksheet("Захиалгын статус");
  status.columns = [
    { header: "Статус", key: "label", width: 18 },
    { header: "Тоо", key: "count", width: 10 },
  ];
  status.addRows(data.statusRows);

  const branch = wb.addWorksheet("Салбараар");
  branch.columns = [
    { header: "Салбар", key: "name", width: 24 },
    { header: "Орлого", key: "revenue", width: 16 },
    { header: "Дотоод зардал", key: "internalCost", width: 16 },
    { header: "Захиалга", key: "count", width: 12 },
  ];
  branch.addRows(data.branchRows);

  const tech = wb.addWorksheet("Мастер-Менежер");
  tech.columns = [
    { header: "Мастер / Менежер", key: "name", width: 24 },
    { header: "Орлого", key: "revenue", width: 16 },
    { header: "Дотоод зардал", key: "internalCost", width: 16 },
    { header: "Захиалга", key: "count", width: 12 },
  ];
  tech.addRows(data.techRows);

  const customers = wb.addWorksheet("Топ үйлчлүүлэгчид");
  customers.columns = [
    { header: "Үйлчлүүлэгч", key: "name", width: 26 },
    { header: "Утас", key: "phone", width: 14 },
    { header: "Орлого", key: "revenue", width: 16 },
    { header: "Захиалга", key: "count", width: 12 },
  ];
  customers.addRows(data.customerRows);

  const parts = wb.addWorksheet("Топ сэлбэгүүд");
  parts.columns = [
    { header: "Сэлбэг", key: "name", width: 26 },
    { header: "Код", key: "sku", width: 14 },
    { header: "Нэгж", key: "unit", width: 10 },
    { header: "Тоо ширхэг", key: "qty", width: 12 },
    { header: "Орлого", key: "revenue", width: 16 },
  ];
  parts.addRows(data.partRows);

  for (const ws of wb.worksheets) {
    ws.getRow(1).font = { bold: true };
  }

  return wb.xlsx.writeBuffer();
}

/** `tailan_<from>_<to>.xlsx`, matching the web export's existing filename. */
export function reportExportFilename(range: Range): string {
  return `tailan_${fmt(range.from)}_${fmt(range.to)}.xlsx`;
}
