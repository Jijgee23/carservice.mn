import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

process.env.DATABASE_URL ??= "postgresql://unused/unused";
process.env.SESSION_SECRET ??= "unit-test-placeholder-secret-value-not-real-00";

const here = dirname(fileURLToPath(import.meta.url));
const read = (file: string) => readFileSync(resolve(here, file), "utf8");

const completedAt = new Date("2026-10-05T10:00:00Z");
const before = new Date("2026-10-05T09:00:00Z");
const after = new Date("2026-10-05T11:00:00Z");

test("paidInFullBeforeCompletion: true only when COMPLETED + PAID and last payment <= completedAt", async () => {
  const { computePaidInFullBeforeCompletion: f } = await import("../lib/orders/order-payment-totals");
  const base = { status: "COMPLETED", paymentStatus: "PAID", completedAt };
  assert.equal(f({ ...base, payments: [{ paidAt: before }] }), true);
  assert.equal(f({ ...base, payments: [{ paidAt: completedAt }] }), true);
  assert.equal(f({ ...base, payments: [{ paidAt: before }, { paidAt: after }] }), false);
  assert.equal(f({ ...base, payments: [{ paidAt: after }] }), false);
  assert.equal(f({ ...base, payments: [] }), false);
  assert.equal(f({ ...base, payments: [{ paidAt: null }] }), false);
  assert.equal(f({ ...base }), false);
});

test("paidInFullBeforeCompletion: false when not completed, not fully paid, or no completedAt", async () => {
  const { computePaidInFullBeforeCompletion: f } = await import("../lib/orders/order-payment-totals");
  const payments = [{ paidAt: before }];
  assert.equal(f({ status: "IN_PROGRESS", paymentStatus: "PAID", completedAt: null, payments }), false);
  assert.equal(f({ status: "COMPLETED", paymentStatus: "PARTIAL", completedAt, payments }), false);
  assert.equal(f({ status: "COMPLETED", paymentStatus: "UNPAID", completedAt, payments }), false);
  assert.equal(f({ status: "COMPLETED", paymentStatus: "PAID", completedAt: null, payments }), false);
});

test("withPaidInFull strips the payments rows and adds the flag", async () => {
  const { withPaidInFull } = await import("../lib/orders/order-payment-totals");
  const out = withPaidInFull({
    id: "o1",
    status: "COMPLETED",
    paymentStatus: "PAID",
    completedAt,
    payments: [{ paidAt: before }],
  });
  assert.equal(out.paidInFullBeforeCompletion, true);
  assert.equal("payments" in out, false);
  assert.equal(out.id, "o1");
});

test("resolveOrderIsPostpaid: default from vehicle, explicit override wins", async () => {
  const { resolveOrderIsPostpaid } = await import("../lib/orders/order-create-references");
  assert.equal(resolveOrderIsPostpaid(undefined, true), true);
  assert.equal(resolveOrderIsPostpaid(undefined, false), false);
  assert.equal(resolveOrderIsPostpaid(undefined, undefined), false);
  assert.equal(resolveOrderIsPostpaid(false, true), false);
  assert.equal(resolveOrderIsPostpaid(true, false), true);
});

test("create request parses optional boolean isPostpaid", async () => {
  const { parseCreateOrderBody } = await import("../lib/orders/order-create-request");
  const base = { branchId: "b", customerId: "c", vehicleId: "v" };
  const omitted = parseCreateOrderBody(base);
  assert.ok(omitted.ok && !("isPostpaid" in omitted.value));
  const yes = parseCreateOrderBody({ ...base, isPostpaid: true });
  assert.ok(yes.ok && yes.value.isPostpaid === true);
  const no = parseCreateOrderBody({ ...base, isPostpaid: false });
  assert.ok(no.ok && no.value.isPostpaid === false);
  const bad = parseCreateOrderBody({ ...base, isPostpaid: "yes" });
  assert.ok(!bad.ok && bad.status === 400);
});

test("createOrderCommand writes isPostpaid via resolver and vehicle snapshots", () => {
  const source = read("../lib/orders/order-create-command.ts");
  assert.match(source, /isPostpaid\?: boolean;/);
  assert.match(source, /isPostpaid: resolveOrderIsPostpaid\(input\.isPostpaid, vehicle\?\.isPostpaid\)/);
  assert.match(source, /plateSnapshot: snapshotVehicle\?\.plate \?\? null/);
  assert.match(source, /vinSnapshot: snapshotVehicle\?\.vin \?\? null/);
});

