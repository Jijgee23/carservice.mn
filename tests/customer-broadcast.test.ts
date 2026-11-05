import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { before, test } from "node:test";

// P3-B7 — Customer broadcast. `lib/customers/customer-broadcast.ts` is a
// plain module (no `server-only`, no Next.js route wrapper) so its exports
// are directly importable and testable under `tsx --test` without a
// database, same as `tests/customer-commands.test.ts`. `app/_actions/customers.ts`
// and `app/api/v1/customers/notify/route.ts` transitively import
// `lib/subscription-server.ts` (`server-only`), so — same gap already
// documented in `customer-commands.test.ts` / `customer-detail-routes.test.ts`
// — their coverage here is source-pattern (structural), not a live import.

process.env.DATABASE_URL ??= "postgresql://unused/unused";
process.env.SESSION_SECRET ??= "unit-test-placeholder-secret-value-not-real-00";

let broadcast: typeof import("../lib/customers/customer-broadcast");

before(async () => {
  broadcast = await import("../lib/customers/customer-broadcast");
});

function src(relPath: string): string {
  return readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), relPath),
    "utf8",
  );
}

// --- CustomerBroadcastError shape ------------------------------------------

test("CustomerBroadcastError carries a typed status and machine code", () => {
  const err = new broadcast.CustomerBroadcastError("msg", 422, "DAILY_LIMIT_REACHED");
  assert.equal(err.status, 422);
  assert.equal(err.code, "DAILY_LIMIT_REACHED");
  assert.ok(err instanceof Error);
  assert.equal(err.name, "CustomerBroadcastError");
});

test("CustomerBroadcastError defaults to a 422 with a generic rejection code", () => {
  const err = new broadcast.CustomerBroadcastError("msg");
  assert.equal(err.status, 422);
  assert.equal(err.code, "BROADCAST_REJECTED");
});

// --- Recipient count excludes accountId: null -------------------------------

