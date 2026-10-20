// SEO: robots/sitemap, нүүр «/», хувийн хэсгийн noindex, байгууллага/салбарын
// metadata + schema.org AutoRepair JSON-LD.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

process.env.DATABASE_URL ??= "postgresql://unused/unused";
process.env.SESSION_SECRET ??= "unit-test-placeholder-secret-value-not-real-00";

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

test("absoluteUrl / org & branch URLs", async () => {
  const seo = await import("../lib/seo");
  assert.equal(seo.absoluteUrl("/uploads/a.png"), "https://carservice.mn/uploads/a.png");
  assert.equal(seo.absoluteUrl("https://cdn.x/a.png"), "https://cdn.x/a.png");
  assert.equal(seo.orgUrl({ slug: "ab c" }), "https://carservice.mn/org/ab%20c");
  assert.equal(seo.branchUrl({ slug: "x" }, { id: "b1" }), "https://carservice.mn/org/x/branch/b1");
});

test("openingHoursSpecification uses weekly rows, falls back to branch hours, skips closed/invalid", async () => {
  const { openingHoursSpecification } = await import("../lib/seo");
  const spec = openingHoursSpecification({
    openTime: "09:00",
    closeTime: "18:00",
    schedules: [
      { weekday: "MON", isOpen: true, openTime: null, closeTime: null },
      { weekday: "SAT", isOpen: true, openTime: "10:00", closeTime: "14:00" },
      { weekday: "SUN", isOpen: false, openTime: null, closeTime: null },
      { weekday: "TUE", isOpen: true, openTime: "9am", closeTime: "18:00" },
    ],
  });
  assert.deepEqual(spec, [
    { "@type": "OpeningHoursSpecification", dayOfWeek: "Monday", opens: "09:00", closes: "18:00" },
    { "@type": "OpeningHoursSpecification", dayOfWeek: "Saturday", opens: "10:00", closes: "14:00" },
  ]);
});

test("branchJsonLd is a complete AutoRepair with address, geo, phone; empty fields are omitted", async () => {
  const { branchJsonLd, orgJsonLd, jsonLdString } = await import("../lib/seo");
  const org = { slug: "tov", name: "Төв сервис", logoUrl: "/uploads/logo.png", phone1: "99112233" };
  const ld = branchJsonLd(org, {
    id: "b1",
    name: "Баянзүрх салбар",
    phone: null,
    city: "Улаанбаатар",
    district: "Баянзүрх",
    khoroo: "6-р хороо",
    address: "",
    latitude: 47.9,
    longitude: 106.9,
  }) as Record<string, unknown>;
  assert.equal(ld["@type"], "AutoRepair");
  assert.equal(ld.name, "Төв сервис — Баянзүрх салбар");
  assert.equal(ld.telephone, "99112233");
  assert.equal(ld.image, "https://carservice.mn/uploads/logo.png");
  assert.deepEqual(ld.address, {
    "@type": "PostalAddress",
    streetAddress: "6-р хороо",
    addressLocality: "Баянзүрх",
    addressRegion: "Улаанбаатар",
    addressCountry: "MN",
  });
  assert.deepEqual(ld.geo, { "@type": "GeoCoordinates", latitude: 47.9, longitude: 106.9 });
  assert.equal("openingHoursSpecification" in ld, false);
  const orgLd = orgJsonLd(org, [{ id: "b1", name: "Төв сервис" }]) as Record<string, unknown>;
  const dept = (orgLd.department as Record<string, unknown>[])[0]!;
  assert.equal("@context" in dept, false);
  assert.equal(dept.name, "Төв сервис");
  // Script-breaking content is escaped.
  assert.doesNotMatch(jsonLdString({ n: "</script><script>x" }), /<\/script>/);
});

test("robots disallows private areas and points to the sitemap", () => {
  const src = read("app/robots.ts");
  for (const p of ["/dashboard", "/system", "/account", "/api", "/login", "/page/login"]) {
    assert.match(src, new RegExp(String.raw`"${p}"`), p);
  }
  assert.match(src, /sitemap: `\$\{SITE_URL\}\/sitemap\.xml`/);
});

test("sitemap lists only public, bookable tenants (same rule as discover)", () => {
  const src = read("app/sitemap.ts");
  assert.match(src, /\.\.\.PUBLIC_TENANT_WHERE, acceptsOnlineBooking: true, plan: \{ in: allowedPlans \}/);
  assert.match(src, /branches: \{ where: \{ isActive: true \}/);
  assert.match(src, /export const revalidate = 3600;/);
});

test("home is served at / with canonical; /page/landing permanently redirects", () => {
  assert.match(read("app/page.tsx"), /alternates: \{ canonical: "\/" \}/);
  assert.match(read("app/page/landing/page.tsx"), /permanentRedirect\("\/"\)/);
});

test("private sections are noindex", () => {
  for (const f of [
    "app/dashboard/layout.tsx",
    "app/system/(authed)/layout.tsx",
    "app/(app)/account/layout.tsx",
    "app/login/page.tsx",
    "app/page/login/page.tsx",
    "app/page/forgot/page.tsx",
    "app/page/activate/page.tsx",
    "app/page/choose-branch/page.tsx",
    "app/system/login/page.tsx",
  ]) {
    assert.match(read(f), /robots: \{ index: false, follow: false \}/, f);
  }
});

test("org and branch pages emit description, canonical, OG and JSON-LD", () => {
  const org = read("app/(app)/org/[slug]/page.tsx");
  assert.match(org, /alternates: \{ canonical: orgUrl\(org\) \}/);
  assert.match(org, /<JsonLd data=\{orgJsonLd\(org, org\.branches\)\} \/>/);
  const branch = read("app/(app)/org/[slug]/branch/[branchId]/page.tsx");
  assert.match(branch, /alternates: \{ canonical: branchUrl\(org, branch\) \}/);
  assert.match(branch, /<JsonLd data=\{branchJsonLd\(org, branch\)\} \/>/);
});
