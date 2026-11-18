import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { before, test } from "node:test";

process.env.DATABASE_URL ??= "postgresql://unused/unused";
process.env.SESSION_SECRET ??= "unit-test-placeholder-secret-value-not-real-00";

let core: typeof import("../lib/system/tenants");
let audit: typeof import("../lib/system/audit");

before(async () => {
  [core, audit] = await Promise.all([import("../lib/system/tenants"), import("../lib/system/audit")]);
});

const src = (rel: string) => readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), rel), "utf8");

// ------------------------------------------------------------------ suspend / activate (fake DB)

type T = { id: string; suspended: boolean; creditSuspended: boolean; creditExempt: boolean };
function tenantDb(rows: T[]) {
  const calls = { updateMany: 0, update: 0 };
  const db = {
    tenant: {
      async findUnique({ where }: { where: { id: string } }) {
        const r = rows.find((x) => x.id === where.id);
        return r ? { suspended: r.suspended, creditSuspended: r.creditSuspended, creditExempt: r.creditExempt } : null;
      },
      async updateMany({ where, data }: { where: { id: string }; data: Partial<T> }) {
        calls.updateMany++;
        const r = rows.find((x) => x.id === where.id);
        if (!r) return { count: 0 };
        Object.assign(r, data);
        return { count: 1 };
      },
      async update({ where, data }: { where: { id: string }; data: Partial<T> }) {
        calls.update++;
        const r = rows.find((x) => x.id === where.id)!;
        Object.assign(r, data);
        return r;
      },
    },
  };
  return { db: db as never, rows, calls };
}

test("suspend: sets suspended, clears the automatic credit flag, reports before/after", async () => {
  const { db, rows } = tenantDb([{ id: "t1", suspended: false, creditSuspended: true, creditExempt: false }]);
  const r = await core.suspendTenant("t1", db);
  assert.equal(r.ok, true);
  assert.deepEqual(rows[0], { id: "t1", suspended: true, creditSuspended: false, creditExempt: false });
  if (r.ok) {
    assert.deepEqual(r.before, { suspended: false, creditSuspended: true, creditExempt: false });
    assert.deepEqual(r.after, { suspended: true, creditSuspended: false, creditExempt: false });
  }
});

test("suspend/activate on an unknown id → NOT_FOUND and nothing is written", async () => {
  const { db, calls } = tenantDb([]);
  assert.deepEqual(await core.suspendTenant("nope", db), { ok: false, reason: "NOT_FOUND" });
  assert.deepEqual(await core.activateTenant("nope", db), { ok: false, reason: "NOT_FOUND" });
  assert.deepEqual(calls, { updateMany: 0, update: 0 });
});

test("activate after a CREDIT suspension marks creditExempt (otherwise tomorrow's cron would suspend it again)", async () => {
  const { db, rows } = tenantDb([{ id: "t1", suspended: true, creditSuspended: true, creditExempt: false }]);
  const r = await core.activateTenant("t1", db);
  assert.equal(r.ok, true);
  assert.deepEqual(rows[0], { id: "t1", suspended: false, creditSuspended: false, creditExempt: true });
  if (r.ok) assert.deepEqual(r.after, { suspended: false, creditSuspended: false, creditExempt: true });
});

test("activate after a MANUAL suspension leaves creditExempt untouched (it keeps whatever it was)", async () => {
  const a = tenantDb([{ id: "t1", suspended: true, creditSuspended: false, creditExempt: false }]);
  await core.activateTenant("t1", a.db);
  assert.equal(a.rows[0].creditExempt, false);
  const b = tenantDb([{ id: "t1", suspended: true, creditSuspended: false, creditExempt: true }]);
  const r = await core.activateTenant("t1", b.db);
  assert.equal(b.rows[0].creditExempt, true);
  assert.equal(r.ok && r.after.creditExempt, true);
});

// ------------------------------------------------------------------ filters

