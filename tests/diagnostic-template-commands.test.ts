import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { before, test } from "node:test";
import type { ApiUser } from "../lib/auth/api-token";

// P5-B1 — typed create/update/delete/duplicate command set for
// DiagnosticTemplate (`lib/diagnostics-templates-server.ts`) plus the four
// new/extended routes that delegate to it
// (`app/api/v1/diagnostics/templates/route.ts` POST,
// `.../templates/[id]/route.ts` PATCH/DELETE,
// `.../templates/[id]/duplicate/route.ts` POST).
//
// Same split every sibling command-module test in this tree uses (see
// `tests/service-commands.test.ts`, `tests/diagnostic-routes-security.test.ts`):
// this repo's Prisma client needs a live `adapter-pg` connection even for a
// single query, and there is no prisma-mocking convention anywhere in this
// tree. So:
//   - the actual decisions are pure, exported helpers
//     (`validateTemplateInput`, `decideTemplateDeleteOutcome`, `schemaEqual`,
//     `decideVersionBump`) and are exercised BEHAVIORALLY below;
//   - permission-gate behaviour is exercised BEHAVIORALLY against the real
//     `requirePermission`/`hasPermission` primitives each route calls;
//   - everything that requires a live DB read (system-default immutability,
//     archive-vs-hard-delete wiring, plan-limit/feature-flag gating on
//     create+duplicate, category tenant-scoping, route gate ordering, and
//     cross-tenant scoping) is asserted STRUCTURALLY (source-pattern)
//     against the real module/route source — the same proxy
//     `tests/service-commands.test.ts` and `tests/diagnostic-routes-security.test.ts`
//     use for this exact gap.

process.env.DATABASE_URL ??= "postgresql://unused/unused";
process.env.SESSION_SECRET ??= "unit-test-placeholder-secret-value-not-real-00";

let commands: typeof import("../lib/diagnostics-templates-server");
let requirePermission: typeof import("../lib/api").requirePermission;
let hasPermission: typeof import("../lib/auth/roles").hasPermission;

