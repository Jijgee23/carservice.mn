import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const testsDir = dirname(fileURLToPath(import.meta.url));
const actionSource = readFileSync(resolve(testsDir, "../app/_actions/orders.ts"), "utf8");
const createRouteSource = readFileSync(resolve(testsDir, "../app/api/v1/orders/route.ts"), "utf8");
const detailRouteSource = readFileSync(
  resolve(testsDir, "../app/api/v1/orders/[id]/route.ts"),
  "utf8",
);
const commandSource = readFileSync(resolve(testsDir, "../lib/orders/order-create-command.ts"), "utf8");
const referencesSource = readFileSync(resolve(testsDir, "../lib/orders/order-create-references.ts"), "utf8");

function section(source: string, startMarker: string, endMarker?: string): string {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `missing source marker: ${startMarker}`);
  const end = endMarker === undefined ? source.length : source.indexOf(endMarker, start);
  assert.notEqual(end, -1, `missing source marker: ${endMarker}`);
  return source.slice(start, end);
}

function createActionBody(): string {
  return section(actionSource, "export async function createOrderAction", "// --- UPDATE");
}

function createApiBody(): string {
  return section(createRouteSource, "export async function POST");
}

function createCommandBody(): string {
  return commandSource;
}

function patchBody(): string {
  return section(detailRouteSource, "export async function PATCH");
}

test("web and API create adapters delegate all persistence to one createOrderCommand", () => {
  const action = createActionBody();
  const api = createApiBody();
  const command = createCommandBody();

  assert.match(actionSource, /createOrderCommand/);
  assert.match(createRouteSource, /createOrderCommand/);
  assert.match(action, /createOrderCommand\(/);
  assert.match(api, /createOrderCommand\(/);

  for (const adapter of [action, api]) {
    assert.doesNotMatch(adapter, /withBookingTransaction/);
    assert.doesNotMatch(adapter, /nextOrderNumber/);
    assert.doesNotMatch(adapter, /(?:tx|scopedTx)\.serviceOrder\.create/);
    assert.doesNotMatch(adapter, /openOrderTimeBooking/);
  }

  assert.match(command, /withBookingTransaction/);
  assert.match(command, /nextOrderNumber/);
  assert.match(command, /(?:tx|scopedTx)\.serviceOrder\.create/);
  assert.match(command, /openOrderTimeBooking/);
});

test("createOrderCommand rejects a same-tenant vehicle owned by another customer", () => {
  const command = createCommandBody();

  assert.match(command, /tenantVehicle\.(?:findUnique|findFirst)/);
  assert.match(command, /customerId:\s*true/);
  assert.match(referencesSource, /vehicle\.customerId\s*!==\s*(?:input\.)?customerId/);
});

test("scheduled create validates branch hours and derives booking endAt from duration", () => {
  const command = createCommandBody();

  assert.match(command, /validateScheduledOrderHours/);
  assert.match(command, /estimatedDurationMinutes/);
  assert.match(command, /endAt\s*:[\s\S]{0,260}getTime\(\)\s*\+\s*[A-Za-z0-9_.]+\s*\*\s*60000/);
});

test("createOrderCommand has no order count limits (plans differ by modules only)", () => {
  const command = createCommandBody();
  assert.doesNotMatch(command, /enforceCountLimit|PLAN_LIMIT_REACHED|DAILY_LIMIT_REACHED|PLAN_LIMIT_CODES\.(MAX_|DAILY_)/);
});

test("notes-only API PATCH delegates to applyOrderPatchCommand without a duplicate transaction or audit body", () => {
  const patch = patchBody();

  assert.match(patch, /applyOrderPatchCommand\(/);
  assert.match(patch, /notes:\s*hasNotes\s*\?\s*b\.notes/);
  assert.doesNotMatch(patch, /withOrderTransaction/);
  assert.doesNotMatch(patch, /logAudit/);
  assert.doesNotMatch(patch, /tx\.serviceOrder\.update/);
});
