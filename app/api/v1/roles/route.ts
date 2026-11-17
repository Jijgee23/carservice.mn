// Contract — GET/POST /api/v1/roles
//
// Роль нь СИСТЕМИЙН (глобал): супер админ /system/roles-оос удирдана, бүх
// байгууллага ижил жагсаалтаас сонгож ажилтандаа онооно (lib/roles/system-roles.ts).
//
// GET /api/v1/roles
//   Permission: any of employees.view / employees.create / employees.edit —
//   the same union the web employee form loaders require (not owner-only).
//   Query: page?, pageSize?/limit? (standard `parsePagination`, unknown
//   params rejected). Active roles first, then by sortOrder/name.
//   200: { roles: RoleDto[], pagination: PaginationMeta }
//
// POST /api/v1/roles
//   Removed — tenants can no longer create roles. Always 403
//   `{ error, code: "SYSTEM_MANAGED" }` (after auth).

import { jsonError, jsonForbidden, jsonOk, requireApiUser } from "@/lib/api";
import { hasPermission } from "@/lib/auth/roles";
import { ROLE_SELECT, SYSTEM_MANAGED_MESSAGE, toRoleDto, type FullRoleRow } from "@/lib/roles/dto";
import { parsePagination, rejectUnknownParams } from "@/lib/list-query-params";
import { buildMeta } from "@/lib/pagination";
import { prisma } from "@/lib/prisma";

const ALLOWED_PARAMS = ["page", "pageSize", "limit"] as const;

function canReadRoles(user: { isOwner: boolean; role?: { permissions: string[] } | null }): boolean {
  return (
    hasPermission(user, "employees.view") ||
    hasPermission(user, "employees.create") ||
    hasPermission(user, "employees.edit")
  );
}

export async function GET(req: Request) {
  const auth = await requireApiUser(req);
  if (auth.response) return auth.response;
  if (!canReadRoles(auth.user)) return jsonForbidden();

  const url = new URL(req.url);
  const unknown = rejectUnknownParams(url.searchParams, ALLOWED_PARAMS);
  if (unknown) {
    return jsonError(422, unknown.message, {
      code: "VALIDATION",
      fieldErrors: { [unknown.field]: unknown.message },
    });
  }
  const paged = parsePagination(url.searchParams);
  if (!("page" in paged)) {
    return jsonError(422, paged.message, { code: "VALIDATION", fieldErrors: { [paged.field]: paged.message } });
  }
  const { page, pageSize, skip, take } = paged;

  const [roles, total] = await Promise.all([
    prisma.role.findMany({
      orderBy: [{ isActive: "desc" }, { sortOrder: "asc" }, { name: "asc" }],
      skip,
      take,
      select: ROLE_SELECT,
    }),
    prisma.role.count(),
  ]);

  return jsonOk({
    roles: roles.map((r) => toRoleDto(r as FullRoleRow)),
    pagination: buildMeta(total, page, pageSize),
  });
}

export async function POST(req: Request) {
  const auth = await requireApiUser(req);
  if (auth.response) return auth.response;
  return jsonError(403, SYSTEM_MANAGED_MESSAGE, { code: "SYSTEM_MANAGED" });
}
