import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { before, test } from "node:test";
import type { ApiUser } from "../lib/auth/api-token";

// `app/api/v1/services/[id]/route.ts`, `.../[id]/stock/route.ts` and
// `.../bulk/category/route.ts` transitively import `lib/subscription-server.ts`,
// which does `import "server-only"`. That package is not a real dependency
// (Next's bundler resolves it specially at build time), so plain `tsx --test`
// module resolution cannot import any of the three route files directly — the
// same gap documented in `tests/services-route-permissions.test.ts` and
// `tests/customer-detail-routes.test.ts` for the sibling P3/P4 route slices.
//
// `lib/services/service-commands.ts` itself has no such import and is
// exercised directly and behaviorally below wherever the codepath does not
// require a live Postgres connection (this repo's Prisma client requires a
// real `adapter-pg` connection even to run a single query — there is no
// prisma-mocking convention anywhere in this tree; see
// `tests/customer-commands.test.ts`/`tests/vehicle-commands.test.ts`, which
// use the same split). Per the P0-B1 idiom ("split the pure decision from the
// DB lookup so it is unit-testable without a Postgres connection"), the four
// commands' actual decision logic — whole-record-replace validation,
// archive-vs-hard-delete, directional stock adjustment with negative
// rejection, and per-item bulk category planning — is factored into pure,
// exported helpers (`validateServiceUpdateInput`, `decideServiceDeleteOutcome`,
// `computeStockAdjustment`/`validateStockAdjustmentInput`,
// `planBulkCategoryChange`) that ARE covered with real runtime assertions
// below. What remains untested for the DB-connection reason above: the
// tenant-scoped existence checks (unit/duration-unit/category lookups), the
// P2002/not-found branches of the actual Prisma calls, and the audit-log
// writes — these are covered only structurally (source-pattern), same as
// every other command module in this tree.

process.env.DATABASE_URL ??= "postgresql://unused/unused";
process.env.SESSION_SECRET ??= "unit-test-placeholder-secret-value-not-real-00";

let commands: typeof import("../lib/services/service-commands");
let requirePermission: typeof import("../lib/api").requirePermission;
let hasPermission: typeof import("../lib/auth/roles").hasPermission;
let Decimal: typeof import("../app/generated/prisma/client").Prisma.Decimal;

