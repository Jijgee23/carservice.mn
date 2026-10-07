import { jsonError, jsonOk } from "@/lib/api";
import { resolveWorkingBranch } from "@/lib/auth/api-branch";
import { cashErrorResponse, requireCashApiUser } from "@/lib/cash/http";
import { buildCashSummary } from "@/lib/cash/report";
import { rejectUnknownParams } from "@/lib/list-query-params";
import { parseRange, validateReportRangeParams } from "@/lib/reports";

const ALLOWED_PARAMS = ["from", "to", "branchId"] as const;

// GET /api/v1/cash/report?from=YYYY-MM-DD&to=YYYY-MM-DD&branchId  (Эрх: cash.manage)
// from/to optional (default «энэ сар»), max 366 days; branchId ignored when the working branch is pinned.
// -> { range: { from, to, label, key }, summary: CashSummary }   422 VALIDATION | 403 CASH_MANAGE_FORBIDDEN
export async function GET(req: Request) {
  const auth = await requireCashApiUser(req);
  if (auth.response) return auth.response;
  const { searchParams } = new URL(req.url);
  const unknown = rejectUnknownParams(searchParams, ALLOWED_PARAMS);
  if (unknown) {
    return jsonError(422, unknown.message, { code: "VALIDATION", fieldErrors: { [unknown.field]: unknown.message } });
  }
  const from = searchParams.get("from");
  const to = searchParams.get("to");
  const invalid = validateReportRangeParams({ from, to });
  if (invalid) {
    return jsonError(422, invalid.message, { code: "VALIDATION", fieldErrors: { [invalid.field]: invalid.message } });
  }
  const range = parseRange({ from: from ?? undefined, to: to ?? undefined });
  const scopeResult = await resolveWorkingBranch(req, auth.user);
  if (scopeResult.response) return scopeResult.response;
  try {
    const summary = await buildCashSummary({
      actor: auth.user,
      from: range.from,
      to: range.to,
      branchId: searchParams.get("branchId"),
      scope: scopeResult.branchId ?? null,
    });
    return jsonOk({ range, summary });
  } catch (error) {
    return cashErrorResponse("report", error);
  }
}
