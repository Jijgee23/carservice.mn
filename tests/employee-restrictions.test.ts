import assert from "node:assert/strict";
import { before, test } from "node:test";

process.env.DATABASE_URL ??= "postgresql://unused/unused";
process.env.SESSION_SECRET ??= "unit-test-placeholder-secret-value-not-real-00";

let svc: typeof import("../lib/employees/restrictions");

before(async () => {
  svc = await import("../lib/employees/restrictions");
});

type Row = {
  id: string;
  tenantId: string;
  isOwner: boolean;
  deletedAt: Date | null;
  deniedPermissions: string[];
  role: { id: string; name: string; permissions: string[]; isActive: boolean; tenantEditablePermissions: string[] } | null;
};
type Override = { tenantId: string; roleId: string; addPermissions: string[]; removePermissions: string[] };

const MECH_PERMS = ["orders.viewOwn", "orders.editOwn", "orders.itemStatus", "customers.view", "orders.itemPrice"];
const mech = (over: Partial<Row> = {}): Row => ({
  id: "emp1",
  tenantId: "t1",
  isOwner: false,
  deletedAt: null,
  deniedPermissions: [],
  role: { id: "r1", name: "Засварчин", permissions: MECH_PERMS, isActive: true, tenantEditablePermissions: [] },
  ...over,
});

function makeDb(rows: Row[], overrides: Override[] = []) {
  const writes: Array<{ where: unknown; data: unknown }> = [];
  const db = {
    user: {
      async findFirst({ where }: { where: { id: string; tenantId: string } }) {
        return rows.find((r) => r.id === where.id && r.tenantId === where.tenantId) ?? null;
      },
      async updateMany({ where, data }: { where: { id: string; tenantId: string }; data: { deniedPermissions: string[] } }) {
        writes.push({ where, data });
        const r = rows.find((x) => x.id === where.id && x.tenantId === where.tenantId);
        if (r) r.deniedPermissions = data.deniedPermissions;
        return { count: r ? 1 : 0 };
      },
    },
    tenantRoleOverride: {
      async findUnique({ where }: { where: { tenantId_roleId: { tenantId: string; roleId: string } } }) {
        const k = where.tenantId_roleId;
        return overrides.find((o) => o.tenantId === k.tenantId && o.roleId === k.roleId) ?? null;
      },
    },
  };
  return { db: db as never, rows, writes };
}

const owner = { id: "own1", tenantId: "t1", isOwner: true, role: null };
const manager = { id: "mgr1", tenantId: "t1", isOwner: false, role: { permissions: [...MECH_PERMS, "employees.edit", "payments.view"] } };
const weakManager = { id: "mgr2", tenantId: "t1", isOwner: false, role: { permissions: ["employees.edit", "customers.view"] } };

test("owner restricts an employee: denied stored, effective loses the code, audit before/after returned", async () => {
  const { db, rows, writes } = makeDb([mech()]);
  const r = await svc.saveEmployeeRestrictions(db, owner, "emp1", ["orders.itemPrice", "customers.view"]);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.deepEqual(rows[0].deniedPermissions, ["orders.itemPrice", "customers.view"]);
  assert.deepEqual(writes[0].where, { id: "emp1", tenantId: "t1" });
  assert.ok(!r.view.effectivePermissions.includes("orders.itemPrice"));
  assert.ok(r.view.effectivePermissions.includes("orders.viewOwn"));
  assert.deepEqual(r.view.grantedPermissions, MECH_PERMS);
  assert.deepEqual(r.before, { denied: [] });
  assert.deepEqual(r.after, { denied: ["orders.itemPrice", "customers.view"] });
});

test("empty list clears all restrictions", async () => {
  const { db, rows } = makeDb([mech({ deniedPermissions: ["orders.itemPrice"] })]);
  const r = await svc.saveEmployeeRestrictions(db, owner, "emp1", []);
  assert.equal(r.ok, true);
  assert.deepEqual(rows[0].deniedPermissions, []);
  if (r.ok) assert.deepEqual(r.before, { denied: ["orders.itemPrice"] });
});