test("countBroadcastRecipients counts only account-linked customers, tenant-scoped", () => {
  const moduleSource = src("../lib/customers/customer-broadcast.ts");
  const start = moduleSource.indexOf("export async function countBroadcastRecipients");
  assert.ok(start >= 0);
  const end = moduleSource.indexOf("export async function sendCustomerBroadcast");
  const section = moduleSource.slice(start, end);
  assert.match(section, /prisma\.customer\.count\(\{\s*where:\s*\{\s*tenantId:\s*actor\.tenantId,\s*accountId:\s*\{\s*not:\s*null\s*\}/);
});

// --- daily-limit → send → audit sequence, preserved --------------------------

test("sendCustomerBroadcast has no daily send limit — plans differ by modules only", () => {
  const moduleSource = src("../lib/customers/customer-broadcast.ts");
  assert.doesNotMatch(moduleSource, /enforceCountLimit|PLAN_LIMIT_REACHED|DAILY_LIMIT_REACHED|PLAN_LIMIT_CODES\.(MAX_|DAILY_)/);
  // The module gate (enable_customer_broadcast) precedes the send instead.
  const gateIdx = moduleSource.indexOf('isModuleEnabled(actor.tenantId, "enable_customer_broadcast")');
  const sendIdx = moduleSource.indexOf("broadcastTenantPromo({");
  assert.ok(gateIdx >= 0 && sendIdx > gateIdx, "the module gate must precede the send");
});

test("a disabled module throws CustomerBroadcastError with status/code, never a generic message", () => {
  const moduleSource = src("../lib/customers/customer-broadcast.ts");
  assert.match(
    moduleSource,
    /throw new CustomerBroadcastError\(\s*moduleDisabledMessage\("enable_customer_broadcast"\),\s*403,\s*MODULE_DISABLED_CODE,\s*\);/,
  );
});

test("exactly one audit row is written per send", () => {
  const moduleSource = src("../lib/customers/customer-broadcast.ts");
  const logAuditOccurrences = moduleSource.match(/await logAudit\(/g) ?? [];
  assert.equal(logAuditOccurrences.length, 1, "sendCustomerBroadcast must write exactly one audit row");
  assert.match(moduleSource, /entity:\s*"Notification"/);
  assert.match(moduleSource, /entityId:\s*actor\.tenantId/);
  assert.match(moduleSource, /action:\s*"OTHER"/);
});

test("no audit-log counter is read any more (the daily limit was removed)", () => {
  const moduleSource = src("../lib/customers/customer-broadcast.ts");
  assert.doesNotMatch(moduleSource, /prisma\.auditLog\.count\(/);
});

test("a zero-recipient send still returns success shape and does not skip the audit write", () => {
  const moduleSource = src("../lib/customers/customer-broadcast.ts");
  // The send call and the audit write are unconditional after the limit
  // check — no `if (notified > 0)` guard exists around the audit write.
  const sendIdx = moduleSource.indexOf("const notified = await broadcastTenantPromo(");
  const auditIdx = moduleSource.indexOf("await logAudit(");
  assert.ok(sendIdx >= 0 && auditIdx > sendIdx);
  const between = moduleSource.slice(sendIdx, auditIdx);
  assert.doesNotMatch(between, /if\s*\(\s*notified/, "audit write must not be conditioned on notified > 0");
});

test("the module documents that the daily send limit is gone (audit row is only an audit trail)", () => {
  const moduleSource = src("../lib/customers/customer-broadcast.ts");
  assert.match(moduleSource, /тоон хязгаар устсан/);
  assert.doesNotMatch(moduleSource, /rate-limit counter\./);
});

test("sendCustomerBroadcast does not re-implement broadcastTenantPromo's send logic", () => {
  const moduleSource = src("../lib/customers/customer-broadcast.ts");
  assert.doesNotMatch(moduleSource, /prisma\.notification\.createMany/);
  assert.doesNotMatch(moduleSource, /sendPushToTokens/);
  assert.match(moduleSource, /import \{ broadcastTenantPromo \} from "@\/lib\/notifications";/);
});

// --- Adapters delegate, do not re-implement ---------------------------------

test("the dashboard broadcast action delegates to sendCustomerBroadcast and no longer contains its own limit/audit logic", () => {
  const actions = src("../app/_actions/customers.ts");
  const start = actions.indexOf("export async function sendCustomerBroadcastAction");
  assert.ok(start >= 0);
  const section = actions.slice(start);
  assert.match(section, /sendCustomerBroadcast\(\{\s*actor:\s*user,\s*data:\s*\{\s*title,\s*body\s*\}/);
  assert.doesNotMatch(section, /enforceCountLimit\(/, "limit enforcement must live only in the broadcast module");
  assert.doesNotMatch(section, /await logAudit\(/, "audit write must live only in the broadcast module");
  assert.doesNotMatch(section, /broadcastTenantPromo\(/, "the send call must live only in the broadcast module");
});

test("the broadcast action still checks customers.notify then active subscription, in that order, before any command call", () => {
  const actions = src("../app/_actions/customers.ts");
  const start = actions.indexOf("export async function sendCustomerBroadcastAction");
  const end = actions.length;
  const section = actions.slice(start, end);
  const permIdx = section.indexOf('hasPermission(user, "customers.notify")');
  const subIdx = section.indexOf("assertActiveSubscription(user.tenantId)");
  const sendIdx = section.indexOf("sendCustomerBroadcast(");
  assert.ok(permIdx >= 0 && subIdx > permIdx && sendIdx > subIdx,
    "order must stay: permission -> subscription -> command");
});

test("the broadcast action preserves its exact field-required and zero-recipient messages", () => {
  const actions = src("../app/_actions/customers.ts");
  assert.match(actions, /Танд үйлчлүүлэгчид зар илгээх эрх байхгүй\./);
  assert.match(actions, /Гарчиг оруулна уу\./);
  assert.match(actions, /Агуулга оруулна уу\./);
  assert.match(actions, /Илгээгдлээ, гэхдээ онлайн бүртгэлтэй \(апп\/веб холбогдсон\) үйлчлүүлэгч алга байна\./);
  assert.match(actions, /Илгээгдлээ — \$\{notified\.toLocaleString\("mn-MN"\)\} үйлчлүүлэгчид хүрлээ\./);
});

test("the notify API route delegates GET (count) and POST (send) to the broadcast module, no inline limit/audit logic", () => {
  const route = src("../app/api/v1/customers/notify/route.ts");
  const getStart = route.indexOf("export async function GET");
  const postStart = route.indexOf("export async function POST");
  assert.ok(getStart >= 0 && postStart > getStart);
  const getBody = route.slice(getStart, postStart);
  const postBody = route.slice(postStart);

  assert.match(getBody, /countBroadcastRecipients\(auth\.user\)/);
  assert.match(postBody, /sendCustomerBroadcast\(\{/);
  assert.doesNotMatch(route, /enforceCountLimit\(/);
  assert.doesNotMatch(route, /await logAudit\(/);
  assert.doesNotMatch(route, /broadcastTenantPromo\(/);
});

test("both notify route methods require customers.notify then an active subscription before any Prisma/command call", () => {
  const route = src("../app/api/v1/customers/notify/route.ts");
  const getStart = route.indexOf("export async function GET");
  const postStart = route.indexOf("export async function POST");
  const getBody = route.slice(getStart, postStart);
  const postBody = route.slice(postStart);

  for (const [label, body] of [["GET", getBody], ["POST", postBody]] as const) {
    const permIdx = body.indexOf('requirePermission(auth.user, "customers.notify")');
    const subIdx = body.indexOf("requireActiveSubscriptionApi(auth.user)");
    assert.ok(permIdx >= 0, `${label} must check customers.notify`);
    assert.ok(subIdx > permIdx, `${label} must check subscription after permission`);
  }

  const countIdx = getBody.indexOf("countBroadcastRecipients(");
  const getSubIdx = getBody.indexOf("requireActiveSubscriptionApi(auth.user)");
  assert.ok(countIdx > getSubIdx, "GET must gate before counting");

  const sendIdx = postBody.indexOf("sendCustomerBroadcast(");
  const postSubIdx = postBody.indexOf("requireActiveSubscriptionApi(auth.user)");
  assert.ok(sendIdx > postSubIdx, "POST must gate before sending");
});

test("the notify route maps CustomerBroadcastError to its typed status/code, never a generic 500", () => {
  const route = src("../app/api/v1/customers/notify/route.ts");
  const postStart = route.indexOf("export async function POST");
  const postBody = route.slice(postStart);
  assert.match(postBody, /if \(e instanceof CustomerBroadcastError\) \{\s*return jsonError\(e\.status, e\.message, \{ code: e\.code \}\);\s*\}/);
});

// --- customers.notify is standalone and does not default into new roles ----

test("customers.notify is a standalone permission, not part of the customers CRUD group", () => {
  const permissions = src("../lib/auth/permissions.ts");
  assert.match(permissions, /"customers\.notify"/);
  // It must be listed under StandaloneCode, not produced by buildCrudPermissions
  // (which only ever emits `${resource}.${view|create|edit|delete}`).
  assert.doesNotMatch(permissions, /customers\.notify[\s\S]*"(view|create|edit|delete)"/);
  const standaloneSection = permissions.slice(
    permissions.indexOf("type StandaloneCode"),
    permissions.indexOf(";", permissions.indexOf("type StandaloneCode")),
  );
  assert.match(standaloneSection, /"customers\.notify"/);
});

test("customers.notify is documented as deliberately not defaulting into new roles", () => {
  const permissions = src("../lib/auth/permissions.ts");
  assert.match(permissions, /шинэ Role-д анхдагчаар ОРОХГҮЙ/);
});
