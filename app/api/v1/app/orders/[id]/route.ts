import { jsonError, jsonOk } from "@/lib/api";
import { getApiAccountFromRequest } from "@/lib/auth/account-api-token";
import { INTAKE_VIEW_SELECT, omitIntakeColumns, toIntakeView } from "@/lib/orders/order-intake-view";
import { prisma } from "@/lib/prisma";
import { customerOwnershipFilters } from "@/lib/vehicles";

// GET /api/v1/app/orders/[id] — нэг засварын хуудасны дэлгэрэнгүй + хавсаргасан
// оношилгооны тайлангуудын БҮРЭН бөглөлт (template.schema-тай хамт, апп талд
// шууд харуулахад зориулав). Зөвшөөрөл: account/history веб хуудастай ижил —
// засварын хуудас account-тай холбоотой Customer-ийнх ЭСВЭЛ эзэмшлийн машины
// засварын хуудас байх ёстой.
export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const account = await getApiAccountFromRequest(req);
  if (!account) return jsonError(401, "Нэвтрэх шаардлагатай.");

  const { id } = await ctx.params;

  const order = await prisma.serviceOrder.findFirst({
    where: {
      id,
      isInternal: false,
      OR: customerOwnershipFilters(account.id, account.phone),
    },
    select: {
      id: true,
      number: true,
      status: true,
      paymentStatus: true,
      scheduledAt: true,
      completedAt: true,
      createdAt: true,
      notes: true,
      totalAmount: true,
      paidAmount: true,
      ...INTAKE_VIEW_SELECT,
      tenant: { select: { name: true, slug: true } },
      branch: { select: { name: true, phone: true } },
      vehicle: {
        select: { plate: true, make: true, model: true, year: true },
      },
      items: {
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          kind: true,
          description: true,
          quantity: true,
          unitPrice: true,
          total: true,
          status: true,
        },
      },
      reports: {
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          templateVersion: true,
          data: true,
          signatureUrl: true,
          mileageAtReport: true,
          notes: true,
          createdAt: true,
          template: { select: { name: true, type: true, schema: true } },
        },
      },
    },
  });
  if (!order) return jsonError(404, "Засварын хуудас олдсонгүй.");

  // Intake-н raw багана болон ажилтны нэрийг ил гаргахгүй (recordedBy үргэлж null).
  const { reports, ...rest } = omitIntakeColumns(order);
  return jsonOk({
    order: {
      ...rest,
      intake: toIntakeView(order, { includeRecordedBy: false }),
      reports: reports.map((r) => ({
        id: r.id,
        type: r.template.type,
        templateName: r.template.name,
        templateSchema: r.template.schema,
        templateVersion: r.templateVersion,
        data: r.data,
        signatureUrl: r.signatureUrl,
        mileageAtReport: r.mileageAtReport,
        notes: r.notes,
        createdAt: r.createdAt,
      })),
    },
  });
}
