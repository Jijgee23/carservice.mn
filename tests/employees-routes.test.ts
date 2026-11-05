import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { before, test } from "node:test";
import type { ApiUser } from "../lib/auth/api-token";

// `app/api/v1/employees/**/route.ts` transitively import
// `lib/subscription-server.ts` (`import "server-only"`), so plain
// `tsx --test` module resolution cannot import them directly — the same
// import barrier documented in `tests/services-route-permissions.test.ts`.
// Behavioural coverage: `requirePermission`/`hasPermission` for the exact
// codes these routes gate on. Structural coverage: each handler gates
// permission (and, where applicable, subscription) before any Prisma call
// or core delegation, stays tenant-scoped, builds its DTO with
// `toEmployeeDto`, and returns `code` on every error branch.

process.env.DATABASE_URL ??= "postgresql://unused/unused";
process.env.SESSION_SECRET ??= "unit-test-placeholder-secret-value-not-real-00";

let requirePermission: typeof import("../lib/api").requirePermission;
let hasPermission: typeof import("../lib/auth/roles").hasPermission;

before(async () => {
  [{ requirePermission }, { hasPermission }] = await Promise.all([
    import("../lib/api"),
    import("../lib/auth/roles"),
  ]);
});

function src(relPath: string): string {
  return readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), relPath), "utf8");
}

function user(overrides: Partial<ApiUser> & { permissions?: string[] }): ApiUser {
  const { permissions, ...rest } = overrides;
  return {
    id: "u1",
    tenantId: "t1",
    isOwner: false,
    role: permissions ? { permissions, name: "Test" } : null,
    ...rest,
  } as ApiUser;
}

function routeSource(relPath: string) {
  return src(`../app/api/v1/employees/${relPath}`);
}

function fnSections(source: string, ...names: string[]) {
  const starts = names.map((n) => ({ n, i: source.indexOf(`export async function ${n}`) }));
  for (const { n, i } of starts) assert.ok(i >= 0, `must export ${n}`);
  const sorted = [...starts].sort((a, b) => a.i - b.i);
  const out: Record<string, string> = {};
  for (let i = 0; i < sorted.length; i++) {
    const end = i + 1 < sorted.length ? sorted[i + 1].i : source.length;
    out[sorted[i].n] = source.slice(sorted[i].i, end);
  }
  return out;
}

// --- Behavioral: requirePermission/hasPermission for the codes these routes add

for (const code of ["employees.view", "employees.create", "employees.edit", "employees.delete"] as const) {
  test(`${code} permission-denied for a role lacking the code`, () => {
    const denied = user({ permissions: ["orders.view"] });
    assert.notEqual(requirePermission(denied, code), null);
  });

  test(`${code} positive for a role that has the code`, () => {
    const granted = user({ permissions: [code] });
    assert.equal(requirePermission(granted, code), null);
  });

  test(`${code} owner bypass`, () => {
    const owner = user({ isOwner: true, permissions: [] });
    assert.equal(hasPermission(owner, code), true);
    assert.equal(requirePermission(owner, code), null);
  });
}

// --- GET/POST /api/v1/employees

test("GET /api/v1/employees gates employees.view before rejecting unknown params or querying, and stays tenant-scoped", () => {
  const source = routeSource("route.ts");
  const { GET } = fnSections(source, "GET", "POST");
  const auth = GET.indexOf("requireApiUser(req)");
  const early = GET.indexOf("if (auth.response) return auth.response;");
  const perm = GET.indexOf('requirePermission(auth.user, "employees.view")');
  const unknown = GET.indexOf("rejectUnknownParams(");
  const findMany = GET.indexOf("prisma.user.findMany");
  assert.ok(auth >= 0 && early > auth && perm > early, "must auth then gate permission");
  assert.ok(unknown > perm, "unknown-param rejection must run after the permission gate");
  assert.ok(findMany > unknown, "the Prisma read must come after param validation");
  assert.match(GET, /tenantId:\s*auth\.user\.tenantId/, "GET's where must stay tenant-scoped");
  assert.match(GET, /toEmployeeDto/, "GET must build its response with toEmployeeDto");
});

