// Contract — GET/PATCH/DELETE /api/v1/employees/[id] (P6-B2)
//
// GET    permission: employees.view.  200: { employee: EmployeeDto }.
//        404 { error, code: "NOT_FOUND" } if missing/cross-tenant.
// PATCH  permission: employees.edit; requires an active subscription.
//        Whole-record replace, matching `PATCH /api/v1/services/[id]`'s
//        convention — the body carries every editable field (role, main
//        branch and its own admin flag are NOT accepted here: `roleId`
//        cannot move an owner, `updateEmployee` in `lib/employees/core.ts`
//        returns OWNER_ROLE_LOCKED for that target regardless).
//        Body: same shape as POST /employees minus `isOwner`.
//        200: { employee: EmployeeDto }.
// DELETE permission: employees.delete; requires an active subscription.
//        200: { employee: { id: string } }.
//
// Errors (every branch): 401, 403 (permission / SUBSCRIPTION_EXPIRED),
// 404 (NOT_FOUND), 409 (OWNER_ROLE_LOCKED / LAST_OWNER / SELF_ACTION /
// OPEN_ORDERS), 422 (VALIDATION / DUPLICATE fieldErrors) — always
// `{error, code, fieldErrors?}`.

import type { Prisma } from "@/app/generated/prisma/client";
import { jsonError, jsonOk, requireApiUser, requirePermission } from "@/lib/api";
import { logAudit } from "@/lib/audit";
import { deleteEmployee, updateEmployee } from "@/lib/employees/core";
import { toEmployeeDto, type FullEmployeeRow } from "@/lib/employees/dto";
import type { EmployeeActor, EmployeeErrorCode } from "@/lib/employees/types";
import { requireActiveSubscriptionApi } from "@/lib/subscription-server";
import { purgeStaffAccess } from "@/lib/account-closure/staff";
import { prisma } from "@/lib/prisma";
import { employeeBodyToFormData, type EmployeeJsonBody } from "../_form-data";

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

/** Guard/business-rule error codes -> HTTP status, shared by PATCH/DELETE. */
const ERROR_STATUS: Record<EmployeeErrorCode, number> = {
  VALIDATION: 422,
  DUPLICATE: 422,
  NOT_FOUND: 404,
  OWNER_ROLE_LOCKED: 409,
  OWNER_ONLY: 403,
  SELF_DEACTIVATE: 409,
  SELF_ACTION: 409,
  LAST_OWNER: 409,
  FK_CONFLICT: 409,
  OPEN_ORDERS: 409,
  PLAN_LIMIT_REACHED: 403,
  UNKNOWN: 500,
};

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireApiUser(req);
  if (auth.response) return auth.response;
  const denied = requirePermission(auth.user, "employees.view");
  if (denied) return denied;
  const { id } = await ctx.params;

  const employee = await prisma.user.findFirst({
    where: { id, tenantId: auth.user.tenantId, deletedAt: null },
    select: EMPLOYEE_SELECT,
  });
  if (!employee) return jsonError(404, "Ажилтан олдсонгүй.", { code: "NOT_FOUND" });

  return jsonOk({ employee: toEmployeeDto(employee as FullEmployeeRow) });
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireApiUser(req);
  if (auth.response) return auth.response;
  const denied = requirePermission(auth.user, "employees.edit");
  if (denied) return denied;
  const locked = await requireActiveSubscriptionApi(auth.user);
  if (locked) return locked;

  const { id } = await ctx.params;

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

  const result = await updateEmployee(prisma, actor, id, formData);
  if (!result.ok) {
    return jsonError(ERROR_STATUS[result.code], result.error, {
      code: result.code,
      ...(result.fieldErrors ? { fieldErrors: result.fieldErrors } : {}),
    });
  }

  await logAudit({
    tenantId: actor.tenantId,
    userId: actor.id,
    entity: "User",
    entityId: id,
    action: "UPDATE",
    summary: result.summary,
    before: result.before as Prisma.InputJsonValue,
    after: result.after as Prisma.InputJsonValue,
  });

  const updated = await prisma.user.findFirst({
    where: { id, tenantId: actor.tenantId },
    select: EMPLOYEE_SELECT,
  });
  if (!updated) return jsonError(404, "Ажилтан олдсонгүй.", { code: "NOT_FOUND" });

  return jsonOk({ employee: toEmployeeDto(updated as FullEmployeeRow) });
}

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireApiUser(req);
  if (auth.response) return auth.response;
  const denied = requirePermission(auth.user, "employees.delete");
  if (denied) return denied;
  const locked = await requireActiveSubscriptionApi(auth.user);
  if (locked) return locked;

  const { id } = await ctx.params;
  const actor: EmployeeActor = auth.user;

  const result = await deleteEmployee(prisma, actor, idFormData(id));
  if ("noop" in result) return jsonError(404, "Ажилтан олдсонгүй.", { code: "NOT_FOUND" });
  if (!result.ok) {
    return jsonError(ERROR_STATUS[result.code], result.error, { code: result.code });
  }

  await purgeStaffAccess(result.id);

  await logAudit({
    tenantId: actor.tenantId,
    userId: actor.id,
    entity: "User",
    entityId: result.id,
    action: "DELETE",
    summary: result.summary,
  });

  return jsonOk({ employee: { id: result.id } });
}

/** `deleteEmployee` reads the target id from `FormData.get("id")` (moved
 * verbatim from the web action's hidden `<input name="id">`) — this route
 * has no form body, so it builds a one-field FormData from the path
 * param instead of changing the core's signature. */
function idFormData(id: string): FormData {
  const fd = new FormData();
  fd.set("id", id);
  return fd;
}
