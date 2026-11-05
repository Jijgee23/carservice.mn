import { requireUser } from "@/lib/auth";
import { moduleGateForPlan } from "@/lib/plan-modules-server";
import { workingBranchScopeId } from "@/lib/auth/roles";
import { loadReportData, parseRange } from "@/lib/reports";
import { buildReportWorkbook, reportExportFilename } from "@/lib/reports-export";

// GET /dashboard/reports/export?from=YYYY-MM-DD&to=YYYY-MM-DD
// Тухайн хугацааны тайланг .xlsx болгож татна (dashboard/reports/page.tsx-тэй
// ижил loadReportData-г ашиглана — дата тооцоолол давхардахгүй). Workbook
// байгуулалт lib/reports-export.ts-д (P7-B0) шилжсэн тул энэ route зөвхөн
// дуудагч (thin caller) болсон.
export async function GET(req: Request) {
  const user = await requireUser();
  const blocked = await moduleGateForPlan(user.tenant.plan, ["enable_reports"]);
  if (blocked) return blocked;
  const { searchParams } = new URL(req.url);
  const range = parseRange({
    from: searchParams.get("from") ?? undefined,
    to: searchParams.get("to") ?? undefined,
  });
  const data = await loadReportData(user, range, workingBranchScopeId(user));
  const buffer = await buildReportWorkbook(data, range);
  const filename = reportExportFilename(range);

  return new Response(buffer, {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
