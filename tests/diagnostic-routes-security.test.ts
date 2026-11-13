import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { before, test } from "node:test";
import type { ApiUser } from "../lib/auth/api-token";

// P5-B0 — permission + data-integrity correction for the four pre-existing
// diagnostics routes (`reports/route.ts`, `reports/[id]/route.ts`,
// `templates/route.ts`, `templates/[id]/route.ts`). Per the entry state
// measured in TENANT_MOBILE_SLICES.md, none of the four GETs and the reports
// POST previously called `requirePermission` at all — only `requireApiUser`
// (authentication, no authorization).
//
// Unlike the `services`/`customers` route families, none of these four files
// (nor `lib/orders.ts`, `lib/diagnostics.ts`) import `server-only`
// transitively, so they import cleanly under plain `tsx --test` module
// resolution. What still cannot run here is any call that reaches
// `prisma` — this repo's Prisma client requires a real `adapter-pg`
// connection even for a single query, and there is no prisma-mocking
// convention anywhere in this tree (see `tests/service-commands.test.ts`,
// `tests/customer-commands.test.ts`). So, matching every sibling route-test
// file's established split:
//   - permission-denied / positive / owner-bypass and cross-resource
//     independence are tested BEHAVIORALLY against the real
//     `requirePermission`/`hasPermission` primitives each handler calls;
//   - `maxSeverity` non-null-on-a-check-answer is tested BEHAVIORALLY against
//     the real, pure `computeReportSeverity`;
//   - permission-gate placement (before any Prisma call), tenant-scoping
//     (the mechanism that turns a cross-tenant id into a 404, standing in for
//     a cross-tenant negative without a live DB), the `maxSeverity` field
//     actually being threaded into both `diagnosticReport.create` calls, the
//     `DELETE` ServiceItem-reset transaction shape, the DELETE route's
//     unchanged permission check, and `isOrderLocked`/`canFillDiagnostics`
//     replacing the old inline `!== "IN_PROGRESS"` checks are all asserted
//     structurally (source-pattern) against the real route source, the same
//     proxy `tests/services-route-permissions.test.ts` and
//     `tests/customer-detail-routes.test.ts` use for this exact gap.

process.env.DATABASE_URL ??= "postgresql://unused/unused";
process.env.SESSION_SECRET ??= "unit-test-placeholder-secret-value-not-real-00";

let requirePermission: typeof import("../lib/api").requirePermission;
let hasPermission: typeof import("../lib/auth/roles").hasPermission;
let computeReportSeverity: typeof import("../lib/diagnostics").computeReportSeverity;
let isOrderLocked: typeof import("../lib/orders").isOrderLocked;
let canFillDiagnostics: typeof import("../lib/orders").canFillDiagnostics;

before(async () => {
  const [api, roles, diagnostics, orders] = await Promise.all([
    import("../lib/api"),
    import("../lib/auth/roles"),
    import("../lib/diagnostics"),
    import("../lib/orders"),
  ]);
  requirePermission = api.requirePermission;
  hasPermission = roles.hasPermission;
  computeReportSeverity = diagnostics.computeReportSeverity;
  isOrderLocked = orders.isOrderLocked;
  canFillDiagnostics = orders.canFillDiagnostics;
});

function src(relPath: string): string {
  return readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), relPath),
    "utf8",
  );
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

function reportsRouteSections() {
  const source = src("../app/api/v1/diagnostics/reports/route.ts");
  const getStart = source.indexOf("export async function GET");
  const postStart = source.indexOf("export async function POST");
  assert.ok(getStart >= 0 && postStart > getStart, "GET must precede POST");
  return { full: source, get: source.slice(getStart, postStart), post: source.slice(postStart) };
}

function reportDetailRouteSections() {
  const source = src("../app/api/v1/diagnostics/reports/[id]/route.ts");
  const getStart = source.indexOf("export async function GET");
  const delStart = source.indexOf("export async function DELETE");
  assert.ok(getStart >= 0 && delStart > getStart, "GET must precede DELETE");
  return { full: source, get: source.slice(getStart, delStart), del: source.slice(delStart) };
}

