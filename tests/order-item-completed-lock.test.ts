import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

process.env.DATABASE_URL ??= "postgresql://unused/unused";
process.env.SESSION_SECRET ??= "unit-test-placeholder-secret-value-not-real-00";

const source = readFileSync(new URL("../lib/orders/order-item-commands.ts", import.meta.url), "utf8");

function commandBlock(name: string): string {
  const start = source.indexOf(`export async function ${name}`);
  assert.notEqual(start, -1, `${name} must exist`);
  const end = source.indexOf("export async function", start + 10);
  return source.slice(start, end === -1 ? source.length : end);
}

function isLocked(error: unknown): boolean {
  return typeof error === "object" && error !== null
    && "code" in error && error.code === "ITEM_COMPLETED_LOCKED"
    && "status" in error && error.status === 422
    && "message" in error && error.message === "Дууссан ажлыг засах боломжгүй.";
}

test("COMPLETED line is rejected with ITEM_COMPLETED_LOCKED; open and cancelled lines are not", async () => {
  const { assertItemNotCompleted } = await import("../lib/orders/order-item-commands");
  assert.throws(() => assertItemNotCompleted("COMPLETED"), isLocked);
  assert.doesNotThrow(() => assertItemNotCompleted("PENDING"));
  assert.doesNotThrow(() => assertItemNotCompleted("IN_PROGRESS"));
  // CANCELLED keeps its own ITEM_CANCELLED guard; the lock helper must not shadow it.
  assert.doesNotThrow(() => assertItemNotCompleted("CANCELLED"));
});

// Guard matrix: every mutation command must reach the COMPLETED lock after the
// CANCELLED guard (so CANCELLED keeps ITEM_CANCELLED) and before any mutation,
// payment check or status validation that would otherwise mask / bypass it.
const MATRIX: Array<{ command: string; before: string; after: string; lock?: string }> = [
  { command: "updateOrderItemCommand", before: 'ITEM_CANCELLED', after: "assertItemValues(next)" },
  { command: "patchOrderItemCommand", before: 'ITEM_CANCELLED', after: "assertItemValues(next)" },
  { command: "cancelOrderItemCommand", before: "ITEM_NOT_FOUND", after: "isServiceItemCancellable(item.status)" },
  { command: "changeOrderItemStatusCommand", before: 'ITEM_CANCELLED', after: "PART_STATUS_UNSUPPORTED", lock: "assertCompletedItemStatusChange(" },
  { command: "changeOrderItemPriceCommand", before: "unitPrice.equals(item.unitPrice)", after: "assertItemValues(" },
];

for (const row of MATRIX) {
  test(`${row.command}: COMPLETED lock sits between "${row.before}" and "${row.after}"`, () => {
    const block = commandBlock(row.command);
    const lockCall = row.lock ?? "assertItemNotCompleted(";
    const lock = block.indexOf(lockCall);
    assert.notEqual(lock, -1, `${row.command} must call ${lockCall}`);
    assert.ok(block.indexOf(row.before) < lock, `lock must follow ${row.before}`);
    assert.ok(lock < block.indexOf(row.after), `lock must precede ${row.after}`);
    for (const later of ["assertNoPaidPayments(tx", "tx.serviceItem.update("]) {
      const at = block.indexOf(later);
      if (at !== -1) assert.ok(lock < at, `lock must precede ${later}`);
    }
  });
}

test("add command only merges into open (PENDING / IN_PROGRESS) lines, never COMPLETED ones", () => {
  const block = commandBlock("addOrderItemCommand");
  assert.match(block, /status: \{ in: \["PENDING", "IN_PROGRESS"\] \}/);
});

test("patch no-op payloads (unchanged price only) still return before the lock; open lines stay editable", () => {
  const block = commandBlock("patchOrderItemCommand");
  const noop = block.indexOf("if (!hasDetails && !priceChanged && !hasStatus) return existing;");
  const lock = block.indexOf("assertItemNotCompleted(existing.status)");
  assert.ok(noop !== -1 && lock > noop);
  // The lock is unconditional on status values: it does not special-case orders.itemPrice,
  // so the permission gates for open lines are untouched.
  assert.match(block, /ITEM_PRICE_FORBIDDEN/);
});

test("COMPLETED -> COMPLETED status is a no-op (it would otherwise rewrite completedAt)", () => {
  const block = commandBlock("changeOrderItemStatusCommand");
  const noop = block.indexOf('nextStatus === item.status && item.status === "COMPLETED"');
  assert.ok(noop !== -1 && noop < block.indexOf("tx.serviceItem.update("));
});

test("COMPLETED line may be reopened, except a diagnostic line with a report", async () => {
  const { assertCompletedItemStatusChange } = await import("../lib/orders/order-item-commands");
  assert.doesNotThrow(() => assertCompletedItemStatusChange({ status: "COMPLETED", kind: "LABOR", diagnosticReportId: null }));
  assert.doesNotThrow(() => assertCompletedItemStatusChange({ status: "COMPLETED", kind: "DIAGNOSTIC", diagnosticReportId: null }));
  assert.doesNotThrow(() => assertCompletedItemStatusChange({ status: "IN_PROGRESS", kind: "DIAGNOSTIC", diagnosticReportId: "r1" }));
  assert.throws(
    () => assertCompletedItemStatusChange({ status: "COMPLETED", kind: "DIAGNOSTIC", diagnosticReportId: "r1" }),
    (e: unknown) => e instanceof Error && "code" in e && e.code === "DIAGNOSTIC_REPORT_LINKED",
  );
});

test("patch keeps detail/price edits locked but lets a status-only change through the reopen guard", () => {
  const block = commandBlock("patchOrderItemCommand");
  assert.match(block, /if \(hasDetails \|\| priceChanged\) assertItemNotCompleted\(existing\.status\)/);
  assert.match(block, /assertCompletedItemStatusChange\(existing\)/);
});

test("diagnostic report deletion cannot reopen a COMPLETED line (API and web action)", () => {
  for (const path of ["../app/api/v1/diagnostics/reports/[id]/route.ts", "../app/_actions/diagnostic-reports.ts"]) {
    const src = readFileSync(new URL(path, import.meta.url), "utf8");
    assert.match(src, /linkedItem\?\.status === "COMPLETED"/, path);
    assert.ok(src.indexOf('linkedItem?.status === "COMPLETED"') < src.indexOf('status: "PENDING", startedAt: null'), path);
  }
});

test("diagnostic report creation only targets open (PENDING / IN_PROGRESS) lines, never COMPLETED", () => {
  for (const path of ["../app/api/v1/diagnostics/reports/route.ts", "../app/_actions/diagnostic-reports.ts"]) {
    const src = readFileSync(new URL(path, import.meta.url), "utf8");
    assert.match(src, /kind: "DIAGNOSTIC",\s*status: \{ in: \["PENDING", "IN_PROGRESS"\] \},\s*(\/\/[^\n]*\n\s*)?diagnosticReportId: null/, path);
  }
});
