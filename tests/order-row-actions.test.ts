// Засварын хуудасны жагсаалтын мөрийн үйлдлүүд: «Төлбөр бүртгэх», «Бүх ажлыг
// дуусгах», «Төлөв өөрчлөх» — shared guard + command/action source guards.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

process.env.DATABASE_URL ??= "postgresql://unused/unused";
process.env.SESSION_SECRET ??= "unit-test-placeholder-secret-value-not-real-00";

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

test("orderCompleteBlockedReason mirrors the detail page rules", async () => {
  const { orderCompleteBlockedReason } = await import("../lib/orders/order-complete-guard");
  const { Prisma } = await import("../app/generated/prisma/client");
  const base = {
    unfilledDiagnostics: 0,
    unfinishedItems: 0,
    isInternal: false,
    isPostpaid: false,
    remaining: new Prisma.Decimal(0),
    canCloseUnpaidPostpaid: false,
  };
  assert.equal(orderCompleteBlockedReason(base), null);
  assert.equal(orderCompleteBlockedReason({ ...base, unfilledDiagnostics: 1, unfinishedItems: 2 }), "Бөглөгдөөгүй оношилгоо байна.");
  assert.equal(orderCompleteBlockedReason({ ...base, unfinishedItems: 2 }), "Дуусаагүй 2 ажил байна.");
  assert.match(orderCompleteBlockedReason({ ...base, remaining: new Prisma.Decimal(5000) })!, /Төлбөр бүрэн төлөгдөөгүй/);
  assert.equal(orderCompleteBlockedReason({ ...base, isInternal: true, remaining: new Prisma.Decimal(5000) }), null);
  assert.notEqual(orderCompleteBlockedReason({ ...base, isPostpaid: true, remaining: new Prisma.Decimal(5000) }), null);
  assert.equal(
    orderCompleteBlockedReason({ ...base, isPostpaid: true, remaining: new Prisma.Decimal(5000), canCloseUnpaidPostpaid: true }),
    null,
  );
});

test("completeAllOrderItemsCommand keeps the per-item status rules under one order lock", () => {
  const src = read("lib/orders/order-item-commands.ts");
  const start = src.indexOf("export async function completeAllOrderItemsCommand(");
  assert.notEqual(start, -1);
  const block = src.slice(start, src.indexOf("\nexport ", start + 10));
  assert.match(block, /withOrderTransaction\(/);
  assert.match(block, /canChangeOrderItemStatus\(actor, order\)/);
  assert.match(block, /isOrderBranchInScope\(actor, order\.branchId, scope\)/);
  assert.match(block, /assertOrderInProgressForItemStatus\(order\.status\)/);
  // Parts have no progress; cancelled/completed rows are never touched.
  assert.match(block, /status: \{ in: \["PENDING", "IN_PROGRESS"\] \}, kind: \{ in: \["LABOR", "DIAGNOSTIC"\] \}/);
  // A diagnostic without a filled report is skipped, never force-completed.
  assert.match(block, /item\.kind === "DIAGNOSTIC" && !item\.diagnosticReportId/);
  assert.match(block, /serviceItemTimingPatch\("COMPLETED", item\.startedAt\)/);
  assert.match(block, /logAudit\(/);
});

test("completeAllOrderItemsAction requires orders.itemStatus and an active subscription", () => {
  const src = read("app/_actions/orders.ts");
  const fn = src.slice(src.indexOf("export async function completeAllOrderItemsAction("));
  const body = fn.slice(0, fn.indexOf("\nexport "));
  assert.match(body, /authorizeItemStatus\(\)/);
  assert.match(body, /completeAllOrderItemsCommand\(\{ actor: user, orderId \}\)/);
});

test("quick context is tenant/branch scoped and view-checked; list payment omits QPay", () => {
  const ctx = read("app/_actions/order-quick-context.ts");
  assert.match(ctx, /^"use server";/);
  assert.match(ctx, /canView\(user, "orders"\)/);
  assert.match(ctx, /tenantId: user\.tenantId, \.\.\.\(scopeBranchId \? \{ branchId: scopeBranchId \} : \{\}\)/);
  assert.match(ctx, /canViewOrder\(user, order\)/);
  // The context never carries anything that authorizes a write by itself.
  assert.doesNotMatch(ctx, /\.(create|update|delete|upsert)\(/);

  const ui = read("app/dashboard/orders/order-row-actions.tsx");
  assert.match(ui, /recordOrderPaymentAction\(null, fd\)/);
  assert.match(ui, /includeQpay=\{false\}/);
  assert.match(ui, /order\.status === "IN_PROGRESS"/);
});

test("detail page uses the shared complete guard (no drift with the list)", () => {
  const page = read("app/dashboard/orders/[id]/page.tsx");
  assert.match(page, /orderCompleteBlockedReason\(\{/);
});
