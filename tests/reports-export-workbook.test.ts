import assert from "node:assert/strict";
import { before, test } from "node:test";
import type { Range, ReportData } from "../lib/reports";

// P7-B0 — the eight-sheet exceljs workbook builder moved from
// `app/dashboard/reports/export/route.ts` to `lib/reports-export.ts`. This
// exercises `buildReportWorkbook` against a fixture `ReportData` and checks
// sheet names, headers, and row counts — the same shape the web export
// route and `GET /api/v1/reports/export` both render.

process.env.DATABASE_URL ??= "postgresql://unused/unused";
process.env.SESSION_SECRET ??= "unit-test-placeholder-secret-value-not-real-00";

let buildReportWorkbook: typeof import("../lib/reports-export").buildReportWorkbook;
let reportExportFilename: typeof import("../lib/reports-export").reportExportFilename;
let Workbook: typeof import("exceljs").Workbook;

before(async () => {
  ({ buildReportWorkbook, reportExportFilename } = await import("../lib/reports-export"));
  const mod = await import("exceljs");
  Workbook = (mod as unknown as { default: typeof import("exceljs") }).default?.Workbook ?? mod.Workbook;
});

const RANGE: Range = {
  from: new Date(2026, 0, 1),
  to: new Date(2026, 0, 31, 23, 59, 59),
  label: "2026.01.01 – 2026.01.31",
  key: "custom",
};

const FIXTURE: ReportData = {
  totalRevenue: 1_250_000,
  internalCost: 75_000,
  completedCount: 12,
  avgTicket: 104_166.67,
  activeCount: 3,
  statusRows: [
    { status: "SCHEDULED", label: "Товлогдсон", count: 2, pct: 20 },
    { status: "IN_PROGRESS", label: "Хийгдэж байгаа", count: 1, pct: 10 },
    { status: "COMPLETED", label: "Дууссан", count: 6, pct: 60 },
    { status: "CANCELLED", label: "Цуцалсан", count: 1, pct: 10 },
  ],
  kindRows: [
    { kind: "LABOR", label: "Ажил", total: 800_000, pct: 64 },
    { kind: "DIAGNOSTIC", label: "Оношилгоо", total: 100_000, pct: 8 },
    { kind: "PART", label: "Сэлбэг", total: 300_000, pct: 24 },
    { kind: "FEE", label: "Бусад", total: 50_000, pct: 4 },
  ],
  branchRows: [{ id: "b1", name: "Төв салбар", revenue: 900_000, internalCost: 50_000, count: 8 }],
  techRows: [{ id: "u1", name: "Бат Болд", revenue: 600_000, internalCost: 25_000, count: 5 }],
  avgJobDurationMinutes: 45,
  jobDurationRows: [{ id: "s1", name: "Даатгал", count: 4, avgMinutes: 30 }],
  customerRows: [
    { id: "c1", name: "Бат", phone: "99001122", revenue: 400_000, count: 2 },
  ],
  partRows: [
    { id: "p1", name: "Тос", sku: "OIL-1", unit: "ш", qty: 10, revenue: 100_000 },
  ],
  income: { points: [{ label: "1", value: 10_000 }], changePct: 12.5 },
};

test("buildReportWorkbook creates all 8 sheets in order with the expected headers", async () => {
  const buffer = await buildReportWorkbook(FIXTURE, RANGE);
  assert.ok(buffer.byteLength > 0);

  const wb = new Workbook();
  await wb.xlsx.load(buffer);

  const expectedSheets = [
    "Хураангуй",
    "Орлогын хандлага",
    "Ажил vs сэлбэг",
    "Захиалгын статус",
    "Салбараар",
    "Мастер-Менежер",
    "Топ үйлчлүүлэгчид",
    "Топ сэлбэгүүд",
  ];
  assert.deepEqual(
    wb.worksheets.map((ws) => ws.name),
    expectedSheets,
  );

  const summary = wb.getWorksheet("Хураангуй")!;
  assert.deepEqual(
    (summary.getRow(1).values as unknown[]).slice(1),
    ["Үзүүлэлт", "Утга"],
  );
  assert.equal(summary.rowCount, 7); // header + 6 fixture rows (incl. Дотоод зардал)
  assert.equal(summary.getRow(1).font?.bold, true);

  const status = wb.getWorksheet("Захиалгын статус")!;
  assert.deepEqual((status.getRow(1).values as unknown[]).slice(1), ["Статус", "Тоо"]);
  assert.equal(status.rowCount, 1 + FIXTURE.statusRows.length);

  const parts = wb.getWorksheet("Топ сэлбэгүүд")!;
  assert.deepEqual(
    (parts.getRow(1).values as unknown[]).slice(1),
    ["Сэлбэг", "Код", "Нэгж", "Тоо ширхэг", "Орлого"],
  );
  assert.equal(parts.rowCount, 1 + FIXTURE.partRows.length);
});

test("buildReportWorkbook bolds the header row on every sheet", async () => {
  const buffer = await buildReportWorkbook(FIXTURE, RANGE);
  const wb = new Workbook();
  await wb.xlsx.load(buffer);
  for (const ws of wb.worksheets) {
    assert.equal(ws.getRow(1).font?.bold, true, `${ws.name} header must be bold`);
  }
});

test("reportExportFilename uses local-date fmt, matching tailan_<from>_<to>.xlsx", () => {
  assert.equal(reportExportFilename(RANGE), "tailan_2026-01-01_2026-01-31.xlsx");
});
