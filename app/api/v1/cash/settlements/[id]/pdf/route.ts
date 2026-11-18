// Contract — GET /api/v1/cash/settlements/[id]/pdf?format=a4|80mm
//
// Тооцооны нэхэмжлэхийн PDF (вэбийн /dashboard/cash/settlements/[id]/print-тэй ИЖИЛ баримт).
// Эрх: cash.manage (бусад cash route-тэй адил). Салбарын хүрээнээс гадуур → 404.
// Query: format = a4 | 80mm (анхдагч a4); буруу → 422. 200: application/pdf. Errors: 401, 403, 404, 422.

import { jsonError } from "@/lib/api";
import { resolveWorkingBranch } from "@/lib/auth/api-branch";
import { cashErrorResponse, requireCashApiUser } from "@/lib/cash/http";
import { loadSettlementDocument } from "@/lib/print/document-loaders";
import { PRINT_FORMATS, parsePrintFormat } from "@/lib/print/documents";
import { renderPrintPdf } from "@/lib/print/pdf";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireCashApiUser(req);
  if (auth.response) return auth.response;

  const rawFormat = new URL(req.url).searchParams.get("format");
  if (rawFormat != null && !(PRINT_FORMATS as readonly string[]).includes(rawFormat)) {
    return jsonError(422, "format нь a4 эсвэл 80mm байх ёстой.", { code: "VALIDATION", fieldErrors: { format: "a4 | 80mm" } });
  }
  const scope = await resolveWorkingBranch(req, auth.user);
  if (scope.response) return scope.response;

  const { id } = await ctx.params;
  try {
    const loaded = await loadSettlementDocument({ actor: auth.user, settlementId: id, scope: scope.branchId });
    if (!loaded.ok) return jsonError(404, "Тооцоо олдсонгүй.", { code: "SETTLEMENT_NOT_FOUND" });
    const pdf = await renderPrintPdf(loaded.doc, parsePrintFormat(rawFormat));
    return new Response(new Uint8Array(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="settlement-${loaded.settlement.id}.pdf"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    return cashErrorResponse("settlements.pdf", error);
  }
}
