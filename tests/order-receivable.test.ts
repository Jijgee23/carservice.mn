import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

process.env.DATABASE_URL ??= "postgresql://unused/unused";
process.env.SESSION_SECRET ??= "unit-test-placeholder-secret-value-not-real-00";

const D = (n: number | string) => ({ toString: () => String(n) });

test("sumReceivable counts unpaid completed orders regardless of postpaid, ignores overpaid", async () => {
  const { sumReceivable } = await import("../lib/orders/order-receivable");
  const { Prisma } = await import("../app/generated/prisma/client");
  const dec = (n: number) => new Prisma.Decimal(n);
  const rows = [
    { totalAmount: dec(102000), payments: [] }, // #00016: completed, nothing paid
    { totalAmount: dec(50000), payments: [{ amount: dec(20000) }] }, // partial
    { totalAmount: dec(30000), payments: [{ amount: dec(30000) }] }, // fully paid
    { totalAmount: dec(10000), payments: [{ amount: dec(15000) }] }, // overpaid: no negative offset
    { totalAmount: null, payments: [] },
  ];
  assert.equal(sumReceivable(rows).toString(), "132000");
  assert.equal(sumReceivable([]).toString(), "0");
  void D;
});

test("RECEIVABLE_ORDER_WHERE excludes postpaid-agnostic internal/cancelled/zero/paid orders and composes with other filters via AND", async () => {
  const { RECEIVABLE_ORDER_WHERE, sumReceivable } = await import("../lib/orders/order-receivable");
  // Minimal evaluator for the where fragment, applied to candidate rows.
  const ok = (o: { status: string; isInternal: boolean; totalAmount: number; paymentStatus: string }) =>
    o.status === RECEIVABLE_ORDER_WHERE.status &&
    o.isInternal === RECEIVABLE_ORDER_WHERE.isInternal &&
    o.totalAmount > RECEIVABLE_ORDER_WHERE.totalAmount.gt &&
    o.paymentStatus !== RECEIVABLE_ORDER_WHERE.paymentStatus.not;
  const base = { status: "COMPLETED", isInternal: false, totalAmount: 102000, paymentStatus: "UNPAID" };
  assert.ok(ok(base));
  assert.ok(ok({ ...base, paymentStatus: "PARTIAL" }));
  assert.ok(!ok({ ...base, status: "CANCELLED" }));
  assert.ok(!ok({ ...base, status: "IN_PROGRESS" }));
  assert.ok(!ok({ ...base, isInternal: true }));
  assert.ok(!ok({ ...base, totalAmount: 0 }));
  assert.ok(!ok({ ...base, paymentStatus: "PAID" }));
  assert.equal(sumReceivable([]).toString(), "0");
});

test("overview loader uses the shared receivable helper with tenant + branch scope", () => {
  const dir = dirname(fileURLToPath(import.meta.url));
  const src = readFileSync(resolve(dir, "../lib/overview.ts"), "utf8");
  assert.match(src, /sumReceivable\(receivableOrders\)/);
  assert.match(src, /\.\.\.orderBranchFilter,[\s\S]*?\.\.\.RECEIVABLE_ORDER_WHERE/);
  assert.doesNotMatch(src, /isPostpaid: true,\s*status: \{ not: "CANCELLED" \}/);
  const page = readFileSync(resolve(dir, "../app/dashboard/page.tsx"), "utf8");
  assert.doesNotMatch(page, /ДАРАА ТӨЛБӨРТ|дараа төлбөрт\)/i);
});

test("orders list supports unpaid=1 with the same definition; dashboard card links to it", () => {
  const dir = dirname(fileURLToPath(import.meta.url));
  const list = readFileSync(resolve(dir, "../app/dashboard/orders/page.tsx"), "utf8");
  assert.match(list, /unpaid === "1"[\s\S]*RECEIVABLE_ORDER_WHERE/);
  const page = readFileSync(resolve(dir, "../app/dashboard/page.tsx"), "utf8");
  assert.match(page, /href="\/dashboard\/orders\?unpaid=1"/);
});

test("orders list composes unpaid with AND; overview applies orderReadWhere", () => {
  const dir = dirname(fileURLToPath(import.meta.url));
  const list = readFileSync(resolve(dir, "../app/dashboard/orders/page.tsx"), "utf8");
  assert.match(list, /where\.AND = \[/);
  assert.doesNotMatch(list, /Object\.assign\(where, RECEIVABLE/);
  const ov = readFileSync(resolve(dir, "../lib/overview.ts"), "utf8");
  assert.match(ov, /orderReadWhere\(user\.orderAccess\)/);
});
