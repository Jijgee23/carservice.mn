// Discover / газрын зураг: олон нийтэд харагдах БҮХ газрыг харуулна;
// «Цаг захиалах» зөвхөн онлайн захиалга авдаг (bookable) газарт.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

test("isTenantBookable requires the toggle AND a plan with «Цаг захиалга» (enable_appointments)", async () => {
  const { isTenantBookable } = await import("../lib/tenant-visibility");
  const plans = ["BUSINESS", "ENTERPRISE"] as const;
  assert.equal(isTenantBookable({ acceptsOnlineBooking: true, plan: "BUSINESS" }, plans), true);
  assert.equal(isTenantBookable({ acceptsOnlineBooking: false, plan: "BUSINESS" }, plans), false);
  assert.equal(isTenantBookable({ acceptsOnlineBooking: true, plan: "FREE" as never }, plans), false);
});

test("web discovery and mobile API include non-bookable tenants, flagged by `bookable`", () => {
  assert.match(read("app/api/web/discovery/route.ts"), /includeNonBookable: true/);
  assert.match(read("app/api/web/discovery/map/route.ts"), /includeNonBookable: true/);
  assert.match(read("app/api/v1/app/orgs/route.ts"), /includeNonBookable: true/);
  assert.match(read("app/api/v1/app/orgs/route.ts"), /bookable: organization\.bookable/);
  assert.match(read("app/api/v1/app/orgs/map/route.ts"), /includeNonBookable: true/);
  const detail = read("app/api/v1/app/orgs/[slug]/route.ts");
  assert.match(detail, /where: \{ slug, \.\.\.PUBLIC_TENANT_WHERE \}/);
  assert.match(detail, /bookable = isTenantBookable\(/);
  assert.match(detail, /branches: \{\s*where: \{ isActive: true \}/);
  const catalog = read("lib/discovery-catalog.ts");
  assert.match(catalog, /const includeNonBookable = options\?\.includeNonBookable \?\? false;/);
  assert.match(catalog, /tenant: tenantVisibilityWhere/);
});

test("discover page lists every public tenant with a branch and flags bookable", () => {
  const src = read("app/(app)/discover/page.tsx");
  assert.match(src, /where: \{ \.\.\.PUBLIC_TENANT_WHERE, branches: \{ some: \{ isActive: true \} \} \}/);
  assert.match(src, /bookable: isTenantBookable\(t, allowedPlans\)/);
});

test("discover UI shows the booking link only for bookable orgs", () => {
  const src = read("app/(app)/discover/discover-client.tsx");
  assert.match(src, /\{selected\.org\.bookable \? \(/);
  assert.match(src, /org\.bookable\s*\?\s*bookingHref\(org\.slug, org\.branches\[0\]\.id\)\s*:\s*branchDetailHref\(/);
});

test("branch page gates «Цаг захиалах»; org booking page redirects non-bookable tenants", () => {
  const branch = read("app/(app)/org/[slug]/branch/[branchId]/page.tsx");
  assert.match(branch, /where: \{ slug, \.\.\.PUBLIC_TENANT_WHERE \}/);
  assert.equal((branch.match(/bookable \? \(/g) ?? []).length, 2);
  const org = read("app/(app)/org/[slug]/page.tsx");
  assert.match(org, /where: \{ slug, \.\.\.PUBLIC_TENANT_WHERE \}/);
  assert.match(org, /if \(!bookable\) \{[\s\S]*?redirect\(`\/org\/\$\{org\.slug\}\/branch\//);
});