test("cannot grant: codes the employee does not have are dropped silently (never added)", async () => {
  const { db, rows } = makeDb([mech()]);
  const r = await svc.saveEmployeeRestrictions(db, owner, "emp1", ["payments.view", "orders.itemPrice"]);
  assert.equal(r.ok, true);
  assert.deepEqual(rows[0].deniedPermissions, ["orders.itemPrice"]);
});

test("unknown code / bad shape → VALIDATION, nothing written", async () => {
  const { db, writes } = makeDb([mech()]);
  const bad = await svc.saveEmployeeRestrictions(db, owner, "emp1", ["nope.nope"]);
  assert.equal(bad.ok === false && bad.code, "VALIDATION");
  const shape = await svc.saveEmployeeRestrictions(db, owner, "emp1", "orders.itemPrice");
  assert.equal(shape.ok === false && shape.code, "VALIDATION");
  assert.equal(writes.length, 0);
});

test("owner target and self are refused", async () => {
  const { db, writes } = makeDb([mech({ id: "own1", isOwner: true, role: null }), mech({ id: "mgr1" })]);
  const o = await svc.saveEmployeeRestrictions(db, manager, "own1", ["orders.itemPrice"]);
  assert.equal(o.ok === false && o.code, "OWNER_TARGET");
  const self = await svc.saveEmployeeRestrictions(db, manager, "mgr1", ["orders.itemPrice"]);
  assert.equal(self.ok === false && self.code, "SELF");
  assert.equal(writes.length, 0);
});

test("non-owner cannot restrict someone with more permissions than themselves", async () => {
  const { db, writes } = makeDb([mech()]);
  const r = await svc.saveEmployeeRestrictions(db, weakManager, "emp1", ["orders.itemPrice"]);
  assert.equal(r.ok === false && r.code, "SUPERIOR_TARGET");
  assert.equal(writes.length, 0);
  // a manager whose permissions cover the employee's can
  const ok = await svc.saveEmployeeRestrictions(db, manager, "emp1", ["orders.itemPrice"]);
  assert.equal(ok.ok, true);
});

test("another tenant's employee is not found (tenant scope)", async () => {
  const { db, writes } = makeDb([mech({ tenantId: "t2" })]);
  const r = await svc.saveEmployeeRestrictions(db, owner, "emp1", []);
  assert.equal(r.ok === false && r.code, "NOT_FOUND");
  assert.equal(writes.length, 0);
});

test("deleted employee is not found", async () => {
  const { db } = makeDb([mech({ deletedAt: new Date() })]);
  const r = await svc.saveEmployeeRestrictions(db, owner, "emp1", []);
  assert.equal(r.ok === false && r.code, "NOT_FOUND");
});

test("tenant override is part of 'granted': an editable add can be restricted per employee", async () => {
  const row = mech({
    role: { id: "r1", name: "Засварчин", permissions: ["orders.viewOwn"], isActive: true, tenantEditablePermissions: ["customers.view"] },
  });
  const { db } = makeDb([row], [{ tenantId: "t1", roleId: "r1", addPermissions: ["customers.view"], removePermissions: [] }]);
  const r = await svc.saveEmployeeRestrictions(db, owner, "emp1", ["customers.view"]);
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.deepEqual(r.view.grantedPermissions.sort(), ["customers.view", "orders.viewOwn"]);
    assert.deepEqual(r.view.effectivePermissions, ["orders.viewOwn"]);
  }
});

test("getEmployeeRestrictions: view reflects stored denials; stale denials (no longer granted) are hidden", async () => {
  const { db } = makeDb([mech({ deniedPermissions: ["orders.itemPrice", "payments.view"] })]);
  const v = await svc.getEmployeeRestrictions({ tenantId: "t1" }, "emp1", db);
  assert.deepEqual(v?.denied, ["orders.itemPrice"]);
  assert.ok(!v?.effectivePermissions.includes("orders.itemPrice"));
  assert.equal(await svc.getEmployeeRestrictions({ tenantId: "t2" }, "emp1", db), null);
});