test("parseTenantStatusFilter accepts only active|suspended (or nothing)", () => {
  assert.equal(core.parseTenantStatusFilter(null), null);
  assert.equal(core.parseTenantStatusFilter(""), null);
  assert.equal(core.parseTenantStatusFilter("active"), "active");
  assert.equal(core.parseTenantStatusFilter("suspended"), "suspended");
  for (const bad of ["ACTIVE", "all", "test", "1; drop"]) assert.equal(core.parseTenantStatusFilter(bad), "invalid");
});

test("buildTenantListWhere: status maps to suspended, q searches name/regno/email/phone, trimmed and capped", () => {
  assert.deepEqual(core.buildTenantListWhere({ q: null, status: null }), {});
  assert.deepEqual(core.buildTenantListWhere({ q: "   ", status: "active" }), { suspended: false });
  assert.deepEqual(core.buildTenantListWhere({ q: null, status: "suspended" }), { suspended: true });
  const w = core.buildTenantListWhere({ q: "  Авто ", status: null }) as { OR: Array<Record<string, unknown>> };
  assert.equal(w.OR.length, 4);
  assert.deepEqual(w.OR.map((c) => Object.keys(c)[0]), ["name", "registerNumber", "email", "phone1"]);
  assert.deepEqual(w.OR[0], { name: { contains: "Авто", mode: "insensitive" } });
  assert.deepEqual(w.OR[3], { phone1: { contains: "Авто" } });
  const long = core.buildTenantListWhere({ q: "x".repeat(500), status: null }) as { OR: Array<{ name: { contains: string } }> };
  assert.equal(long.OR[0].name.contains.length, 100);
});

// ------------------------------------------------------------------ privacy: what staff may see

test("toOwnerDto exposes only contact + activation state", () => {
  const dto = core.toOwnerDto({ id: "u", firstName: "Б", lastName: "Д", phone: "99112233", email: null, verified: false, passwordHash: "SECRET" } as never);
  assert.deepEqual(Object.keys(dto).sort(), ["activated", "email", "firstName", "id", "lastName", "phone"]);
  assert.equal(dto.activated, false);
  assert.equal(JSON.stringify(dto).includes("SECRET"), false);
});

