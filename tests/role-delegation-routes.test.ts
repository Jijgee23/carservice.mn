import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

// Route/action тохиргооны source-pattern шалгалт (route нь requireApiUser/requireUser-ээр
// tenant context тавьдаг тул DB-гүй unit-д бүтнээр нь ажиллуулахгүй) — зөв хаалт, зөв
// delegate хийгдсэнийг баталгаажуулна. Логикийн тест: tests/tenant-role-overrides.test.ts.

function src(rel: string): string {
  return readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), rel), "utf8");
}

test("PUT /roles/[id]/override is owner-only and delegates to the shared service", () => {
  const s = src("../app/api/v1/roles/[id]/override/route.ts");
  const put = s.slice(s.indexOf("export async function PUT"));
  assert.match(put, /requireApiUser/);
  assert.match(put, /if \(!u\.isOwner\) return jsonForbidden/);
  // owner check must come before the body is parsed or anything is written
  assert.ok(put.indexOf("isOwner") < put.indexOf("req.json()"));
  assert.match(put, /saveTenantRoleOverride\(\{ tenantId: u\.tenantId, userId: u\.id \}/);
  assert.match(put, /code: "LOCKED"/);
  assert.match(put, /code: "VALIDATION"/);
});

test("GET override routes require employees.view|create|edit and scope by the caller's tenant", () => {
  for (const rel of ["../app/api/v1/roles/[id]/override/route.ts", "../app/api/v1/roles/overrides/route.ts"]) {
    const s = src(rel);
    assert.match(s, /hasPermission\(u, "employees\.view"\)/);
    assert.match(s, /hasPermission\(u, "employees\.create"\)/);
    assert.match(s, /hasPermission\(u, "employees\.edit"\)/);
    assert.match(s, /u\.tenantId/);
  }
});

test("tenant switch action is owner-gated, revalidates the dashboard layout, and uses the shared service", () => {
  const s = src("../app/_actions/tenant-role-overrides.ts");
  assert.match(s, /"use server"/);
  assert.match(s, /if \(!user\.isOwner\) return/);
  assert.match(s, /toggleTenantRolePermission\(/);
  assert.match(s, /revalidatePath\("\/dashboard", "layout"\)/);
  assert.ok(!s.includes("saveTenantRoleOverrideAction"), "batch save action removed");
});

test("settings page lives under the owner-only settings layout", () => {
  assert.match(src("../app/dashboard/settings/layout.tsx"), /if \(!user\.isOwner\)/);
  assert.match(src("../app/dashboard/settings/roles/page.tsx"), /listTenantRoleOverrides\(user\.tenantId\)/);
  // one page per role with a switch per permission; the list page has no switches
  const detail = src("../app/dashboard/settings/roles/[id]/page.tsx");
  assert.match(detail, /PermissionSwitchList/);
  assert.match(detail, /toggleTenantRolePermissionAction\.bind\(null, id\)/);
  assert.match(detail, /getTenantRoleOverrideView\(user\.tenantId, id\)/);
  assert.ok(!src("../app/dashboard/settings/roles/page.tsx").includes("PermissionSwitchList"));
});

test("override service never trusts client codes: always sanitized against the role's editable set", () => {
  const s = src("../lib/roles/tenant-overrides.ts");
  assert.match(s, /sanitizeOverride\(\{ rolePerms: role\.permissions, editable: role\.tenantEditablePermissions \}/);
  // reset goes through delete (row absent = default), writes always carry tenantId
  assert.match(s, /deleteMany\(\{ where: \{ tenantId: ctx\.tenantId, roleId \} \}\)/);
});

test("PUT /employees/[id]/restrictions needs employees.edit + active subscription and audits via the shared service", () => {
  const s = src("../app/api/v1/employees/[id]/restrictions/route.ts");
  const put = s.slice(s.indexOf("export async function PUT"));
  assert.match(put, /requirePermission\(auth\.user, "employees\.edit"\)/);
  assert.match(put, /requireActiveSubscriptionApi\(auth\.user\)/);
  assert.match(put, /saveEmployeeRestrictions\(prisma, auth\.user, id,/);
  assert.match(put, /entity: "User"/);
  // permission and subscription are checked before the body is read
  assert.ok(put.indexOf("employees.edit") < put.indexOf("req.json()"));
  assert.ok(put.indexOf("requireActiveSubscriptionApi") < put.indexOf("req.json()"));
  const get = s.slice(s.indexOf("export async function GET"), s.indexOf("export async function PUT"));
  assert.match(get, /requirePermission\(auth\.user, "employees\.edit"\)/);
});

test("employee restriction switch action: canEdit(employees) + subscription + audit + revalidate", () => {
  const s = src("../app/_actions/employee-restrictions.ts");
  assert.match(s, /"use server"/);
  assert.match(s, /canEdit\(me, "employees"\)/);
  assert.match(s, /assertActiveSubscription\(me\.tenantId\)/);
  assert.match(s, /toggleEmployeeRestriction\(prisma, me, employeeId, code, allowed\)/);
  assert.match(s, /logAudit\(/);
  assert.match(s, /revalidatePath\(`\/dashboard\/employees\/\$\{employeeId\}`\)/);
  assert.match(src("../app/dashboard/employees/[id]/employee-restrictions.tsx"), /toggleEmployeeRestrictionAction\(employeeId, code, on\)/);
});

test("employee page hides the restrictions card for owners and for yourself", () => {
  const s = src("../app/dashboard/employees/[id]/page.tsx");
  assert.match(s, /employee\.isOwner \|\| employee\.id === me\.id \|\| !employee\.role/);
});

test("restrictions service enforces every guard before writing", () => {
  const s = src("../lib/employees/restrictions.ts");
  const save = s.slice(s.indexOf("export async function saveEmployeeRestrictions"));
  const write = save.indexOf("updateMany");
  for (const guard of ["NOT_FOUND", "OWNER_TARGET", "SELF", "roleWithinActorPermissions", "sanitizeUserDenials"]) {
    assert.ok(save.indexOf(guard) !== -1 && save.indexOf(guard) < write, `${guard} must precede the write`);
  }
  assert.match(save, /tenantId: actor\.tenantId/);
});
