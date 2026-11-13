import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { before, test } from "node:test";

// These route modules import `lib/auth/api-branch.ts` (for the async
// `resolveWorkingBranch`), which — like `tests/api-branch.test.ts` — pulls in
// `lib/prisma.ts` transitively (via `lib/api.ts` / `lib/employee-branch-lock.ts`),
// which throws at import time without DATABASE_URL/SESSION_SECRET. There is no
// database available in this environment, so every route handler here does
// real Prisma I/O once called and CANNOT be invoked in this suite. What we can
// verify without a DB:
//   1. Each importable route module still exposes exactly the HTTP method
//      handlers it's supposed to (a regression here would mean the
//      `resolveWorkingBranch` adoption broke the module shape, e.g. a typo'd
//      export or a thrown error during module evaluation).
//   2. The pure helpers introduced by the branch-scoping work —
//      `branchFilterConflicts` in app/api/v1/appointments/route.ts and
//      `branchListWhere` in app/api/v1/branches/route.ts — behave correctly
//      across their decision tables.
//
// We deliberately do NOT attempt to test `decideWorkingBranch`'s own behavior
// here — that is `tests/api-branch.test.ts`'s job (owned by a different slice,
// not to be duplicated) and it is not a file this slice owns.
//
// KNOWN GAP — `app/api/v1/orders/route.ts` and `app/api/v1/orders/[id]/route.ts`
// are deliberately NOT imported here. Both transitively import
// `lib/subscription-server.ts`, which does `import "server-only"`. That
// package is not installed as a project dependency (Next's bundler resolves
// it specially at build time; `server-only` doesn't even appear in
// package.json/package-lock.json) and plain Node module resolution under
// `tsx --test` cannot find it — confirmed: `Cannot find module 'server-only'`,
// pre-existing and unrelated to this slice's changes. This is an environment
// limitation, not something this slice could work around without either
// installing a real dependency or hand-rolling a module-resolution shim
// (out of scope, and outside the files this slice owns). There is therefore
// no way to write even a shape-only test for those two route files without a
// full Next.js runtime — reported here rather than silently dropped.
process.env.DATABASE_URL ??= "postgresql://unused/unused";
process.env.SESSION_SECRET ??= "unit-test-placeholder-secret-value-not-real-00";

let appointmentsRoute: typeof import("../app/api/v1/appointments/route");
let appointmentDetailRoute: typeof import("../app/api/v1/appointments/[id]/route");
let diagnosticsReportsRoute: typeof import("../app/api/v1/diagnostics/reports/route");
let diagnosticsReportDetailRoute: typeof import("../app/api/v1/diagnostics/reports/[id]/route");
let switchableRoute: typeof import("../app/api/v1/branches/switchable/route");
let branchesRoute: typeof import("../app/api/v1/branches/route");

before(async () => {
  [
    appointmentsRoute,
    appointmentDetailRoute,
    diagnosticsReportsRoute,
    diagnosticsReportDetailRoute,
    switchableRoute,
    branchesRoute,
  ] = await Promise.all([
    import("../app/api/v1/appointments/route"),
    import("../app/api/v1/appointments/[id]/route"),
    import("../app/api/v1/diagnostics/reports/route"),
    import("../app/api/v1/diagnostics/reports/[id]/route"),
    import("../app/api/v1/branches/switchable/route"),
    import("../app/api/v1/branches/route"),
  ]);
});

// --- Module shape: each importable route still exports its expected HTTP handlers ----

test("appointments/route.ts exports GET", () => {
  assert.equal(typeof appointmentsRoute.GET, "function");
});

test("appointments/[id]/route.ts exports PATCH", () => {
  assert.equal(typeof appointmentDetailRoute.PATCH, "function");
});

test("diagnostics/reports/route.ts exports GET and POST", () => {
  assert.equal(typeof diagnosticsReportsRoute.GET, "function");
  assert.equal(typeof diagnosticsReportsRoute.POST, "function");
});