function templatesRouteSource() {
  return src("../app/api/v1/diagnostics/templates/route.ts");
}

function templateDetailRouteSource() {
  return src("../app/api/v1/diagnostics/templates/[id]/route.ts");
}

// --- Behavioral: requirePermission/hasPermission for diagnostics.view/create

test("diagnostics.view permission-denied for a role lacking the code", () => {
  const denied = user({ permissions: ["orders.view"] });
  assert.notEqual(requirePermission(denied, "diagnostics.view"), null);
});

test("diagnostics.view positive for a role that has the code", () => {
  const granted = user({ permissions: ["diagnostics.view"] });
  assert.equal(requirePermission(granted, "diagnostics.view"), null);
});

test("diagnostics.view owner bypass — owners never need the explicit code", () => {
  const owner = user({ isOwner: true, permissions: [] });
  assert.equal(hasPermission(owner, "diagnostics.view"), true);
  assert.equal(requirePermission(owner, "diagnostics.view"), null);
});

test("diagnostics.create permission-denied for a role lacking the code", () => {
  const denied = user({ permissions: ["diagnostics.view"] });
  assert.notEqual(requirePermission(denied, "diagnostics.create"), null);
});

test("diagnostics.create positive for a role that has the code", () => {
  const granted = user({ permissions: ["diagnostics.create"] });
  assert.equal(requirePermission(granted, "diagnostics.create"), null);
});

test("diagnostics.create owner bypass", () => {
  const owner = user({ isOwner: true, permissions: [] });
  assert.equal(hasPermission(owner, "diagnostics.create"), true);
  assert.equal(requirePermission(owner, "diagnostics.create"), null);
});

test("a cross-resource role (no diagnostics.* at all) is denied both diagnostics.view and diagnostics.create", () => {
  const crossResourceRole = user({ permissions: ["customers.view", "customers.create"] });
  assert.notEqual(requirePermission(crossResourceRole, "diagnostics.view"), null);
  assert.notEqual(requirePermission(crossResourceRole, "diagnostics.create"), null);
});

// --- Behavioral: computeReportSeverity (the pure fix for the maxSeverity gap)

function checkSchema() {
  return {
    sections: [
      {
        id: "sec1",
        title: "Үндсэн үзлэг",
        items: [
          { id: "brakes", label: "Тормоз", type: "check" as const, required: true },
        ],
      },
    ],
  };
}

test("computeReportSeverity returns null when the report has no check answers", () => {
  const result = computeReportSeverity(checkSchema(), {});
  assert.equal(result, null);
});

test("computeReportSeverity is non-null (BAD) for a report with at least one check-type answer needing replacement", () => {
  const result = computeReportSeverity(checkSchema(), { brakes: { value: "Солих" } });
  assert.notEqual(result, null);
  assert.equal(result, "BAD");
});

test("computeReportSeverity is non-null (GOOD) for a report whose only check answer is normal", () => {
  const result = computeReportSeverity(checkSchema(), { brakes: { value: "Хэвийн" } });
  assert.notEqual(result, null);
  assert.equal(result, "GOOD");
});

// --- Source-pattern: GET /api/v1/diagnostics/reports gates before the query

test("GET /api/v1/diagnostics/reports gates on diagnostics.view before building the query, tenant-scoped", () => {
  const { get } = reportsRouteSections();
  const permCheck = get.indexOf('requirePermission(auth.user, "diagnostics.view")');
  const findMany = get.indexOf("prisma.diagnosticReport.findMany");
  assert.ok(permCheck >= 0, "GET must call requirePermission(auth.user, \"diagnostics.view\")");
  assert.ok(findMany > permCheck, "permission check must precede the Prisma read");
  assert.match(get, /tenantId:\s*auth\.user\.tenantId/, "GET's where must stay tenant-scoped");
});

// --- Source-pattern: POST /api/v1/diagnostics/reports gates before any work