before(async () => {
  let apiModule: typeof import("../lib/api");
  let rolesModule: typeof import("../lib/auth/roles");
  let prismaClientModule: typeof import("../app/generated/prisma/client");
  [commands, apiModule, rolesModule, prismaClientModule] = await Promise.all([
    import("../lib/services/service-commands"),
    import("../lib/api"),
    import("../lib/auth/roles"),
    import("../app/generated/prisma/client"),
  ]);
  requirePermission = apiModule.requirePermission;
  hasPermission = rolesModule.hasPermission;
  Decimal = prismaClientModule.Prisma.Decimal;
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

// ============================================================================
// 1. Whole-record-replace vs. partial-update decision — validated explicitly
// ============================================================================
//
// P4-B1 decided PATCH /api/v1/services/[id] is WHOLE-RECORD REPLACE, matching
// PATCH /customers/[id] and PATCH /vehicles/[id]: a missing/absent required
// field is validated exactly as it would be on create — never silently kept
// at its old DB value the way a true partial-patch would. These tests prove
// that decision is what the code actually does, not just what the doc
// comment claims.

test("whole-record-replace: a missing required field (name) fails validation exactly as on create — never silently retained", () => {
  const base = {
    type: "LABOR",
    name: "",
    unitId: "unit-1",
    price: "1000",
    categoryId: "cat-1",
  };
  const { fieldErrors } = commands.validateServiceUpdateInput(base);
  assert.equal(fieldErrors.name, "Нэр оруулна уу.");
});

test("whole-record-replace: categoryId is mandatory on every update, regardless of kind", () => {
  for (const type of ["LABOR", "GOODS"]) {
    const { fieldErrors } = commands.validateServiceUpdateInput({
      type,
      name: "X",
      unitId: "unit-1",
      price: "10",
      categoryId: "",
    });
    assert.equal(fieldErrors.categoryId, "Ангилал сонгоно уу.", `type=${type}`);
  }
});

test("whole-record-replace: unitId is required for LABOR/GOODS but not for DIAGNOSTIC", () => {
  const labor = commands.validateServiceUpdateInput({
    type: "LABOR",
    name: "X",
    unitId: "",
    price: "10",
    categoryId: "cat-1",
  });
  assert.equal(labor.fieldErrors.unitId, "Хэмжих нэгж сонгоно уу.");

  const diagnostic = commands.validateServiceUpdateInput(
    { type: "DIAGNOSTIC", name: "X", unitId: "", price: "10", categoryId: "cat-1" },
    { allowedKinds: ["LABOR", "GOODS", "DIAGNOSTIC"] },
  );
  assert.equal(diagnostic.fieldErrors.unitId, undefined);
});

test("whole-record-replace: price is required and must parse as a non-negative decimal", () => {
  const missing = commands.validateServiceUpdateInput({
    type: "LABOR", name: "X", unitId: "u1", price: "", categoryId: "c1",
  });
  assert.equal(missing.fieldErrors.price, "Үнэ буруу.");

  const negative = commands.validateServiceUpdateInput({
    type: "LABOR", name: "X", unitId: "u1", price: "-5", categoryId: "c1",
  });
  assert.equal(negative.fieldErrors.price, "Үнэ буруу.");

  const ok = commands.validateServiceUpdateInput({
    type: "LABOR", name: "X", unitId: "u1", price: "1500.50", categoryId: "c1",
  });
  assert.equal(ok.fieldErrors.price, undefined);
  assert.equal(ok.data.price.toString(), "1500.5");
});

test("allowedKinds defaults to LABOR/GOODS (the web action's existing behaviour) — DIAGNOSTIC is rejected unless the caller widens it", () => {
  const defaulted = commands.validateServiceUpdateInput({
    type: "DIAGNOSTIC", name: "X", price: "10", categoryId: "c1",
  });
  assert.equal(defaulted.fieldErrors.type, "Төрлийг сонгоно уу.");

  const widened = commands.validateServiceUpdateInput(
    { type: "DIAGNOSTIC", name: "X", price: "10", categoryId: "c1" },
    { allowedKinds: ["LABOR", "GOODS", "DIAGNOSTIC"] },
  );
  assert.equal(widened.fieldErrors.type, undefined);
});

test("stock is validated when the kind is GOODS (a malformed value still rejects the update) but the module never persists it — see doc comment", () => {
  const badStock = commands.validateServiceUpdateInput({
    type: "GOODS", name: "X", unitId: "u1", price: "10", categoryId: "c1", stock: "not-a-number",
  });
  assert.equal(badStock.fieldErrors.stock, "Үлдэгдэл буруу.");

  const blankStockDefaultsToZero = commands.validateServiceUpdateInput({
    type: "GOODS", name: "X", unitId: "u1", price: "10", categoryId: "c1",
  });
  assert.equal(blankStockDefaultsToZero.fieldErrors.stock, undefined);

  // Structural proof stock is excluded from the write payload.
  const commandSource = src("../lib/services/service-commands.ts");
  const start = commandSource.indexOf("export async function updateServiceCommand");
  const end = commandSource.indexOf("// --- delete");
  const body = commandSource.slice(start, end);
  assert.doesNotMatch(body, /stock:\s*data\.stock/, "updateServiceCommand must never write data.stock");
});

test("type is accepted but never written on update — same immutable-but-returned shape as vehicle-commands' plate", () => {
  const commandSource = src("../lib/services/service-commands.ts");
  const start = commandSource.indexOf("export async function updateServiceCommand");
  const end = commandSource.indexOf("// --- delete");
  const body = commandSource.slice(start, end);
  assert.doesNotMatch(body, /type:\s*data\.type/, "the Prisma update payload must not include type");
  assert.match(body, /return \{ id: serviceId, \.\.\.data \};/, "the returned record still carries the (unpersisted) type back to the caller");
});

// ============================================================================
// 2. Archive-vs-hard-delete — both branches
// ============================================================================

test("decideServiceDeleteOutcome archives when the service has order-item history", () => {
  assert.equal(commands.decideServiceDeleteOutcome(1), "archived");
  assert.equal(commands.decideServiceDeleteOutcome(5), "archived");
});

test("decideServiceDeleteOutcome hard-deletes when the service has no order-item history", () => {
  assert.equal(commands.decideServiceDeleteOutcome(0), "deleted");
});

test("deleteServiceCommand's body branches archive vs. hard-delete exactly on decideServiceDeleteOutcome, and never both", () => {
  const commandSource = src("../lib/services/service-commands.ts");
  const start = commandSource.indexOf("export async function deleteServiceCommand");
  const body = commandSource.slice(start);
  assert.match(body, /const outcome = decideServiceDeleteOutcome\(svc\._count\.items\);/);
  assert.match(body, /if \(outcome === "archived"\) \{/);
  assert.match(body, /prisma\.service\.update\(\{\s*where:\s*\{\s*id:\s*serviceId\s*\},\s*data:\s*\{\s*isActive:\s*false\s*\}/);
  assert.match(body, /prisma\.service\.delete\(\{\s*where:\s*\{\s*id:\s*serviceId\s*\}\s*\}\)/);
});

// ============================================================================
// 3. Stock adjustment — in/out and negative rejection
// ============================================================================

test("computeStockAdjustment adds for 'in'", () => {
  const result = commands.computeStockAdjustment(new Decimal(10), "in", new Decimal(5));
  assert.ok(result.ok);
  if (result.ok) assert.equal(result.next.toString(), "15");
});

test("computeStockAdjustment subtracts for 'out'", () => {
  const result = commands.computeStockAdjustment(new Decimal(10), "out", new Decimal(4));
  assert.ok(result.ok);
  if (result.ok) assert.equal(result.next.toString(), "6");
});

test("computeStockAdjustment rejects a resulting negative balance rather than clamping to zero", () => {
  const result = commands.computeStockAdjustment(new Decimal(3), "out", new Decimal(5));
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.match(result.fieldErrors.amount, /Үлдэгдэл сөрөг болж байна/);
    assert.match(result.fieldErrors.amount, /Одоо: 3/);
  }
});

test("computeStockAdjustment allows the balance to land exactly on zero", () => {
  const result = commands.computeStockAdjustment(new Decimal(5), "out", new Decimal(5));
  assert.ok(result.ok);
  if (result.ok) assert.equal(result.next.toString(), "0");
});

test("validateStockAdjustmentInput requires a positive amount", () => {
  const zero = commands.validateStockAdjustmentInput({ direction: "in", amount: "0" });
  assert.equal(zero.data, null);
  assert.equal(zero.fieldErrors.amount, "Эерэг тоо оруулна уу.");

  const negative = commands.validateStockAdjustmentInput({ direction: "in", amount: "-1" });
  assert.equal(negative.data, null);

  const ok = commands.validateStockAdjustmentInput({ direction: "in", amount: "3" });
  assert.notEqual(ok.data, null);
});

test("validateStockAdjustmentInput requires direction to be exactly 'in' or 'out'", () => {
  const bad = commands.validateStockAdjustmentInput({ direction: "sideways", amount: "3" });
  assert.equal(bad.data, null);
  assert.equal(bad.fieldErrors.direction, "Чиглэлийг сонгоно уу.");

  const inOk = commands.validateStockAdjustmentInput({ direction: "in", amount: "3" });
  assert.notEqual(inOk.data, null);
  const outOk = commands.validateStockAdjustmentInput({ direction: "out", amount: "3" });
  assert.notEqual(outOk.data, null);
});

test("adjustServiceStockCommand's Prisma read is GOODS-only and tenant-scoped", () => {
  const commandSource = src("../lib/services/service-commands.ts");
  const start = commandSource.indexOf("export async function adjustServiceStockCommand");
  const body = commandSource.slice(start);
  assert.match(
    body,
    /prisma\.service\.findFirst\(\{\s*where:\s*\{\s*id:\s*serviceId,\s*tenantId:\s*actor\.tenantId,\s*type:\s*"GOODS"/,
    "the lookup must scope by id, tenantId AND type:GOODS together",
  );
});

// ============================================================================
// 4. Bulk category — per-item success and per-item failure in the same batch
// ============================================================================

test("planBulkCategoryChange: unmatched id fails, differing-category id updates, same-category id is a no-op success (skip)", () => {
  const services = [
    { id: "s1", name: "Тос", code: "OIL-1", categoryId: "cat-old" },
    { id: "s2", name: "Шүүлтүүр", code: null, categoryId: "cat-target" },
  ];
  const plans = commands.planBulkCategoryChange(["s1", "s2", "missing-id"], services, "cat-target");

  assert.deepEqual(
    plans.map((p) => p.action),
    ["update", "skip", "fail"],
  );
  const failed = plans.find((p) => p.action === "fail");
  assert.ok(failed && failed.action === "fail");
  if (failed.action === "fail") assert.equal(failed.message, "Олдсонгүй.");
});

test("planBulkCategoryChange labels a failed id with its code+name when known, and with the bare id when unknown", () => {
  const services = [{ id: "s1", name: "Тос", code: "OIL-1", categoryId: "cat-old" }];
  const plans = commands.planBulkCategoryChange(["s1", "ghost"], services, "cat-new");
  const updatePlan = plans.find((p) => p.id === "s1");
  assert.equal(updatePlan?.label, "OIL-1 · Тос");
  const failPlan = plans.find((p) => p.id === "ghost");
  assert.equal(failPlan?.label, "ghost");
});

test("planBulkCategoryChange processes duplicate requested ids independently (matches the original non-deduplicating loop)", () => {
  const services = [{ id: "s1", name: "Тос", code: null, categoryId: "cat-old" }];
  const plans = commands.planBulkCategoryChange(["s1", "s1"], services, "cat-new");
  assert.equal(plans.length, 2);
  assert.ok(plans.every((p) => p.action === "update"));
});

test("a missing/empty categoryId is a whole-request rejection, not a per-item failure — bulkChangeServiceCategoryCommand throws before any per-item planning", () => {
  const commandSource = src("../lib/services/service-commands.ts");
  const start = commandSource.indexOf("export async function bulkChangeServiceCategoryCommand");
  const planIdx = commandSource.indexOf("planBulkCategoryChange(", start);
  const categoryCheckIdx = commandSource.indexOf('throw new ServiceCommandError("Ангилал сонгоно уу."', start);
  assert.ok(categoryCheckIdx > start && categoryCheckIdx < planIdx, "the empty-categoryId rejection must precede any per-item planning");
});

test("BulkCategoryChangeResult tallies succeeded (update+skip) vs failed (fail) — never all-or-nothing", () => {
  const services = [
    { id: "s1", name: "A", code: null, categoryId: "cat-old" },
    { id: "s2", name: "B", code: null, categoryId: "cat-target" },
  ];
  const plans = commands.planBulkCategoryChange(["s1", "s2", "missing"], services, "cat-target");
  const succeeded = plans.filter((p) => p.action !== "fail").length;
  const failed = plans.filter((p) => p.action === "fail").length;
  assert.equal(succeeded, 2);
  assert.equal(failed, 1);
});

// ============================================================================
// 5. ServiceCommandError shape
// ============================================================================

test("ServiceCommandError carries a status, machine code and optional fieldErrors, defaulting to 422/SERVICE_COMMAND_REJECTED", () => {
  const withDefaults = new commands.ServiceCommandError("msg");
  assert.equal(withDefaults.status, 422);
  assert.equal(withDefaults.code, "SERVICE_COMMAND_REJECTED");
  assert.ok(withDefaults instanceof Error);

  const explicit = new commands.ServiceCommandError("msg", 404, "SERVICE_NOT_FOUND");
  assert.equal(explicit.status, 404);
  assert.equal(explicit.code, "SERVICE_NOT_FOUND");
  assert.equal(explicit.fieldErrors, undefined);
});

// ============================================================================
// 6. Permission gates — behavioral, real requirePermission/hasPermission calls
// ============================================================================

test("services.edit permission-denied for a role lacking the code, positive for a role with it, owner bypass", () => {
  const denied = user({ permissions: ["services.view"] });
  assert.notEqual(requirePermission(denied, "services.edit"), null);
  const granted = user({ permissions: ["services.edit"] });
  assert.equal(requirePermission(granted, "services.edit"), null);
  const owner = user({ isOwner: true, permissions: [] });
  assert.equal(hasPermission(owner, "services.edit"), true);
});

test("services.delete permission-denied for a role lacking the code, positive for a role with it, owner bypass", () => {
  const denied = user({ permissions: ["services.edit"] });
  assert.notEqual(requirePermission(denied, "services.delete"), null);
  const granted = user({ permissions: ["services.delete"] });
  assert.equal(requirePermission(granted, "services.delete"), null);
  const owner = user({ isOwner: true, permissions: [] });
  assert.equal(hasPermission(owner, "services.delete"), true);
});

// ============================================================================
// 7. Route wiring — source-pattern (server-only import barrier, see header)
// ============================================================================

function detailRouteSections() {
  const source = src("../app/api/v1/services/[id]/route.ts");
  const getStart = source.indexOf("export async function GET");
  const patchStart = source.indexOf("export async function PATCH");
  const deleteStart = source.indexOf("export async function DELETE");
  assert.ok(getStart >= 0 && patchStart > getStart && deleteStart > patchStart);
  return {
    full: source,
    get: source.slice(getStart, patchStart),
    patch: source.slice(patchStart, deleteStart),
    del: source.slice(deleteStart),
  };
}

test("PATCH /services/[id] gates on services.edit, then subscription, before parsing the body, and delegates to updateServiceCommand", () => {
  const { patch } = detailRouteSections();
  const permIdx = patch.indexOf('requirePermission(auth.user, "services.edit")');
  const subIdx = patch.indexOf("requireActiveSubscriptionApi(auth.user)");
  const bodyIdx = patch.indexOf("req.json()");
  const commandIdx = patch.indexOf("updateServiceCommand(");
  assert.ok(permIdx >= 0, "PATCH must check services.edit");
  assert.ok(subIdx > permIdx, "subscription check must run after the permission check");
  assert.ok(bodyIdx > subIdx, "body parsing must happen after both gates");
  assert.ok(commandIdx > bodyIdx, "PATCH must delegate to updateServiceCommand");
  assert.doesNotMatch(patch, /prisma\.service\.(update|updateMany)\(/, "PATCH must not write prisma.service directly — only the command may");
});

test("DELETE /services/[id] gates on services.delete, then subscription, and delegates to deleteServiceCommand", () => {
  const { del } = detailRouteSections();
  const permIdx = del.indexOf('requirePermission(auth.user, "services.delete")');
  const subIdx = del.indexOf("requireActiveSubscriptionApi(auth.user)");
  const commandIdx = del.indexOf("deleteServiceCommand(");
  assert.ok(permIdx >= 0, "DELETE must check services.delete");
  assert.ok(subIdx > permIdx, "subscription check must run after the permission check");
  assert.ok(commandIdx > subIdx, "DELETE must delegate to deleteServiceCommand");
  assert.doesNotMatch(del, /prisma\.service\.delete\(/, "DELETE must not delete prisma.service directly — only the command may");
});

test("GET /services/[id] is untouched by this slice — still no subscription gate, still services.view", () => {
  const { get } = detailRouteSections();
  assert.match(get, /requirePermission\(auth\.user, "services\.view"\)/);
  assert.doesNotMatch(get, /requireActiveSubscriptionApi/);
});

test("POST /services/[id]/stock gates on services.edit, then subscription, and delegates to adjustServiceStockCommand", () => {
  const source = src("../app/api/v1/services/[id]/stock/route.ts");
  const permIdx = source.indexOf('requirePermission(auth.user, "services.edit")');
  const subIdx = source.indexOf("requireActiveSubscriptionApi(auth.user)");
  const commandIdx = source.indexOf("adjustServiceStockCommand(");
  assert.ok(permIdx >= 0);
  assert.ok(subIdx > permIdx);
  assert.ok(commandIdx > subIdx);
  assert.doesNotMatch(source, /prisma\./, "the stock route must never touch prisma directly");
});

test("POST /services/bulk/category gates on services.edit, then subscription, and delegates to bulkChangeServiceCategoryCommand", () => {
  const source = src("../app/api/v1/services/bulk/category/route.ts");
  const permIdx = source.indexOf('requirePermission(auth.user, "services.edit")');
  const subIdx = source.indexOf("requireActiveSubscriptionApi(auth.user)");
  const commandIdx = source.indexOf("bulkChangeServiceCategoryCommand(");
  assert.ok(permIdx >= 0);
  assert.ok(subIdx > permIdx);
  assert.ok(commandIdx > subIdx);
  assert.doesNotMatch(source, /prisma\./, "the bulk/category route must never touch prisma directly");
});

test("all four new/extended handlers require an authenticated ApiUser before any permission check", () => {
  const { patch, del } = detailRouteSections();
  const stock = src("../app/api/v1/services/[id]/stock/route.ts");
  const bulk = src("../app/api/v1/services/bulk/category/route.ts");
  for (const section of [patch, del, stock, bulk]) {
    const authIdx = section.indexOf("requireApiUser(req)");
    const earlyReturn = section.indexOf("if (auth.response) return auth.response;");
    const permIdx = section.indexOf("requirePermission(auth.user,");
    assert.ok(authIdx >= 0, "must call requireApiUser(req)");
    assert.ok(earlyReturn > authIdx, "must early-return auth.response");
    assert.ok(permIdx > earlyReturn, "permission check must come after the auth early-return");
  }
});

// ============================================================================
// 8. Tenant scoping — every command's Prisma call stays scoped by tenantId
// ============================================================================

test("every prisma.service/category/unit call inside the command module is tenant-scoped", () => {
  const commandSource = src("../lib/services/service-commands.ts");
  // Each of these calls must carry tenantId somewhere in its where-clause;
  // the only exceptions are writes keyed by an already-tenant-verified id
  // (service.update/service.delete by primary key, after a tenant-scoped
  // findFirst/updateMany already proved ownership).
  assert.match(commandSource, /prisma\.service\.updateMany\(\{\s*where:\s*\{\s*id:\s*serviceId,\s*tenantId:\s*actor\.tenantId/);
  assert.match(commandSource, /prisma\.service\.findFirst\(\{\s*where:\s*\{\s*id:\s*serviceId,\s*tenantId:\s*actor\.tenantId\s*\}/);
  assert.match(commandSource, /prisma\.service\.findFirst\(\{\s*where:\s*\{\s*id:\s*serviceId,\s*tenantId:\s*actor\.tenantId,\s*type:\s*"GOODS"/);
  // Өөрийн эсвэл системийн (tenantId null, бүх тенантад нийтлэг) ангилал — өөр тенантынх хэзээ ч биш.
  assert.match(commandSource, /prisma\.category\.findFirst\(\{\s*where:\s*\{\s*id:\s*categoryId,\s*OR:\s*\[\{\s*tenantId:\s*actor\.tenantId\s*\},\s*\{\s*tenantId:\s*null\s*\}\]\s*\}/);
  assert.match(commandSource, /prisma\.service\.findMany\(\{\s*where:\s*\{\s*id:\s*\{\s*in:\s*ids\s*\},\s*tenantId:\s*actor\.tenantId/);
});

// ============================================================================
// 9. Adapter delegation — app/_actions/services.ts's four exports
// ============================================================================

test("the four web actions delegate to the shared commands and no longer implement update/delete/stock/bulk logic inline", () => {
  const actions = src("../app/_actions/services.ts");

  const updateStart = actions.indexOf("export async function updateServiceAction");
  const deleteStart = actions.indexOf("export async function deleteServiceAction");
  const stockStart = actions.indexOf("export async function adjustServiceStockAction");
  const bulkStart = actions.indexOf("export async function bulkChangeServiceCategoryAction");
  assert.ok(updateStart >= 0 && deleteStart > updateStart && stockStart > deleteStart && bulkStart > stockStart);

  const updateBody = actions.slice(updateStart, deleteStart);
  assert.match(updateBody, /updateServiceCommand\(\{/);
  assert.doesNotMatch(updateBody, /prisma\.service\.(update|updateMany)\(/);

  const deleteBody = actions.slice(deleteStart, stockStart);
  assert.match(deleteBody, /deleteServiceCommand\(\{/);
  assert.doesNotMatch(deleteBody, /prisma\.service\.(delete|update|findFirst)\(/);

  const stockBody = actions.slice(stockStart, bulkStart);
  assert.match(stockBody, /adjustServiceStockCommand\(\{/);
  assert.doesNotMatch(stockBody, /prisma\.service\.(update|findFirst)\(/);

  const bulkBody = actions.slice(bulkStart);
  assert.match(bulkBody, /bulkChangeServiceCategoryCommand\(\{/);
  assert.doesNotMatch(bulkBody, /prisma\.(service|category)\./);
});

test("createServiceAction delegates to the shared create rules + command (also used by the Excel import)", () => {
  const actions = src("../app/_actions/services.ts");
  const createStart = actions.indexOf("export async function createServiceAction");
  const updateStart = actions.indexOf("export async function updateServiceAction");
  const createBody = actions.slice(createStart, updateStart);
  assert.match(createBody, /validateServiceCreate\(raw, await loadServiceRefs\(user\.tenantId, raw\.type\)\)/);
  assert.match(createBody, /enforceCountLimit\(/);
  assert.match(createBody, /createServiceCommand\(user, data\)/);
  assert.doesNotMatch(createBody, /prisma\.service\.create\(/);
});
