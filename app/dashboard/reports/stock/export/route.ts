import { requireUser } from "@/lib/auth";
import { canView, workingBranchScopeId } from "@/lib/auth/roles";
import { parseRange, validateReportRangeParams } from "@/lib/reports";
import type { StockLevel } from "@/lib/services";
import {
  STOCK_REPORT_LEVELS,
  STOCK_REPORT_SORTS,
  buildStockReportWorkbook,
  loadStockReport,
  stockReportFilename,
  type StockReportSort,
} from "@/lib/stock-report";

// GET /dashboard/reports/stock/export?<same params as the page> — the page's filtered table as .xlsx.
export async function GET(req: Request) {
  const user = await requireUser();
  if (!canView(user, "services")) return new Response("Forbidden", { status: 403 });
  const sp = new URL(req.url).searchParams;
  const get = (k: string) => sp.get(k) ?? undefined;

  const rawRange = { from: get("from"), to: get("to") };
  const range = parseRange(validateReportRangeParams(rawRange) ? {} : rawRange);
  const level = get("level");
  const sort = get("sort");
  const report = await loadStockReport(user.tenantId, {
    q: get("q"),
    categoryId: get("categoryId") ?? null,
    level: (STOCK_REPORT_LEVELS as readonly string[]).includes(level ?? "") ? (level as StockLevel) : null,
    includeInactive: get("inactive") === "1",
    sort: (STOCK_REPORT_SORTS as readonly string[]).includes(sort ?? "") ? (sort as StockReportSort) : "name",
    from: range.from,
    to: range.to,
    branchId: workingBranchScopeId(user),
  });
  const buffer = await buildStockReportWorkbook(report);
  return new Response(buffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${stockReportFilename()}"`,
    },
  });
}
