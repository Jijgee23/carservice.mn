// Contract — GET/POST /api/v1/employees (P6-B2)
//
// GET /api/v1/employees
//   Permission: employees.view
//   Query: q?, branchId?, roleId?, active? ("yes"|"no"), page?, pageSize?/limit?
//     (standard `parsePagination`; unknown query params are rejected with
//     422 `{error, code: "VALIDATION", fieldErrors: {<param>: "..."}}`).
//   200: {
//     employees: EmployeeDto[],
//     pagination: PaginationMeta,
//     meta: {
//       branches: { id: string; name: string; count: number }[], // tenant's
//         active branches with the employee count for EACH (unfiltered by
//         q/roleId/active — a stable chip count, matching how a filter UI's
//         chips show totals independent of the current filter selection),
//         plus one synthetic { id: "", name: "Хуваарилагдаагүй", count }
//         entry for employees with branchId = null when that count > 0.
//       roles: { id: string; name: string }[], // tenant's active roles,
//         for building the role-label filter/picker.
//     }
//   }
//
// POST /api/v1/employees
//   Permission: employees.create; requires an active subscription;
//   `isOwner: true` in the body is honoured only when the caller
//   (`auth.user.isOwner`) is itself an owner (enforced by
//   `lib/employees/core.ts`'s `prepareCreateEmployee`, not this route).
//   Enforces the `MAX_USERS` plan limit before creating.
//   Body: { firstName, lastName, email, phone, roleId?, branchId?,
//     assignableBranchIds?: string[], isActive?: boolean, activeUntil?:
//     string (ISO), isOwner?: boolean }
//   201: { employee: EmployeeDto }
//   Errors: 400 (bad JSON), 401, 403 (permission / SUBSCRIPTION_EXPIRED),
//     422 (VALIDATION / DUPLICATE fieldErrors) — every
//     branch includes `code`.

import { jsonError, jsonOk, requireApiUser, requirePermission } from "@/lib/api";
import { logAudit } from "@/lib/audit";
import { toEmployeeDto, type FullEmployeeRow } from "@/lib/employees/dto";
import { createEmployee, prepareCreateEmployee } from "@/lib/employees/core";
import type { EmployeeActor } from "@/lib/employees/types";
import { optionalText, parseYesNo, parsePagination, rejectUnknownParams } from "@/lib/list-query-params";
import { buildMeta } from "@/lib/pagination";
import { requireActiveSubscriptionApi } from "@/lib/subscription-server";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/app/generated/prisma/client";
import { employeeBodyToFormData, type EmployeeJsonBody } from "./_form-data";

const ALLOWED_PARAMS = ["q", "branchId", "roleId", "active", "page", "pageSize", "limit"] as const;

const EMPLOYEE_SELECT = {
  id: true,
  firstName: true,
  lastName: true,
  email: true,
  phone: true,
  isOwner: true,
  roleId: true,
  isActive: true,
  activeUntil: true,
  deactivatedAt: true,
  tenantId: true,
  branchId: true,
  assignableBranchIds: true,
  verified: true,
  role: { select: { name: true } },
} satisfies Prisma.UserSelect;

