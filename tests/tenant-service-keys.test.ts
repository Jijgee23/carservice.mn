// Байгууллагын «үзүүлдэг үйлчилгээ» (Tenant.serviceKeys): эзэн заавал сонгоно,
// /book нь системийн бүх төрлийг харуулж, тухайн ажлыг хийдэг бүх газрыг
// (захиалга авдаггүйг ч) гаргана; discovery хайлт ч эдгээрийг тооцно.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

test("schema + migration: Tenant ↔ SystemServiceKey and confirmation timestamp, backfilled from categories", () => {
  const schema = read("prisma/schema.prisma");
  assert.match(schema, /serviceKeysConfirmedAt\s+DateTime\?/);
  assert.match(schema, /serviceKeys\s+SystemServiceKey\[\] @relation\("TenantServiceKeys"\)/);
  assert.match(schema, /tenants\s+Tenant\[\]\s+@relation\("TenantServiceKeys"\)/);
  const sql = read("prisma/migrations/20261117140000_tenant_service_keys/migration.sql");
  assert.match(sql, /CREATE TABLE "_TenantServiceKeys"/);
  assert.match(sql, /INSERT INTO "_TenantServiceKeys" \("A", "B"\)\s+SELECT DISTINCT c\."systemServiceKeyId", c\."tenantId"/);
  // Backfill нь баталгаажуулалт биш — эзэн заавал хянана.
  assert.doesNotMatch(sql, /SET "serviceKeysConfirmedAt"/);
});

test("owner must pick services: blocking gate in dashboard layout, editable in settings", () => {
  const layout = read("app/dashboard/layout.tsx");
  assert.match(layout, /const serviceKeyChoices = user\.isOwner \? await loadServiceKeyChoices\(user\.tenantId\) : null;/);
  assert.match(layout, /!serviceKeyChoices\.confirmed && serviceKeyChoices\.keys\.length > 0/);
  assert.match(layout, /<ServiceKeysGate/);
  assert.match(read("app/dashboard/settings/page.tsx"), /title="Үзүүлдэг үйлчилгээ"/);

  const action = read("app/_actions/tenant-service-keys.ts");
  assert.match(action, /if \(!user\.isOwner\) return \{ ok: false/);
  assert.match(action, /saveTenantServiceKeys\(/);
  // Хадгалах логик нэг газар — вэб action ба mobile PUT хоёул ашиглана.
  const lib = read("lib/tenant-service-keys.ts");
  assert.match(lib, /Дор хаяж нэг үйлчилгээ сонгоно уу\./);
  assert.match(lib, /where: \{ id: \{ in: requested \}, isActive: true \}/);
  assert.match(lib, /serviceKeys: \{ set: valid\.map/);
  assert.match(lib, /serviceKeysConfirmedAt: new Date\(\)/);
});

test("mobile APIs: tenant service keys (owner PUT), onboarding flags, public booking fee", () => {
  const route = read("app/api/v1/tenant/service-keys/route.ts");
  assert.match(route, /export async function GET/);
  assert.match(route, /if \(!auth\.user\.isOwner\) return jsonForbidden/);
  assert.match(route, /saveTenantServiceKeys\(\{ tenantId: auth\.user\.tenantId, userId: auth\.user\.id \}, ids\)/);
  const tenant = read("app/api/v1/tenant/route.ts");
  assert.match(tenant, /needsShopName: user\.isOwner && shopNameConfirmedAt == null,/);
  assert.match(tenant, /needsServiceKeys: user\.isOwner && serviceKeysConfirmedAt == null,/);
  assert.match(read("app/api/v1/app/booking-fee/route.ts"), /jsonOk\(\{ fee: await getBookingFeeNotice\(\) \}\)/);
});

test("/book lists every active system service type and matches all public shops", () => {
  const page = read("app/(app)/book/page.tsx");
  assert.match(page, /prisma\.systemServiceKey\.findMany\(\{\s*where: \{ isActive: true \},/);
  const book = read("app/_actions/book.ts");
  // Шүүлт нь нийтийн бүх газар (acceptsOnlineBooking-оор шүүхгүй — зөвхөн select-д).
  assert.match(book, /where: \{\s*\.\.\.PUBLIC_TENANT_WHERE,\s*branches: \{ some: \{ isActive: true \} \},/);
  assert.match(book, /\{ serviceKeys: \{ some: \{ id \} \} \},/);
  assert.match(book, /const bookable = isTenantBookable\(t, allowedPlans\);/);
  assert.match(book, /return results\.sort\(\(a, b\) => Number\(b\.bookable\) - Number\(a\.bookable\)\);/);
  const flow = read("app/(app)/book/booking-flow.tsx");
  assert.match(flow, /href=\{r\.href\}/);
  assert.match(flow, /\{r\.bookable \? "Цаг авах" : "Дэлгэрэнгүй"\}/);
});

test("discovery search and mobile key list honour tenant-selected service types", () => {
  const catalog = read("lib/discovery-catalog.ts");
  assert.match(catalog, /\.\.\.tenant\.serviceKeys\.map\(\(key\) => key\.id\)/);
  assert.match(catalog, /\{ serviceKeys: \{ some: \{ isActive: true, name: \{ contains: filters\.query/);
  assert.match(read("app/(app)/discover/page.tsx"), /\.\.\.t\.serviceKeys\.map\(\(k\) => k\.name\)/);
  assert.match(read("app/api/v1/app/service-keys/route.ts"), /where: \{ isActive: true \},/);
});