test("POST /api/v1/employees gates employees.create, then subscription, before creating; no MAX_USERS quota", () => {
  const source = routeSource("route.ts");
  const { POST } = fnSections(source, "GET", "POST");
  const perm = POST.indexOf('requirePermission(auth.user, "employees.create")');
  const sub = POST.indexOf("requireActiveSubscriptionApi(auth.user)");
  const prep = POST.indexOf("prepareCreateEmployee(");
  const create = POST.indexOf("createEmployee(prisma, actor,");
  assert.ok(perm >= 0 && sub > perm, "subscription check must run after the permission check");
  assert.ok(prep > sub, "prepareCreateEmployee must run after the subscription gate");
  assert.ok(create > prep, "createEmployee must run after prepare");
  assert.doesNotMatch(POST, /enforceCountLimit|PLAN_LIMIT_REACHED|DAILY_LIMIT_REACHED|PLAN_LIMIT_CODES\.(MAX_|DAILY_)/, "no employee count quota");
  assert.match(POST, /code: prep\.code, fieldErrors: prep\.fieldErrors/, "prepare errors must carry code");
  assert.match(POST, /code: result\.code/, "create errors must carry code");
});

test("employees list/detail/bulk routes never select passwordHash or verification secrets", () => {
  for (const rel of ["route.ts", "[id]/route.ts", "bulk/route.ts", "[id]/toggle-active/route.ts", "[id]/reset-password/route.ts"]) {
    const source = routeSource(rel);
    assert.doesNotMatch(source, /passwordHash/, `${rel} must never reference passwordHash`);
    assert.doesNotMatch(source, /failedLoginAttempts|lockedAt/, `${rel} must never reference lock/failed-login fields`);
  }
});

// --- GET/PATCH/DELETE /api/v1/employees/[id]

test("employees/[id] handlers each gate permission before any Prisma/core call, and every error branch carries code", () => {
  const source = routeSource("[id]/route.ts");
  const { GET, PATCH, DELETE } = fnSections(source, "GET", "PATCH", "DELETE");

  const getPerm = GET.indexOf('requirePermission(auth.user, "employees.view")');
  const getFind = GET.indexOf("prisma.user.findFirst");
  assert.ok(getPerm >= 0 && getFind > getPerm);
  assert.match(GET, /tenantId:\s*auth\.user\.tenantId/);

  const patchPerm = PATCH.indexOf('requirePermission(auth.user, "employees.edit")');
  const patchSub = PATCH.indexOf("requireActiveSubscriptionApi(auth.user)");
  const patchUpdate = PATCH.indexOf("updateEmployee(prisma, actor, id, formData)");
  assert.ok(patchPerm >= 0 && patchSub > patchPerm && patchUpdate > patchSub);
  assert.match(PATCH, /ERROR_STATUS\[result\.code\]/, "PATCH must map the core's error code to an HTTP status");

  const delPerm = DELETE.indexOf('requirePermission(auth.user, "employees.delete")');
  const delSub = DELETE.indexOf("requireActiveSubscriptionApi(auth.user)");
  const delCall = DELETE.indexOf("deleteEmployee(prisma, actor,");
  assert.ok(delPerm >= 0 && delSub > delPerm && delCall > delSub);
});

test("employees/[id] ERROR_STATUS covers every EmployeeErrorCode with a real HTTP status", () => {
  const source = routeSource("[id]/route.ts");
  for (const code of [
    "VALIDATION",
    "DUPLICATE",
    "NOT_FOUND",
    "OWNER_ROLE_LOCKED",
    "SELF_DEACTIVATE",
    "SELF_ACTION",
    "LAST_OWNER",
    "FK_CONFLICT",
    "UNKNOWN",
  ]) {
    assert.match(source, new RegExp(`${code}:\\s*\\d{3}`), `ERROR_STATUS must map ${code}`);
  }
});

// --- toggle-active / reset-password

