import assert from "node:assert/strict";
import { before, test } from "node:test";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

process.env.DATABASE_URL ??= "postgresql://unused/unused";
process.env.SESSION_SECRET ??= "unit-test-placeholder-secret-value-not-real-00";

let commands: typeof import("../lib/orders/order-commands");

before(async () => {
  commands = await import("../lib/orders/order-commands");
});

const actor = {
  id: "staff-a",
  tenantId: "tenant-a",
  isOwner: false,
  branchId: "branch-a",
  assignableBranchIds: ["branch-b"],
  role: { permissions: ["orders.view", "orders.edit", "orders.assign"] },
};

test("status transition matrix accepts only declared transitions", () => {
  assert.equal(commands.isAllowedOrderStatusTransition("SCHEDULED", "IN_PROGRESS"), true);
  assert.equal(commands.isAllowedOrderStatusTransition("IN_PROGRESS", "COMPLETED"), true);
  assert.equal(commands.isAllowedOrderStatusTransition("COMPLETED", "CANCELLED"), false);
  assert.equal(commands.isAllowedOrderStatusTransition("CANCELLED", "SCHEDULED"), false);
  assert.equal(commands.isAllowedOrderStatusTransition("SCHEDULED", "NOT_A_STATUS" as never), false);
});

test("assignment-only and notes-only patches do not represent status changes", () => {
  assert.equal(commands.hasRequestedStatusChange(undefined), false);
  assert.equal(commands.hasRequestedStatusChange(null), false);
  assert.equal(commands.hasRequestedStatusChange("IN_PROGRESS"), true);
});

test("status notifications only target active appointments", () => {
  assert.equal(commands.isActiveOrderNotificationAppointmentStatus("PENDING"), true);
  assert.equal(commands.isActiveOrderNotificationAppointmentStatus("CONFIRMED"), true);
  assert.equal(commands.isActiveOrderNotificationAppointmentStatus("CANCELLED"), false);
  assert.equal(commands.isActiveOrderNotificationAppointmentStatus("REJECTED"), false);
  assert.equal(commands.isActiveOrderNotificationAppointmentStatus("NO_SHOW"), false);
});

test("whole-order cancellation only restores linked PART stock", () => {
  assert.equal(commands.isStockBackedOrderItem("PART", "service-a"), true);
  assert.equal(commands.isStockBackedOrderItem("PART", null), false);
  assert.equal(commands.isStockBackedOrderItem("LABOR", "service-a"), false);
});

test("whole-order cancellation recomputes the order total after cancelling items", () => {
  const source = readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), "../lib/orders/order-commands.ts"),
    "utf8",
  );
  const start = source.indexOf('} else if (nextStatus === "CANCELLED")');
  const end = source.indexOf("if (nextStatus != null) await logAudit", start);
  assert.notEqual(start, -1);
  assert.match(source.slice(start, end), /serviceItem\.updateMany/);
  assert.match(source.slice(start, end), /recomputeOrderTotal\(tx, orderId\)/);
});

test("assignment-only commands use assign permission while mixed patches retain edit gating", () => {
  const source = readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), "../lib/orders/order-commands.ts"),
    "utf8",
  );
  assert.match(source, /const editsOrderFields = nextStatus != null \|\| input\.notes !== undefined/);
  assert.match(source, /if \(input\.assignedToId !== undefined && !canAssignOrders\(actor\)\)/);
  assert.match(
    source,
    /const editsOrderFields = nextStatus != null \|\| input\.notes !== undefined[\s\S]{0,120}if \(editsOrderFields\) assertCanEdit\(actor, order\);[\s\S]{0,120}if \(input\.assignedToId !== undefined && !canAssignOrders\(actor\)\)/,
  );
});

