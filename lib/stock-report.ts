// «Сэлбэг барааны үлдэгдлийн тайлан»: GOODS catalog stock as of now, its value at cost / sale price, and how much of
// each item went into repair orders in the period. Stock is one tenant-wide number per item (Service.stock, decremented
// when a part is added to an order and restored when the item / order is cancelled), so there is no per-branch stock and
// no incoming-stock history — usage is the only period figure, and it honours the branch scope through the order.
import ExcelJS from "exceljs";
import { Prisma } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { stockLevel, type StockLevel } from "@/lib/services";

export const STOCK_REPORT_LEVELS = ["out", "low", "ok"] as const;
export const STOCK_REPORT_SORTS = ["name", "stock", "value", "used"] as const;
export type StockReportSort = (typeof STOCK_REPORT_SORTS)[number];

export type StockReportFilters = {
  /** Name or code contains (case-insensitive). */
  q?: string | null;
  categoryId?: string | null;
  level?: StockLevel | null;
  includeInactive?: boolean;
  sort?: StockReportSort;
  /** Usage period (inclusive instants). */
  from: Date;
  to: Date;
  /** Usage is limited to this branch's orders (stock itself is tenant-wide). */
  branchId?: string | null;
};

export type StockReportRow = {
  id: string;
  code: string | null;
  name: string;
  category: string | null;
  unit: string | null;
  isActive: boolean;
  stock: string;
  level: StockLevel;
  costPrice: string | null;
  price: string;
  /** stock × costPrice; null when the cost is unknown. Negative stock counts as 0 value. */
  stockCost: string | null;
  /** stock × price (negative stock counts as 0). */
  stockRetail: string;
  usedQty: string;
  usedAmount: string;
};

export type StockReport = {
  rows: StockReportRow[];
  totals: {
    items: number;
    outCount: number;
    lowCount: number;
    stockCost: string;
    /** Items with stock but no cost price (their cost value is unknown and left out of stockCost). */
    missingCostCount: number;
    stockRetail: string;
    usedQty: string;
    usedAmount: string;
  };
  categories: Array<{ id: string; name: string }>;
};

const ZERO = new Prisma.Decimal(0);
const dec = (v: { toString(): string } | null | undefined) => new Prisma.Decimal((v ?? 0).toString());

type Client = Pick<typeof prisma, "service" | "serviceItem" | "category">;

