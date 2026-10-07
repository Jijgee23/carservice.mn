import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

process.env.DATABASE_URL ??= "postgresql://unused/unused";
process.env.SESSION_SECRET ??= "unit-test-placeholder-secret-value-not-real-00";

const here = dirname(fileURLToPath(import.meta.url));
const read = (file: string) =>
  readFileSync(resolve(here, "..", file), "utf8").split(String.fromCharCode(13)).join("");

const OWNER = { isOwner: true, role: null } as never;
const STAFF = { isOwner: false, role: { permissions: ["orders.edit"] } } as never;

// ---- conflict -------------------------------------------------------------

test("internal + postpaid conflict: pure rule returns 422 ORDER_INTERNAL_POSTPAID_CONFLICT", async () => {
  const { internalPostpaidConflict } = await import("../lib/orders/order-internal");
  const v = internalPostpaidConflict(true, true);
  assert.equal(v?.status, 422);
  assert.equal(v?.code, "ORDER_INTERNAL_POSTPAID_CONFLICT");
  assert.equal(v?.message, "Дотоод засвар болон дараа тооцоо зэрэг байж болохгүй.");
  assert.equal(internalPostpaidConflict(true, false), null);
  assert.equal(internalPostpaidConflict(true, undefined), null);
  assert.equal(internalPostpaidConflict(false, true), null);
  assert.equal(internalPostpaidConflict(undefined, true), null);
});

test("POST parser: isInternal optional boolean, conflict -> 422 with code", async () => {
  const { parseCreateOrderBody } = await import("../lib/orders/order-create-request");
  const base = { branchId: "b", customerId: "c", vehicleId: "v" };
  const ok = parseCreateOrderBody({ ...base, isInternal: true });
  assert.equal(ok.ok, true);
  if (ok.ok) assert.equal(ok.value.isInternal, true);
  const omitted = parseCreateOrderBody(base);
  assert.equal(omitted.ok && "isInternal" in omitted.value, false);
  const bad = parseCreateOrderBody({ ...base, isInternal: "yes" });
  assert.equal(bad.ok ? null : bad.status, 400);
  const conflict = parseCreateOrderBody({ ...base, isInternal: true, isPostpaid: true });
  assert.equal(conflict.ok, false);
  if (!conflict.ok) {
    assert.equal(conflict.status, 422);
    assert.equal(conflict.code, "ORDER_INTERNAL_POSTPAID_CONFLICT");
  }
});

test("createOrderCommand rejects internal + postpaid before touching the database", async () => {
  const { createOrderCommand } = await import("../lib/orders/order-create-command");
  await assert.rejects(
    createOrderCommand({
      tenantId: "t",
      actorId: "u",
      branchId: "b",
      customerId: "c",
      vehicleId: "v",
      assignedToId: "u",
      scheduledAt: null,
      notes: null,
      isInternal: true,
      isPostpaid: true,
    }),
    (e: { status?: number; code?: string }) => e.status === 422 && e.code === "ORDER_INTERNAL_POSTPAID_CONFLICT",
  );
});

