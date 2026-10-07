import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { before, test } from "node:test";
import type { ApiUser } from "../lib/auth/api-token";

// `app/api/v1/customers/[id]/route.ts` transitively imports
// `lib/subscription-server.ts`, which does `import "server-only"`. That
// package is not a real dependency (Next's bundler resolves it specially at
// build time), so plain `tsx --test` module resolution cannot import the
// route file directly — confirmed by the same gap documented in
// `tests/customers-list-route.test.ts` and the Wave-2 spec-correction note in
// TENANT_MOBILE_SLICES.md ("Wave 2 coverage is structural, not behavioral").
//
// What is tested with real runtime behaviour, without a database:
//   1. `requirePermission`/`hasPermission` — the exact primitives each
//      handler calls — for denied/granted/owner-bypass, per method's
//      permission code.
//   2. `CustomerCommandError` status/code/fieldErrors shape, imported and
//      constructed directly from the real (importable, non-`server-only`)
//      command module — this is the actual error the route re-throws as a
//      response, not a guess at its shape.
// What is asserted structurally (source-pattern), and why each one is a
// legitimate proxy given the import barrier:
//   - each method's permission code is checked before any Prisma read
//   - every Prisma lookup includes `tenantId: auth.user.tenantId`, which is
//     what makes another tenant's customer 404 rather than 403 (there is no
//     separate tenant-mismatch branch to accidentally return 403 from)
//   - the delete/update command-error catch blocks forward `e.status`/`e.code`
//     rather than re-mapping them, so CUSTOMER_IN_USE cannot collapse to 500
//   - no method re-implements validation, normalisation, or the P2002 phone
//     conflict / P2003 in-use mapping — those calls only exist in
//     `lib/customers/customer-commands.ts`

process.env.DATABASE_URL ??= "postgresql://unused/unused";
process.env.SESSION_SECRET ??= "unit-test-placeholder-secret-value-not-real-00";

let requirePermission: typeof import("../lib/api").requirePermission;
let hasPermission: typeof import("../lib/auth/roles").hasPermission;
let CustomerCommandError: typeof import("../lib/customers/customer-commands").CustomerCommandError;

