// Contract — DELETE /api/v1/tenant/photos/[id]
//
// Зургийг устгана (мөр + файл). Эрх: байгууллагын нийтлэг зураг → зөвхөн эзэмшигч; салбарын зураг → `branches.edit`.
// Өөр байгууллагын зураг "олдсонгүй" (404) — оршихуйг ил болгохгүй.
// 200: { ok: true } | 401 | 403 | 404 { code: "NOT_FOUND" }

import { jsonError, jsonForbidden, jsonOk, requireApiUser, requirePermission } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { removeTenantPhoto } from "@/lib/tenant-photos";

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireApiUser(req);
  if (auth.response) return auth.response;
  const { id } = await ctx.params;

  const photo = await prisma.tenantPhoto.findFirst({ where: { id, tenantId: auth.user.tenantId }, select: { branchId: true } });
  if (!photo) return jsonError(404, "Зураг олдсонгүй.", { code: "NOT_FOUND" });

  if (photo.branchId === null) {
    if (!auth.user.isOwner) return jsonForbidden("Зөвхөн админ байгууллагын зургийг өөрчилнө.");
  } else {
    const denied = requirePermission(auth.user, "branches.edit");
    if (denied) return denied;
  }

  const result = await removeTenantPhoto({ tenantId: auth.user.tenantId, userId: auth.user.id }, id);
  if (!result.ok) return jsonError(404, result.message, { code: "NOT_FOUND" });
  return jsonOk({ ok: true });
}
