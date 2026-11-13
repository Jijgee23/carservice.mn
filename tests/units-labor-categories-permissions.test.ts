import assert from "node:assert/strict";
import { before, beforeEach, test } from "node:test";

// Unlike `app/api/v1/customers/route.ts` / `.../vehicles/route.ts`, none of
// the four route files this suite covers import `lib/subscription-server.ts`
// (which pulls in `server-only`), so — confirmed by spiking a plain `tsx`
// import before writing this file — they import cleanly under `tsx --test`
// with no bundler. That means this suite can exercise the *actual* exported
// GET/POST/PATCH/DELETE handlers end-to-end with a real signed JWT
// (`signApiToken`, using the same `SESSION_SECRET` `requireApiUser` verifies
// against) rather than falling back to source-pattern assertions: the only
// thing standing between "real request in" and "real response out" is the
// Postgres connection, and `prisma`'s per-model delegates (`prisma.unit`,
// `prisma.category`, `prisma.service`, `prisma.user`, `prisma.auditLog`) are
// plain writable object properties, so each test replaces exactly the calls
// it needs with an in-memory fake and lets the real route/permission code run
// unmodified around them.

process.env.DATABASE_URL ??= "postgresql://unused/unused";
process.env.SESSION_SECRET ??= "unit-test-placeholder-secret-value-not-real-00";

let prisma: typeof import("../lib/prisma").prisma;
let signApiToken: typeof import("../lib/auth/api-token").signApiToken;
let unitsRoute: typeof import("../app/api/v1/units/route");
let unitRoute: typeof import("../app/api/v1/units/[id]/route");
let categoriesRoute: typeof import("../app/api/v1/labor-categories/route");
let categoryRoute: typeof import("../app/api/v1/labor-categories/[id]/route");

before(async () => {
  [{ prisma }, { signApiToken }, unitsRoute, unitRoute, categoriesRoute, categoryRoute] =
    await Promise.all([
      import("../lib/prisma"),
      import("../lib/auth/api-token"),
      import("../app/api/v1/units/route"),
      import("../app/api/v1/units/[id]/route"),
      import("../app/api/v1/labor-categories/route"),
      import("../app/api/v1/labor-categories/[id]/route"),
    ]);
});

type UserFixture = {
  id?: string;
  tenantId?: string;
  isOwner?: boolean;
  permissions?: string[];
};

// Every mock below is cast through `as unknown as typeof prisma.<model>.<method>`
// rather than `any` — it keeps the test file lint-clean while still letting
// each test return exactly the shape it needs (the real Prisma delegate
// signatures are far wider than any single mock needs to satisfy).

// `requireApiUser` always calls `prisma.user.findUnique` — mocked per test so
// no real DB is needed; `auditLog.create` is stubbed globally in
// `beforeEach` so a passing mutation's `logAudit` call (which swallows its
// own errors anyway) never depends on real Postgres either.
function mockUser(fixture: UserFixture) {
  const { id = "u1", tenantId = "t1", isOwner = false, permissions = [] } = fixture;
  prisma.user.findUnique = (async () => ({
    id,
    email: "test@example.com",
    firstName: "Test",
    lastName: "User",
    phone: null,
    isOwner,
    tenantId,
    branchId: null,
    assignableBranchIds: [],
    role: permissions.length || !isOwner
      ? { id: "r1", name: "Test role", permissions, isActive: true }
      : null,
    // getApiUserFromRequest re-checks these on every request (lib/auth/api-token.ts).
    isActive: true,
    activeUntil: null,
    deactivatedAt: null,
    lockedAt: null,
    tenant: { suspended: false, plan: "BUSINESS" },
  })) as unknown as typeof prisma.user.findUnique;
}

async function tokenFor(fixture: UserFixture): Promise<string> {
  const { id = "u1", tenantId = "t1", isOwner = false } = fixture;
  return signApiToken({ userId: id, tenantId, isOwner });
}

