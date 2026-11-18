// Contract — GET /api/v1/roles/overrides
//
// Систем админ ядаж нэг эрхийг өөрчлөхийг зөвшөөрсөн идэвхтэй ролиуд + ЭНЭ байгууллагын override.
// Auth: GET /api/v1/roles-тэй ижил (employees.view|create|edit).
// 200: { roles: RoleOverrideView[] } — { roleId, name, description, rolePermissions,
//      editablePermissions, add, remove, effectivePermissions }

import { jsonForbidden, jsonOk, requireApiUser } from "@/lib/api";
import { hasPermission } from "@/lib/auth/roles";
import { listTenantRoleOverrides } from "@/lib/roles/tenant-overrides";

export async function GET(req: Request) {
  const auth = await requireApiUser(req);
  if (auth.response) return auth.response;
  const u = auth.user;
  if (!(hasPermission(u, "employees.view") || hasPermission(u, "employees.create") || hasPermission(u, "employees.edit"))) {
    return jsonForbidden();
  }
  return jsonOk({ roles: await listTenantRoleOverrides(u.tenantId) });
}
