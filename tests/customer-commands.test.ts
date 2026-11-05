import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { before, test } from "node:test";

process.env.DATABASE_URL ??= "postgresql://unused/unused";
process.env.SESSION_SECRET ??= "unit-test-placeholder-secret-value-not-real-00";

let commands: typeof import("../lib/customers/customer-commands");

before(async () => {
  commands = await import("../lib/customers/customer-commands");
});

function src(relPath: string): string {
  return readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), relPath),
    "utf8",
  );
}

// --- Pure validation logic (genuinely testable without a database) --------

test("phone is required and must be a valid 8-digit Mongolian number", () => {
  const noPhone = commands.validateCustomerInput({ phone: "" });
  assert.equal(noPhone.fieldErrors.phone, "Утасны дугаар оруулна уу.");

  const badPhone = commands.validateCustomerInput({ phone: "123" });
  assert.equal(badPhone.fieldErrors.phone, "Утасны дугаар 8 оронтой тоо байх ёстой.");

  const ok = commands.validateCustomerInput({ phone: "99112233" });
  assert.equal(ok.fieldErrors.phone, undefined);
  assert.equal(ok.data.phone, "99112233");
});

test("phone normalises country code / leading-zero variants to the canonical 8-digit form", () => {
  const withCountryCode = commands.validateCustomerInput({ phone: "+976 99112233" });
  assert.equal(withCountryCode.data.phone, "99112233");

  const withLeadingZero = commands.validateCustomerInput({ phone: "099112233" });
  assert.equal(withLeadingZero.data.phone, "99112233");
});

test("fullName is optional — empty stays empty, never required", () => {
  const result = commands.validateCustomerInput({ phone: "99112233" });
  assert.equal(result.fieldErrors.fullName, undefined);
  assert.equal(result.data.fullName, "");
});

test("email is optional but must match a basic email shape when present", () => {
  const noEmail = commands.validateCustomerInput({ phone: "99112233" });
  assert.equal(noEmail.fieldErrors.email, undefined);
  assert.equal(noEmail.data.email, null);

  const badEmail = commands.validateCustomerInput({ phone: "99112233", email: "not-an-email" });
  assert.equal(badEmail.fieldErrors.email, "Имэйл хаяг буруу.");

  const goodEmail = commands.validateCustomerInput({ phone: "99112233", email: "a@b.mn" });
  assert.equal(goodEmail.fieldErrors.email, undefined);
  assert.equal(goodEmail.data.email, "a@b.mn");
});

test("note is optional and trimmed; blank becomes null", () => {
  const result = commands.validateCustomerInput({ phone: "99112233", note: "  hi  " });
  assert.equal(result.data.note, "hi");
  const blank = commands.validateCustomerInput({ phone: "99112233", note: "   " });
  assert.equal(blank.data.note, null);
});

test("CustomerCommandError carries a status, machine code and optional fieldErrors", () => {
  const err = new commands.CustomerCommandError("msg", 409, "PHONE_CONFLICT", { phone: "dup" });
  assert.equal(err.status, 409);
  assert.equal(err.code, "PHONE_CONFLICT");
  assert.deepEqual(err.fieldErrors, { phone: "dup" });
  assert.ok(err instanceof Error);
});

// --- Structural coverage: entry points delegate to the one command --------
//
// These are source-pattern assertions, not runtime behavior tests. They
// guard against the exact regression this slice removes — a fourth copy of
// validation/claim logic creeping back into an entry point. They cannot
// substitute for a database-backed integration test of the full
// create/claim/conflict flow; see the final report for what remains
// untested for that reason.