test("toggle-active and reset-password both gate employees.edit + active subscription before the core call", () => {
  for (const [rel, coreCall] of [
    ["[id]/toggle-active/route.ts", "toggleEmployeeActive(prisma, actor, fd)"],
    ["[id]/reset-password/route.ts", "resetEmployeePassword(prisma, actor, fd)"],
  ] as const) {
    const source = routeSource(rel);
    const perm = source.indexOf('requirePermission(auth.user, "employees.edit")');
    const sub = source.indexOf("requireActiveSubscriptionApi(auth.user)");
    const call = source.indexOf(coreCall);
    assert.ok(perm >= 0, `${rel} must gate employees.edit`);
    assert.ok(sub > perm, `${rel} must check subscription after permission`);
    assert.ok(call > sub, `${rel} must call the core after both gates`);
  }
});

test("reset-password never returns or generates a password", () => {
  const source = routeSource("[id]/reset-password/route.ts");
  assert.doesNotMatch(source, /newPassword|generatedPassword/);
});

// --- bulk

test("POST /api/v1/employees/bulk gates employees.edit + subscription, delegates to the shared core, and is per-row not all-or-nothing", () => {
  const source = routeSource("bulk/route.ts");
  const perm = source.indexOf('requirePermission(auth.user, "employees.edit")');
  const sub = source.indexOf("requireActiveSubscriptionApi(auth.user)");
  const call = source.indexOf("bulkUpdateEmployeeRoleBranch(prisma, actor, fd)");
  assert.ok(perm >= 0 && sub > perm && call > sub);
  assert.match(source, /succeeded:\s*result\.succeeded,\s*failed:\s*result\.failed,\s*errors:\s*result\.errors/);
});

// --- Wiring sanity: every handler requires an authenticated ApiUser first

test("every employees route handler requires requireApiUser before any permission check", () => {
  const files = [
    "route.ts",
    "[id]/route.ts",
    "bulk/route.ts",
    "[id]/toggle-active/route.ts",
    "[id]/reset-password/route.ts",
  ];
  for (const rel of files) {
    const source = routeSource(rel);
    const authIdx = source.indexOf("requireApiUser(req)");
    const earlyReturn = source.indexOf("if (auth.response) return auth.response;");
    assert.ok(authIdx >= 0, `${rel} must call requireApiUser(req)`);
    assert.ok(earlyReturn > authIdx, `${rel} must early-return auth.response`);
  }
});

// --- deactivatedAt exposure + tombstone (deletedAt) list filtering

test("GET /api/v1/employees and /api/v1/employees/[id] both select deactivatedAt", () => {
  for (const rel of ["route.ts", "[id]/route.ts"]) {
    const source = routeSource(rel);
    assert.match(
      source,
      /EMPLOYEE_SELECT\s*=\s*\{[\s\S]*?deactivatedAt:\s*true[\s\S]*?\}\s*satisfies Prisma\.UserSelect/,
      `${rel}'s EMPLOYEE_SELECT must include deactivatedAt`,
    );
  }
});

test("toEmployeeDto exposes deactivatedAt as an ISO string or null", () => {
  const source = src("../lib/employees/dto.ts");
  assert.match(source, /deactivatedAt:\s*string \| null/, "EmployeeDto must type deactivatedAt");
  assert.match(
    source,
    /deactivatedAt:\s*row\.deactivatedAt\s*\?\s*row\.deactivatedAt\.toISOString\(\)\s*:\s*null/,
    "toEmployeeDto must serialize deactivatedAt to an ISO string (or null)",
  );
});

test("GET /api/v1/employees excludes tombstoned (deletedAt) users from its list where", () => {
  const source = routeSource("route.ts");
  const { GET } = fnSections(source, "GET", "POST");
  assert.match(GET, /where:\s*Prisma\.UserWhereInput\s*=\s*\{\s*tenantId:\s*auth\.user\.tenantId,\s*deletedAt:\s*null,/);
});

test("dashboard employees list/export share a where-builder that filters deletedAt: null", () => {
  const source = src("../app/dashboard/employees/data.ts");
  assert.match(source, /where:\s*Prisma\.UserWhereInput\s*=\s*\{\s*tenantId,\s*deletedAt:\s*null\s*\}/);
});
