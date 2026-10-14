import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import ExcelJS from "exceljs";

process.env.DATABASE_URL ??= "postgresql://unused/unused";
process.env.SESSION_SECRET ??= "unit-test-placeholder-secret-value-not-real-00";

type Goods = { id: string; code: string | null; name: string; isActive: boolean; stock: number | null; costPrice: number | null; price: number; category: { name: string } | null; unit: { name: string } | null };

const GOODS: Goods[] = [
  { id: "g1", code: "OIL5", name: "Тос 5W30", isActive: true, stock: 20, costPrice: 30000, price: 45000, category: { name: "Тос" }, unit: { name: "л" } },
  { id: "g2", code: null, name: "Шүүлтүүр", isActive: true, stock: 3, costPrice: 8000, price: 15000, category: { name: "Шүүлтүүр" }, unit: { name: "ш" } },
  { id: "g3", code: "BRK", name: "Тоормосны наалт", isActive: true, stock: -2, costPrice: 50000, price: 90000, category: null, unit: { name: "ком" } },
  { id: "g4", code: "X1", name: "Аккумлятор", isActive: true, stock: 4, costPrice: null, price: 250000, category: null, unit: null },
];

function fake(goods = GOODS, usage: Array<{ serviceId: string; _sum: { quantity: number; total: number } }> = []) {
  const calls: Record<string, unknown> = {};
  const client = {
    service: { findMany: async (args: unknown) => { calls.service = args; return goods; } },
    serviceItem: { groupBy: async (args: unknown) => { calls.usage = args; return usage; } },
    category: { findMany: async (args: unknown) => { calls.category = args; return [{ id: "c1", name: "Тос" }]; } },
  };
  return { client: client as never, calls };
}

const FROM = new Date("2026-10-01T00:00:00+08:00");
const TO = new Date("2026-10-31T23:59:59.999+08:00");

test("rows: value = max(stock, 0) × cost / price, level from the stock threshold, usage joined per item", async () => {
  const { loadStockReport } = await import("../lib/stock-report");
  const { client } = fake(GOODS, [{ serviceId: "g1", _sum: { quantity: 6, total: 270000 } }]);
  const r = await loadStockReport("t1", { from: FROM, to: TO }, client);
  const row = (id: string) => r.rows.find((x) => x.id === id)!;
  assert.deepEqual([row("g1").level, row("g1").stockCost, row("g1").stockRetail, row("g1").usedQty, row("g1").usedAmount], ["ok", "600000", "900000", "6", "270000"]);
  assert.equal(row("g2").level, "low");
  // Negative stock is «out» and adds nothing to the value.
  assert.deepEqual([row("g3").stock, row("g3").level, row("g3").stockCost, row("g3").stockRetail], ["-2", "out", "0", "0"]);
  // Unknown cost: no cost value, still a retail value; flagged in the totals.
  assert.deepEqual([row("g4").stockCost, row("g4").stockRetail, row("g2").usedQty], [null, "1000000", "0"]);
  assert.deepEqual(r.totals, {
    items: 4, outCount: 1, lowCount: 2, stockCost: "624000", missingCostCount: 1, stockRetail: "1945000", usedQty: "6", usedAmount: "270000",
  });
});

test("filters: level filters rows and totals; sorts by stock / value / usage", async () => {
  const { loadStockReport } = await import("../lib/stock-report");
  const { client } = fake(GOODS, [{ serviceId: "g2", _sum: { quantity: 9, total: 135000 } }]);
  const low = await loadStockReport("t1", { from: FROM, to: TO, level: "low" }, client);
  assert.deepEqual(low.rows.map((r) => r.id).sort(), ["g2", "g4"]);
  assert.equal(low.totals.items, 2);
  assert.deepEqual((await loadStockReport("t1", { from: FROM, to: TO, sort: "stock" }, client)).rows.map((r) => r.id), ["g3", "g2", "g4", "g1"]);
  // Unknown cost sorts last by value.
  assert.deepEqual((await loadStockReport("t1", { from: FROM, to: TO, sort: "value" }, client)).rows.map((r) => r.id), ["g1", "g2", "g3", "g4"]);
  assert.equal((await loadStockReport("t1", { from: FROM, to: TO, sort: "used" }, client)).rows[0].id, "g2");
});

