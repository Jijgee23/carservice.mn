import assert from "node:assert/strict";
import { before, test } from "node:test";

process.env.DATABASE_URL ??= "postgresql://unused/unused";
process.env.SESSION_SECRET ??= "unit-test-placeholder-secret-value-not-real-00";

let svc: typeof import("../lib/roles/tenant-overrides");

before(async () => {
  svc = await import("../lib/roles/tenant-overrides");
});

type RoleRow = {
  id: string;
  name: string;
  description: string | null;
  permissions: string[];
  tenantEditablePermissions: string[];
  isActive: boolean;
  sortOrder?: number;
};
type OverrideRow = { tenantId: string; roleId: string; addPermissions: string[]; removePermissions: string[]; updatedById?: string | null };

function makeDb(seed: { roles: RoleRow[]; overrides?: OverrideRow[] }) {
  const roles = seed.roles;
  const overrides = seed.overrides ?? [];
  const log: string[] = [];
  const db = {
    role: {
      async findMany({ where }: { where: { isActive: boolean } }) {
        log.push("role.findMany");
        return roles.filter((r) => r.isActive === where.isActive && r.tenantEditablePermissions.length > 0);
      },
      async findUnique({ where }: { where: { id: string } }) {
        return roles.find((r) => r.id === where.id) ?? null;
      },
    },
    tenantRoleOverride: {
      async findMany({ where }: { where: { tenantId: string; roleId: { in: string[] } } }) {
        log.push(`override.findMany:${where.tenantId}`);
        return overrides.filter((o) => o.tenantId === where.tenantId && where.roleId.in.includes(o.roleId));
      },
      async findUnique({ where }: { where: { tenantId_roleId: { tenantId: string; roleId: string } } }) {
        const k = where.tenantId_roleId;
        return overrides.find((o) => o.tenantId === k.tenantId && o.roleId === k.roleId) ?? null;
      },
      async deleteMany({ where }: { where: { tenantId: string; roleId: string } }) {
        log.push("override.deleteMany");
        for (let i = overrides.length - 1; i >= 0; i--) {
          if (overrides[i].tenantId === where.tenantId && overrides[i].roleId === where.roleId) overrides.splice(i, 1);
        }
        return { count: 1 };
      },
      async upsert({ where, create, update }: { where: { tenantId_roleId: { tenantId: string; roleId: string } }; create: OverrideRow; update: Partial<OverrideRow> }) {
        log.push("override.upsert");
        const k = where.tenantId_roleId;
        const found = overrides.find((o) => o.tenantId === k.tenantId && o.roleId === k.roleId);
        if (found) Object.assign(found, update);
        else overrides.push({ ...create });
        const row = overrides.find((o) => o.tenantId === k.tenantId && o.roleId === k.roleId)!;
        return { addPermissions: row.addPermissions, removePermissions: row.removePermissions };
      },
    },
  };
  return { db: db as never, overrides, log };
}

const MECH: RoleRow = {
  id: "r_mech",
  name: "Засварчин",
  description: null,
  permissions: ["orders.viewOwn", "orders.editOwn", "orders.itemPrice"],
  tenantEditablePermissions: ["orders.itemPrice", "customers.view"],
  isActive: true,
};
const LOCKED: RoleRow = { ...MECH, id: "r_locked", name: "Түгжигдсэн", tenantEditablePermissions: [] };

function audit() {
  const calls: Array<Record<string, unknown>> = [];
  return { fn: (async (i: Record<string, unknown>) => { calls.push(i); }) as never, calls };
}

test("list: only roles with something editable, scoped to the tenant, with effective view", async () => {
  const { db, log } = makeDb({
    roles: [MECH, LOCKED],
    overrides: [
      { tenantId: "t1", roleId: "r_mech", addPermissions: ["customers.view"], removePermissions: ["orders.itemPrice"] },
      { tenantId: "t2", roleId: "r_mech", addPermissions: [], removePermissions: ["orders.itemPrice"] },
    ],
  });
  const views = await svc.listTenantRoleOverrides("t1", db);
  assert.equal(views.length, 1);
  assert.deepEqual(views[0].add, ["customers.view"]);
  assert.deepEqual(views[0].remove, ["orders.itemPrice"]);
  assert.ok(views[0].effectivePermissions.includes("customers.view"));
  assert.ok(!views[0].effectivePermissions.includes("orders.itemPrice"));
  assert.ok(log.includes("override.findMany:t1"));
});