test("PATCH: internal on an order that already has PAID payments -> 409 ORDER_INTERNAL_HAS_PAYMENTS", async () => {
  const { internalHasPaymentsViolation } = await import("../lib/orders/order-internal");
  const v = internalHasPaymentsViolation(true, false, true);
  assert.equal(v?.status, 409);
  assert.equal(v?.code, "ORDER_INTERNAL_HAS_PAYMENTS");
  assert.equal(v?.message, "Төлбөр бүртгэгдсэн захиалгыг дотоод засвар болгох боломжгүй.");
  assert.equal(internalHasPaymentsViolation(true, false, false), null);
  assert.equal(internalHasPaymentsViolation(true, true, true), null); // already internal
  assert.equal(internalHasPaymentsViolation(false, false, true), null);
  assert.equal(internalHasPaymentsViolation(undefined, false, true), null);
  // Both write paths wire the check inside the order lock.
  assert.match(read("lib/orders/order-commands.ts"), /internalHasPaymentsViolation\(input\.isInternal, order\.isInternal/);
  assert.match(read("app/_actions/orders.ts"), /internalHasPaymentsViolation\(explicitInternal, fresh\.isInternal/);
});

test("vehicle change never re-enables postpaid on an internal order", async () => {
  const { resolveUpdatedIsPostpaid } = await import("../lib/orders/order-internal");
  const args = { explicitPostpaid: undefined, vehicleChanged: true, vehicleIsPostpaid: true };
  assert.equal(resolveUpdatedIsPostpaid({ ...args, nextIsInternal: true }), false);
  assert.equal(resolveUpdatedIsPostpaid({ ...args, nextIsInternal: false }), true);
  assert.equal(resolveUpdatedIsPostpaid({ ...args, vehicleChanged: false, nextIsInternal: false }), undefined);
  assert.equal(resolveUpdatedIsPostpaid({ ...args, explicitPostpaid: false, nextIsInternal: false }), false);
});

// ---- completion -----------------------------------------------------------

test("completion: internal order completes with zero payment; ordinary order still PAYMENT_INCOMPLETE", async () => {
  const { assertCompletionPaymentAllowed } = await import("../lib/orders/order-commands");
  const { Prisma } = await import("../app/generated/prisma/client");
  const base = { actor: STAFF, totalAmount: new Prisma.Decimal(100), paid: new Prisma.Decimal(0) };
  assert.doesNotThrow(() => assertCompletionPaymentAllowed({ ...base, isPostpaid: false, isInternal: true }));
  assert.throws(
    () => assertCompletionPaymentAllowed({ ...base, isPostpaid: false, isInternal: false }),
    (e: { code?: string }) => e.code === "PAYMENT_INCOMPLETE",
  );
  assert.throws(
    () => assertCompletionPaymentAllowed({ ...base, isPostpaid: false }),
    (e: { code?: string }) => e.code === "PAYMENT_INCOMPLETE",
  );
  assert.doesNotThrow(() => assertCompletionPaymentAllowed({ ...base, actor: OWNER, isPostpaid: true, isInternal: true }));
});

test("order detail page mirrors the completion guard for internal orders", () => {
  const src = read("app/dashboard/orders/[id]/page.tsx");
  const i = src.indexOf("const completeBlockedReason");
  assert.ok(i > 0);
  assert.match(src.slice(i, i + 600), /order\.isInternal\s*\?\s*null/);
});

// ---- payments -------------------------------------------------------------

test("payment access check rejects internal orders with 409 ORDER_INTERNAL_NO_PAYMENT", async () => {
  const { assertPaymentAccess } = await import("../lib/orders/order-payment-commands");
  const actor = { id: "u", tenantId: "t", isOwner: true, role: null, workingBranchId: null } as never;
  const order = { branchId: "b", assignedToId: null, status: "IN_PROGRESS", isPostpaid: false, isInternal: true };
  assert.throws(
    () => assertPaymentAccess(actor, order, null),
    (e: { status?: number; code?: string; message?: string }) =>
      e.status === 409 && e.code === "ORDER_INTERNAL_NO_PAYMENT" && e.message === "Дотоод засварт төлбөр бүртгэхгүй.",
  );
  assert.doesNotThrow(() => assertPaymentAccess(actor, { ...order, isInternal: false }, null));
});

test("every payment command goes through assertPaymentAccess (record, reverse, reverse-all, QPay create/check/cancel)", () => {
  const src = read("lib/orders/order-payment-commands.ts");
  const fns = [
    "createOrderPaymentCommand",
    "reverseOrderPaymentCommand",
    "reverseAllOrderPaymentsCommand",
    "createOrderQPayInvoiceCommand",
    "confirmOrderQPayPaymentCommand",
    "cancelOrderQPayPaymentCommand",
  ];
  for (const fn of fns) {
    const start = src.indexOf(`export async function ${fn}`);
    assert.ok(start >= 0, fn);
    const next = src.indexOf("\nexport ", start + 10);
    assert.match(src.slice(start, next < 0 ? undefined : next), /assertPaymentAccess\(/, fn);
  }
  assert.match(src, /isInternal: true,\n  totalAmount: true/); // locked select carries the flag
});

// ---- list filter ----------------------------------------------------------

test("orders list: internal=yes|no filter parses and scopes the where clause", async () => {
  const { parseOrderListQuery, buildOrderListWhere } = await import("../lib/orders/order-list-query");
  const opts = { tenantId: "t", workingBranchId: null, readWhere: {} };
  const yes = parseOrderListQuery(new URLSearchParams("internal=yes"));
  const no = parseOrderListQuery(new URLSearchParams("internal=no"));
  const none = parseOrderListQuery(new URLSearchParams(""));
  assert.ok(yes.ok && no.ok && none.ok);
  if (yes.ok && no.ok && none.ok) {
    assert.equal(buildOrderListWhere(yes.value, opts).isInternal, true);
    assert.equal(buildOrderListWhere(no.value, opts).isInternal, false);
    assert.equal("isInternal" in buildOrderListWhere(none.value, opts), false);
  }
  const bad = parseOrderListQuery(new URLSearchParams("internal=maybe"));
  assert.equal(bad.ok, false);
  if (!bad.ok) assert.equal(bad.field, "internal");
});

// ---- revenue exclusion ----------------------------------------------------

test("income series ignores internal orders", async () => {
  const { buildIncomeSeries, resolveIncomeRange } = await import("../app/dashboard/income-range");
  const range = resolveIncomeRange({ range: "week" });
  const when = new Date(range.to.getTime() - 60_000);
  const series = buildIncomeSeries(
    [
      { completedAt: when, totalAmount: "1000", isInternal: false },
      { completedAt: when, totalAmount: "400", isInternal: true },
      { completedAt: when, totalAmount: "50" },
    ],
    range,
  );
  assert.equal(series.total, 1050);
});

test("mergeInternalSplit: counts include internal, revenue excludes it, internalCost separate", async () => {
  const { mergeInternalSplit } = await import("../lib/orders/order-internal");
  const rows = mergeInternalSplit([
    { key: "t1", isInternal: false, amount: "900", count: 3 },
    { key: "t1", isInternal: true, amount: "250", count: 2 },
    { key: "t2", isInternal: true, amount: "100", count: 1 },
  ]);
  assert.deepEqual(rows.find((r) => r.key === "t1"), { key: "t1", revenue: 900, internalCost: 250, count: 5 });
  assert.deepEqual(rows.find((r) => r.key === "t2"), { key: "t2", revenue: 0, internalCost: 100, count: 1 });
});

test("every revenue consumer filters isInternal: false; internalCost sums only internal", () => {
  const reports = read("lib/reports.ts");
  assert.match(reports, /const revenueWhere = \{ \.\.\.completedWhere, isInternal: false \}/);
  assert.match(reports, /const internalWhere = \{ \.\.\.completedWhere, isInternal: true \}/);
  for (const needle of [
    /where: revenueWhere,\n\s+_sum: \{ totalAmount: true \}/,
    /order: revenueWhere,\n\s+\},\n\s+_sum: \{ total: true \}/,
    /\.\.\.revenueWhere, totalAmount: \{ not: null \}/,
    /order: revenueWhere,\n\s+serviceId: \{ not: null \}/,
    /where: revenueWhere,\n\s+select: \{ completedAt: true, totalAmount: true \}/,
    /where: internalWhere,/,
  ]) {
    assert.match(reports, needle);
  }
  assert.match(reports, /by: \["branchId", "isInternal"\]/);
  assert.match(reports, /by: \["assignedToId", "isInternal"\]/);

  const overview = read("lib/overview.ts");
  assert.match(overview, /isInternal: false,\n\s+completedAt: \{ gte: incomeRange\.fetchFrom/);
  assert.match(overview, /isInternal: true,\n\s+completedAt: \{ gte: incomeRange\.from/);
  assert.match(read("app/api/v1/overview/route.ts"), /internalCost: data\.internalCost\.toString\(\)/);

  assert.match(read("app/system/(authed)/tenants/page.tsx"), /status: "COMPLETED", isInternal: false/);
  assert.match(read("app/system/(authed)/tenants/[id]/page.tsx"), /status: "COMPLETED", isInternal: false/);
});

// ---- customer-facing exclusion -------------------------------------------

test("customer-facing order queries exclude internal orders", () => {
  const files = [
    "app/api/v1/app/orders/route.ts",
    "app/api/v1/app/orders/[id]/route.ts",
    "app/api/v1/app/appointments/route.ts",
    "app/(app)/account/history/page.tsx",
    "app/(app)/account/history/[id]/page.tsx",
    "app/(app)/account/orders/[id]/page.tsx",
    "app/(app)/account/page.tsx",
    "app/(app)/account/vehicles/page.tsx",
    "app/(app)/account/vehicles/[id]/page.tsx",
    "app/(app)/account/appointments/[id]/page.tsx",
  ];
  for (const f of files) assert.match(read(f), /isInternal/, f);
  assert.equal((read("app/api/v1/app/orders/route.ts").match(/isInternal: false/g) ?? []).length, 2);
});

// ---- fix round 1: remaining customer-facing surfaces ----------------------

test("customer surfaces: account list masks internal appointment orders, diagnostics hide order, no push, vehicle count", () => {
  const acct = read("app/(app)/account/page.tsx");
  assert.match(acct, /isInternal: true \}/);
  assert.match(acct, /a\.serviceOrder\?\.isInternal \? \{ \.\.\.a, serviceOrder: null \}/);
  assert.match(read("app/api/v1/app/diagnostics/route.ts"), /r\.order && !r\.order\.isInternal/);
  assert.match(read("app/api/v1/app/diagnostics/[id]/route.ts"), /report\.order && !report\.order\.isInternal/);
  const cmds = read("lib/orders/order-commands.ts");
  const i = cmds.indexOf("async function notifyOrderStatusChange");
  assert.match(cmds.slice(i, i + 900), /if \(order\?\.isInternal\) return;/);
  const veh = read("app/api/v1/app/vehicles/route.ts");
  assert.equal((veh.match(/status: "COMPLETED", isInternal: false/g) ?? []).length, 2);
});
