import { jsonError, jsonOk, requireApiUser, requirePermission } from "@/lib/api";
import { resolveWorkingBranch } from "@/lib/auth/api-branch";
import { canDelete } from "@/lib/auth/roles";
import { logAudit } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import { canEditOrder, canViewOrder } from "@/lib/auth/order-access";

export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const auth = await requireApiUser(req);
  if (auth.response) return auth.response;
  const denied = requirePermission(auth.user, "diagnostics.view");
  if (denied) return denied;
  const { id } = await ctx.params;
  const scopeResult = await resolveWorkingBranch(req, auth.user);
  if (scopeResult.response) return scopeResult.response;
  const scope = scopeResult.branchId;

  const report = await prisma.diagnosticReport.findFirst({
    where: {
      id,
      tenantId: auth.user.tenantId,
      ...(scope ? { branchId: scope } : {}),
    },
    include: {
      template: {
        select: {
          id: true,
          name: true,
          type: true,
          schema: true,
        },
      },
      customer: { select: { id: true, fullName: true, phone: true } },
      vehicle: {
        select: { id: true, plate: true, make: true, model: true, year: true },
      },
      branch: { select: { id: true, name: true } },
      filledBy: { select: { id: true, firstName: true, lastName: true } },
      order: { select: { id: true, number: true, assignedToId: true, branchId: true } },
    },
  });
  if (!report) return jsonError(404, "Тайлан олдсонгүй.");
  if (report.order && !canViewOrder(auth.user, report.order)) return jsonError(404, "Тайлан олдсонгүй.");

  return jsonOk({ report });
}

export async function DELETE(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const auth = await requireApiUser(req);
  if (auth.response) return auth.response;
  const { id } = await ctx.params;
  const scopeResult = await resolveWorkingBranch(req, auth.user);
  if (scopeResult.response) return scopeResult.response;
  const scope = scopeResult.branchId;

  const report = await prisma.diagnosticReport.findFirst({
    where: {
      id,
      tenantId: auth.user.tenantId,
      ...(scope ? { branchId: scope } : {}),
    },
    select: { id: true, filledById: true, orderId: true, order: { select: { assignedToId: true, branchId: true } } },
  });
  if (!report) return jsonError(404, "Тайлан олдсонгүй.");

  const allowed =
    canDelete(auth.user, "diagnostics") || report.filledById === auth.user.id;
  if (!allowed) return jsonError(403, "Танд устгах эрх байхгүй.");
  if (report.order && !canEditOrder(auth.user, report.order)) return jsonError(403, "Танд энэ тайланг устгах эрх байхгүй.");

  // Энэ тайланг гүйцээж байсан ServiceItem-ийг олж, тайлан устгагдсаны дараа
  // (FK-ийн SET NULL-аар diagnosticReportId нь автоматаар хоослогдоно) статусыг
  // нь бөглөх хүлээгдэж буй болгож буцаана — mirrors deleteReportAction.
  const linkedItem = await prisma.serviceItem.findUnique({
    where: { diagnosticReportId: report.id },
    select: { id: true, status: true },
  });
  // Дууссан оношилгооны мөр түгжигдсэн — тайланг устгаж мөрийг буцаах боломжгүй.
  if (linkedItem?.status === "COMPLETED") {
    return jsonError(422, "Дууссан ажлыг засах боломжгүй.", { code: "ITEM_COMPLETED_LOCKED" });
  }

  await prisma.$transaction(async (tx) => {
    await tx.diagnosticReport.delete({ where: { id: report.id } });
    if (linkedItem) {
      await tx.serviceItem.update({
        where: { id: linkedItem.id },
        data: { status: "PENDING", startedAt: null, completedAt: null },
      });
    }
  });

  await logAudit({
    tenantId: auth.user.tenantId,
    userId: auth.user.id,
    entity: "DiagnosticReport",
    entityId: report.id,
    action: "DELETE",
    summary: report.orderId ? `засварын хуудас #${report.orderId}` : null,
  });

  return jsonOk({ ok: true });
}
