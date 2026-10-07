import { jsonError, jsonOk } from "@/lib/api";
import { getApiAccountFromRequest } from "@/lib/auth/account-api-token";
import { prisma } from "@/lib/prisma";
import { customerOwnershipFilters } from "@/lib/vehicles";

// GET /api/v1/app/diagnostics/[id] — нэг оношилгооны тайлангийн БҮРЭН бөглөлт
// (template.schema-тай хамт, апп талд шууд харуулахад зориулав). Зөвшөөрөл:
// order-уудын ижил зарчим — тайлан account-тай холбоотой Customer-ийнх ЭСВЭЛ
// эзэмшлийн машины тайлан байх ёстой.
export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const account = await getApiAccountFromRequest(req);
  if (!account) return jsonError(401, "Нэвтрэх шаардлагатай.");

  const { id } = await ctx.params;

  const report = await prisma.diagnosticReport.findFirst({
    where: {
      id,
      OR: customerOwnershipFilters(account.id, account.phone),
    },
    select: {
      id: true,
      templateVersion: true,
      data: true,
      maxSeverity: true,
      signatureUrl: true,
      mileageAtReport: true,
      notes: true,
      createdAt: true,
      template: { select: { name: true, type: true, schema: true } },
      vehicle: { select: { plate: true, make: true, model: true, year: true } },
      branch: { select: { name: true } },
      order: { select: { id: true, number: true, isInternal: true } },
    },
  });
  if (!report) return jsonError(404, "Тайлан олдсонгүй.");

  return jsonOk({
    report: {
      id: report.id,
      type: report.template.type,
      templateName: report.template.name,
      templateSchema: report.template.schema,
      templateVersion: report.templateVersion,
      data: report.data,
      severity: report.maxSeverity,
      signatureUrl: report.signatureUrl,
      mileageAtReport: report.mileageAtReport,
      notes: report.notes,
      createdAt: report.createdAt,
      vehicle: report.vehicle,
      branch: report.branch,
      // Дотоод засварын захиалгыг ил гаргахгүй.
      order: report.order && !report.order.isInternal ? { id: report.order.id, number: report.order.number } : null,
    },
  });
}
