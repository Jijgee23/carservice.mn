// Contract — GET/PUT /api/v1/roles/[id]/override
//
// Байгууллагын нийтийн роль дээрх нэмэлт/хасалт. Зөвхөн систем админ «өөрчилж болно» гэж
// тэмдэглэсэн эрхэд (Role.tenantEditablePermissions) хүчинтэй.
//
// GET  employees.view|create|edit. 200 { override: RoleOverrideView } | 404 NOT_FOUND
// PUT  ЗӨВХӨН байгууллагын эзэн. Body { add?: string[], remove?: string[] } (хоосон = анхдагч руу).
//      200 { override } | 403 | 404 NOT_FOUND | 403 LOCKED (өөрчилж болох эрхгүй роль)
//      | 422 VALIDATION { fieldErrors } (түгжигдсэн/тодорхойгүй код)

import { jsonError, jsonForbidden, jsonOk, requireApiUser } from "@/lib/api";
import { hasPermission } from "@/lib/auth/roles";
import { getTenantRoleOverrideView, saveTenantRoleOverride } from "@/lib/roles/tenant-overrides";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireApiUser(req);
  if (auth.response) return auth.response;
  const u = auth.user;
  if (!(hasPermission(u, "employees.view") || hasPermission(u, "employees.create") || hasPermission(u, "employees.edit"))) {
    return jsonForbidden();
  }
  const { id } = await ctx.params;
  const view = await getTenantRoleOverrideView(u.tenantId, id);
  if (!view) return jsonError(404, "Роль олдсонгүй.", { code: "NOT_FOUND" });
  return jsonOk({ override: view });
}

export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireApiUser(req);
  if (auth.response) return auth.response;
  const u = auth.user;
  if (!u.isOwner) return jsonForbidden("Зөвхөн байгууллагын эзэн өөрчилнө.");

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError(400, "JSON body шаардлагатай.");
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) return jsonError(400, "Body буруу.");
  const { add, remove } = body as { add?: unknown; remove?: unknown };

  const { id } = await ctx.params;
  const r = await saveTenantRoleOverride({ tenantId: u.tenantId, userId: u.id }, id, { add, remove });
  if (!r.ok) {
    if (r.code === "NOT_FOUND") return jsonError(404, r.message, { code: "NOT_FOUND" });
    if (r.code === "LOCKED") return jsonError(403, r.message, { code: "LOCKED" });
    return jsonError(422, r.message, { code: "VALIDATION", fieldErrors: r.fieldErrors });
  }
  return jsonOk({ override: r.view });
}