test("list: stale override rows (code no longer editable) are not shown as active", async () => {
  const stale: RoleRow = { ...MECH, tenantEditablePermissions: ["customers.view"] };
  const { db } = makeDb({
    roles: [stale],
    overrides: [{ tenantId: "t1", roleId: "r_mech", addPermissions: [], removePermissions: ["orders.itemPrice"] }],
  });
  const [v] = await svc.listTenantRoleOverrides("t1", db);
  assert.deepEqual(v.remove, []);
  assert.ok(v.effectivePermissions.includes("orders.itemPrice"));
});

test("list: nothing editable anywhere → empty, no override query", async () => {
  const { db, log } = makeDb({ roles: [LOCKED] });
  assert.deepEqual(await svc.listTenantRoleOverrides("t1", db), []);
  assert.ok(!log.some((l) => l.startsWith("override.")));
});

test("save: persists add/remove, audits before/after with user + tenant", async () => {
  const { db, overrides } = makeDb({ roles: [MECH] });
  const a = audit();
  const r = await svc.saveTenantRoleOverride(
    { tenantId: "t1", userId: "u1" },
    "r_mech",
    { add: ["customers.view"], remove: ["orders.itemPrice"] },
    { db, audit: a.fn },
  );
  assert.equal(r.ok, true);
  assert.deepEqual(overrides[0], {
    tenantId: "t1",
    roleId: "r_mech",
    addPermissions: ["customers.view"],
    removePermissions: ["orders.itemPrice"],
    updatedById: "u1",
  });
  assert.equal(a.calls.length, 1);
  assert.equal(a.calls[0].tenantId, "t1");
  assert.equal(a.calls[0].entity, "Role");
  assert.equal(a.calls[0].userId, "u1");
  assert.deepEqual(a.calls[0].before, { add: [], remove: [] });
  assert.deepEqual(a.calls[0].after, { add: ["customers.view"], remove: ["orders.itemPrice"] });
});

test("save: a locked code is rejected 422-style and nothing is written", async () => {
  const { db, overrides } = makeDb({ roles: [MECH] });
  const a = audit();
  const r = await svc.saveTenantRoleOverride(
    { tenantId: "t1", userId: "u1" },
    "r_mech",
    { remove: ["orders.editOwn"] }, // not editable
    { db, audit: a.fn },
  );
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.equal(r.code, "VALIDATION");
    assert.ok(r.fieldErrors?.remove);
  }
  assert.equal(overrides.length, 0);
  assert.equal(a.calls.length, 0);
});

test("save: role with nothing editable → LOCKED; unknown/inactive role → NOT_FOUND", async () => {
  const { db } = makeDb({ roles: [LOCKED, { ...MECH, id: "r_off", isActive: false }] });
  const a = audit();
  const locked = await svc.saveTenantRoleOverride({ tenantId: "t1", userId: "u1" }, "r_locked", { add: [] }, { db, audit: a.fn });
  assert.equal(locked.ok === false && locked.code, "LOCKED");
  const missing = await svc.saveTenantRoleOverride({ tenantId: "t1", userId: "u1" }, "nope", {}, { db, audit: a.fn });
  assert.equal(missing.ok === false && missing.code, "NOT_FOUND");
  const off = await svc.saveTenantRoleOverride({ tenantId: "t1", userId: "u1" }, "r_off", {}, { db, audit: a.fn });
  assert.equal(off.ok === false && off.code, "NOT_FOUND");
  assert.equal(a.calls.length, 0);
});

test("save: empty add/remove resets to default by deleting the row", async () => {
  const { db, overrides, log } = makeDb({
    roles: [MECH],
    overrides: [{ tenantId: "t1", roleId: "r_mech", addPermissions: [], removePermissions: ["orders.itemPrice"] }],
  });
  const a = audit();
  const r = await svc.saveTenantRoleOverride({ tenantId: "t1", userId: "u1" }, "r_mech", { add: [], remove: [] }, { db, audit: a.fn });
  assert.equal(r.ok, true);
  assert.equal(overrides.length, 0);
  assert.ok(log.includes("override.deleteMany"));
  assert.deepEqual(a.calls[0].before, { add: [], remove: ["orders.itemPrice"] });
  if (r.ok) assert.deepEqual(r.view.effectivePermissions, MECH.permissions);
});

test("save: another tenant's override is untouched", async () => {
  const { db, overrides } = makeDb({
    roles: [MECH],
    overrides: [{ tenantId: "t2", roleId: "r_mech", addPermissions: [], removePermissions: ["orders.itemPrice"] }],
  });
  await svc.saveTenantRoleOverride({ tenantId: "t1", userId: "u1" }, "r_mech", { remove: ["orders.itemPrice"] }, { db, audit: audit().fn });
  assert.equal(overrides.length, 2);
  assert.deepEqual(overrides.find((o) => o.tenantId === "t2")?.removePermissions, ["orders.itemPrice"]);
});
