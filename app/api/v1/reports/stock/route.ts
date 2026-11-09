// Сэлбэг барааны үлдэгдлийн тайлан — mobile staff API. Вэбийн
// `app/dashboard/reports/stock` хуудастай ижил `loadStockReport`
// (lib/stock-report.ts)-ийг дуудна, fork хийхгүй.
//
// Модулийн хаалт: API_MODULE_PATHS "/api/v1/reports/stock" → enable_inventory
// (`requireApiUser` дотор). Салбарын хүрээ (зөвхөн зарцуулалтад нөлөөлнө —
// үлдэгдэл бүх салбарт нэг) — `resolveWorkingBranch` (X-Working-Branch
// header + ээлжийн түгжээ), `/api/v1/reports`-тэй ижил mobile загвар.

import { jsonError, jsonOk, requireApiUser, requirePermission } from "@/lib/api";
import { resolveWorkingBranch } from "@/lib/auth/api-branch";
import { rejectUnknownParams } from "@/lib/list-query-params";
import { fmt, parseRange, validateReportRangeParams } from "@/lib/reports";
import type { StockLevel } from "@/lib/services";
import { STOCK_REPORT_LEVELS, STOCK_REPORT_SORTS, loadStockReport, type StockReportSort } from "@/lib/stock-report";

const ALLOWED_PARAMS = ["q", "categoryId", "level", "inactive", "sort", "from", "to"] as const;

const validation = (field: string, message: string) =>
  jsonError(422, message, { code: "VALIDATION", fieldErrors: { [field]: message } });

/**
 * GET /api/v1/reports/stock — permission: services.view (вэбийн хуудасны `canView(user, "services")`)
 * Query (бүгд заавал биш, вэбийн searchParams-тай ижил):
 *   q — нэр/кодоор хайх; categoryId; level — out | low | ok;
 *   inactive=1 — идэвхгүй барааг оруулах; sort — name (default) | stock | value | used;
 *   from, to — YYYY-MM-DD, зарцуулалтын хугацаа (default: энэ сар).
 * Вэб буруу утгыг чимээгүй орхидог бол API 422 VALIDATION буцаана
 * (`/api/v1/reports`-тэй ижил); үл мэдэгдэх параметр ч 422.
 * 200: { range: { from, to, label, key }, filters, rows, totals, categories }
 *   (мөнгө/тоо хэмжээ string — `StockReport` төрөл).
 */
export async function GET(req: Request) {
  const auth = await requireApiUser(req);
  if (auth.response) return auth.response;
  const denied = requirePermission(auth.user, "services.view");
  if (denied) return denied;

  const sp = new URL(req.url).searchParams;
  const unknown = rejectUnknownParams(sp, ALLOWED_PARAMS);
  if (unknown) return validation(unknown.field, unknown.message);

  const rawRange = { from: sp.get("from") || undefined, to: sp.get("to") || undefined };
  const invalid = validateReportRangeParams(rawRange);
  if (invalid) return validation(invalid.field, invalid.message);

  const levelRaw = sp.get("level") || "";
  if (levelRaw && !(STOCK_REPORT_LEVELS as readonly string[]).includes(levelRaw)) {
    return validation("level", `level нь ${STOCK_REPORT_LEVELS.join(" | ")} байх ёстой.`);
  }
  const sortRaw = sp.get("sort") || "";
  if (sortRaw && !(STOCK_REPORT_SORTS as readonly string[]).includes(sortRaw)) {
    return validation("sort", `sort нь ${STOCK_REPORT_SORTS.join(" | ")} байх ёстой.`);
  }

  const range = parseRange(rawRange);
  const level = levelRaw ? (levelRaw as StockLevel) : null;
  const sort: StockReportSort = sortRaw ? (sortRaw as StockReportSort) : "name";
  const includeInactive = sp.get("inactive") === "1";
  const q = sp.get("q") || undefined;
  const categoryId = sp.get("categoryId") || null;

  const scope = await resolveWorkingBranch(req, auth.user);
  if (scope.response) return scope.response;

  const report = await loadStockReport(auth.user.tenantId, {
    q,
    categoryId,
    level,
    includeInactive,
    sort,
    from: range.from,
    to: range.to,
    branchId: scope.branchId ?? null,
  });

  return jsonOk({
    range: { from: fmt(range.from), to: fmt(range.to), label: range.label, key: range.key },
    filters: { q: q ?? null, categoryId, level, inactive: includeInactive, sort },
    rows: report.rows,
    totals: report.totals,
    categories: report.categories,
  });
}