export async function GET(req: Request) {
  const auth = await requireApiUser(req);
  if (auth.response) return auth.response;
  const denied = requirePermission(auth.user, "employees.view");
  if (denied) return denied;

  const url = new URL(req.url);
  const { searchParams } = url;

  const unknown = rejectUnknownParams(searchParams, ALLOWED_PARAMS);
  if (unknown) {
    return jsonError(422, unknown.message, {
      code: "VALIDATION",
      fieldErrors: { [unknown.field]: unknown.message },
    });
  }

  const q = optionalText(searchParams, "q");
  const branchId = optionalText(searchParams, "branchId");
  const roleId = optionalText(searchParams, "roleId");
  const active = parseYesNo(searchParams, "active");
  if (typeof active === "object" && active !== null) {
    return jsonError(422, active.message, { code: "VALIDATION", fieldErrors: { [active.field]: active.message } });
  }
  const paged = parsePagination(searchParams);
  if (typeof paged !== "object" || !("page" in paged)) {
    const err = paged as { field: string; message: string };
    return jsonError(422, err.message, { code: "VALIDATION", fieldErrors: { [err.field]: err.message } });
  }
  const { page, pageSize, skip, take } = paged;

  const where: Prisma.UserWhereInput = {
    tenantId: auth.user.tenantId,
    deletedAt: null,
    ...(branchId && { branchId }),
    ...(roleId && { roleId }),
    ...(active === "yes" && { isActive: true }),
    ...(active === "no" && { isActive: false }),
    ...(q && {
      OR: [
        { firstName: { contains: q, mode: "insensitive" } },
        { lastName: { contains: q, mode: "insensitive" } },
        { email: { contains: q, mode: "insensitive" } },
        { phone: { contains: q } },
      ],
    }),
  };

  const [employees, total, branches, roles, branchCounts, unassignedCount] = await Promise.all([
    prisma.user.findMany({
      where,
      orderBy: [{ isOwner: "desc" }, { createdAt: "asc" }],
      skip,
      take,
      select: EMPLOYEE_SELECT,
    }),
    prisma.user.count({ where }),
    prisma.branch.findMany({
      where: { tenantId: auth.user.tenantId, isActive: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    prisma.role.findMany({
      where: { tenantId: auth.user.tenantId, isActive: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    prisma.user.groupBy({
      by: ["branchId"],
      where: { tenantId: auth.user.tenantId, deletedAt: null, branchId: { not: null } },
      _count: { _all: true },
    }),
    prisma.user.count({ where: { tenantId: auth.user.tenantId, deletedAt: null, branchId: null } }),
  ]);

  const countByBranch = new Map(branchCounts.map((b) => [b.branchId, b._count._all]));
  const branchChips = branches.map((b) => ({ id: b.id, name: b.name, count: countByBranch.get(b.id) ?? 0 }));
  if (unassignedCount > 0) {
    branchChips.push({ id: "", name: "Хуваарилагдаагүй", count: unassignedCount });
  }

  return jsonOk({
    employees: employees.map((e) => toEmployeeDto(e as FullEmployeeRow)),
    pagination: buildMeta(total, page, pageSize),
    meta: { branches: branchChips, roles },
  });
}

export async function POST(req: Request) {
  const auth = await requireApiUser(req);
  if (auth.response) return auth.response;
  const denied = requirePermission(auth.user, "employees.create");
  if (denied) return denied;
  const locked = await requireActiveSubscriptionApi(auth.user);
  if (locked) return locked;

  let body: EmployeeJsonBody;
  try {
    body = (await req.json()) as EmployeeJsonBody;
  } catch {
    return jsonError(400, "JSON body шаардлагатай.", { code: "VALIDATION" });
  }
  if (!body || typeof body !== "object") {
    return jsonError(400, "Body буруу.", { code: "VALIDATION" });
  }

  const actor: EmployeeActor = auth.user;
  const formData = employeeBodyToFormData(body);

  const prep = await prepareCreateEmployee(prisma, actor, formData);
  if (!prep.ok) {
    return jsonError(prep.code === "ROLE_EXCEEDS_ACTOR" ? 403 : 422, prep.error, {
      code: prep.code,
      fieldErrors: prep.fieldErrors,
    });
  }

  const result = await createEmployee(prisma, actor, prep.data, prep.wantsOwner);
  if (!result.ok) {
    return jsonError(422, result.error, {
      code: result.code,
      ...(result.fieldErrors ? { fieldErrors: result.fieldErrors } : {}),
    });
  }

  await logAudit({
    tenantId: actor.tenantId,
    userId: actor.id,
    entity: "User",
    entityId: result.id,
    action: "CREATE",
    summary: result.summary,
    after: result.after as Prisma.InputJsonValue,
  });

  const created = await prisma.user.findFirst({
    where: { id: result.id, tenantId: actor.tenantId },
    select: EMPLOYEE_SELECT,
  });
  if (!created) return jsonError(404, "Ажилтан олдсонгүй.", { code: "NOT_FOUND" });

  return jsonOk({ employee: toEmployeeDto(created as FullEmployeeRow) }, { status: 201 });
}
