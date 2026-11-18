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

test("web action is owner-gated, revalidates the dashboard layout, and uses the shared service", () => {
  const s = src("../app/_actions/tenant-role-overrides.ts");
  assert.match(s, /"use server"/);
  assert.match(s, /if \(!user\.isOwner\) return/);
  assert.match(s, /saveTenantRoleOverride\(/);
  assert.match(s, /revalidatePath\("\/dashboard", "layout"\)/);
});

test("settings page lives under the owner-only settings layout", () => {
  assert.match(src("../app/dashboard/settings/layout.tsx"), /if \(!user\.isOwner\)/);
  assert.match(src("../app/dashboard/settings/roles/page.tsx"), /listTenantRoleOverrides\(user\.tenantId\)/);
});

test("override service never trusts client codes: always sanitized against the role's editable set", () => {
  const s = src("../lib/roles/tenant-overrides.ts");
  assert.match(s, /sanitizeOverride\(\{ rolePerms: role\.permissions, editable: role\.tenantEditablePermissions \}/);
  // reset goes through delete (row absent = default), writes always carry tenantId
  assert.match(s, /deleteMany\(\{ where: \{ tenantId: ctx\.tenantId, roleId \} \}\)/);
});
