// /system/subscriptions шүүлтүүр + тенантын төлбөрийн түүх.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

process.env.DATABASE_URL ??= "postgresql://unused/unused";
process.env.SESSION_SECRET ??= "unit-test-placeholder-secret-value-not-real-00";

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

test("filters are whitelisted per tab; junk is dropped", async () => {
  const { parseSubscriptionHistoryFilters } = await import("../lib/subscription-history");
  const f = parseSubscriptionHistoryFilters({ tab: "payments", plan: "BUSINESS", status: "PAID", from: "2026-10-01", to: "x", q: " Төв " });
  assert.deepEqual(f, { tab: "payments", q: "Төв", plan: "BUSINESS", status: "PAID", from: "2026-10-01", to: "" });
  // A subscription status is not valid on the payments tab (and vice versa).
  assert.equal(parseSubscriptionHistoryFilters({ tab: "payments", status: "ACTIVE" }).status, "");
  assert.equal(parseSubscriptionHistoryFilters({ status: "PAID" }).status, "");
  assert.equal(parseSubscriptionHistoryFilters({ tab: "evil", plan: "GOD" }).tab, "subscriptions");
  assert.equal(parseSubscriptionHistoryFilters({ plan: "GOD" }).plan, "");
});

test("date range uses Ulaanbaatar day bounds and includes the `to` day", async () => {
  const { dateRange } = await import("../lib/subscription-history");
  const r = dateRange({ from: "2026-10-01", to: "2026-10-31" })!;
  assert.equal(r.gte!.toISOString(), "2026-09-30T16:00:00.000Z");
  assert.equal(r.lt!.toISOString(), "2026-10-31T16:00:00.000Z");
  assert.equal(dateRange({ from: "", to: "" }), undefined);
});

test("where builders map filters and search the tenant", async () => {
  const { paymentWhere, subscriptionWhere } = await import("../lib/subscription-history");
  const base = { tab: "subscriptions" as const, q: "", plan: "" as const, status: "", from: "", to: "" };
  assert.deepEqual(subscriptionWhere(base), {});
  const w = paymentWhere({ ...base, tab: "payments", q: "abc", plan: "ENTERPRISE", status: "PENDING" }) as Record<string, unknown>;
  assert.equal(w.plan, "ENTERPRISE");
  assert.equal(w.status, "PENDING");
  assert.ok((w.tenant as { OR: unknown[] }).OR.length === 3);
});

test("page/export are super-admin only, totals exclude test tenants, sidebar links it", () => {
  const page = read("app/system/(authed)/subscriptions/page.tsx");
  assert.match(page, /await requireSuperAdmin\(\);/);
  assert.match(page, /\{ status: "PAID" as const, tenant: \{ isTest: false \} \}/);
  const exp = read("app/system/(authed)/subscriptions/export/route.ts");
  assert.match(exp, /await requireSuperAdmin\(\);/);
  assert.match(exp, /parseSubscriptionHistoryFilters\(sp\)/);
  assert.match(read("app/_components/system-sidebar.tsx"), /href: "\/system\/subscriptions"/);
});

test("tenant subscription page shows its own payment history only", () => {
  const src = read("app/dashboard/settings/subscription/page.tsx");
  assert.match(src, /subscriptionPayment\.findMany\(\{\s*where: \{ tenantId: user\.tenantId \}/);
  assert.match(src, /Төлбөрийн түүх/);
});