before(async () => {
  [{ requirePermission }, { hasPermission }, { CustomerCommandError }] = await Promise.all([
    import("../lib/api"),
    import("../lib/auth/roles"),
    import("../lib/customers/customer-commands"),
  ]);
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

function routeSections() {
  const source = src("../app/api/v1/customers/[id]/route.ts");
  const getStart = source.indexOf("export async function GET");
  const patchStart = source.indexOf("export async function PATCH");
  const deleteStart = source.indexOf("export async function DELETE");
  assert.ok(getStart >= 0 && patchStart > getStart && deleteStart > patchStart,
    "GET, PATCH, DELETE must appear in that order");
  return {
    full: source,
    get: source.slice(getStart, patchStart),
    patch: source.slice(patchStart, deleteStart),
    del: source.slice(deleteStart),
  };
}

// --- Permission gates, per method -----------------------------------------

test("GET requires customers.view", () => {
  const denied = user({ permissions: ["orders.view"] });
  assert.notEqual(requirePermission(denied, "customers.view"), null);
  const granted = user({ permissions: ["customers.view"] });
  assert.equal(requirePermission(granted, "customers.view"), null);
  const owner = user({ isOwner: true, permissions: [] });
  assert.equal(hasPermission(owner, "customers.view"), true);
});

test("PATCH requires customers.edit", () => {
  const denied = user({ permissions: ["customers.view"] });
  assert.notEqual(requirePermission(denied, "customers.edit"), null);
  const granted = user({ permissions: ["customers.edit"] });
  assert.equal(requirePermission(granted, "customers.edit"), null);
});

test("DELETE requires customers.delete", () => {
  const denied = user({ permissions: ["customers.edit"] });
  assert.notEqual(requirePermission(denied, "customers.delete"), null);
  const granted = user({ permissions: ["customers.delete"] });
  assert.equal(requirePermission(granted, "customers.delete"), null);
});

test("route file: each method gates on its permission code before any Prisma call", () => {
  const { get, patch, del } = routeSections();

  const getPerm = get.indexOf('requirePermission(auth.user, "customers.view")');
  const getFind = get.indexOf("prisma.customer.findFirst");
  assert.ok(getPerm >= 0, "GET must check customers.view");
  assert.ok(getFind > getPerm, "GET permission check must precede the Prisma read");

  const patchPerm = patch.indexOf('requirePermission(auth.user, "customers.edit")');
  const patchCommand = patch.indexOf("updateCustomerCommand(");
  assert.ok(patchPerm >= 0, "PATCH must check customers.edit");
  assert.ok(patchCommand > patchPerm, "PATCH permission check must precede the command call");

  const delPerm = del.indexOf('requirePermission(auth.user, "customers.delete")');
  const delCommand = del.indexOf("deleteCustomerCommand(");
  assert.ok(delPerm >= 0, "DELETE must check customers.delete");
  assert.ok(delCommand > delPerm, "DELETE permission check must precede the command call");
});

// --- Tenant scoping / 404-not-403 ------------------------------------------

test("GET's customer lookup and every dependent query are tenant-scoped", () => {
  const { get } = routeSections();
  assert.match(get, /prisma\.customer\.findFirst\(\{\s*where:\s*\{\s*id,\s*tenantId:\s*auth\.user\.tenantId/,
    "GET must look up the customer by id AND tenantId together");
  assert.match(get, /tenantId:\s*auth\.user\.tenantId,\s*vehicleId:\s*\{\s*in:\s*vehicleIds\s*\}/,
    "the per-vehicle order count must also be tenant-scoped, not global");
});

test("GET returns 404 (never 403) when the tenant-scoped lookup finds nothing — covers cross-tenant ids", () => {
  const { get } = routeSections();
  const findIdx = get.indexOf("prisma.customer.findFirst");
  const notFoundIdx = get.indexOf("customerNotFound()");
  assert.ok(findIdx >= 0 && notFoundIdx > findIdx);
  assert.doesNotMatch(get, /jsonError\(403/, "GET must not have a distinct 403 branch for an existing-but-foreign customer");
});

test("customerNotFound() helper always answers 404, documented as the 404-not-403 boundary", () => {
  const { full } = routeSections();
  assert.match(full, /function customerNotFound\(\)\s*\{\s*return jsonError\(404/);
});

test("PATCH and DELETE rely on the command's own tenant-scoped predicate rather than a second tenant check", () => {
  const { patch, del } = routeSections();
  // The commands themselves (updateMany({ where: { id, tenantId } }) /
  // findFirst({ where: { id, tenantId } })) are what make a foreign customer
  // 404; asserting the route does not re-implement Prisma reads for the
  // target row confirms there is no second, possibly-403 code path.
  assert.doesNotMatch(patch, /prisma\.customer\.(update|findFirst|findUnique)\(/,
    "PATCH must not query prisma.customer directly — only the command may");
  assert.doesNotMatch(del, /prisma\.customer\.(delete|findFirst|findUnique)\(/,
    "DELETE must not query prisma.customer directly — only the command may");
});

// --- Delete conflict is a typed, translatable 409, never a 500 ------------

test("CUSTOMER_IN_USE (P2003) is a typed 409 conflict on the command itself", () => {
  const inUse = new CustomerCommandError(
    "Энэ үйлчлүүлэгчтэй холбоотой засварын хуудас байгаа тул устгах боломжгүй.",
    409,
    "CUSTOMER_IN_USE",
  );
  assert.equal(inUse.status, 409);
  assert.equal(inUse.code, "CUSTOMER_IN_USE");
  assert.ok(inUse instanceof Error);
});

test("DELETE forwards CustomerCommandError.status/code verbatim instead of hardcoding a response", () => {
  const { del } = routeSections();
  assert.match(del, /if \(e instanceof CustomerCommandError\)/);
  assert.match(del, /jsonError\(e\.status,\s*e\.message,\s*\{\s*code:\s*e\.code\s*\}\)/,
    "DELETE must map status/code straight from the command error, not re-derive them");
  // No catch-all that would turn an unexpected CustomerCommandError into a
  // silent 500 — anything not a CustomerCommandError re-throws (Next's
  // framework converts an uncaught error to its own 500, but that is never a
  // *swallowed* CustomerCommandError).
  assert.match(del, /throw e;/);
});

test("PATCH forwards CustomerCommandError with fieldErrors when present, status/code otherwise", () => {
  const { patch } = routeSections();
  assert.match(patch, /if \(e\.fieldErrors\) return jsonError\(e\.status, e\.message, \{ fieldErrors: e\.fieldErrors \}\)/);
  assert.match(patch, /return jsonError\(e\.status, e\.message, \{ code: e\.code \}\)/);
});

// --- No re-implemented command logic ---------------------------------------

test("route delegates to the P3-B1 commands and performs no validation/normalisation of its own", () => {
  const { full } = routeSections();
  assert.match(full, /import \{\s*CustomerCommandError,\s*deleteCustomerCommand,\s*orgInputFromBody,\s*updateCustomerCommand,\s*\} from "@\/lib\/customers\/customer-commands"/);
  assert.doesNotMatch(full, /isValidPhone|normalizePhone/, "phone validation/normalisation belongs only to the command module");
  assert.doesNotMatch(full, /code === "P2002"|code === "P2003"/, "Prisma error-code mapping belongs only to the command module");
});

// --- Subscription gate decision --------------------------------------------

test("PATCH and DELETE require an active subscription, matching the sibling POST route's mutation gate", () => {
  const { patch, del } = routeSections();
  const postSource = src("../app/api/v1/customers/route.ts");
  assert.match(postSource, /requireActiveSubscriptionApi\(auth\.user\)/, "sanity: sibling POST gates on subscription");
  assert.match(patch, /requireActiveSubscriptionApi\(auth\.user\)/);
  assert.match(del, /requireActiveSubscriptionApi\(auth\.user\)/);
});

test("GET does not require an active subscription — reads stay available to a locked tenant", () => {
  const { get } = routeSections();
  assert.doesNotMatch(get, /requireActiveSubscriptionApi/);
});
