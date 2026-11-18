import assert from "node:assert/strict";
import { before, test } from "node:test";

process.env.DATABASE_URL ??= "postgresql://unused/unused";
process.env.SESSION_SECRET ??= "unit-test-placeholder-secret-value-not-real-00";

let delegation: typeof import("../lib/roles/delegation");
let tenant: typeof import("../lib/roles/tenant-overrides");
let restr: typeof import("../lib/employees/restrictions");

before(async () => {
  [delegation, tenant, restr] = await Promise.all([
    import("../lib/roles/delegation"),
    import("../lib/roles/tenant-overrides"),
    import("../lib/employees/restrictions"),
  ]);
});

// ---------------------------------------------------------------- system admin: setRoleEditablePermission

function roleDb(editable: string[], exists = true) {
  const row = { id: "r1", name: "Засварчин", isActive: true, permissions: ["orders.viewOwn"], tenantEditablePermissions: [...editable] };
  const writes: string[][] = [];
  const db = {
    role: {
      async findUnique() {
        return exists ? { ...row, tenantEditablePermissions: [...row.tenantEditablePermissions] } : null;
      },
      async update({ data }: { data: { tenantEditablePermissions: string[] } }) {
        writes.push(data.tenantEditablePermissions);
        row.tenantEditablePermissions = data.tenantEditablePermissions;
        return row;
      },
    },
  };
  return { db: db as never, row, writes };
}

test("admin: unlocking one permission appends only that code", async () => {
  const { db, row, writes } = roleDb(["orders.itemPrice"]);
  const r = await delegation.setRoleEditablePermission("r1", "customers.view", true, db);
  assert.equal(r.ok, true);
  assert.deepEqual(row.tenantEditablePermissions, ["orders.itemPrice", "customers.view"]);
  assert.equal(writes.length, 1);
  if (r.ok) assert.deepEqual(r.before, ["orders.itemPrice"]);
});

test("admin: locking one permission removes only that code", async () => {
  const { db, row } = roleDb(["orders.itemPrice", "customers.view"]);
  const r = await delegation.setRoleEditablePermission("r1", "orders.itemPrice", false, db);
  assert.equal(r.ok, true);
  assert.deepEqual(row.tenantEditablePermissions, ["customers.view"]);
});

test("admin: toggling to the state it is already in is a no-op (no write)", async () => {
  const { db, writes } = roleDb(["orders.itemPrice"]);
  const a = await delegation.setRoleEditablePermission("r1", "orders.itemPrice", true, db);
  const b = await delegation.setRoleEditablePermission("r1", "customers.view", false, db);
  assert.equal(a.ok && b.ok, true);
  assert.equal(writes.length, 0);
});

test("admin: unknown code, bad types and unknown role are rejected without writing", async () => {
  const { db, writes } = roleDb([]);
  assert.equal((await delegation.setRoleEditablePermission("r1", "nope.nope", true, db)).ok, false);
  assert.equal((await delegation.setRoleEditablePermission("r1", 5, true, db)).ok, false);
  assert.equal((await delegation.setRoleEditablePermission("r1", "orders.itemPrice", "yes", db)).ok, false);
  const missing = roleDb([], false);
  const r = await delegation.setRoleEditablePermission("nope", "orders.itemPrice", true, missing.db);
  assert.equal(r.ok === false && r.code, "NOT_FOUND");
  assert.equal(writes.length + missing.writes.length, 0);
});

test("admin: getRoleDelegation returns the role's open switches", async () => {
  const { db } = roleDb(["orders.itemPrice"]);
  const v = await delegation.getRoleDelegation("r1", db);
  assert.deepEqual(v?.editablePermissions, ["orders.itemPrice"]);
  assert.equal(await delegation.getRoleDelegation("x", roleDb([], false).db), null);
});

// ---------------------------------------------------------------- tenant: toggleTenantRolePermission

type RoleRow = { id: string; name: string; description: null; permissions: string[]; tenantEditablePermissions: string[]; isActive: boolean };
type OverrideRow = { tenantId: string; roleId: string; addPermissions: string[]; removePermissions: string[] };

