import assert from "node:assert/strict";
import { test } from "node:test";
import { ADMIN_BULK_MAX, parseAdminBulkInput, runAdminBulk, type AdminBulkStore } from "../lib/system-admin-bulk";

function fakeStore(rows: Record<string, { active: boolean; used: boolean }>) {
  const calls: string[] = [];
  const store: AdminBulkStore = {
    existing: async (ids) => ids.filter((id) => id in rows),
    inUse: async (ids) => new Set(ids.filter((id) => rows[id]?.used)),
    setActive: async (ids, isActive) => {
      calls.push(`setActive:${isActive}:${ids.join(",")}`);
      for (const id of ids) rows[id].active = isActive;
      return ids.length;
    },
    remove: async (ids) => {
      calls.push(`remove:${ids.join(",")}`);
      for (const id of ids) delete rows[id];
      return ids.length;
    },
  };
  return { store, rows, calls };
}

test("parseAdminBulkInput rejects bad ops, empty and oversized selections, and dedupes ids", () => {
  assert.deepEqual(parseAdminBulkInput(["a"], "drop"), { error: "Үйлдэл буруу." });
  assert.deepEqual(parseAdminBulkInput("a", "delete"), { error: "Мөр сонгоно уу." });
  assert.deepEqual(parseAdminBulkInput([1, "", null], "delete"), { error: "Мөр сонгоно уу." });
  const tooMany = Array.from({ length: ADMIN_BULK_MAX + 1 }, (_, i) => `id${i}`);
  assert.ok("error" in parseAdminBulkInput(tooMany, "activate"));
  assert.deepEqual(parseAdminBulkInput(["a", "a", "b"], "activate"), { ids: ["a", "b"], op: "activate" });
});

test("delete removes unused rows and only deactivates rows that are in use", async () => {
  const { store, rows, calls } = fakeStore({
    free: { active: true, used: false },
    busy: { active: true, used: true },
  });
  const res = await runAdminBulk(store, ["free", "busy", "ghost"], "delete");
  assert.deepEqual(res, { ok: true, updated: 0, deleted: 1, deactivated: 1, notFound: 1 });
  assert.equal("free" in rows, false);
  assert.equal(rows.busy.active, false);
  assert.deepEqual(calls, ["remove:free", "setActive:false:busy"]);
});

test("activate/deactivate touch only existing rows and never delete", async () => {
  const { store, rows, calls } = fakeStore({ a: { active: false, used: true }, b: { active: false, used: false } });
  const res = await runAdminBulk(store, ["a", "b", "x"], "activate");
  assert.deepEqual(res, { ok: true, updated: 2, deleted: 0, deactivated: 0, notFound: 1 });
  assert.equal(rows.a.active && rows.b.active, true);
  assert.ok(calls.every((c) => !c.startsWith("remove")));
});

test("nothing found is a no-op, not an error", async () => {
  const { store, calls } = fakeStore({});
  assert.deepEqual(await runAdminBulk(store, ["x"], "delete"), { ok: true, updated: 0, deleted: 0, deactivated: 0, notFound: 1 });
  assert.deepEqual(calls, []);
});
