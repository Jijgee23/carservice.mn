import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { before, test } from "node:test";

process.env.DATABASE_URL ??= "postgresql://unused/unused";
process.env.SESSION_SECRET ??= "unit-test-placeholder-secret-value-not-real-00";

let admin: typeof import("../lib/system/tenant-admin");

before(async () => {
  admin = await import("../lib/system/tenant-admin");
});

const code = (rel: string) =>
  readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), rel), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

test("parseTenantPatch: only provided fields end up in the patch", () => {
  const r = admin.parseTenantPatch({ name: "  Шинэ нэр  ", phone: "99112233" });
  assert.ok(r.ok);
  assert.deepEqual(r.patch.profile, { name: "Шинэ нэр", phone1: "99112233" });
  assert.deepEqual(r.patch.branch, {});
});

test("parseTenantPatch: empty email / phone2 clear the value (null)", () => {
  const r = admin.parseTenantPatch({ email: " ", phone2: null });
  assert.ok(r.ok);
  assert.equal(r.patch.profile.email, null);
  assert.equal(r.patch.profile.phone2, null);
});

test("parseTenantPatch: empty body or non-object is rejected", () => {
  assert.ok(!admin.parseTenantPatch({}).ok);
  assert.ok(!admin.parseTenantPatch([]).ok);
  assert.ok(!admin.parseTenantPatch(null).ok);
  assert.ok(!admin.parseTenantPatch("x").ok);
});

test("parseTenantPatch: wrong types are field errors, not coercions", () => {
  const r = admin.parseTenantPatch({ name: 5, acceptsOnlineBooking: "yes", branch: "x" });
  assert.ok(!r.ok);
  assert.ok("name" in r.fieldErrors && "acceptsOnlineBooking" in r.fieldErrors && "branch" in r.fieldErrors);
});

test("parseTenantPatch: owner / plan / credit fields are silently NOT part of the patch", () => {
  const r = admin.parseTenantPatch({ name: "A", plan: "ENTERPRISE", suspended: true, creditExempt: true, ownerPhone: "99000000", requireCashSession: true });
  assert.ok(r.ok);
  assert.deepEqual(Object.keys(r.patch.profile), ["name"]);
});

test("parseTenantPatch: branch location needs lat+lng together and in range", () => {
  assert.ok(!admin.parseTenantPatch({ branch: { latitude: 47.9 } }).ok);
  assert.ok(!admin.parseTenantPatch({ branch: { latitude: 91, longitude: 106 } }).ok);
  assert.ok(!admin.parseTenantPatch({ branch: { latitude: 47, longitude: 181 } }).ok);
  assert.ok(!admin.parseTenantPatch({ branch: { latitude: "47", longitude: "106" } }).ok);
  const ok = admin.parseTenantPatch({ branch: { latitude: 47.9, longitude: 106.9 } });
  assert.ok(ok.ok);
  assert.deepEqual(ok.patch.branch, { latitude: 47.9, longitude: 106.9 });
  const clear = admin.parseTenantPatch({ branch: { latitude: null, longitude: null } });
  assert.ok(clear.ok);
  assert.equal(clear.patch.branch.latitude, null);
});

test("parseTenantPatch: branch phone is validated + normalised; text fields trimmed, '' → null, length capped", () => {
  assert.ok(!admin.parseTenantPatch({ branch: { phone: "123" } }).ok);
  const r = admin.parseTenantPatch({ branch: { phone: "+976 99112233", city: " УБ ", address: "" } });
  assert.ok(r.ok);
  assert.equal(r.patch.branch.phone, "99112233");
  assert.equal(r.patch.branch.city, "УБ");
  assert.equal(r.patch.branch.address, null);
  assert.ok(!admin.parseTenantPatch({ branch: { address: "x".repeat(201) } }).ok);
});

test("routes: PATCH/suspend/activate require the right system permission + rate limit + audit", () => {
  const patch = code("../app/api/v1/system/tenants/[id]/route.ts");
  assert.match(patch, /export async function PATCH[\s\S]*requireSystemApiUser\(req, "tenants\.edit"\)/);
  assert.match(patch, /enforceRateLimit\(req, "system-api-tenant-edit"/);
  for (const kind of ["suspend", "activate"]) {
    const s = code(`../app/api/v1/system/tenants/[id]/${kind}/route.ts`);
    assert.match(s, /requireSystemApiUser\(req, "tenants\.suspend"\)/, kind);
    assert.match(s, /enforceRateLimit\(/, kind);
    assert.match(s, /action: "STATUS_CHANGE"/, kind);
    assert.match(s, kind === "suspend" ? /suspendTenant\(id\)/ : /activateTenant\(id\)/);
  }
});

test("edit core never touches the owner User, plan, credit or cash settings", () => {
  const s = code("../lib/system/tenant-admin.ts");
  assert.doesNotMatch(s, /\btx\.user\b|\bprisma\.user\b|\.user\.update/);
  assert.doesNotMatch(s, /plan:|creditExempt|creditSuspended|suspended:/);
  // requireCashSession тогтмол хэвээр дамжина
  assert.match(s, /requireCashSession: current\.requireCashSession/);
  // tenant + салбар жинхэнэ transaction-д
  assert.match(s, /withBookingTransaction\(input\.tenantId/);
});