test("web create/update/delete actions delegate to the shared command and do not re-implement it", () => {
  const actions = src("../app/_actions/customers.ts");
  // Matched loosely across lines: the point is that the action delegates to
  // the command with the form input, not how the call happens to be wrapped.
  assert.match(actions, /createCustomerCommand\(\{[\s\S]*?data: formInput\(formData\)/);
  assert.match(actions, /updateCustomerCommand\(\{ actor: user, customerId: id, data: formInput\(formData\) \}\)/);
  assert.match(actions, /deleteCustomerCommand\(\{ actor: user, customerId: id \}\)/);
  // The old inline validate()/authorize-driven Prisma create/update/delete
  // calls must be gone from this file — only the command module talks to
  // prisma.customer now.
  assert.doesNotMatch(actions, /prisma\.customer\.(create|update|updateMany|delete|findUnique|findFirst)/);
  assert.doesNotMatch(actions, /function validate\(/);
});

test("quick-create delegates to the same command instead of re-implementing validation/claim", () => {
  const quickCreate = src("../app/_actions/quick-create.ts");
  const start = quickCreate.indexOf("export async function quickCreateCustomerAction");
  const end = quickCreate.indexOf("export type QuickVehicleResult");
  assert.ok(start >= 0 && end > start, "quickCreateCustomerAction section must exist before the vehicle section");
  const customerSection = quickCreate.slice(start, end);
  assert.match(customerSection, /createCustomerCommand\(\{/);
  assert.doesNotMatch(customerSection, /prisma\.customer\.(create|update|findUnique|findFirst)/);
  assert.doesNotMatch(customerSection, /isValidPhone\(/);

  // The vehicle half is NOT extracted. P3-B2 attempted it and was discarded
  // on 2026-09-22 when an upstream commit redesigned the vehicle model
  // (vehicle-per-owner: plate/vin no longer globally unique, resolveVehicle
  // replaced by resolveVehicleForOwner). What matters here is only that the
  // two halves stay separate — the customer command must not creep into the
  // vehicle path. Re-extraction is tracked as the redone P3-B2.
  const vehicleSection = quickCreate.slice(end);
  assert.doesNotMatch(vehicleSection, /createCustomerCommand\(/);
});

test("the staff API POST route delegates to the same command — including the account-claim step it used to skip", () => {
  const route = src("../app/api/v1/customers/route.ts");
  const postStart = route.indexOf("export async function POST");
  assert.ok(postStart >= 0);
  const postBody = route.slice(postStart);
  assert.match(postBody, /createCustomerCommand\(\{/);
  assert.doesNotMatch(postBody, /prisma\.customer\.create/);
  // GET must be completely untouched by this slice (P3-B0 owns it).
  const getStart = route.indexOf("export async function GET");
  const getBody = route.slice(getStart, postStart);
  assert.match(getBody, /requirePermission\(auth\.user, "customers\.view"\)/);
  assert.match(getBody, /tenantId:\s*auth\.user\.tenantId/);
});

test("the command module is the only one of the three files that talks to prisma.account", () => {
  const commandSource = src("../lib/customers/customer-commands.ts");
  assert.match(commandSource, /prisma\.account\.findUnique/);
  assert.match(commandSource, /tenantId_accountId/);
  const actions = src("../app/_actions/customers.ts");
  const quickCreate = src("../app/_actions/quick-create.ts");
  const route = src("../app/api/v1/customers/route.ts");
  assert.doesNotMatch(actions, /prisma\.account\./);
  assert.doesNotMatch(quickCreate, /prisma\.account\./);
  assert.doesNotMatch(route, /prisma\.account\./);
});

test("customer creation has no count quota on any entry point", () => {
  for (const rel of ["../lib/customers/customer-commands.ts", "../app/_actions/customers.ts", "../app/_actions/quick-create.ts", "../app/api/v1/customers/route.ts"]) {
    assert.doesNotMatch(src(rel), /enforceCountLimit|PLAN_LIMIT_REACHED|DAILY_LIMIT_REACHED|PLAN_LIMIT_CODES\.(MAX_|DAILY_)/, rel);
  }
});

test("no per-caller plan-limit flag exists on customer creation", () => {
  const commandSource = src("../lib/customers/customer-commands.ts");
  assert.doesNotMatch(commandSource, /enforcePlanLimit/);
  for (const caller of [
    "../app/_actions/customers.ts",
    "../app/_actions/quick-create.ts",
    "../app/api/v1/customers/route.ts",
  ]) {
    assert.doesNotMatch(src(caller), /enforcePlanLimit/, `${caller} must not pass a plan-limit flag`);
  }
});

test("quick-create keeps its distinguishing audit tag", () => {
  // The audit log distinguishes a customer quick-created from an order or
  // vehicle page from one created on the customers page. Unification dropped
  // the tag; it is restored via the command's suffix parameter.
  const quickCreate = src("../app/_actions/quick-create.ts");
  assert.match(quickCreate, /auditSummarySuffix:\s*"\(засварын хуудаснаас түргэн\)"/);
  const commandSource = src("../lib/customers/customer-commands.ts");
  assert.match(commandSource, /auditSummarySuffix/);
});

test("P2002 is handled as a phone conflict in both create and update, matching the partial-unique-index note", () => {
  const commandSource = src("../lib/customers/customer-commands.ts");
  assert.match(commandSource, /accountId IS NULL/);
  const p2002Occurrences = commandSource.match(/code === "P2002"/g) ?? [];
  assert.equal(p2002Occurrences.length, 2, "create and update must each catch P2002");
});

test("full name is capped at 100 characters", () => {
  const long = commands.validateCustomerInput({ phone: "99112233", fullName: "а".repeat(101) });
  assert.equal(long.fieldErrors.fullName, "Нэр 100 тэмдэгтээс хэтрэхгүй.");
  const ok = commands.validateCustomerInput({ phone: "99112233", fullName: "а".repeat(100) });
  assert.equal(ok.fieldErrors.fullName, undefined);
});

test("an unchanged over-long existing name is not re-validated on update", () => {
  const longName = "а".repeat(150);
  const unchanged = commands.validateCustomerInput(
    { phone: "99112233", fullName: ` ${longName} ` },
    { existingFullName: longName },
  );
  assert.equal(unchanged.fieldErrors.fullName, undefined);
  const changed = commands.validateCustomerInput(
    { phone: "99112233", fullName: longName + "б" },
    { existingFullName: longName },
  );
  assert.equal(changed.fieldErrors.fullName, "Нэр 100 тэмдэгтээс хэтрэхгүй.");
  // create (no existing) always enforces
  const created = commands.validateCustomerInput({ phone: "99112233", fullName: longName });
  assert.equal(created.fieldErrors.fullName, "Нэр 100 тэмдэгтээс хэтрэхгүй.");
});

test("customer update loads the stored name before validating", () => {
  const body = src("../lib/customers/customer-commands.ts");
  const start = body.indexOf("export async function updateCustomerCommand");
  assert.match(body.slice(start), /existingFullName: stored\?\.fullName/);
});
