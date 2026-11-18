import assert from "node:assert/strict";
import { before, test } from "node:test";

process.env.DATABASE_URL ??= "postgresql://unused/unused";
process.env.SESSION_SECRET ??= "unit-test-placeholder-secret-value-not-real-00";

let resolveEffectiveRole: typeof import("../lib/auth/load-effective").resolveEffectiveRole;

before(async () => {
  ({ resolveEffectiveRole } = await import("../lib/auth/load-effective"));
});

type Override = { addPermissions: string[]; removePermissions: string[] } | null;

function fakeDb(override: Override) {
  const calls: unknown[] = [];
  const db = {
    tenantRoleOverride: {
      findUnique: async (args: unknown) => {
        calls.push(args);
        return override;
      },
    },
  };
  return { db: db as never, calls };
}

const role = (over: Partial<{ permissions: string[]; editable: string[]; isActive: boolean }> = {}) => ({
  id: "r1",
  name: "Засварчин",
  permissions: over.permissions ?? ["orders.viewOwn", "orders.editOwn", "orders.itemPrice"],
  isActive: over.isActive ?? true,
  tenantEditablePermissions: over.editable ?? [],
});
const user = (r: ReturnType<typeof role> | null, extra: Partial<{ isOwner: boolean; denied: string[] }> = {}) => ({
  isOwner: extra.isOwner ?? false,
  tenantId: "t1",
  deniedPermissions: extra.denied ?? [],
  role: r,
});

test("no role → null", async () => {
  const { db } = fakeDb(null);
  assert.equal(await resolveEffectiveRole(user(null), db), null);
});

test("inactive role → no permissions, no DB read", async () => {
  const { db, calls } = fakeDb(null);
  const r = await resolveEffectiveRole(user(role({ isActive: false, editable: ["orders.itemPrice"] })), db);
  assert.deepEqual(r?.permissions, []);
  assert.equal(calls.length, 0);
});

test("owner keeps raw role permissions and never reads overrides", async () => {
  const { db, calls } = fakeDb({ addPermissions: [], removePermissions: ["orders.itemPrice"] });
  const r = await resolveEffectiveRole(
    user(role({ editable: ["orders.itemPrice"] }), { isOwner: true, denied: ["orders.viewOwn"] }),
    db,
  );
  assert.deepEqual(r?.permissions, ["orders.viewOwn", "orders.editOwn", "orders.itemPrice"]);
  assert.equal(calls.length, 0);
});

test("default (nothing editable): zero extra queries, permissions unchanged", async () => {
  const { db, calls } = fakeDb({ addPermissions: ["payments.view"], removePermissions: [] });
  const r = await resolveEffectiveRole(user(role()), db);
  assert.deepEqual(r?.permissions, ["orders.viewOwn", "orders.editOwn", "orders.itemPrice"]);
  assert.equal(calls.length, 0);
});

test("editable code: tenant override applied, scoped by tenant + role", async () => {
  const { db, calls } = fakeDb({ addPermissions: [], removePermissions: ["orders.itemPrice"] });
  const r = await resolveEffectiveRole(user(role({ editable: ["orders.itemPrice"] })), db);
  assert.deepEqual(r?.permissions, ["orders.viewOwn", "orders.editOwn"]);
  assert.deepEqual((calls[0] as { where: unknown }).where, { tenantId_roleId: { tenantId: "t1", roleId: "r1" } });
});

test("stale override on a code that is no longer editable is ignored", async () => {
  const { db } = fakeDb({ addPermissions: [], removePermissions: ["orders.editOwn"] });
  const r = await resolveEffectiveRole(user(role({ editable: ["orders.itemPrice"] })), db);
  assert.ok(r?.permissions.includes("orders.editOwn"));
});

test("per-user denial applies even when nothing is editable (no override query)", async () => {
  const { db, calls } = fakeDb(null);
  const r = await resolveEffectiveRole(user(role(), { denied: ["orders.itemPrice"] }), db);
  assert.deepEqual(r?.permissions, ["orders.viewOwn", "orders.editOwn"]);
  assert.equal(calls.length, 0);
});

test("no override row + editable codes → role permissions minus denials", async () => {
  const { db } = fakeDb(null);
  const r = await resolveEffectiveRole(user(role({ editable: ["orders.itemPrice"] }), { denied: ["orders.editOwn"] }), db);
  assert.deepEqual(r?.permissions, ["orders.viewOwn", "orders.itemPrice"]);
});
