// Мобайл аппын store холбоос: super admin хадгална, хоосон бол харагдахгүй,
// зөвхөн жинхэнэ store домэйн, ажилтны layout-ын RLS context-ыг эвдэхгүй.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

process.env.DATABASE_URL ??= "postgresql://unused/unused";
process.env.SESSION_SECRET ??= "unit-test-placeholder-secret-value-not-real-00";

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

test("validateStoreUrl accepts only https links on the right store host", async () => {
  const { validateStoreUrl, hasStoreLinks } = await import("../lib/app-store-links");
  assert.deepEqual(validateStoreUrl("", "appStore"), { ok: true, value: null });
  assert.deepEqual(validateStoreUrl("  ", "playStore"), { ok: true, value: null });
  const ios = validateStoreUrl("https://apps.apple.com/mn/app/carservice/id1234567890", "appStore");
  assert.equal(ios.ok, true);
  const play = validateStoreUrl("https://play.google.com/store/apps/details?id=mn.infosystems.carservice", "playStore");
  assert.equal(play.ok, true);
  assert.equal(validateStoreUrl("http://apps.apple.com/app/id1", "appStore").ok, false);
  assert.equal(validateStoreUrl("https://play.google.com/store/apps/details?id=x", "appStore").ok, false);
  assert.equal(validateStoreUrl("https://evil.example/apps.apple.com", "appStore").ok, false);
  assert.equal(validateStoreUrl("https://apps.apple.com.evil.example/x", "appStore").ok, false);
  assert.equal(validateStoreUrl("javascript:alert(1)", "playStore").ok, false);
  assert.equal(hasStoreLinks({ appStore: null, playStore: null }), false);
  assert.equal(hasStoreLinks({ appStore: null, playStore: "https://play.google.com/x" }), true);
});

test("settings action validates all four store URLs and revalidates every layout", () => {
  const src = read("app/_actions/system-settings.ts");
  for (const f of ["customerAppStoreUrl", "customerPlayStoreUrl", "businessAppStoreUrl", "businessPlayStoreUrl"]) {
    assert.match(src, new RegExp(String.raw`\["${f}", "(appStore|playStore)"\]`), f);
  }
  assert.match(src, /validateStoreUrl\(/);
  assert.match(src, /await requireSuperAdmin\(\);/);
  assert.match(src, /revalidatePath\("\/", "layout"\)/);
});

test("getAppStoreLinks never switches an existing tenant (RLS) context to bypass", () => {
  const src = read("lib/platform-settings.ts");
  const fn = src.slice(src.indexOf("export async function getAppStoreLinks("));
  assert.match(fn.slice(0, 300), /if \(!getTenantContext\(\)\) setBypassContext\(\);/);
  assert.match(fn.slice(0, 300), /readPlatformSettings\(\)/);
  // The dashboard layout (tenant context) must use the context-safe reader.
  const layout = read("app/dashboard/layout.tsx");
  assert.match(layout, /getAppStoreLinks\(\)\.then\(\(l\) => l\.business\)/);
  assert.doesNotMatch(layout, /getPlatformSettings\(/);
});

test("badges render nothing without links; placements are wired", () => {
  const badges = read("app/_components/app-store-badges.tsx");
  assert.match(badges, /if \(items\.length === 0\) return null;/);
  assert.match(badges, /rel="noopener noreferrer"/);
  assert.match(read("app/_components/app-download.tsx"), /if \(apps\.length === 0\) return null;/);
  assert.match(read("app/page.tsx"), /<AppDownload \/>/);
  assert.match(read("app/_components/footer.tsx"), /<StoreBadges links=\{a\.links\} size="sm"/);
  assert.match(read("app/(app)/layout.tsx"), /getAppStoreLinks\(\)\)\.customer/);
  assert.equal((read("app/_components/consumer-sidebar.tsx").match(/<SidebarAppLinks /g) ?? []).length, 2);
  assert.equal((read("app/_components/admin-sidebar.tsx").match(/<SidebarAppLinks /g) ?? []).length, 2);
});

test("schema + migration add the four nullable store URL columns", () => {
  const schema = read("prisma/schema.prisma");
  for (const f of ["customerAppStoreUrl", "customerPlayStoreUrl", "businessAppStoreUrl", "businessPlayStoreUrl"]) {
    assert.match(schema, new RegExp(String.raw`${f}\s+String\?`));
  }
  const sql = read("prisma/migrations/20261020120000_platform_app_store_links/migration.sql");
  assert.equal((sql.match(/ADD COLUMN "\w+" TEXT;/g) ?? []).length, 4);
});