test("assignment audits keep the committed assignee display name inside the command", () => {
  const source = readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), "../lib/orders/order-commands.ts"),
    "utf8",
  );
  assert.match(source, /firstName:\s*true,\s*lastName:\s*true/);
  assert.match(source, /assigneeDisplayName = \[assignee\.lastName, assignee\.firstName\]/);
  assert.match(source, /summary: input\.assignedToId \? `Хариуцагч: \$\{assigneeDisplayName/);
  assert.match(source, /SELECT id, "roleId", verified FROM "User"[\s\S]*FOR UPDATE/);
});

test("effective working branch scope is enforced", () => {
  const scopedActor = { ...actor, workingBranchId: "branch-a" };
  assert.equal(commands.isOrderBranchInScope(scopedActor, "branch-a"), true);
  assert.equal(commands.isOrderBranchInScope(scopedActor, "branch-b"), false);
  assert.equal(commands.isOrderBranchInScope(scopedActor, "branch-b", "branch-b"), true);
  assert.equal(commands.isOrderBranchInScope(scopedActor, "branch-c", "branch-b"), false);
});

test("assignee must be active, same tenant, assignable and branch eligible", () => {
  const base = {
    isActive: true,
    tenantId: "tenant-a",
    isOwner: false,
    branchId: "branch-a",
    assignableBranchIds: [],
    role: { permissions: ["orders.assignable"] },
  };
  assert.equal(commands.isAssigneeEligible(base, "tenant-a", "branch-a"), true);
  assert.equal(commands.isAssigneeEligible({ ...base, branchId: "branch-b" }, "tenant-a", "branch-a"), false);
  assert.equal(commands.isAssigneeEligible({ ...base, isActive: false }, "tenant-a", "branch-a"), false);
  assert.equal(commands.isAssigneeEligible({ ...base, tenantId: "tenant-b" }, "tenant-a", "branch-a"), false);
  assert.equal(commands.isAssigneeEligible({ ...base, role: { permissions: [] } }, "tenant-a", "branch-a"), false);
  assert.equal(commands.isAssigneeEligible({ ...base, role: { permissions: ["orders.assignable"], isActive: false } }, "tenant-a", "branch-a"), false);
  assert.equal(
    commands.isAssigneeEligible({ ...base, branchId: "branch-b", assignableBranchIds: ["branch-a"] }, "tenant-a", "branch-a"),
    true,
  );
  // Ажлаас гарсан (өөрөө хаасан) болон хугацаа дууссан түр ажилтан мастер болохгүй.
  const now = new Date("2026-10-01T00:00:00Z");
  assert.equal(commands.isAssigneeEligible({ ...base, verified: false }, "tenant-a", "branch-a"), false);
  assert.equal(commands.isAssigneeEligible({ ...base, verified: true }, "tenant-a", "branch-a"), true);
  assert.equal(commands.isAssigneeEligible({ ...base, deactivatedAt: now }, "tenant-a", "branch-a", now), false);
  assert.equal(
    commands.isAssigneeEligible({ ...base, activeUntil: new Date("2026-09-30T00:00:00Z") }, "tenant-a", "branch-a", now),
    false,
  );
  assert.equal(
    commands.isAssigneeEligible({ ...base, activeUntil: new Date("2026-12-31T00:00:00Z") }, "tenant-a", "branch-a", now),
    true,
  );
});

test("assignee query excludes expired staff and unchanged assignees are not revalidated", () => {
  const source = readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), "../lib/orders/order-commands.ts"),
    "utf8",
  );
  assert.match(source, /isActive: true, \.\.\.orderAssignableWhere\(\) \}/);
  assert.match(source, /deactivatedAt: true,\s+activeUntil: true,/);
  assert.match(source, /input\.assignedToId && input\.assignedToId !== order\.assignedToId/);
});

test("duration parser rejects malformed and out-of-range values", () => {
  assert.deepEqual(commands.parseCommandDuration(undefined), { ok: true, minutes: null });
  assert.equal(commands.parseCommandDuration(30).ok, true);
  assert.equal(commands.parseCommandDuration(0).ok, false);
  assert.equal(commands.parseCommandDuration(721).ok, false);
  assert.equal(commands.parseCommandDuration(30.5).ok, false);
});

test("action duration adapter preserves hours/minutes validation", () => {
  assert.deepEqual(commands.parseActionDuration("1", "30"), { ok: true, minutes: 90 });
  assert.equal(commands.parseActionDuration("", "").ok, true);
  assert.equal(commands.parseActionDuration("1", "60").ok, false);
});

test("web order mutations lock edit-own and validate assignees in the write transaction", () => {
  const source = readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), "../app/_actions/orders.ts"),
    "utf8",
  );
  const createCommandSource = readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), "../lib/orders/order-create-command.ts"),
    "utf8",
  );
  const updateStart = source.indexOf("export async function updateOrderAction");
  const updateBody = source.slice(updateStart, source.indexOf("// --- STATUS CHANGE", updateStart));
  assert.match(updateBody, /assignedToId: true/);
  assert.match(updateBody, /if \(!canEditOrder\(user, fresh\)\)/);
  assert.match(updateBody, /validateOrderAssignee\(tx/);
  assert.match(createCommandSource, /validateOrderAssignee\(scopedTx/);
});

test("clearing and restoring a schedule updates booking rows and capacity", () => {
  const source = readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), "../app/_actions/orders.ts"),
    "utf8",
  );
  const updateStart = source.indexOf("export async function updateOrderAction");
  const updateBody = source.slice(updateStart, source.indexOf("// --- STATUS CHANGE", updateStart));
  assert.match(updateBody, /closeOpenOrderTimeBooking\(tx, id, new Date\(\), "SCHEDULED"\)/);
  assert.match(updateBody, /openOrderTimeBooking\(tx, \{/);
  assert.match(updateBody, /occupiesCapacity: data\.scheduledAt != null/);
});

test("bulk assignment requires orders.assign and does not expose unexpected errors", () => {
  const source = readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), "../app/_actions/orders.ts"),
    "utf8",
  );
  const start = source.indexOf("export async function bulkAssignOrderAction");
  const body = source.slice(start, source.indexOf("// --- EXPECTED FINISH", start));
  assert.match(body, /authorizeAssign\(\)/);
  assert.doesNotMatch(body, /authorize\("edit"\)/);
  assert.match(body, /Серверийн алдаа гарлаа\./);
});

test("web decimal parsing is strict and never throws", async () => {
  const { parseNonNegativeDecimal } = await import("../lib/decimal-input");
  assert.equal(parseNonNegativeDecimal("1,250.50")?.toString(), "1250.5");
  assert.equal(parseNonNegativeDecimal(" 10 ")?.toString(), "10");
  assert.equal(parseNonNegativeDecimal(3)?.toString(), "3");
  for (const bad of ["", "10ш", "1.2.3", "-5", "1e5", "abc", null, undefined]) {
    assert.equal(parseNonNegativeDecimal(bad), null, String(bad));
  }
  // Сэлбэг/үйлчилгээ, оношилгооны загвар, захиалгын form бүгд нэг parser ашиглана.
  const here = dirname(fileURLToPath(import.meta.url));
  for (const file of [
    "../app/_actions/orders.ts",
    "../app/_actions/services.ts",
    "../app/_actions/diagnostic-templates.ts",
    "../app/_actions/system-diagnostic-templates.ts",
    "../lib/services/service-commands.ts",
  ]) {
    const source = readFileSync(resolve(here, file), "utf8");
    assert.match(source, /parseNonNegativeDecimal/, file);
    assert.doesNotMatch(source, /Number\.parseFloat\(cleaned\)/, file);
  }
});

test("completing an order requires finished work and full payment unless postpaid (QA №6/№11)", () => {
  const source = readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), "../lib/orders/order-commands.ts"),
    "utf8",
  );
  const start = source.indexOf('if (nextStatus === "COMPLETED") {');
  const end = source.indexOf("const enteringInProgress", start);
  assert.notEqual(start, -1);
  const block = source.slice(start, end);
  assert.match(block, /item\.kind !== "PART" && item\.status !== "COMPLETED"/);
  assert.match(block, /"ITEMS_NOT_COMPLETED"/);
  assert.match(block, /paidLedger\(tx, actor\.tenantId, orderId\)/);
  assert.match(block, /assertCompletionPaymentAllowed\(/);
  assert.match(block, /const completingPostpaid = input\.isPostpaid \?\? order\.isPostpaid/);
  assert.match(block, /isPostpaid: completingPostpaid/);
  const guard = source.slice(source.indexOf("export function assertCompletionPaymentAllowed"));
  assert.match(guard, /"PAYMENT_INCOMPLETE"/);
  assert.match(guard, /"POSTPAID_CLOSE_FORBIDDEN"/);
});

async function dec(value: string) {
  const { Prisma } = await import("../app/generated/prisma/client");
  return new Prisma.Decimal(value);
}

const accountant = {
  isOwner: false,
  role: { permissions: ["orders.edit", "orders.closeUnpaidPostpaid"] },
};

test("postpaid unpaid completion without orders.closeUnpaidPostpaid -> POSTPAID_CLOSE_FORBIDDEN (403)", async () => {
  await assert.rejects(
    async () =>
      commands.assertCompletionPaymentAllowed({
        actor: actor,
        isPostpaid: true,
        totalAmount: await dec("1000"),
        paid: await dec("400"),
      }),
    (error: unknown) => {
      const e = error as { code: string; status: number; message: string };
      assert.equal(e.code, "POSTPAID_CLOSE_FORBIDDEN");
      assert.equal(e.status, 403);
      assert.match(e.message, /нягтлан/);
      return true;
    },
  );
});

test("postpaid unpaid completion is allowed for the permission holder and the owner", async () => {
  const total = await dec("1000");
  const paid = await dec("0");
  assert.doesNotThrow(() =>
    commands.assertCompletionPaymentAllowed({ actor: accountant, isPostpaid: true, totalAmount: total, paid }),
  );
  assert.doesNotThrow(() =>
    commands.assertCompletionPaymentAllowed({
      actor: { isOwner: true, role: null },
      isPostpaid: true,
      totalAmount: total,
      paid,
    }),
  );
});

test("fully paid postpaid order completes for anyone", async () => {
  const total = await dec("1000");
  const paid = await dec("1000");
  assert.doesNotThrow(() =>
    commands.assertCompletionPaymentAllowed({ actor, isPostpaid: true, totalAmount: total, paid }),
  );
});

test("non-postpaid unpaid completion keeps PAYMENT_INCOMPLETE (even for the permission holder)", async () => {
  const total = await dec("500");
  const paid = await dec("100");
  for (const who of [actor, accountant]) {
    assert.throws(
      () =>
        commands.assertCompletionPaymentAllowed({
          actor: who,
          isPostpaid: false,
          totalAmount: total,
          paid,
        }),
      (error: unknown) => (error as { code: string }).code === "PAYMENT_INCOMPLETE",
    );
  }
});

test("assigned master is required on create and cannot be removed afterwards", () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const read = (f: string) => readFileSync(resolve(here, f), "utf8");
  const create = read("../lib/orders/order-create-command.ts");
  assert.match(create, /if \(!input\.assignedToId(?: && !input\.appointmentId)?\) \{[\s\S]{0,200}"ASSIGNEE_REQUIRED"/);
  // QA #28: from an appointment the master may be carried over, but one must still resolve.
  assert.match(create, /if \(!assignedToId\) \{[\s\S]{0,200}"ASSIGNEE_REQUIRED"/);
  const patch = read("../lib/orders/order-commands.ts");
  assert.match(patch, /input\.assignedToId === null && order\.assignedToId[\s\S]{0,200}"ASSIGNEE_REQUIRED"/);
  // Оноох эрхгүй mobile хэрэглэгч өөрөө (web-тэй ижил).
  const route = read("../app/api/v1/orders/route.ts");
  assert.match(route, /else if \(!canAssignOrders\(auth\.user\)\) \{[\s\S]{0,160}assignedToId = auth\.user\.id;/);
  const web = read("../app/_actions/orders.ts");
  assert.match(web, /if \(!data\.assignedToId\) errors\.assignedToId = "Хариуцах мастер сонгоно уу\.";/);
});
