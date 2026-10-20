// Tenant.isTest — тест/демо тенант олон нийтэд харагдахгүй, онлайн захиалга
// авахгүй, системийн статистикаас хасагдана; зөвхөн super admin тохируулна.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

test("isTenantPublic hides suspended and test tenants", async () => {
  const { isTenantPublic, PUBLIC_TENANT_WHERE } = await import("../lib/tenant-visibility");
  assert.equal(isTenantPublic({ suspended: false, isTest: false }), true);
  assert.equal(isTenantPublic({ suspended: false, isTest: true }), false);
  assert.equal(isTenantPublic({ suspended: true, isTest: false }), false);
  assert.deepEqual(PUBLIC_TENANT_WHERE, { suspended: false, isTest: false });
});

test("schema + migration add Tenant.isTest defaulting to false", () => {
  assert.match(read("prisma/schema.prisma"), /isTest\s+Boolean\s+@default\(false\)/);
  assert.match(
    read("prisma/migrations/20261020100000_tenant_is_test/migration.sql"),
    /ALTER TABLE "Tenant" ADD COLUMN "isTest" BOOLEAN NOT NULL DEFAULT false;/,
  );
});

// Every public tenant query/guard must exclude test tenants.
const PUBLIC_QUERIES = [
  "lib/discovery-catalog.ts",
  "app/(app)/discover/page.tsx",
  "app/(app)/org/[slug]/page.tsx",
  "app/(app)/org/[slug]/branch/[branchId]/page.tsx",
  "app/(app)/book/branch/[branchId]/page.tsx",
  "app/_actions/book.ts",
  "app/api/v1/app/orgs/[slug]/route.ts",
];
for (const file of PUBLIC_QUERIES) {
  test(`public query excludes test tenants: ${file}`, () => {
    const src = read(file);
    const filters = src.match(/acceptsOnlineBooking: true,?\s*suspended: false,?\s*isTest: false/g) ?? [];
    const all = src.match(/acceptsOnlineBooking: true,?\s*suspended: false/g) ?? [];
    assert.ok(all.length > 0, "expected a public tenant filter");
    assert.equal(filters.length, all.length, "every public tenant filter must carry isTest: false");
  });
}

test("online booking guards reject test tenants (staff registration still allowed)", () => {
  assert.match(read("lib/public-availability.ts"), /branch\.tenant\.isTest \|\|/);
  assert.match(
    read("lib/appointment-reservations.ts"),
    /!input\.staffUserId && \(!branch\.tenant\.acceptsOnlineBooking \|\| branch\.tenant\.isTest\)/,
  );
  for (const file of ["app/_actions/appointments.ts", "app/api/v1/app/appointments/route.ts"]) {
    assert.match(read(file), /branch\.tenant\.suspended \|\| branch\.tenant\.isTest\)/, file);
  }
});

test("landing logos and cross-tenant account history skip test tenants", () => {
  assert.match(read("app/_components/logo-marquee.tsx"), /where: PUBLIC_TENANT_WHERE/);
  const vehicles = read("lib/vehicles.ts");
  const fn = vehicles.slice(vehicles.indexOf("export function customerOwnershipFilters("));
  assert.match(fn.slice(0, 900), /tenant: \{ isTest: false \}/);
  assert.match(fn.slice(0, 900), /\{ customer: \{ accountId, \.\.\.publicTenant \} \}/);
  assert.match(fn.slice(0, 900), /\{ customer: \{ phone, \.\.\.publicTenant \} \}/);
});

test("only super admin toggles isTest, with audit; tenants cannot set it", () => {
  const src = read("app/_actions/system-tenants.ts");
  const fn = src.slice(src.indexOf("export async function setTenantTestAction("));
  const body = fn.slice(0, fn.indexOf("\nexport "));
  assert.match(body, /await requireSuperAdmin\(\);/);
  assert.match(body, /logAudit\(/);
  assert.doesNotMatch(read("app/_actions/tenant.ts"), /isTest/);
  assert.doesNotMatch(read("app/_actions/auth.ts"), /isTest/);
});

test("system overview and booking revenue totals exclude test tenants", () => {
  const overview = read("app/system/(authed)/page.tsx");
  assert.match(overview, /const REAL_TENANT = \{ isTest: false \}/);
  assert.match(overview, /prisma\.tenant\.count\(\{ where: REAL_TENANT \}\)/);
  assert.match(overview, /subscriptionPayment\.aggregate\(\{\s*where: \{ status: "PAID", tenant: REAL_TENANT \}/);
  assert.match(overview, /appointmentPayment\.aggregate\(\{\s*where: \{ status: "PAID", tenant: REAL_TENANT \}/);
  const revenue = read("app/system/(authed)/booking-revenue/page.tsx");
  assert.match(revenue, /where: \{ status: "PAID", \.\.\.REAL_TENANT_PAYMENT \}/);
  assert.match(revenue, /where: \{ status: "REFUNDED", \.\.\.REAL_TENANT_PAYMENT \}/);
  // Refund / underpaid work queues must never hide real money.
  assert.match(revenue, /refundNote: \{ startsWith: REFUND_CLAIM_PREFIX \} \}/);
});
