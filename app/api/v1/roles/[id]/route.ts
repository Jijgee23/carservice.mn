// Contract — GET/PATCH/DELETE /api/v1/roles/[id]
//
// Роль нь СИСТЕМИЙН (глобал) — супер админ /system/roles-оос удирдана.
//
// GET    Read access matches `GET /api/v1/roles` — any of employees.view /
//        employees.create / employees.edit. 200: { role: RoleDto }.
//        404 { error, code: "NOT_FOUND" } if missing.
// PATCH  Removed — always 403 `{ error, code: "SYSTEM_MANAGED" }`.
// DELETE Removed — always 403 `{ error, code: "SYSTEM_MANAGED" }`.

import { jsonError, jsonForbidden, jsonOk, requireApiUser } from "@/lib/api";
import { hasPermission } from "@/lib/auth/roles";
import { ROLE_SELECT, SYSTEM_MANAGED_MESSAGE, toRoleDto, type FullRoleRow } from "@/lib/roles/dto";
import { prisma } from "@/lib/prisma";

function canReadRoles(user: { isOwner: boolean; role?: { permissions: string[] } | null }): boolean {
  return (
    hasPermission(user, "employees.view") ||
    hasPermission(user, "employees.create") ||
    hasPermission(user, "employees.edit")
  );
}

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireApiUser(req);
  if (auth.response) return auth.response;
  if (!canReadRoles(auth.user)) return jsonForbidden();
  const { id } = await ctx.params;

  const role = await prisma.role.findUnique({ where: { id }, select: ROLE_SELECT });
  if (!role) return jsonError(404, "Роль олдсонгүй.", { code: "NOT_FOUND" });

  return jsonOk({ role: toRoleDto(role as FullRoleRow) });
}

async function systemManaged(req: Request) {
  const auth = await requireApiUser(req);
  if (auth.response) return auth.response;
  return jsonError(403, SYSTEM_MANAGED_MESSAGE, { code: "SYSTEM_MANAGED" });
}

export async function PATCH(req: Request) {
  return systemManaged(req);
}

export async function DELETE(req: Request) {
  return systemManaged(req);
}
