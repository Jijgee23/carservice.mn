import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";

process.env.DATABASE_URL ??= "postgresql://unused/unused";
process.env.SESSION_SECRET ??= "unit-test-placeholder-secret-value-not-real-00";

const src = (rel: string) => readFile(new URL(`../${rel}`, import.meta.url), "utf8").then((s) => s.replace(/\r\n/g, "\n"));

test("parseCountedQty: blank = not counted; non-negative, ≤ 3 decimals, comma accepted", async () => {
  const { parseCountedQty } = await import("../lib/stock-counts");
  const v = (raw: unknown) => {
    const r = parseCountedQty(raw);
    return r.ok ? (r.value == null ? null : r.value.toString()) : "ERR";
  };
  assert.equal(v(""), null);
  assert.equal(v("  "), null);
  assert.equal(v(null), null);
  assert.equal(v("0"), "0");
  assert.equal(v("12"), "12");
  assert.equal(v("2,5"), "2.5");
  assert.equal(v(" 1 000 "), "1000");
  assert.equal(v("0.125"), "0.125");
  assert.equal(v(7), "7");
  for (const bad of ["-1", "1.2345", "abc", "1e3", "1.2.3"]) assert.equal(v(bad), "ERR", bad);
});

test("summarizeStockCount: only counted lines; shortage / surplus valued at cost (no cost = 0)", async () => {
  const { summarizeStockCount } = await import("../lib/stock-counts");
  const s = summarizeStockCount([
    { systemQty: "10", countedQty: "8", costPrice: "5000" }, // −2 × 5000
    { systemQty: "3", countedQty: "4.5", costPrice: "2000" }, // +1.5 × 2000
    { systemQty: "7", countedQty: "7", costPrice: "100" }, // match
    { systemQty: "5", countedQty: null, costPrice: "100" }, // not counted
    { systemQty: "1", countedQty: "0", costPrice: null }, // −1, unknown cost
  ]);
  assert.deepEqual(
    { ...s, shortageValue: s.shortageValue.toString(), surplusValue: s.surplusValue.toString() },
    { lineCount: 5, countedCount: 4, diffCount: 3, shortageValue: "10000", surplusValue: "3000" },
  );
});

test("labels", async () => {
  const { stockCountLabel, personName } = await import("../lib/stock-counts");
  assert.equal(stockCountLabel(7), "ТО-0007");
  assert.equal(stockCountLabel(12345), "ТО-12345");
  assert.equal(personName({ firstName: "Бат", lastName: "Дорж" }), "Д. Бат");
  assert.equal(personName(null), "—");
});

test("service: edit permission, one DRAFT, atomic increment by (counted − snapshot), DRAFT→COMPLETED claim, audits", async () => {
  const s = await src("lib/stock-counts.ts");
  assert.match(s, /canEdit\(actor, "services"\)/);
  assert.match(s, /findFirst\(\{ where: \{ tenantId, status: "DRAFT" \}/);
  assert.match(s, /const diff = l\.countedQty\.minus\(l\.systemQty\)/);
  assert.match(s, /data: \{ stock: \{ increment: diff \} \}/);
  assert.match(s, /updateMany\(\{\s*where: \{ id: count\.id, tenantId, status: "DRAFT" \},\s*data: \{ status: "COMPLETED"/);
  assert.match(s, /if \(l\.countedQty == null\) continue;/);
  assert.match(s, /reason: "STOCK_COUNT"/);
  // Snapshot keeps name / code / unit / cost so history survives edits and deletes.
  assert.match(s, /name: g\.name,\s*code: g\.code,\s*unit: g\.unit\?\.name \?\? null,\s*costPrice: g\.costPrice,\s*systemQty:/);
});

test("migration: tables, one-draft partial index, RLS on both tables", async () => {
  const sql = await src("prisma/migrations/20261014150000_stock_counts/migration.sql");
  assert.match(sql, /CREATE TABLE "StockCount"/);
  assert.match(sql, /CREATE TABLE "StockCountLine"/);
  assert.match(sql, /CREATE UNIQUE INDEX IF NOT EXISTS "StockCount_one_draft_per_tenant_key" ON "StockCount"\("tenantId"\) WHERE "status" = 'DRAFT'/);
  for (const t of ["StockCount", "StockCountLine"]) {
    assert.match(sql, new RegExp(`ALTER TABLE "${t}" FORCE ROW LEVEL SECURITY`));
    assert.match(sql, new RegExp(`CREATE POLICY tenant_isolation ON "${t}"`));
  }
  assert.doesNotMatch(sql, /DROP\s|DELETE\s+FROM|TRUNCATE/i);
  assert.match(await src("prisma/schema.prisma"), /StockCount_one_draft_per_tenant_key/);
});

test("wiring: tabs, sidebar, actions check subscription, pages check services view / edit", async () => {
  assert.match(await src("app/dashboard/services/tabs.tsx"), /\{ href: "\/dashboard\/services\/stock-counts", label: "Тооллого" \}/);
  assert.match(await src("app/_components/admin-sidebar.tsx"), /\{ href: "\/dashboard\/services\/stock-counts", label: "Тооллого" \}/);
  const actions = await src("app/_actions/stock-counts.ts");
  assert.match(actions, /^"use server";/);
  assert.equal(actions.match(/await assertActiveSubscription\(user\.tenantId\)/g)?.length, 4);
  assert.match(actions, /unstable_rethrow/);
  assert.match(await src("app/dashboard/services/stock-counts/page.tsx"), /if \(!canView\(user, "services"\)\) redirect/);
  const detail = await src("app/dashboard/services/stock-counts/[id]/page.tsx");
  assert.match(detail, /const editable = count\.status === "DRAFT" && canEdit\(user, "services"\)/);
  assert.match(await src("lib/audit.ts"), /"StockCount",/);
});
