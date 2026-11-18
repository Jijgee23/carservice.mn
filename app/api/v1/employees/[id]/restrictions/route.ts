// Contract — GET/PUT /api/v1/employees/[id]/restrictions
//
// Ажилтны эрхийн ХЯЗГААРЛАЛТ: ролиос (байгууллагын override-ийн дараах) зарим эрхийг хасна.
// Эрх НЭМЭХГҮЙ — зөвхөн ажилтанд ОДОО байгаа эрхийг хасна.
//
// Permission: employees.edit (вэбийн action-тай ижил). PUT нь идэвхтэй захиалга шаардана.
// GET  200 { restrictions: { employeeId, grantedPermissions, denied, effectivePermissions } } | 404 NOT_FOUND
// PUT  Body { denied: string[] } (хоосон = хязгаарлалтыг арилгана).
//      200 { restrictions } | 404 NOT_FOUND | 403 OWNER_TARGET / SELF / SUPERIOR_TARGET
//      | 422 VALIDATION { fieldErrors } (тодорхойгүй эрхийн код)

import { jsonError, jsonOk, requireApiUser, requirePermission } from "@/lib/api";
import { logAudit } from "@/lib/audit";
import { getEmployeeRestrictions, saveEmployeeRestrictions } from "@/lib/employees/restrictions";
import { requireActiveSubscriptionApi } from "@/lib/subscription-server";
import { prisma } from "@/lib/prisma";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireApiUser(req);
  if (auth.response) return auth.response;
  const denied = requirePermission(auth.user, "employees.edit");
  if (denied) return denied;

  const { id } = await ctx.params;
  const view = await getEmployeeRestrictions(auth.user, id);
  if (!view) return jsonError(404, "Ажилтан олдсонгүй.", { code: "NOT_FOUND" });
  return jsonOk({ restrictions: view });
}

export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireApiUser(req);
  if (auth.response) return auth.response;
  const denied = requirePermission(auth.user, "employees.edit");
  if (denied) return denied;
  const locked = await requireActiveSubscriptionApi(auth.user);
  if (locked) return locked;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError(400, "JSON body шаардлагатай.", { code: "VALIDATION" });
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return jsonError(400, "Body буруу.", { code: "VALIDATION" });
  }

  const { id } = await ctx.params;
  const r = await saveEmployeeRestrictions(prisma, auth.user, id, (body as { denied?: unknown }).denied ?? []);
  if (!r.ok) {
    if (r.code === "NOT_FOUND") return jsonError(404, r.error, { code: r.code });
    if (r.code === "VALIDATION") return jsonError(422, r.error, { code: r.code, fieldErrors: r.fieldErrors });
    return jsonError(403, r.error, { code: r.code });
  }

  await logAudit({
    tenantId: auth.user.tenantId,
    userId: auth.user.id,
    entity: "User",
    entityId: id,
    action: "UPDATE",
    summary: r.summary,
    before: r.before,
    after: r.after,
  });

  return jsonOk({ restrictions: r.view });
}