before(async () => {
  let apiModule: typeof import("../lib/api");
  let rolesModule: typeof import("../lib/auth/roles");
  [commands, apiModule, rolesModule] = await Promise.all([
    import("../lib/diagnostics-templates-server"),
    import("../lib/api"),
    import("../lib/auth/roles"),
  ]);
  requirePermission = apiModule.requirePermission;
  hasPermission = rolesModule.hasPermission;
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

function validSchema() {
  return {
    sections: [
      {
        id: "sec1",
        title: "Үндсэн үзлэг",
        items: [{ id: "item1", label: "Тормоз", type: "check", required: false }],
      },
    ],
  };
}

// ============================================================================
// 1. validateTemplateInput — structural validation
// ============================================================================

test("validateTemplateInput requires a non-empty name", () => {
  const { fieldErrors } = commands.validateTemplateInput({
    name: "",
    type: "INTAKE",
    schema: validSchema(),
    categoryId: "cat-1",
  });
  assert.equal(fieldErrors.name, "Хуудасны нэрээ оруулна уу.");
});

test("validateTemplateInput requires type to be one of DIAGNOSTIC_TYPES", () => {
  const bad = commands.validateTemplateInput({
    name: "X",
    type: "NOT_A_TYPE",
    schema: validSchema(),
    categoryId: "cat-1",
  });
  assert.equal(bad.fieldErrors.type, "Төрлөө сонгоно уу.");

  const good = commands.validateTemplateInput({
    name: "X",
    type: "DAMAGE_REPORT",
    schema: validSchema(),
    categoryId: "cat-1",
  });
  assert.equal(good.fieldErrors.type, undefined);
});

test("validateTemplateInput requires categoryId to be present (existence/ownership is checked separately by assertCategory)", () => {
  const { fieldErrors } = commands.validateTemplateInput({
    name: "X",
    type: "INTAKE",
    schema: validSchema(),
    categoryId: "",
  });
  assert.equal(fieldErrors.categoryId, "Ангилал сонгоно уу.");
});

test("validateTemplateInput rejects an invalid schema shape and surfaces validateSchema's message", () => {
  const { fieldErrors } = commands.validateTemplateInput({
    name: "X",
    type: "INTAKE",
    schema: { sections: [] },
    categoryId: "cat-1",
  });
  assert.match(fieldErrors.schema ?? "", /хэсэг/);
});

test("validateTemplateInput accepts a valid schema with no schema field error", () => {
  const { fieldErrors, data } = commands.validateTemplateInput({
    name: "X",
    type: "INTAKE",
    schema: validSchema(),
    categoryId: "cat-1",
  });
  assert.equal(fieldErrors.schema, undefined);
  assert.equal(data.schema.sections.length, 1);
});

test("validateTemplateInput: price parses as a non-negative decimal when supplied, is optional (null) when omitted", () => {
  const omitted = commands.validateTemplateInput({
    name: "X", type: "INTAKE", schema: validSchema(), categoryId: "c1",
  });
  assert.equal(omitted.fieldErrors.price, undefined);
  assert.equal(omitted.data.price, null);

  const bad = commands.validateTemplateInput({
    name: "X", type: "INTAKE", schema: validSchema(), categoryId: "c1", price: "not-a-number",
  });
  assert.equal(bad.fieldErrors.price, "Үнэ буруу.");

  const negative = commands.validateTemplateInput({
    name: "X", type: "INTAKE", schema: validSchema(), categoryId: "c1", price: -5,
  });
  assert.equal(negative.fieldErrors.price, "Үнэ буруу.");

  const ok = commands.validateTemplateInput({
    name: "X", type: "INTAKE", schema: validSchema(), categoryId: "c1", price: "1500.5",
  });
  assert.equal(ok.fieldErrors.price, undefined);
  assert.equal(ok.data.price?.toString(), "1500.5");
});

test("validateTemplateInput: durationMin must be a non-negative integer when supplied, accepts both string and number input", () => {
  const bad = commands.validateTemplateInput({
    name: "X", type: "INTAKE", schema: validSchema(), categoryId: "c1", durationMin: "-1",
  });
  assert.equal(bad.fieldErrors.durationMin, "Хугацаа буруу.");

  const okString = commands.validateTemplateInput({
    name: "X", type: "INTAKE", schema: validSchema(), categoryId: "c1", durationMin: "30",
  });
  assert.equal(okString.fieldErrors.durationMin, undefined);
  assert.equal(okString.data.durationMin, 30);

  const okNumber = commands.validateTemplateInput({
    name: "X", type: "INTAKE", schema: validSchema(), categoryId: "c1", durationMin: 45,
  });
  assert.equal(okNumber.fieldErrors.durationMin, undefined);
  assert.equal(okNumber.data.durationMin, 45);
});

test("validateTemplateInput: isActive defaults to false when omitted", () => {
  const { data } = commands.validateTemplateInput({
    name: "X", type: "INTAKE", schema: validSchema(), categoryId: "c1",
  });
  assert.equal(data.isActive, false);
});

// ============================================================================
// 2. Archive-vs-hard-delete — both branches
// ============================================================================

test("decideTemplateDeleteOutcome archives when the template has report history", () => {
  assert.equal(commands.decideTemplateDeleteOutcome(1), "archived");
  assert.equal(commands.decideTemplateDeleteOutcome(5), "archived");
});

test("decideTemplateDeleteOutcome hard-deletes when the template has no report history", () => {
  assert.equal(commands.decideTemplateDeleteOutcome(0), "deleted");
});

test("deleteTemplateCommand's body branches archive vs. hard-delete exactly on decideTemplateDeleteOutcome, and never both", () => {
  const source = src("../lib/diagnostics-templates-server.ts");
  const start = source.indexOf("export async function deleteTemplateCommand");
  const body = source.slice(start);
  assert.match(body, /const outcome = decideTemplateDeleteOutcome\(t\._count\.reports\);/);
  assert.match(body, /if \(outcome === "archived"\) \{/);
  assert.match(
    body,
    /prisma\.diagnosticTemplate\.update\(\{\s*where:\s*\{\s*id:\s*templateId\s*\},\s*data:\s*\{\s*isActive:\s*false\s*\}/,
  );
  assert.match(body, /prisma\.diagnosticTemplate\.delete\(\{\s*where:\s*\{\s*id:\s*templateId\s*\}\s*\}\)/);
});

// ============================================================================
// 3. Version-bump only on schema-change-with-reports — all three cases
// ============================================================================

test("schemaEqual: identical schemas (including key order differences a real diff might introduce) — structural equality via JSON.stringify", () => {
  assert.equal(commands.schemaEqual(validSchema(), validSchema()), true);
  const changed = { ...validSchema(), sections: [{ ...validSchema().sections[0], title: "Өөр" }] };
  assert.equal(commands.schemaEqual(validSchema(), changed), false);
});

test("decideVersionBump: case 1 — no schema change never bumps, regardless of report count", () => {
  assert.equal(commands.decideVersionBump(false, 0), false);
  assert.equal(commands.decideVersionBump(false, 5), false);
});

test("decideVersionBump: case 2 — schema change with zero reports does not bump (nothing depends on the old shape yet)", () => {
  assert.equal(commands.decideVersionBump(true, 0), false);
});

test("decideVersionBump: case 3 — schema change WITH reports present bumps, preserving old reports' templateVersion reference", () => {
  assert.equal(commands.decideVersionBump(true, 1), true);
  assert.equal(commands.decideVersionBump(true, 10), true);
});

test("updateTemplateCommand computes schemaChanged/versionBumped via the pure helpers, not an inline re-implementation", () => {
  const source = src("../lib/diagnostics-templates-server.ts");
  const start = source.indexOf("export async function updateTemplateCommand");
  const end = source.indexOf("// --- delete", start);
  const body = source.slice(start, end);
  assert.match(body, /const schemaChanged = !schemaEqual\(existing\.schema, data\.schema\);/);
  assert.match(body, /const versionBumped = decideVersionBump\(schemaChanged, existing\._count\.reports\);/);
  assert.match(body, /version:\s*versionBumped \? existing\.version \+ 1 : existing\.version/);
});

// ============================================================================
// 4. System-default immutability — edit AND delete both rejected
// ============================================================================

test("updateTemplateCommand rejects isSystemDefault templates before writing anything", () => {
  const source = src("../lib/diagnostics-templates-server.ts");
  const start = source.indexOf("export async function updateTemplateCommand");
  const end = source.indexOf("// --- delete", start);
  const body = source.slice(start, end);
  const checkIdx = body.indexOf("existing.isSystemDefault");
  const throwIdx = body.indexOf("SYSTEM_DEFAULT_IMMUTABLE");
  const updateCallIdx = body.indexOf("prisma.diagnosticTemplate.update(");
  assert.ok(checkIdx >= 0, "must check existing.isSystemDefault");
  assert.ok(throwIdx > checkIdx, "must throw a SYSTEM_DEFAULT_IMMUTABLE error");
  assert.ok(updateCallIdx > throwIdx, "the isSystemDefault rejection must precede the write");
});

test("deleteTemplateCommand rejects isSystemDefault templates before archiving or deleting anything", () => {
  const source = src("../lib/diagnostics-templates-server.ts");
  const start = source.indexOf("export async function deleteTemplateCommand");
  const body = source.slice(start);
  const checkIdx = body.indexOf("t.isSystemDefault");
  const throwIdx = body.indexOf("SYSTEM_DEFAULT_IMMUTABLE");
  const outcomeIdx = body.indexOf("decideTemplateDeleteOutcome(");
  assert.ok(checkIdx >= 0, "must check t.isSystemDefault");
  assert.ok(throwIdx > checkIdx, "must throw a SYSTEM_DEFAULT_IMMUTABLE error");
  assert.ok(outcomeIdx > throwIdx, "the isSystemDefault rejection must precede the archive/delete decision");
});

// ============================================================================
// 5. Plan-limit + feature-flag rejection on BOTH create and duplicate
// ============================================================================

function commandBody(fnName: string, endMarker: string) {
  const source = src("../lib/diagnostics-templates-server.ts");
  const start = source.indexOf(`export async function ${fnName}`);
  const end = source.indexOf(endMarker, start);
  assert.ok(start >= 0 && end > start, `${fnName} must exist and precede "${endMarker}"`);
  return source.slice(start, end);
}

test("createTemplateCommand checks ENABLE_DIAGNOSTICS then MAX_DIAGNOSTIC_TEMPLATES before creating the row", () => {
  const body = commandBody("createTemplateCommand", "export async function updateTemplateCommand");
  const featureIdx = body.indexOf("isFeatureEnabled(actor.tenantId, PLAN_LIMIT_CODES.ENABLE_DIAGNOSTICS)");
  const limitIdx = body.indexOf("enforceCountLimit(");
  const limitCodeIdx = body.indexOf("PLAN_LIMIT_CODES.MAX_DIAGNOSTIC_TEMPLATES");
  const createIdx = body.indexOf("prisma.diagnosticTemplate.create(");
  assert.ok(featureIdx >= 0, "must check ENABLE_DIAGNOSTICS");
  assert.ok(limitIdx > featureIdx, "must check the count limit after the feature flag");
  assert.ok(limitCodeIdx > limitIdx, "the count limit must use MAX_DIAGNOSTIC_TEMPLATES");
  assert.ok(createIdx > limitCodeIdx, "both gates must precede the actual create");
});

test("duplicateTemplateCommand checks ENABLE_DIAGNOSTICS then MAX_DIAGNOSTIC_TEMPLATES before creating the row — same gating as create, unlike duplicateTemplateAction today", () => {
  const source = src("../lib/diagnostics-templates-server.ts");
  const start = source.indexOf("export async function duplicateTemplateCommand");
  const body = source.slice(start);
  const featureIdx = body.indexOf("isFeatureEnabled(actor.tenantId, PLAN_LIMIT_CODES.ENABLE_DIAGNOSTICS)");
  const limitIdx = body.indexOf("enforceCountLimit(");
  const limitCodeIdx = body.indexOf("PLAN_LIMIT_CODES.MAX_DIAGNOSTIC_TEMPLATES");
  const createIdx = body.indexOf("prisma.diagnosticTemplate.create(");
  assert.ok(featureIdx >= 0, "duplicate must check ENABLE_DIAGNOSTICS");
  assert.ok(limitIdx > featureIdx, "duplicate must check the count limit after the feature flag");
  assert.ok(limitCodeIdx > limitIdx, "duplicate's count limit must use MAX_DIAGNOSTIC_TEMPLATES");
  assert.ok(createIdx > limitCodeIdx, "both gates must precede duplicate's actual create");
});

test("updateTemplateCommand does NOT re-check ENABLE_DIAGNOSTICS/MAX_DIAGNOSTIC_TEMPLATES — only create and duplicate create new rows", () => {
  const body = commandBody("updateTemplateCommand", "// --- delete");
  assert.doesNotMatch(body, /isFeatureEnabled\(/);
  assert.doesNotMatch(body, /enforceCountLimit\(/);
});

// ============================================================================
// 6. Cross-tenant category rejection — assertCategory scoped by tenantId
// ============================================================================

test("assertCategory scopes its lookup by BOTH id and the actor's tenantId — a category belonging to another tenant never resolves", () => {
  const source = src("../lib/diagnostics-templates-server.ts");
  assert.match(
    source,
    /async function assertCategory\(tenantId: string, categoryId: string \| null\)/,
  );
  const start = source.indexOf("async function assertCategory");
  const end = source.indexOf("const TEMPLATE_RECORD_SELECT");
  const body = source.slice(start, end);
  // Тенантынх + «Оношилгоо»/«Бүх төрөлд» ангилал л (системийн сэлбэгийн ангилал орохгүй).
  assert.match(body, /prisma\.category\.findFirst\(\{[\s\S]*?where:\s*\{\s*id:\s*categoryId,\s*tenantId,\s*OR: \[\{ kind: "DIAGNOSTIC" as const \}, \{ kind: null \}\]\s*\}/);
});

test("createTemplateCommand and updateTemplateCommand both call assertCategory with the actor's tenantId", () => {
  const createBody = commandBody("createTemplateCommand", "export async function updateTemplateCommand");
  assert.match(createBody, /assertCategory\(actor\.tenantId, data\.categoryId\)/);
  const updateBody = commandBody("updateTemplateCommand", "// --- delete");
  assert.match(updateBody, /assertCategory\(actor\.tenantId, data\.categoryId\)/);
});

// ============================================================================
// 7. Tenant scoping on every command's Prisma read
// ============================================================================

test("updateTemplateCommand and deleteTemplateCommand look up the existing template by id AND tenantId together (cross-tenant id -> not found)", () => {
  const updateBody = commandBody("updateTemplateCommand", "// --- delete");
  assert.match(
    updateBody,
    /prisma\.diagnosticTemplate\.findFirst\(\{\s*where:\s*\{\s*id:\s*templateId,\s*tenantId:\s*actor\.tenantId\s*\}/,
  );
  const source = src("../lib/diagnostics-templates-server.ts");
  const delStart = source.indexOf("export async function deleteTemplateCommand");
  const delBody = source.slice(delStart);
  assert.match(
    delBody,
    /prisma\.diagnosticTemplate\.findFirst\(\{\s*where:\s*\{\s*id:\s*templateId,\s*tenantId:\s*actor\.tenantId\s*\}/,
  );
});

test("duplicateTemplateCommand sources from tenantVisibleTemplateWhere(actor.tenantId) — own or system-granted-shared, never another tenant's private template", () => {
  const source = src("../lib/diagnostics-templates-server.ts");
  const start = source.indexOf("export async function duplicateTemplateCommand");
  const body = source.slice(start);
  assert.match(body, /\.\.\.tenantVisibleTemplateWhere\(actor\.tenantId\)/);
  assert.match(body, /tenantId:\s*actor\.tenantId,\s*\n\s*createdById:\s*actor\.id,/, "the copy must always be written as tenant-owned");
});

// ============================================================================
// 8. DiagnosticTemplateCommandError shape
// ============================================================================

test("DiagnosticTemplateCommandError carries a status, machine code and optional fieldErrors, defaulting to 422/DIAGNOSTIC_TEMPLATE_COMMAND_REJECTED", () => {
  const withDefaults = new commands.DiagnosticTemplateCommandError("msg");
  assert.equal(withDefaults.status, 422);
  assert.equal(withDefaults.code, "DIAGNOSTIC_TEMPLATE_COMMAND_REJECTED");
  assert.ok(withDefaults instanceof Error);

  const explicit = new commands.DiagnosticTemplateCommandError("msg", 404, "TEMPLATE_NOT_FOUND");
  assert.equal(explicit.status, 404);
  assert.equal(explicit.code, "TEMPLATE_NOT_FOUND");
  assert.equal(explicit.fieldErrors, undefined);
});

// ============================================================================
// 9. Permission gates — behavioral, real requirePermission/hasPermission calls
// ============================================================================

test("diagnostics.create permission-denied for a role lacking the code, positive for a role with it, owner bypass", () => {
  const denied = user({ permissions: ["diagnostics.view"] });
  assert.notEqual(requirePermission(denied, "diagnostics.create"), null);
  const granted = user({ permissions: ["diagnostics.create"] });
  assert.equal(requirePermission(granted, "diagnostics.create"), null);
  const owner = user({ isOwner: true, permissions: [] });
  assert.equal(hasPermission(owner, "diagnostics.create"), true);
});

test("diagnostics.edit permission-denied for a role lacking the code, positive for a role with it, owner bypass", () => {
  const denied = user({ permissions: ["diagnostics.view"] });
  assert.notEqual(requirePermission(denied, "diagnostics.edit"), null);
  const granted = user({ permissions: ["diagnostics.edit"] });
  assert.equal(requirePermission(granted, "diagnostics.edit"), null);
  const owner = user({ isOwner: true, permissions: [] });
  assert.equal(hasPermission(owner, "diagnostics.edit"), true);
});

test("diagnostics.delete permission-denied for a role lacking the code, positive for a role with it, owner bypass", () => {
  const denied = user({ permissions: ["diagnostics.edit"] });
  assert.notEqual(requirePermission(denied, "diagnostics.delete"), null);
  const granted = user({ permissions: ["diagnostics.delete"] });
  assert.equal(requirePermission(granted, "diagnostics.delete"), null);
  const owner = user({ isOwner: true, permissions: [] });
  assert.equal(hasPermission(owner, "diagnostics.delete"), true);
});

test("a cross-resource role (no diagnostics.* at all) is denied create/edit/delete", () => {
  const crossResourceRole = user({ permissions: ["customers.view", "customers.edit", "customers.delete"] });
  assert.notEqual(requirePermission(crossResourceRole, "diagnostics.create"), null);
  assert.notEqual(requirePermission(crossResourceRole, "diagnostics.edit"), null);
  assert.notEqual(requirePermission(crossResourceRole, "diagnostics.delete"), null);
});

// ============================================================================
// 10. Route wiring — source-pattern (server-only import barrier via
// requireActiveSubscriptionApi, same reason tests/service-commands.test.ts's
// route section documents)
// ============================================================================

function templatesRouteSections() {
  const source = src("../app/api/v1/diagnostics/templates/route.ts");
  const getStart = source.indexOf("export async function GET");
  const postStart = source.indexOf("export async function POST");
  assert.ok(getStart >= 0 && postStart > getStart, "GET must precede POST");
  return { full: source, get: source.slice(getStart, postStart), post: source.slice(postStart) };
}

function templateDetailRouteSections() {
  const source = src("../app/api/v1/diagnostics/templates/[id]/route.ts");
  const getStart = source.indexOf("export async function GET");
  const patchStart = source.indexOf("export async function PATCH");
  const delStart = source.indexOf("export async function DELETE");
  assert.ok(getStart >= 0 && patchStart > getStart && delStart > patchStart, "GET, then PATCH, then DELETE");
  return {
    full: source,
    get: source.slice(getStart, patchStart),
    patch: source.slice(patchStart, delStart),
    del: source.slice(delStart),
  };
}

function duplicateRouteSource() {
  return src("../app/api/v1/diagnostics/templates/[id]/duplicate/route.ts");
}

test("POST /diagnostics/templates gates on diagnostics.create, then subscription, before parsing the body, and delegates to createTemplateCommand", () => {
  const { post } = templatesRouteSections();
  const permIdx = post.indexOf('requirePermission(auth.user, "diagnostics.create")');
  const subIdx = post.indexOf("requireActiveSubscriptionApi(auth.user)");
  const bodyIdx = post.indexOf("req.json()");
  const commandIdx = post.indexOf("createTemplateCommand(");
  assert.ok(permIdx >= 0, "POST must check diagnostics.create");
  assert.ok(subIdx > permIdx, "subscription check must run after the permission check");
  assert.ok(bodyIdx > subIdx, "body parsing must happen after both gates");
  assert.ok(commandIdx > bodyIdx, "POST must delegate to createTemplateCommand");
  assert.doesNotMatch(post, /prisma\.diagnosticTemplate\.create\(/, "POST must not write prisma.diagnosticTemplate directly — only the command may");
});

test("GET /diagnostics/templates is untouched by this slice — still no subscription gate, still diagnostics.view", () => {
  const { get } = templatesRouteSections();
  assert.match(get, /requirePermission\(auth\.user, "diagnostics\.view"\)/);
  assert.doesNotMatch(get, /requireActiveSubscriptionApi/);
});

test("PATCH /diagnostics/templates/[id] gates on diagnostics.edit, then subscription, and delegates to updateTemplateCommand", () => {
  const { patch } = templateDetailRouteSections();
  const permIdx = patch.indexOf('requirePermission(auth.user, "diagnostics.edit")');
  const subIdx = patch.indexOf("requireActiveSubscriptionApi(auth.user)");
  const commandIdx = patch.indexOf("updateTemplateCommand(");
  assert.ok(permIdx >= 0, "PATCH must check diagnostics.edit");
  assert.ok(subIdx > permIdx, "subscription check must run after the permission check");
  assert.ok(commandIdx > subIdx, "PATCH must delegate to updateTemplateCommand");
  assert.doesNotMatch(patch, /prisma\.diagnosticTemplate\.update\(/, "PATCH must not write prisma.diagnosticTemplate directly — only the command may");
});

test("DELETE /diagnostics/templates/[id] gates on diagnostics.delete, then subscription, and delegates to deleteTemplateCommand", () => {
  const { del } = templateDetailRouteSections();
  const permIdx = del.indexOf('requirePermission(auth.user, "diagnostics.delete")');
  const subIdx = del.indexOf("requireActiveSubscriptionApi(auth.user)");
  const commandIdx = del.indexOf("deleteTemplateCommand(");
  assert.ok(permIdx >= 0, "DELETE must check diagnostics.delete");
  assert.ok(subIdx > permIdx, "subscription check must run after the permission check");
  assert.ok(commandIdx > subIdx, "DELETE must delegate to deleteTemplateCommand");
  assert.doesNotMatch(del, /prisma\.diagnosticTemplate\.delete\(/, "DELETE must not delete prisma.diagnosticTemplate directly — only the command may");
});

test("GET /diagnostics/templates/[id] is untouched by this slice — still no subscription gate, still diagnostics.view", () => {
  const { get } = templateDetailRouteSections();
  assert.match(get, /requirePermission\(auth\.user, "diagnostics\.view"\)/);
  assert.doesNotMatch(get, /requireActiveSubscriptionApi/);
});

test("POST /diagnostics/templates/[id]/duplicate gates on diagnostics.create, then subscription, and delegates to duplicateTemplateCommand", () => {
  const source = duplicateRouteSource();
  const permIdx = source.indexOf('requirePermission(auth.user, "diagnostics.create")');
  const subIdx = source.indexOf("requireActiveSubscriptionApi(auth.user)");
  const commandIdx = source.indexOf("duplicateTemplateCommand(");
  assert.ok(permIdx >= 0, "duplicate must check diagnostics.create");
  assert.ok(subIdx > permIdx, "subscription check must run after the permission check");
  assert.ok(commandIdx > subIdx, "duplicate route must delegate to duplicateTemplateCommand");
  assert.doesNotMatch(source, /prisma\./, "the duplicate route must never touch prisma directly");
});

test("all four new/extended handlers require an authenticated ApiUser before any permission check", () => {
  const { post } = templatesRouteSections();
  const { patch, del } = templateDetailRouteSections();
  const duplicate = duplicateRouteSource();
  for (const section of [post, patch, del, duplicate]) {
    const authIdx = section.indexOf("requireApiUser(req)");
    const earlyReturn = section.indexOf("if (auth.response) return auth.response;");
    const permIdx = section.indexOf("requirePermission(auth.user,");
    assert.ok(authIdx >= 0, "must call requireApiUser(req)");
    assert.ok(earlyReturn > authIdx, "must early-return auth.response");
    assert.ok(permIdx > earlyReturn, "permission check must come after the auth early-return");
  }
});

// ============================================================================
// 11. app/_actions/diagnostic-templates.ts must remain untouched by this slice
// ============================================================================

test("app/_actions/diagnostic-templates.ts still implements its four actions inline — this slice does not require touching it", () => {
  const actions = src("../app/_actions/diagnostic-templates.ts");
  assert.match(actions, /export async function createTemplateAction/);
  assert.match(actions, /export async function updateTemplateAction/);
  assert.match(actions, /export async function deleteTemplateAction/);
  assert.match(actions, /export async function duplicateTemplateAction/);
  // Not required to delegate to the new command module — see this slice's
  // own instruction not to touch this file unless strictly additive.
});
