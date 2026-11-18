import assert from "node:assert/strict";
import { before, test } from "node:test";

process.env.DATABASE_URL ??= "postgresql://unused/unused";
process.env.SESSION_SECRET ??= "unit-test-placeholder-secret-value-not-real-00";

let guards: typeof import("../lib/employees/guards");

before(async () => {
  guards = await import("../lib/employees/guards");
});

const ROLE = {
  id: "r1",
  name: "Засварчин",
  isActive: true,
  permissions: ["orders.viewOwn", "orders.editOwn"],
  tenantEditablePermissions: ["payments.view"],
};

function db(override: { addPermissions: string[]; removePermissions: string[] } | null, withOverrideTable = true) {
  const base = { role: { findFirst: async () => ROLE } };
  return (withOverrideTable
    ? { ...base, tenantRoleOverride: { findUnique: async () => override } }
    : base) as never;
}

test("ensureRoleAssignable without tenantId returns raw role permissions (unchanged contract)", async () => {
  const r = await guards.ensureRoleAssignable(db({ addPermissions: ["payments.view"], removePermissions: [] }), "r1");
  assert.equal(r.ok, true);
  assert.deepEqual(r.permissions, ROLE.permissions);
});

test("ensureRoleAssignable with tenantId includes the tenant's added permission (escalation guard sees it)", async () => {
  const r = await guards.ensureRoleAssignable(db({ addPermissions: ["payments.view"], removePermissions: [] }), "r1", "t1");
  assert.deepEqual(r.permissions?.sort(), ["orders.editOwn", "orders.viewOwn", "payments.view"]);
  // a manager lacking payments.view can therefore NOT hand this role out
  const weak = { id: "m", tenantId: "t1", isOwner: false, role: { permissions: ["orders.viewOwn", "orders.editOwn"] } };
  assert.equal(guards.roleWithinActorPermissions(weak, r.permissions), false);
});

test("ensureRoleAssignable with tenantId but no override row keeps the raw permissions", async () => {
  const r = await guards.ensureRoleAssignable(db(null), "r1", "t1");
  assert.deepEqual(r.permissions, ROLE.permissions);
});

test("ensureRoleAssignable tolerates clients without the override table (fakes/legacy)", async () => {
  const r = await guards.ensureRoleAssignable(db(null, false), "r1", "t1");
  assert.deepEqual(r.permissions, ROLE.permissions);
});

test("targetEffectivePermissions: override add + per-user denial are both applied", async () => {
  const eff = await guards.targetEffectivePermissions(
    db({ addPermissions: ["payments.view"], removePermissions: [] }),
    "t1",
    { isOwner: false, deniedPermissions: ["orders.editOwn"], role: ROLE },
  );
  assert.deepEqual(eff.sort(), ["orders.viewOwn", "payments.view"]);
});

test("targetEffectivePermissions: role-less or fake role (no isActive) behaves like before", async () => {
  assert.deepEqual(await guards.targetEffectivePermissions(db(null), "t1", { role: null }), []);
  const eff = await guards.targetEffectivePermissions(db(null, false), "t1", {
    role: { permissions: ["orders.view"] },
  });
  assert.deepEqual(eff, ["orders.view"]);
});

test("targetEffectivePermissions: inactive role has no permissions", async () => {
  const eff = await guards.targetEffectivePermissions(db(null), "t1", {
    role: { ...ROLE, isActive: false },
  });
  assert.deepEqual(eff, []);
});
