import { requireUser } from "@/lib/auth";
import { CashError } from "@/lib/cash/rules";
import { buildCashSummary } from "@/lib/cash/report";
import { buildCashSummaryWorkbook, cashSummaryFilename } from "@/lib/cash/report-export";
import { MAX_REPORT_RANGE_DAYS, parseRange, validateReportRangeParams } from "@/lib/reports";

// GET /dashboard/cash/report/export?from=YYYY-MM-DD&to=YYYY-MM-DD&branchId
// «Мөнгөн гүйлгээний тайлан»-г .xlsx болгож татна (cash.manage). Дата тооцоолол lib/cash/report.ts-д.
export async function GET(req: Request) {
  const user = await requireUser();
  const { searchParams } = new URL(req.url);
  const invalid = validateReportRangeParams({ from: searchParams.get("from"), to: searchParams.get("to") });
  if (invalid) return Response.json({ error: invalid.message, code: "VALIDATION", fieldErrors: { [invalid.field]: invalid.message } }, { status: 422 });
  const range = parseRange({ from: searchParams.get("from") ?? undefined, to: searchParams.get("to") ?? undefined });
  // Same 366-day cap as the page (F20): validateReportRangeParams only checks a span when BOTH ends are given, so a
  // lone `from` (to defaults to today) could still request an unbounded range. Check the resolved range.
  if (range.to.getTime() - range.from.getTime() > MAX_REPORT_RANGE_DAYS * 24 * 60 * 60 * 1000) {
    const message = `Хугацааны муж хэт урт байна (дээд тал нь ${MAX_REPORT_RANGE_DAYS} хоног).`;
    return Response.json({ error: message, code: "VALIDATION", fieldErrors: { to: message } }, { status: 422 });
  }
  try {
    const summary = await buildCashSummary({
      actor: user,
      from: range.from,
      to: range.to,
      branchId: searchParams.get("branchId"),
    });
    const buffer = await buildCashSummaryWorkbook(summary);
    return new Response(buffer, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${cashSummaryFilename(range.from, range.to)}"`,
      },
    });
  } catch (error) {
    if (error instanceof CashError) {
      return Response.json({ error: error.message, code: error.code }, { status: error.status });
    }
    throw error;
  }
}