function tenantDb(role: RoleRow, overrides: OverrideRow[] = []) {
  const db = {
    role: {
      async findUnique() {
        return role;
      },
    },
    tenantRoleOverride: {
      async findUnique({ where }: { where: { tenantId_roleId: { tenantId: string; roleId: string } } }) {
        const k = where.tenantId_roleId;
        return overrides.find((o) => o.tenantId === k.tenantId && o.roleId === k.roleId) ?? null;
      },
      async deleteMany({ where }: { where: { tenantId: string; roleId: string } }) {
        for (let i = overrides.length - 1; i >= 0; i--) {
          if (overrides[i].tenantId === where.tenantId && overrides[i].roleId === where.roleId) overrides.splice(i, 1);
        }
        return { count: 1 };
      },
      async upsert({ where, create, update }: { where: { tenantId_roleId: { tenantId: string; roleId: string } }; create: OverrideRow; update: Partial<OverrideRow> }) {
        const k = where.tenantId_roleId;
        const f = overrides.find((o) => o.tenantId === k.tenantId && o.roleId === k.roleId);
        if (f) Object.assign(f, update);
        else overrides.push({ ...create });
        const row = overrides.find((o) => o.tenantId === k.tenantId && o.roleId === k.roleId)!;
        return { addPermissions: row.addPermissions, removePermissions: row.removePermissions };
      },
    },
  };
  return { db: db as never, overrides };
}

const ROLE: RoleRow = {
  id: "r1",
  name: "Засварчин",
  description: null,
  permissions: ["orders.viewOwn", "orders.editOwn", "orders.itemPrice"],
  tenantEditablePermissions: ["orders.itemPrice", "customers.view"],
  isActive: true,
};
const CTX = { tenantId: "t1", userId: "u1" };
const noAudit = { audit: (async () => {}) as never };

test("tenant: switching OFF a role permission records a removal; switching it back ON clears the row", async () => {
  const { db, overrides } = tenantDb(ROLE);
  const off = await tenant.toggleTenantRolePermission(CTX, "r1", "orders.itemPrice", false, { db, ...noAudit });
  assert.equal(off.ok, true);
  assert.deepEqual(overrides[0].removePermissions, ["orders.itemPrice"]);
  if (off.ok) assert.ok(!off.view.effectivePermissions.includes("orders.itemPrice"));
  const on = await tenant.toggleTenantRolePermission(CTX, "r1", "orders.itemPrice", true, { db, ...noAudit });
  assert.equal(on.ok, true);
  assert.equal(overrides.length, 0);
});

test("tenant: switching ON a permission the role lacks records an addition; OFF reverts it", async () => {
  const { db, overrides } = tenantDb(ROLE);
  const on = await tenant.toggleTenantRolePermission(CTX, "r1", "customers.view", true, { db, ...noAudit });
  assert.equal(on.ok, true);
  assert.deepEqual(overrides[0].addPermissions, ["customers.view"]);
  const off = await tenant.toggleTenantRolePermission(CTX, "r1", "customers.view", false, { db, ...noAudit });
  assert.equal(off.ok, true);
  assert.equal(overrides.length, 0);
});

test("tenant: a toggle keeps the other switches (only one code changes)", async () => {
  const { db, overrides } = tenantDb(ROLE, [{ tenantId: "t1", roleId: "r1", addPermissions: ["customers.view"], removePermissions: [] }]);
  const r = await tenant.toggleTenantRolePermission(CTX, "r1", "orders.itemPrice", false, { db, ...noAudit });
  assert.equal(r.ok, true);
  assert.deepEqual(overrides[0].addPermissions, ["customers.view"]);
  assert.deepEqual(overrides[0].removePermissions, ["orders.itemPrice"]);
});

test("tenant: a locked permission cannot be switched; bad input and unknown role are rejected", async () => {
  const { db, overrides } = tenantDb(ROLE);
  const locked = await tenant.toggleTenantRolePermission(CTX, "r1", "orders.editOwn", false, { db, ...noAudit });
  assert.equal(locked.ok === false && locked.code, "VALIDATION");
  const bad = await tenant.toggleTenantRolePermission(CTX, "r1", 7, true, { db, ...noAudit });
  assert.equal(bad.ok === false && bad.code, "VALIDATION");
  const badOn = await tenant.toggleTenantRolePermission(CTX, "r1", "orders.itemPrice", "no", { db, ...noAudit });
  assert.equal(badOn.ok === false && badOn.code, "VALIDATION");
  assert.equal(overrides.length, 0);
});

// ---------------------------------------------------------------- employee: toggleEmployeeRestriction

type UserRow = {
  id: string;
  tenantId: string;
  isOwner: boolean;
  deletedAt: null;
  deniedPermissions: string[];
  role: { id: string; name: string; permissions: string[]; isActive: boolean; tenantEditablePermissions: string[] };
};

