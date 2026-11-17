import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

// `app/api/v1/roles/**` and `app/api/v1/permissions/route.ts` transitively
// import server-only modules (`lib/prisma.ts` / `lib/audit.ts`), so plain
// `tsx --test` module resolution cannot import them directly — same import
// barrier documented in `tests/services-route-permissions.test.ts`. All
// coverage here is source-pattern: gating order, the system-managed (403)
// mutations, the shared (non-owner-only) read gate, DTO usage and `code`.

function src(relPath: string): string {
  return readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), relPath), "utf8");
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

const ROLES_ROUTE = () => src("../app/api/v1/roles/route.ts");
const ROLE_ID_ROUTE = () => src("../app/api/v1/roles/[id]/route.ts");
const PERMISSIONS_ROUTE = () => src("../app/api/v1/permissions/route.ts");

// --- GET /api/v1/roles and GET /api/v1/permissions share the same,
// non-owner-only read gate (measured against the web's employee
// create/edit form loaders — see the routes' own doc comments).

test("GET /api/v1/roles and GET /api/v1/permissions both use canReadRoles/canReadPermissions built from employees.view/create/edit — not owner-only", () => {
  for (const source of [ROLES_ROUTE(), ROLE_ID_ROUTE(), PERMISSIONS_ROUTE()]) {
    assert.match(source, /hasPermission\(user, "employees\.view"\)/);
    assert.match(source, /hasPermission\(user, "employees\.create"\)/);
    assert.match(source, /hasPermission\(user, "employees\.edit"\)/);
    assert.doesNotMatch(
      source.slice(0, source.indexOf("export async function GET") + 200),
      /auth\.user\.isOwner\)\s*return jsonForbidden/,
      "GET must not be owner-gated the way PATCH/DELETE/POST are",
    );
  }
});

test("GET /api/v1/roles gates its read check before querying, lists the global roles, and builds RoleDto", () => {
  const source = ROLES_ROUTE();
  const { GET } = fnSections(source, "GET", "POST");
  const gate = GET.indexOf("canReadRoles(auth.user)");
  const findMany = GET.indexOf("prisma.role.findMany");
  assert.ok(gate >= 0 && findMany > gate);
  // Роль глобал — tenant шүүлтгүй.
  assert.doesNotMatch(GET, /tenantId/);
  assert.match(GET, /toRoleDto/);
});

// --- POST/PATCH/DELETE /api/v1/roles — roles are system-managed now

test("POST /api/v1/roles and PATCH/DELETE /api/v1/roles/[id] always answer 403 SYSTEM_MANAGED", () => {
  const { POST } = fnSections(ROLES_ROUTE(), "GET", "POST");
  assert.match(POST, /jsonError\(403, SYSTEM_MANAGED_MESSAGE, \{ code: "SYSTEM_MANAGED" \}\)/);
  assert.doesNotMatch(POST, /createRole/);

  const idSource = ROLE_ID_ROUTE();
  assert.match(idSource, /export async function PATCH\(req: Request\) \{\s*return systemManaged\(req\);/);
  assert.match(idSource, /export async function DELETE\(req: Request\) \{\s*return systemManaged\(req\);/);
  assert.match(idSource, /jsonError\(403, SYSTEM_MANAGED_MESSAGE, \{ code: "SYSTEM_MANAGED" \}\)/);
  assert.doesNotMatch(idSource, /updateRole|deleteRole/);
});

// --- GET /api/v1/permissions serves the grouped catalogue

test("GET /api/v1/permissions gates its read check, then serves permissionsByGroup + STANDALONE_PERMISSIONS", () => {
  const source = PERMISSIONS_ROUTE();
  const gate = source.indexOf("canReadPermissions(auth.user)");
  const groups = source.indexOf("permissionsByGroup()");
  const standalone = source.indexOf("STANDALONE_PERMISSIONS.map");
  assert.ok(gate >= 0 && groups > gate && standalone > gate);
});

// --- Wiring sanity

test("every roles/permissions handler requires requireApiUser before any gate", () => {
  for (const source of [ROLES_ROUTE(), ROLE_ID_ROUTE(), PERMISSIONS_ROUTE()]) {
    const authIdx = source.indexOf("requireApiUser(req)");
    const earlyReturn = source.indexOf("if (auth.response) return auth.response;");
    assert.ok(authIdx >= 0);
    assert.ok(earlyReturn > authIdx);
  }
});