test("list and detail queries select a strict whitelist: no credit, subscription, payment or order data, no password hash", async () => {
  const selects: Array<Record<string, unknown>> = [];
  const db = {
    tenant: {
      async findMany({ select }: { select: Record<string, unknown> }) {
        selects.push(select);
        return [];
      },
      async count() {
        return 0;
      },
      async findUnique({ select }: { select: Record<string, unknown> }) {
        selects.push(select);
        return null;
      },
    },
  };
  await core.listTenants({ q: null, status: null, skip: 0, take: 10 }, db as never);
  await core.getTenantDetail("x", db as never);
  const FORBIDDEN = /credit|subscription|payment|serviceOrder|revenue|passwordHash|enabledBanks|qpay|plan.?price/i;
  const collect = (o: unknown, path = ""): string[] =>
    o && typeof o === "object" ? Object.entries(o as Record<string, unknown>).flatMap(([k, v]) => [`${path}${k}`, ...collect(v, `${path}${k}.`)]) : [];
  for (const sel of selects) {
    const keys = collect(sel);
    assert.ok(keys.length > 5);
    assert.deepEqual(keys.filter((k) => FORBIDDEN.test(k)), [], "sensitive field selected");
  }
  // owners are looked up via isOwner only, non-deleted
  assert.match(src("../lib/system/tenants.ts"), /users: \{ where: \{ isOwner: true, deletedAt: null \}/);
});

test("list/detail DTOs serialise dates and shape rows predictably", async () => {
  const created = new Date("2026-11-18T01:02:03Z");
  const owner = { id: "u1", firstName: "Б", lastName: "Д", phone: "99112233", email: "o@x.mn", verified: true };
  const db = {
    tenant: {
      async findMany() {
        return [{ id: "t1", name: "Авто", registerNumber: "1234567", phone1: "70001111", email: null, plan: "FREE", suspended: false, isTest: false, createdAt: created, users: [owner] },
          { id: "t2", name: "Хоосон", registerNumber: "7654321", phone1: "70002222", email: null, plan: "FREE", suspended: true, isTest: true, createdAt: created, users: [] }];
      },
      async count() { return 2; },
      async findUnique() {
        return { id: "t1", slug: "avto-a1b2c3", name: "Авто", registerNumber: "1234567", email: null, phone1: "70001111", phone2: null, logoUrl: null, plan: "FREE", suspended: false,
          isTest: false, acceptsOnlineBooking: true, createdAt: created, users: [owner],
          branches: [{ id: "b1", name: "Үндсэн салбар", phone: null, city: "УБ", district: null, khoroo: null, address: "Өнөр 12", latitude: 47.9, longitude: 106.9 }],
          _count: { branches: 2, users: 5 } };
      },
    },
  };
  const list = await core.listTenants({ q: null, status: null, skip: 0, take: 10 }, db as never);
  assert.equal(list.total, 2);
  assert.equal(list.items[0].createdAt, "2026-11-18T01:02:03.000Z");
  assert.deepEqual(list.items[0].owner, { id: "u1", firstName: "Б", lastName: "Д", phone: "99112233", email: "o@x.mn", activated: true });
  assert.equal(list.items[1].owner, null);
  const detail = (await core.getTenantDetail("t1", db as never))!;
  assert.deepEqual([detail.branchCount, detail.employeeCount, detail.owners.length, detail.primaryBranch?.name], [2, 5, 1, "Үндсэн салбар"]);
  assert.equal(detail.slug, "avto-a1b2c3");
});

// ------------------------------------------------------------------ audit helper

test("logSystemAudit writes who/what/before/after and never throws", async () => {
  const rows: Array<Record<string, unknown>> = [];
  const ok = { systemAuditLog: { async create({ data }: { data: Record<string, unknown> }) { rows.push(data); return {}; } } };
  const req = new Request("http://x", { headers: { "x-forwarded-for": "203.0.113.9", "user-agent": "app/1" } });
  await audit.logSystemAudit({ adminId: "a1", tenantId: "t1", entity: "Tenant", entityId: "t1", action: "UPDATE", summary: "s", before: { a: 1 }, after: { a: 2 }, req }, ok as never);
  assert.equal(rows.length, 1);
  assert.deepEqual([rows[0].adminId, rows[0].tenantId, rows[0].entity, rows[0].action, rows[0].userAgent], ["a1", "t1", "Tenant", "UPDATE", "app/1"]);
  assert.deepEqual([rows[0].before, rows[0].after], [{ a: 1 }, { a: 2 }]);
  const boom = { systemAuditLog: { async create() { throw new Error("db down"); } } };
  await assert.doesNotReject(audit.logSystemAudit({ adminId: "a1", entity: "Tenant", entityId: "t1", action: "CREATE" }, boom as never));
});

// ------------------------------------------------------------------ wiring

test("read endpoints need tenants.view; the status filter is validated before the query; web actions use the shared core", () => {
  const list = src("../app/api/v1/system/tenants/route.ts");
  assert.match(list, /requireSystemApiUser\(req, "tenants\.view"\)/);
  assert.ok(list.indexOf('status === "invalid"') < list.indexOf("listTenants("));
  const one = src("../app/api/v1/system/tenants/[id]/route.ts");
  assert.match(one, /requireSystemApiUser\(req, "tenants\.view"\)/);
  assert.match(one, /jsonError\(404, [^)]*code: "NOT_FOUND"/);
  const web = src("../app/_actions/system-tenants.ts");
  assert.match(web, /await suspendTenant\(id\)/);
  assert.match(web, /await activateTenant\(id\)/);
  assert.doesNotMatch(web, /creditExempt: true/, "the credit/exempt rule lives only in the shared core");
  assert.match(src("../lib/system/tenants.ts"), /before\.creditSuspended \? \{ creditExempt: true \} : \{\}/);
});