async function request(
  fixture: UserFixture,
  init: { method?: string; url: string; body?: unknown } = { url: "" },
): Promise<Request> {
  mockUser(fixture);
  const token = await tokenFor(fixture);
  return new Request(`http://localhost${init.url}`, {
    method: init.method ?? "GET",
    headers: {
      authorization: `Bearer ${token}`,
      ...(init.body !== undefined ? { "content-type": "application/json" } : {}),
    },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
}

function ctx(id: string) {
  return { params: Promise.resolve({ id }) };
}

let auditLogCalls: unknown[] = [];

beforeEach(() => {
  auditLogCalls = [];
  prisma.auditLog.create = (async (args: unknown) => {
    auditLogCalls.push(args);
    return {};
  }) as unknown as typeof prisma.auditLog.create;
});

// --- GET /units — services.view gate, owner bypass -------------------------

test("GET /units: denied for a non-owner without services.view", async () => {
  const res = await unitsRoute.GET(await request({ permissions: ["orders.view"] }, { url: "/api/v1/units" }));
  assert.equal(res.status, 403);
});

test("GET /units: a non-owner WITH services.view can read the list", async () => {
  prisma.unit.findMany = (async () => [{ id: "u-1", name: "kg" }]) as unknown as typeof prisma.unit.findMany;
  const res = await unitsRoute.GET(
    await request({ permissions: ["services.view"] }, { url: "/api/v1/units" }),
  );
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.deepEqual(body.units, [{ id: "u-1", name: "kg" }]);
});

test("GET /units: an owner reads the list without an explicit permission code (owner bypass)", async () => {
  prisma.unit.findMany = (async () => []) as unknown as typeof prisma.unit.findMany;
  const res = await unitsRoute.GET(
    await request({ isOwner: true, permissions: [] }, { url: "/api/v1/units" }),
  );
  assert.equal(res.status, 200);
});

// --- POST /units — isOwner gate, mirroring authorizeOwner() -----------------

test("POST /units: a non-owner is rejected 403, even with services.view, before any write", async () => {
  let createCalled = false;
  prisma.unit.create = (async () => {
    createCalled = true;
    return {};
  }) as unknown as typeof prisma.unit.create;
  const res = await unitsRoute.POST(
    await request(
      { permissions: ["services.view", "services.create"] },
      { url: "/api/v1/units", method: "POST", body: { name: "kg" } },
    ),
  );
  assert.equal(res.status, 403);
  assert.equal(createCalled, false, "isOwner gate must run before prisma.unit.create");
});

test("POST /units: an owner can create a unit", async () => {
  prisma.unit.findFirst = (async () => null) as unknown as typeof prisma.unit.findFirst;
  prisma.unit.create = (async () => ({ id: "u-2", name: "litr", code: null, isActive: true })) as unknown as typeof prisma.unit.create;
  const res = await unitsRoute.POST(
    await request({ isOwner: true }, { url: "/api/v1/units", method: "POST", body: { name: "litr" } }),
  );
  assert.equal(res.status, 200);
  assert.equal(auditLogCalls.length, 1);
});

// --- PATCH/DELETE /units/[id] — isOwner gate + tenant isolation preserved --

test("PATCH /units/[id]: a non-owner is rejected 403 before the row is even looked up", async () => {
  let lookedUp = false;
  prisma.unit.findFirst = (async () => {
    lookedUp = true;
    return null;
  }) as unknown as typeof prisma.unit.findFirst;
  const res = await unitRoute.PATCH(
    await request({ permissions: ["services.view"] }, { url: "/api/v1/units/x", method: "PATCH", body: { name: "kg2" } }),
    ctx("x"),
  );
  assert.equal(res.status, 403);
  assert.equal(lookedUp, false, "isOwner gate must run before the existing-row lookup");
});

test("PATCH /units/[id]: an owner from another tenant gets 404, not a bypass — tenant scoping survives the new gate", async () => {
  // Simulates a cross-tenant id: the real route scopes the lookup by
  // `tenantId: auth.user.tenantId`, so a foreign unit id resolves to null
  // regardless of isOwner.
  prisma.unit.findFirst = (async () => null) as unknown as typeof prisma.unit.findFirst;
  const res = await unitRoute.PATCH(
    await request({ isOwner: true, tenantId: "other-tenant" }, {
      url: "/api/v1/units/foreign-id",
      method: "PATCH",
      body: { name: "kg2" },
    }),
    ctx("foreign-id"),
  );
  assert.equal(res.status, 404);
});

test("PATCH /units/[id]: an owner within their own tenant can update", async () => {
  prisma.unit.findFirst = (async (args: { where: { NOT?: unknown } }) =>
    args.where.NOT ? null : { id: "x", name: "kg", tenantId: "t1" }) as unknown as typeof prisma.unit.findFirst;
  prisma.unit.update = (async () => ({ id: "x", name: "kg2", code: null, isActive: true })) as unknown as typeof prisma.unit.update;
  const res = await unitRoute.PATCH(
    await request({ isOwner: true }, { url: "/api/v1/units/x", method: "PATCH", body: { name: "kg2" } }),
    ctx("x"),
  );
  assert.equal(res.status, 200);
});

test("DELETE /units/[id]: a non-owner is rejected 403 before the row is even looked up", async () => {
  let lookedUp = false;
  prisma.unit.findFirst = (async () => {
    lookedUp = true;
    return null;
  }) as unknown as typeof prisma.unit.findFirst;
  const res = await unitRoute.DELETE(
    await request({ permissions: ["services.view"] }, { url: "/api/v1/units/x", method: "DELETE" }),
    ctx("x"),
  );
  assert.equal(res.status, 403);
  assert.equal(lookedUp, false, "isOwner gate must run before the existing-row lookup");
});

test("DELETE /units/[id]: an owner from another tenant gets 404, not a bypass", async () => {
  prisma.unit.findFirst = (async () => null) as unknown as typeof prisma.unit.findFirst;
  const res = await unitRoute.DELETE(
    await request({ isOwner: true, tenantId: "other-tenant" }, { url: "/api/v1/units/foreign-id", method: "DELETE" }),
    ctx("foreign-id"),
  );
  assert.equal(res.status, 404);
});

test("DELETE /units/[id]: an owner within their own tenant, unused unit, succeeds", async () => {
  prisma.unit.findFirst = (async () => ({ id: "x", name: "kg", tenantId: "t1" })) as unknown as typeof prisma.unit.findFirst;
  prisma.service.count = (async () => 0) as unknown as typeof prisma.service.count;
  prisma.unit.delete = (async () => ({})) as unknown as typeof prisma.unit.delete;
  const res = await unitRoute.DELETE(
    await request({ isOwner: true }, { url: "/api/v1/units/x", method: "DELETE" }),
    ctx("x"),
  );
  assert.equal(res.status, 200);
});

// --- GET /labor-categories — services.view gate, owner bypass --------------

test("GET /labor-categories: denied for a non-owner without services.view", async () => {
  const res = await categoriesRoute.GET(
    await request({ permissions: ["orders.view"] }, { url: "/api/v1/labor-categories" }),
  );
  assert.equal(res.status, 403);
});

test("GET /labor-categories: a non-owner WITH services.view can read the list", async () => {
  prisma.category.findMany = (async () => [{ id: "c-1", name: "Засвар" }]) as unknown as typeof prisma.category.findMany;
  const res = await categoriesRoute.GET(
    await request({ permissions: ["services.view"] }, { url: "/api/v1/labor-categories" }),
  );
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.deepEqual(body.categories, [{ id: "c-1", name: "Засвар" }]);
});

test("GET /labor-categories: an owner reads the list without an explicit permission code", async () => {
  prisma.category.findMany = (async () => []) as unknown as typeof prisma.category.findMany;
  const res = await categoriesRoute.GET(
    await request({ isOwner: true, permissions: [] }, { url: "/api/v1/labor-categories" }),
  );
  assert.equal(res.status, 200);
});

// --- POST /labor-categories — isOwner gate ----------------------------------

test("POST /labor-categories: a non-owner is rejected 403, even with services.view, before any write", async () => {
  let createCalled = false;
  prisma.category.create = (async () => {
    createCalled = true;
    return {};
  }) as unknown as typeof prisma.category.create;
  const res = await categoriesRoute.POST(
    await request(
      { permissions: ["services.view", "services.create"] },
      { url: "/api/v1/labor-categories", method: "POST", body: { name: "Засвар" } },
    ),
  );
  assert.equal(res.status, 403);
  assert.equal(createCalled, false, "isOwner gate must run before prisma.category.create");
});

test("POST /labor-categories: an owner can create a category", async () => {
  prisma.category.findFirst = (async () => null) as unknown as typeof prisma.category.findFirst;
  prisma.systemServiceKey.findFirst = (async () => ({ id: "sk-1" })) as unknown as typeof prisma.systemServiceKey.findFirst;
  prisma.category.create = (async () => ({ id: "c-2", name: "Засвар", description: null, isActive: true })) as unknown as typeof prisma.category.create;
  const res = await categoriesRoute.POST(
    await request({ isOwner: true }, { url: "/api/v1/labor-categories", method: "POST", body: { name: "Засвар" } }),
  );
  assert.equal(res.status, 200);
  assert.equal(auditLogCalls.length, 1);
});

// --- PATCH/DELETE /labor-categories/[id] — isOwner gate + tenant isolation --

test("PATCH /labor-categories/[id]: a non-owner is rejected 403 before the row is even looked up", async () => {
  let lookedUp = false;
  prisma.category.findFirst = (async () => {
    lookedUp = true;
    return null;
  }) as unknown as typeof prisma.category.findFirst;
  const res = await categoryRoute.PATCH(
    await request({ permissions: ["services.view"] }, {
      url: "/api/v1/labor-categories/x",
      method: "PATCH",
      body: { name: "Шинэ" },
    }),
    ctx("x"),
  );
  assert.equal(res.status, 403);
  assert.equal(lookedUp, false, "isOwner gate must run before the existing-row lookup");
});

test("PATCH /labor-categories/[id]: an owner from another tenant gets 404, not a bypass", async () => {
  prisma.category.findFirst = (async () => null) as unknown as typeof prisma.category.findFirst;
  const res = await categoryRoute.PATCH(
    await request({ isOwner: true, tenantId: "other-tenant" }, {
      url: "/api/v1/labor-categories/foreign-id",
      method: "PATCH",
      body: { name: "Шинэ" },
    }),
    ctx("foreign-id"),
  );
  assert.equal(res.status, 404);
});

test("PATCH /labor-categories/[id]: an owner within their own tenant can update", async () => {
  prisma.category.findFirst = (async (args: { where: { NOT?: unknown } }) =>
    args.where.NOT ? null : { id: "x", name: "Засвар", tenantId: "t1" }) as unknown as typeof prisma.category.findFirst;
  prisma.category.update = (async () => ({ id: "x", name: "Шинэ", description: null, isActive: true })) as unknown as typeof prisma.category.update;
  const res = await categoryRoute.PATCH(
    await request({ isOwner: true }, { url: "/api/v1/labor-categories/x", method: "PATCH", body: { name: "Шинэ" } }),
    ctx("x"),
  );
  assert.equal(res.status, 200);
});

test("DELETE /labor-categories/[id]: a non-owner is rejected 403 before the row is even looked up", async () => {
  let lookedUp = false;
  prisma.category.findFirst = (async () => {
    lookedUp = true;
    return null;
  }) as unknown as typeof prisma.category.findFirst;
  const res = await categoryRoute.DELETE(
    await request({ permissions: ["services.view"] }, { url: "/api/v1/labor-categories/x", method: "DELETE" }),
    ctx("x"),
  );
  assert.equal(res.status, 403);
  assert.equal(lookedUp, false, "isOwner gate must run before the existing-row lookup");
});

test("DELETE /labor-categories/[id]: an owner from another tenant gets 404, not a bypass", async () => {
  prisma.category.findFirst = (async () => null) as unknown as typeof prisma.category.findFirst;
  const res = await categoryRoute.DELETE(
    await request({ isOwner: true, tenantId: "other-tenant" }, {
      url: "/api/v1/labor-categories/foreign-id",
      method: "DELETE",
    }),
    ctx("foreign-id"),
  );
  assert.equal(res.status, 404);
});

test("DELETE /labor-categories/[id]: an owner within their own tenant, unused category, succeeds", async () => {
  prisma.category.findFirst = (async () => ({ id: "x", name: "Засвар", tenantId: "t1" })) as unknown as typeof prisma.category.findFirst;
  prisma.service.count = (async () => 0) as unknown as typeof prisma.service.count;
  prisma.category.delete = (async () => ({})) as unknown as typeof prisma.category.delete;
  const res = await categoryRoute.DELETE(
    await request({ isOwner: true }, { url: "/api/v1/labor-categories/x", method: "DELETE" }),
    ctx("x"),
  );
  assert.equal(res.status, 200);
});