test("POST /api/v1/diagnostics/reports gates on diagnostics.create before parsing the multipart body", () => {
  const { post } = reportsRouteSections();
  const permCheck = post.indexOf('requirePermission(auth.user, "diagnostics.create")');
  const formDataParse = post.indexOf("req.formData()");
  assert.ok(permCheck >= 0, "POST must call requirePermission(auth.user, \"diagnostics.create\")");
  assert.ok(formDataParse > permCheck, "permission check must precede formData parsing");
});

// --- Source-pattern: maxSeverity threaded into BOTH create calls

test("POST /api/v1/diagnostics/reports computes and stores maxSeverity on both diagnosticReport.create calls", () => {
  const { post, full } = reportsRouteSections();
  // The route computes severity once and hands it to commitDiagnosticReportCommand,
  // which writes it on both the linked (locked tx) and standalone create paths.
  const occurrences = post.match(/maxSeverity:\s*computeReportSeverity\(schema,\s*validated\)/g) ?? [];
  assert.equal(occurrences.length, 1, "the route must compute maxSeverity for the shared commit command");
  assert.match(full, /import\s*\{[^}]*computeReportSeverity[^}]*\}\s*from\s*"@\/lib\/diagnostics"/);
  const commit = readFileSync(new URL("../lib/diagnostic-report-commit.ts", import.meta.url), "utf8");
  assert.equal((commit.match(/maxSeverity:\s*baseWrite\.maxSeverity/g) ?? []).length, 2, "both create paths must store maxSeverity");
});

// --- Source-pattern: isOrderLocked/canFillDiagnostics replace the old inline check

test("reports/route.ts imports isOrderLocked and canFillDiagnostics from @/lib/orders", () => {
  const { full } = reportsRouteSections();
  assert.match(full, /import\s*\{[^}]*canFillDiagnostics[^}]*isOrderLocked[^}]*\}\s*from\s*"@\/lib\/orders"|import\s*\{[^}]*isOrderLocked[^}]*canFillDiagnostics[^}]*\}\s*from\s*"@\/lib\/orders"/);
});

test("reports/route.ts no longer hand-rolls the order.status !== \"IN_PROGRESS\" check anywhere", () => {
  const { full } = reportsRouteSections();
  assert.doesNotMatch(full, /!==\s*"IN_PROGRESS"/, "every order-status check must go through isOrderLocked/canFillDiagnostics");
});