test("diagnostic report creation guards linked orders before report creation", async () => {
  const source = await readFile(new URL("../app/api/v1/diagnostics/reports/route.ts", import.meta.url), "utf8");
  const orderRead = source.indexOf("status: true");
  const statusGuard = source.indexOf("canFillDiagnostics(orderStatus)");
  // Report creation moved into the shared atomic command (lib/diagnostic-report-commit.ts).
  const reportCreate = source.indexOf("commitDiagnosticReportCommand(");
  assert.ok(orderRead >= 0, "linked order read must include status");
  assert.ok(statusGuard > orderRead, "status guard must use the linked order status");
  assert.ok(reportCreate > statusGuard, "status guard must run before report creation");
  assert.match(source.slice(statusGuard, reportCreate), /ORDER_STATUS_INVALID/);
  assert.match(source, /if \(itemId\)[\s\S]*?canFillDiagnostics\(itemOrderStatus\)/);
  assert.match(source, /tenantVisibleTemplateWhere\(auth\.user\.tenantId\)/);
  assert.match(source, /DIAGNOSTIC_TEMPLATE_MISMATCH/);

  // The locked transaction now lives in lib/diagnostic-report-commit.ts: the route
  // finishes file work first, then hands everything to commitDiagnosticReportCommand.
  const upload = source.indexOf("collectValidatedReportData(formData, schema)");
  assert.ok(upload >= 0 && upload < reportCreate, "file work must finish before the commit command");
  assert.doesNotMatch(source, /prisma\.serviceItem\.update/);
  const commit = await readFile(new URL("../lib/diagnostic-report-commit.ts", import.meta.url), "utf8");
  assert.match(commit, /withOrderTransaction\(/, "linked commits run under the order lock");
  const lockedCreate = commit.indexOf("tx.diagnosticReport.create");
  const lockedLink = commit.indexOf("tx.serviceItem.update");
  assert.ok(lockedCreate >= 0 && lockedCreate < lockedLink, "item link must follow report creation on the same tx");
  assert.match(commit, /status: "COMPLETED",[\s\S]*?startedAt: startedAt \?\? completedAt,[\s\S]*?completedAt,/, "item completion keeps startedAt and sets completedAt");
});

test("diagnostics/reports/[id]/route.ts exports GET and DELETE", () => {
  assert.equal(typeof diagnosticsReportDetailRoute.GET, "function");
  assert.equal(typeof diagnosticsReportDetailRoute.DELETE, "function");
});

test("branches/switchable/route.ts exports GET", () => {
  assert.equal(typeof switchableRoute.GET, "function");
});

test("branches/route.ts exports GET", () => {
  assert.equal(typeof branchesRoute.GET, "function");
});

// --- branchListWhere (GET /branches eligibility and tenant scope) ----------

test("branchListWhere: owner sees all active branches in their tenant", () => {
  assert.deepEqual(
    branchesRoute.branchListWhere({
      tenantId: "tenant-a",
      isOwner: true,
      branchId: null,
      assignableBranchIds: ["branch-other"],
    }),
    { tenantId: "tenant-a", isActive: true },
  );
});

test("branchListWhere: assigned + assignable staff are restricted to eligible IDs", () => {
  assert.deepEqual(
    branchesRoute.branchListWhere({
      tenantId: "tenant-a",
      isOwner: false,
      branchId: "branch-a",
      assignableBranchIds: ["branch-b", "branch-a"],
    }),
    {
      tenantId: "tenant-a",
      isActive: true,
      id: { in: ["branch-a", "branch-b"] },
    },
  );
});

test("branchListWhere: floating staff with no eligible IDs see all active branches in their tenant", () => {
  assert.deepEqual(
    branchesRoute.branchListWhere({
      tenantId: "tenant-a",
      isOwner: false,
      branchId: null,
      assignableBranchIds: [],
    }),
    { tenantId: "tenant-a", isActive: true },
  );
});

test("branchListWhere: inactive branches are always excluded", () => {
  assert.equal(
    branchesRoute.branchListWhere({
      tenantId: "tenant-a",
      isOwner: true,
      branchId: null,
      assignableBranchIds: [],
    }).isActive,
    true,
  );
});

test("branchListWhere: eligibility cannot widen the tenant scope", () => {
  assert.deepEqual(
    branchesRoute.branchListWhere({
      tenantId: "tenant-a",
      isOwner: false,
      branchId: "branch-a",
      assignableBranchIds: ["branch-from-other-tenant"],
    }),
    {
      tenantId: "tenant-a",
      isActive: true,
      id: { in: ["branch-a", "branch-from-other-tenant"] },
    },
  );
});

// --- branchFilterConflicts (Task 2's header-vs-query-param precedence) ----

test("branchFilterConflicts: no header scope (owner / ALL) -> never conflicts, regardless of query param", () => {
  assert.equal(appointmentsRoute.branchFilterConflicts(null, undefined), false);
  assert.equal(appointmentsRoute.branchFilterConflicts(null, "branch-a"), false);
});

test("branchFilterConflicts: header scope present, no query param -> no conflict", () => {
  assert.equal(appointmentsRoute.branchFilterConflicts("branch-a", undefined), false);
});

test("branchFilterConflicts: header scope and query param agree -> no conflict", () => {
  assert.equal(appointmentsRoute.branchFilterConflicts("branch-a", "branch-a"), false);
});

test("branchFilterConflicts: header scope and query param disagree -> conflict", () => {
  assert.equal(appointmentsRoute.branchFilterConflicts("branch-a", "branch-b"), true);
});