function empDb(row: UserRow) {
  const db = {
    user: {
      async findFirst({ where }: { where: { id: string; tenantId: string } }) {
        return row.id === where.id && row.tenantId === where.tenantId ? { ...row, deniedPermissions: [...row.deniedPermissions] } : null;
      },
      async updateMany({ data }: { data: { deniedPermissions: string[] } }) {
        row.deniedPermissions = data.deniedPermissions;
        return { count: 1 };
      },
    },
    tenantRoleOverride: { async findUnique() { return null; } },
  };
  return db as never;
}

const EMP = (): UserRow => ({
  id: "e1",
  tenantId: "t1",
  isOwner: false,
  deletedAt: null,
  deniedPermissions: [],
  role: { id: "r1", name: "Засварчин", permissions: ["orders.viewOwn", "orders.editOwn", "orders.itemPrice"], isActive: true, tenantEditablePermissions: [] },
});
const OWNER = { id: "o1", tenantId: "t1", isOwner: true, role: null };

test("employee: switching OFF one permission denies only that code; ON restores it", async () => {
  const row = EMP();
  const db = empDb(row);
  const off = await restr.toggleEmployeeRestriction(db, OWNER, "e1", "orders.itemPrice", false);
  assert.equal(off.ok, true);
  assert.deepEqual(row.deniedPermissions, ["orders.itemPrice"]);
  const off2 = await restr.toggleEmployeeRestriction(db, OWNER, "e1", "orders.editOwn", false);
  assert.equal(off2.ok, true);
  assert.deepEqual(row.deniedPermissions.sort(), ["orders.editOwn", "orders.itemPrice"]);
  const on = await restr.toggleEmployeeRestriction(db, OWNER, "e1", "orders.itemPrice", true);
  assert.equal(on.ok, true);
  assert.deepEqual(row.deniedPermissions, ["orders.editOwn"]);
});

test("employee: toggle respects every guard (owner target, self, superior, bad input, other tenant)", async () => {
  const ownerTarget = EMP();
  ownerTarget.isOwner = true;
  assert.equal((await restr.toggleEmployeeRestriction(empDb(ownerTarget), OWNER, "e1", "orders.itemPrice", false) as { code?: string }).code, "OWNER_TARGET");
  const self = { id: "e1", tenantId: "t1", isOwner: false, role: { permissions: ["employees.edit", "orders.viewOwn", "orders.editOwn", "orders.itemPrice"] } };
  assert.equal((await restr.toggleEmployeeRestriction(empDb(EMP()), self, "e1", "orders.itemPrice", false) as { code?: string }).code, "SELF");
  const weak = { id: "m", tenantId: "t1", isOwner: false, role: { permissions: ["employees.edit"] } };
  assert.equal((await restr.toggleEmployeeRestriction(empDb(EMP()), weak, "e1", "orders.itemPrice", false) as { code?: string }).code, "SUPERIOR_TARGET");
  assert.equal((await restr.toggleEmployeeRestriction(empDb(EMP()), OWNER, "e1", 5, false) as { code?: string }).code, "VALIDATION");
  assert.equal((await restr.toggleEmployeeRestriction(empDb(EMP()), OWNER, "e1", "orders.itemPrice", "x") as { code?: string }).code, "VALIDATION");
  assert.equal((await restr.toggleEmployeeRestriction(empDb(EMP()), { ...OWNER, tenantId: "t2" }, "e1", "orders.itemPrice", false) as { code?: string }).code, "NOT_FOUND");
});

// ---------------------------------------------------------------- shared switch component (source guards)

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

test("PermissionSwitchList: accessible switches, optimistic save with rollback, no double submit", () => {
  const s = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "../app/_components/permission-switch-list.tsx"), "utf8");
  assert.match(s, /role="switch"/);
  assert.match(s, /aria-checked=\{on\}/);
  assert.match(s, /aria-label=\{i\.label\}/);
  // optimistic update, then rollback when the server refuses or the request throws
  assert.match(s, /setState\(\(s\) => \(\{ \.\.\.s, \[code\]: next \}\)\)/);
  assert.match(s, /if \(!r\.ok\) \{\s+setState\(\(s\) => \(\{ \.\.\.s, \[code\]: !next \}\)\)/);
  assert.match(s, /catch \{\s+setState\(\(s\) => \(\{ \.\.\.s, \[code\]: !next \}\)\)/);
  // a switch with a request in flight (or a locked one) is disabled; duplicate clicks are ignored
  assert.match(s, /inFlight\.current\.has\(code\)\) return/);
  assert.match(s, /disabled = Boolean\(i\.locked\) \|\| busy/);
  assert.match(s, /role="status" aria-live="polite"/);
});