test("queries: tenant-scoped GOODS, search on name/code, inactive hidden by default; usage excludes cancelled items/orders and honours the branch", async () => {
  const { loadStockReport } = await import("../lib/stock-report");
  const { client, calls } = fake();
  await loadStockReport("t1", { from: FROM, to: TO, q: " тос ", categoryId: "c1", branchId: "b1" }, client);
  const where = (calls.service as { where: Record<string, unknown> }).where;
  assert.equal(where.tenantId, "t1");
  assert.equal(where.type, "GOODS");
  assert.equal(where.isActive, true);
  assert.equal(where.categoryId, "c1");
  assert.deepEqual(where.OR, [{ name: { contains: "тос", mode: "insensitive" } }, { code: { contains: "тос", mode: "insensitive" } }]);
  const usage = (calls.usage as { where: Record<string, unknown> }).where;
  assert.deepEqual(usage.createdAt, { gte: FROM, lte: TO });
  assert.deepEqual(usage.status, { not: "CANCELLED" });
  assert.deepEqual(usage.order, { is: { tenantId: "t1", status: { not: "CANCELLED" }, branchId: "b1" } });
  assert.deepEqual(usage.service, { is: where });

  const all = fake();
  await loadStockReport("t1", { from: FROM, to: TO, includeInactive: true }, all.client);
  assert.equal((all.calls.service as { where: Record<string, unknown> }).where.isActive, undefined);
  assert.deepEqual((all.calls.usage as { where: { order: unknown } }).where.order, { is: { tenantId: "t1", status: { not: "CANCELLED" } } });
});

test("workbook: one sheet with the page columns and a total row", async () => {
  const { loadStockReport, buildStockReportWorkbook, stockReportFilename } = await import("../lib/stock-report");
  const { client } = fake();
  const buf = await buildStockReportWorkbook(await loadStockReport("t1", { from: FROM, to: TO }, client));
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as unknown as ArrayBuffer);
  const ws = wb.getWorksheet("Үлдэгдэл")!;
  assert.deepEqual((ws.getRow(1).values as unknown[]).slice(1), [
    "Код", "Нэр", "Ангилал", "Нэгж", "Үлдэгдэл", "Төлөв", "Өртөг", "Зарах үнэ", "Үлдэгдлийн өртөг", "Зарах үнээр", "Зарцуулсан (тоо)", "Зарцуулсан (дүн)",
  ]);
  assert.equal(ws.rowCount, 1 + GOODS.length + 1);
  assert.equal((ws.getRow(ws.rowCount).values as unknown[])[2], "Нийт");
  assert.match(stockReportFilename(new Date("2026-10-14T03:00:00Z")), /^selbeg-uldegdel_2026-10-14\.xlsx$/);
});

test("sidebar: «Тайлан» has the order report and the stock report; the stock page and export check services view", async () => {
  const src = (rel: string) => readFile(new URL(`../${rel}`, import.meta.url), "utf8");
  const sidebar = await src("app/_components/admin-sidebar.tsx");
  assert.match(sidebar, /\{ href: "\/dashboard\/reports", label: "Засварын хуудасны тайлан", exact: true, view: PUBLIC_VIEW \}/);
  assert.match(sidebar, /\{ href: "\/dashboard\/reports\/stock", label: "Сэлбэг барааны үлдэгдэл", view: "services" \}/);
  assert.match(await src("app/dashboard/reports/stock/page.tsx"), /if \(!canView\(user, "services"\)\) redirect/);
  assert.match(await src("app/dashboard/reports/stock/export/route.ts"), /if \(!canView\(user, "services"\)\) return new Response\("Forbidden", \{ status: 403 \}\)/);
});