test("update paths re-derive isPostpaid and refresh snapshots only on vehicle change", () => {
  const web = read("../app/_actions/orders.ts");
  // Internal repairs: the derivation moved into resolveUpdatedIsPostpaid (never re-enables postpaid on internal orders).
  assert.match(web, /resolveUpdatedIsPostpaid\(\{/);
  assert.match(read("../lib/orders/order-internal.ts"), /input\.explicitPostpaid \?\? \(input\.vehicleChanged \? input\.vehicleIsPostpaid : undefined\)/);
  assert.match(web, /\.\.\.\(vehicleChanged \? vehicleSnapshot : \{\}\)/);
  const route = read("../app/api/v1/orders/[id]/route.ts");
  assert.match(route, /isPostpaid: hasPostpaid \? b\.isPostpaid as boolean : undefined/);
});

test("orders.closeUnpaidPostpaid is a standalone permission listed in the role editor", async () => {
  const { PERMISSIONS, STANDALONE_PERMISSIONS } = await import("../lib/auth/permissions");
  const def = PERMISSIONS.find((p) => p.code === "orders.closeUnpaidPostpaid");
  assert.equal(def?.label, "Дараа тооцоо хаах, тооцоо нийлэх");
  assert.ok(STANDALONE_PERMISSIONS.some((p) => p.code === "orders.closeUnpaidPostpaid"));
});

test("bulk status path goes through the guarded patch command", () => {
  const bulk = read("../lib/orders/order-bulk-commands.ts");
  assert.match(bulk, /changeOrderStatusCommand/);
  const commands = read("../lib/orders/order-commands.ts");
  assert.match(commands, /return applyOrderPatchCommand\(input\)/);
});

test("postpaid settlement gate: matrix for assertPostpaidSettlementAllowed", async () => {
  const { assertPostpaidSettlementAllowed, canSettlePostpaidOrder } = await import("../lib/orders/order-commands");
  const holder = { isOwner: false, role: { permissions: ["payments.create", "orders.closeUnpaidPostpaid"] } };
  const plain = { isOwner: false, role: { permissions: ["payments.create"] } };
  const owner = { isOwner: true, role: null };
  const done = { isPostpaid: true, status: "COMPLETED" };
  // non-postpaid: always allowed
  assert.doesNotThrow(() => assertPostpaidSettlementAllowed(plain, { isPostpaid: false, status: "COMPLETED" }));
  // postpaid, not completed: allowed
  assert.doesNotThrow(() => assertPostpaidSettlementAllowed(plain, { isPostpaid: true, status: "IN_PROGRESS" }));
  // postpaid completed without permission: 403
  assert.throws(
    () => assertPostpaidSettlementAllowed(plain, done),
    (e: unknown) => (e as { code: string; status: number }).code === "POSTPAID_SETTLEMENT_FORBIDDEN" && (e as { status: number }).status === 403,
  );
  // with permission / owner
  assert.doesNotThrow(() => assertPostpaidSettlementAllowed(holder, done));
  assert.doesNotThrow(() => assertPostpaidSettlementAllowed(owner, done));
  // missing user fails closed (no system bypass)
  assert.throws(
    () => assertPostpaidSettlementAllowed(null as never, done),
  );
  assert.equal(canSettlePostpaidOrder(plain, done), false);
});

test("postpaid settlement gate is wired into the shared payment access check", () => {
  const src = read("../lib/orders/order-payment-commands.ts");
  assert.match(src, /assertPostpaidSettlementAllowed\(actor, order\)/);
  assert.match(src, /isPostpaid: true/);
});

test("completion unchecks postpaid only when fully paid", async () => {
  const { shouldUncheckPostpaidOnCompletion } = await import("../lib/orders/order-commands");
  const { Prisma } = await import("../app/generated/prisma/client");
  const d = (v: string) => new Prisma.Decimal(v);
  assert.equal(shouldUncheckPostpaidOnCompletion(true, d("30000"), d("30000")), true);
  assert.equal(shouldUncheckPostpaidOnCompletion(true, d("30000"), d("15000")), false);
  assert.equal(shouldUncheckPostpaidOnCompletion(false, d("30000"), d("30000")), false);
  assert.equal(shouldUncheckPostpaidOnCompletion(true, null, d("0")), true);
  const src = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "../lib/orders/order-commands.ts"), "utf8");
  assert.match(src, /if \(uncheckPostpaidOnCompletion\) updates\.isPostpaid = false;/);
});
