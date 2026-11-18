import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { before, test } from "node:test";

process.env.DATABASE_URL ??= "postgresql://unused/unused";
process.env.SESSION_SECRET ??= "unit-test-placeholder-secret-value-not-real-00";

let defaults: typeof import("../lib/roles/tenant-editable-defaults");
let perms: typeof import("../lib/auth/permissions");
let sys: typeof import("../lib/roles/system-roles");
let eff: typeof import("../lib/auth/effective-permissions");

before(async () => {
  [defaults, perms, sys, eff] = await Promise.all([
    import("../lib/roles/tenant-editable-defaults"),
    import("../lib/auth/permissions"),
    import("../lib/roles/system-roles"),
    import("../lib/auth/effective-permissions"),
  ]);
});

function src(rel: string): string {
  return readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), rel), "utf8");
}

test("defaults are open: item price (and other operational permissions) can be changed by tenants", () => {
  const d = defaults.DEFAULT_TENANT_EDITABLE_PERMISSIONS;
  for (const code of ["orders.itemPrice", "orders.itemStatus", "orders.assignable", "orders.create", "customers.edit"]) {
    assert.ok(d.includes(code), `${code} should be open by default`);
  }
  assert.ok(d.length > 30);
});

test("sensitive permissions are locked by default; every code is valid and unique", () => {
  const d = defaults.DEFAULT_TENANT_EDITABLE_PERMISSIONS;
  for (const code of defaults.SENSITIVE_PERMISSION_CODES) {
    assert.ok(perms.isValidPermissionCode(code), `sensitive code ${code} must exist in the catalog`);
    assert.ok(!d.includes(code), `${code} must be locked by default`);
  }
  for (const code of d) assert.ok(perms.isValidPermissionCode(code), code);
  assert.equal(new Set(d).size, d.length);
  assert.equal(d.length + defaults.SENSITIVE_PERMISSION_CODES.length, perms.PERMISSIONS.length);
});

test("every built-in system role ships with the open default set", () => {
  for (const r of sys.SYSTEM_ROLE_DEFAULTS) {
    assert.deepEqual(r.tenantEditablePermissions, [...defaults.DEFAULT_TENANT_EDITABLE_PERMISSIONS], r.key);
  }
});

test("migration SQL stays in sync with the TS defaults and only touches roles with nothing open", () => {
  const sql = src("../prisma/migrations/20261118120000_tenant_editable_defaults/migration.sql");
  const arr = `ARRAY[${defaults.DEFAULT_TENANT_EDITABLE_PERMISSIONS.map((c) => `'${c}'`).join(",")}]::TEXT[]`;
  assert.ok(sql.includes(arr), "migration permission list must equal DEFAULT_TENANT_EDITABLE_PERMISSIONS");
  assert.match(sql, /WHERE cardinality\("tenantEditablePermissions"\) = 0;/);
});

test("end to end: with defaults a tenant can give a mechanic item-price editing, but not a locked permission", () => {
  const mech = sys.SYSTEM_ROLE_DEFAULTS.find((r) => r.key === "MECHANIC")!;
  const editable = mech.tenantEditablePermissions;
  assert.ok(!mech.permissions.includes("orders.itemPrice"));
  const ok = eff.sanitizeOverride({ rolePerms: mech.permissions, editable }, { add: ["orders.itemPrice"] });
  assert.deepEqual(ok, { ok: true, add: ["orders.itemPrice"], remove: [] });
  const effective = eff.computeEffectivePermissions({
    rolePerms: mech.permissions,
    editable,
    add: ["orders.itemPrice"],
  });
  assert.ok(effective.includes("orders.itemPrice"));
  const locked = eff.sanitizeOverride({ rolePerms: mech.permissions, editable }, { add: ["employees.edit"] });
  assert.equal(locked.ok, false);
});

test("form pre-checks defaults for a new role and exposes quick actions", () => {
  const form = src("../app/system/(authed)/roles/role-form.tsx");
  assert.match(form, /initial \? \(initial\.tenantEditablePermissions \?\? \[\]\) : defaultTenantEditable/);
  for (const label of ["Анхдагч", "Бүгдийг нээх", "Бүгдийг түгжих"]) assert.ok(form.includes(label), label);
  assert.match(src("../app/system/(authed)/roles/new/page.tsx"), /defaultTenantEditable=\{\[\.\.\.DEFAULT_TENANT_EDITABLE_PERMISSIONS\]\}/);
});
