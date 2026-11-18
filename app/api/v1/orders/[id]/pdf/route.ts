// Contract — GET /api/v1/orders/[id]/pdf?format=a4|80mm
//
// Захиалгын хуудас / нэхэмжлэхийн PDF (мобайл хэвлэх, хуваалцах). Вэбийн /dashboard/orders/[id]/print-тэй
// ИЖИЛ баримт (lib/print/document-loaders.ts loadOrderDocument) — зөвхөн PDF хэлбэр. Татварын баримт биш.
//
// Эрх: захиалга харах (orders.view эсвэл orders.viewOwn → зөвхөн өөрийн хуудас). Ажиллах салбарын хүрээг
// (X-Working-Branch) хүндэтгэнэ. Байхгүй / хүрээнээс гадуур / харах эрхгүй хуудас БҮГД 404 (оршин буйг
// алдахгүйн тулд, diagnostics PDF-тэй адил).
// Query: format = a4 | 80mm (байхгүй бол байгууллагын анхдагч хэмжээ); буруу утга → 422.
// 200: application/pdf (Content-Disposition: attachment; filename="order-<дугаар>.pdf"; Cache-Control: private, no-store)
// Errors: 401, 403 (эрх), 404, 422 (format).

import { jsonError, requireApiUser } from "@/lib/api";
import { resolveWorkingBranch } from "@/lib/auth/api-branch";
import { canView } from "@/lib/auth/roles";
import { getBranchVisibility } from "@/lib/branch-visibility";
import { loadOrderDocument } from "@/lib/print/document-loaders";
import { PRINT_FORMATS, parsePrintFormat, type PrintFormat } from "@/lib/print/documents";
import { renderPrintPdf } from "@/lib/print/pdf";
import { prisma } from "@/lib/prisma";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireApiUser(req);
  if (auth.response) return auth.response;
  const user = auth.user;
  if (!canView(user, "orders")) return jsonError(403, "Танд энэ үйлдэл хийх эрх байхгүй.");

  const rawFormat = new URL(req.url).searchParams.get("format");
  if (rawFormat != null && !(PRINT_FORMATS as readonly string[]).includes(rawFormat)) {
    return jsonError(422, "format нь a4 эсвэл 80mm байх ёстой.", { code: "VALIDATION", fieldErrors: { format: "a4 | 80mm" } });
  }

  const scope = await resolveWorkingBranch(req, user);
  if (scope.response) return scope.response;
  const tenant = await prisma.tenant.findUnique({ where: { id: user.tenantId }, select: { plan: true } });
  const { hideBranches } = await getBranchVisibility({ tenantId: user.tenantId, tenant: { plan: tenant?.plan ?? user.tenantPlan } });

  const { id } = await ctx.params;
  const loaded = await loadOrderDocument({ user, orderId: id, scopeBranchId: scope.branchId, hideBranches });
  if (!loaded.ok) return jsonError(404, "Засварын хуудас олдсонгүй.", { code: "NOT_FOUND" });

  const format: PrintFormat = parsePrintFormat(rawFormat, loaded.defaultFormat);
  const pdf = await renderPrintPdf(loaded.doc, format);
  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="order-${loaded.order.number.replace(/[^\w.-]+/g, "_")}.pdf"`,
      "Cache-Control": "private, no-store",
    },
  });
}
