// Хувь хүний регистрээр бүртгүүлсэн байгууллагын нэр = эзний овог нэр байдаг тул
// эзэн dashboard-д засварын нэрээ заавал оруулна (Tenant.shopNameConfirmedAt).

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

test("schema + migration: shopNameConfirmedAt, backfilled for non-person registrations only", () => {
  assert.match(read("prisma/schema.prisma"), /shopNameConfirmedAt\s+DateTime\?/);
  const sql = read("prisma/migrations/20261117150000_tenant_shop_name_confirmed/migration.sql");
  assert.match(sql, /ADD COLUMN\s+"shopNameConfirmedAt" TIMESTAMP\(3\);/);
  // Хувь хүний регистр (lib/tenant-regno.ts PERSON_RE-тэй ижил) null хэвээр.
  assert.match(sql, /WHERE NOT \("registerNumber" ~ '\^\[А-ЯЁӨҮ\]\{2\}\[0-9\]\{8\}\$'\);/);
  assert.match(read("lib/tenant-regno.ts"), /const PERSON_RE = \/\^\[А-ЯЁӨҮ\]\{2\}\\d\{8\}\$\/u;/);
});

test("signup confirms the shop name for organisations only; settings save confirms it", () => {
  assert.match(read("lib/auth/tenant-signup.ts"), /shopNameConfirmedAt: data\.isPerson \? null : new Date\(\),/);
  assert.match(read("lib/tenant-settings.ts"), /data: \{ \.\.\.data, shopNameConfirmedAt: new Date\(\) \},/);
});

test("owner-only blocking dialog comes before the service-type dialog", () => {
  const layout = read("app/dashboard/layout.tsx");
  assert.match(layout, /const showShopNameGate = shopNameRow != null && shopNameRow\.shopNameConfirmedAt == null;/);
  assert.match(layout, /!showShopNameGate &&\s*serviceKeyChoices != null/);
  assert.match(layout, /<ShopNameGate currentName=\{shopNameRow\.name\} \/>/);

  const action = read("app/_actions/tenant-shop-name.ts");
  assert.match(action, /if \(!user\.isOwner\) return \{ ok: false/);
  assert.match(action, /where: \{ name, id: \{ not: user\.tenantId \} \}/);
  assert.match(action, /data: \{ name, shopNameConfirmedAt: new Date\(\) \}/);
  // slug (URL)-ийг өөрчлөхгүй — хуучин холбоос эвдрэхгүй.
  assert.doesNotMatch(action, /slug:/);
});