test("reports/route.ts actually invokes both isOrderLocked(...) and canFillDiagnostics(...), not just imports them", () => {
  const { full } = reportsRouteSections();
  assert.match(full, /isOrderLocked\(/);
  assert.match(full, /canFillDiagnostics\(/);
  // Real behavior sanity on the two helpers themselves, exercised with the
  // same OrderStatus values the route now branches on.
  assert.equal(isOrderLocked("COMPLETED"), true);
  assert.equal(isOrderLocked("CANCELLED"), true);
  assert.equal(isOrderLocked("IN_PROGRESS"), false);
  assert.equal(canFillDiagnostics("IN_PROGRESS"), true);
  assert.equal(canFillDiagnostics("SCHEDULED"), false);
  assert.equal(canFillDiagnostics("COMPLETED"), false);
});

// --- Source-pattern: reports/[id]/route.ts GET gate + DELETE unchanged + ServiceItem reset

test("GET /api/v1/diagnostics/reports/[id] gates on diagnostics.view before the Prisma read", () => {
  const { get } = reportDetailRouteSections();
  const permCheck = get.indexOf('requirePermission(auth.user, "diagnostics.view")');
  const findFirst = get.indexOf("prisma.diagnosticReport.findFirst");
  assert.ok(permCheck >= 0, "GET must call requirePermission(auth.user, \"diagnostics.view\")");
  assert.ok(findFirst > permCheck, "permission check must precede the Prisma read");
  assert.match(get, /id,\s*\n\s*tenantId:\s*auth\.user\.tenantId/, "GET must look up the report by id AND tenantId together");
});

test("DELETE /api/v1/diagnostics/reports/[id] keeps its existing canDelete-or-filledBy check unchanged, with no added diagnostics.delete gate", () => {
  const { del } = reportDetailRouteSections();
  assert.match(
    del,
    /canDelete\(auth\.user,\s*"diagnostics"\)\s*\|\|\s*report\.filledById\s*===\s*auth\.user\.id/,
    "the existing owner-or-filler check must remain exactly as-is",
  );
  assert.doesNotMatch(
    del,
    /requirePermission\(auth\.user,\s*"diagnostics\.delete"\)/,
    "no redundant diagnostics.delete gate may be layered on top",
  );
});

test("DELETE resets the linked ServiceItem to PENDING inside the same transaction as the report delete", () => {
  const { del } = reportDetailRouteSections();
  const findLinked = del.indexOf("prisma.serviceItem.findUnique");
  const txStart = del.indexOf("prisma.$transaction");
  assert.ok(findLinked >= 0, "DELETE must look up the linked ServiceItem by diagnosticReportId");
  assert.match(del, /where:\s*\{\s*diagnosticReportId:\s*report\.id\s*\}/);
  assert.ok(txStart > findLinked, "the linked item must be looked up before the transaction");
  const txBody = del.slice(txStart);
  assert.match(txBody, /tx\.diagnosticReport\.delete\(\{\s*where:\s*\{\s*id:\s*report\.id\s*\}\s*\}\)/);
  assert.match(txBody, /tx\.serviceItem\.update/);
  assert.match(
    txBody,
    /data:\s*\{\s*status:\s*"PENDING",\s*startedAt:\s*null,\s*completedAt:\s*null\s*\}/,
    "the reset must mirror deleteReportAction's transaction shape exactly",
  );
});

// --- Source-pattern: templates routes gate on diagnostics.view

test("GET /api/v1/diagnostics/templates gates on diagnostics.view before the query, tenant-scoped", () => {
  const source = templatesRouteSource();
  const permCheck = source.indexOf('requirePermission(auth.user, "diagnostics.view")');
  const findMany = source.indexOf("prisma.diagnosticTemplate.findMany");
  assert.ok(permCheck >= 0, "GET must call requirePermission(auth.user, \"diagnostics.view\")");
  assert.ok(findMany > permCheck, "permission check must precede the Prisma read");
  assert.match(source, /tenantVisibleTemplateWhere\(auth\.user\.tenantId\)/);
});

test("GET /api/v1/diagnostics/templates/[id] gates on diagnostics.view before the Prisma read, tenant-scoped", () => {
  const source = templateDetailRouteSource();
  const permCheck = source.indexOf('requirePermission(auth.user, "diagnostics.view")');
  const findFirst = source.indexOf("prisma.diagnosticTemplate.findFirst");
  assert.ok(permCheck >= 0, "GET must call requirePermission(auth.user, \"diagnostics.view\")");
  assert.ok(findFirst > permCheck, "permission check must precede the Prisma read");
  // Tenant-scoped via tenantVisibleTemplateWhere (own templates + system
  // defaults readable by every tenant), combined with the id in an AND.
  assert.match(
    source,
    /where:\s*\{\s*AND:\s*\[\s*\{\s*id\s*\},\s*tenantVisibleTemplateWhere\(auth\.user\.tenantId\)\s*\]\s*\}/,
  );
});

// --- Wiring sanity: every touched handler authenticates before authorizing

test("every touched GET/POST handler calls requireApiUser and early-returns before its permission check", () => {
  const { get: reportsGet, post: reportsPost } = reportsRouteSections();
  const { get: reportGet } = reportDetailRouteSections();
  const templatesGet = templatesRouteSource();
  const templateGet = templateDetailRouteSource();
  for (const section of [reportsGet, reportsPost, reportGet, templatesGet, templateGet]) {
    const authIdx = section.indexOf("requireApiUser(req)");
    const earlyReturn = section.indexOf("if (auth.response) return auth.response;");
    const permIdx = section.indexOf("requirePermission(auth.user,");
    assert.ok(authIdx >= 0, "must call requireApiUser(req)");
    assert.ok(earlyReturn > authIdx, "must early-return auth.response");
    assert.ok(permIdx > earlyReturn, "permission check must come after the auth early-return");
  }
});