export async function loadStockReport(tenantId: string, filters: StockReportFilters, client: Client = prisma): Promise<StockReport> {
  const q = filters.q?.trim() ?? "";
  const goodsWhere: Prisma.ServiceWhereInput = {
    tenantId,
    type: "GOODS",
    ...(filters.includeInactive ? {} : { isActive: true }),
    ...(filters.categoryId ? { categoryId: filters.categoryId } : {}),
    ...(q ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { code: { contains: q, mode: "insensitive" } }] } : {}),
  };

  const [goods, usage, categoryRows] = await Promise.all([
    client.service.findMany({
      where: goodsWhere,
      select: {
        id: true,
        code: true,
        name: true,
        isActive: true,
        stock: true,
        costPrice: true,
        price: true,
        category: { select: { name: true } },
        unit: { select: { name: true } },
      },
    }),
    // Parts that went into orders in the period: the item and its order are not cancelled (cancelling restores stock).
    client.serviceItem.groupBy({
      by: ["serviceId"],
      where: {
        createdAt: { gte: filters.from, lte: filters.to },
        status: { not: "CANCELLED" },
        service: { is: goodsWhere },
        order: { is: { tenantId, status: { not: "CANCELLED" }, ...(filters.branchId ? { branchId: filters.branchId } : {}) } },
      },
      _sum: { quantity: true, total: true },
    }),
    client.category.findMany({
      where: { tenantId, services: { some: { tenantId, type: "GOODS" } } },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
  ]);

  const usedById = new Map(usage.map((u) => [u.serviceId, u]));
  let rows: StockReportRow[] = goods.map((g) => {
    const stock = dec(g.stock);
    const valued = stock.gt(0) ? stock : ZERO;
    const used = usedById.get(g.id);
    return {
      id: g.id,
      code: g.code,
      name: g.name,
      category: g.category?.name ?? null,
      unit: g.unit?.name ?? null,
      isActive: g.isActive,
      stock: stock.toString(),
      level: stockLevel(stock.toNumber()),
      costPrice: g.costPrice == null ? null : dec(g.costPrice).toString(),
      price: dec(g.price).toString(),
      stockCost: g.costPrice == null ? null : valued.times(dec(g.costPrice)).toString(),
      stockRetail: valued.times(dec(g.price)).toString(),
      usedQty: dec(used?._sum.quantity).toString(),
      usedAmount: dec(used?._sum.total).toString(),
    };
  });

  // Level is derived (stock vs threshold), so it filters here; the summary below covers the filtered rows.
  if (filters.level) rows = rows.filter((r) => r.level === filters.level);

  const byName = (a: StockReportRow, b: StockReportRow) => a.name.localeCompare(b.name, "mn");
  const num = (v: string | null) => (v == null ? -Infinity : Number(v));
  const sorters: Record<StockReportSort, (a: StockReportRow, b: StockReportRow) => number> = {
    name: byName,
    stock: (a, b) => Number(a.stock) - Number(b.stock) || byName(a, b),
    value: (a, b) => num(b.stockCost) - num(a.stockCost) || byName(a, b),
    used: (a, b) => Number(b.usedQty) - Number(a.usedQty) || byName(a, b),
  };
  rows.sort(sorters[filters.sort ?? "name"]);

  const totals = rows.reduce(
    (t, r) => ({
      items: t.items + 1,
      outCount: t.outCount + (r.level === "out" ? 1 : 0),
      lowCount: t.lowCount + (r.level === "low" ? 1 : 0),
      stockCost: r.stockCost == null ? t.stockCost : t.stockCost.plus(r.stockCost),
      missingCostCount: t.missingCostCount + (r.stockCost == null && Number(r.stock) > 0 ? 1 : 0),
      stockRetail: t.stockRetail.plus(r.stockRetail),
      usedQty: t.usedQty.plus(r.usedQty),
      usedAmount: t.usedAmount.plus(r.usedAmount),
    }),
    { items: 0, outCount: 0, lowCount: 0, stockCost: ZERO, missingCostCount: 0, stockRetail: ZERO, usedQty: ZERO, usedAmount: ZERO },
  );

  return {
    rows,
    totals: {
      ...totals,
      stockCost: totals.stockCost.toString(),
      stockRetail: totals.stockRetail.toString(),
      usedQty: totals.usedQty.toString(),
      usedAmount: totals.usedAmount.toString(),
    },
    categories: categoryRows,
  };
}

export function stockReportFilename(now: Date = new Date()): string {
  const d = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ulaanbaatar" }).format(now);
  return `selbeg-uldegdel_${d}.xlsx`;
}

/** One sheet, same columns as the page table. Pure: report in, Buffer out. */
export async function buildStockReportWorkbook(report: StockReport) {
  const wb = new ExcelJS.Workbook();
  wb.creator = "carservice.mn";
  wb.created = new Date();
  const ws = wb.addWorksheet("Үлдэгдэл");
  ws.columns = [
    { header: "Код", key: "code", width: 14 },
    { header: "Нэр", key: "name", width: 34 },
    { header: "Ангилал", key: "category", width: 18 },
    { header: "Нэгж", key: "unit", width: 8 },
    { header: "Үлдэгдэл", key: "stock", width: 12 },
    { header: "Төлөв", key: "level", width: 14 },
    { header: "Өртөг", key: "costPrice", width: 14 },
    { header: "Зарах үнэ", key: "price", width: 14 },
    { header: "Үлдэгдлийн өртөг", key: "stockCost", width: 18 },
    { header: "Зарах үнээр", key: "stockRetail", width: 16 },
    { header: "Зарцуулсан (тоо)", key: "usedQty", width: 16 },
    { header: "Зарцуулсан (дүн)", key: "usedAmount", width: 16 },
  ];
  const n = (v: string | null) => (v == null ? null : Number(v));
  const levelLabel: Record<StockLevel, string> = { out: "Дууссан", low: "Бага", ok: "Хүрэлцээтэй" };
  for (const r of report.rows) {
    ws.addRow({
      code: r.code ?? "",
      name: r.isActive ? r.name : `${r.name} (идэвхгүй)`,
      category: r.category ?? "",
      unit: r.unit ?? "",
      stock: n(r.stock),
      level: levelLabel[r.level],
      costPrice: n(r.costPrice),
      price: n(r.price),
      stockCost: n(r.stockCost),
      stockRetail: n(r.stockRetail),
      usedQty: n(r.usedQty),
      usedAmount: n(r.usedAmount),
    });
  }
  const t = report.totals;
  ws.addRow({ name: "Нийт", stockCost: n(t.stockCost), stockRetail: n(t.stockRetail), usedQty: n(t.usedQty), usedAmount: n(t.usedAmount) }).font = { bold: true };
  ws.getRow(1).font = { bold: true };
  return Buffer.from(await wb.xlsx.writeBuffer());
}
