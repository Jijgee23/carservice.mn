import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { parseBusinessLocalDateTime } from "../lib/booking-time";
import { isAssigneeEligible } from "../lib/orders/order-commands";

const routeSource = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), "../app/api/v1/orders/route.ts"),
  "utf8",
);
const commandSource = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), "../lib/orders/order-create-command.ts"),
  "utf8",
);

// D-123 Cycle 3: body parsing (including the scheduledAt parse call) is
// moving out of the route and into lib/orders/order-create-request.ts (see
// tests/order-create-request.test.ts, which pins that module's contract).
// That module does not exist yet in this cycle's starting tree, so this read
// is guarded rather than done at bare module-load time — an unguarded
// `readFileSync` here would throw before `node:test` can even register the
// file's other tests, turning every test in this file red for the wrong
// reason instead of just the one test below whose intent has moved.
let requestModuleSource: string | undefined;
let requestModuleReadError: unknown;
try {
  requestModuleSource = readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), "../lib/orders/order-create-request.ts"),
    "utf8",
  );
} catch (error) {
  requestModuleReadError = error;
}

test("rejects null and array JSON bodies before property access", async () => {
  // D-123 Cycle 3 amendment 2 repoint: the object-shape guard (null / array /
  // non-object -> 400 "JSON object body шаардлагатай.") moved out of the
  // route entirely and into parseCreateOrderBody itself
  // (lib/orders/order-create-request.ts) — see tests/order-create-request.test.ts,
  // "object-shape guard" section, which pins the same behavior. The route now
  // keeps only the raw `await req.json()` parse-failure guard (400 "JSON body
  // шаардлагатай."), which needs the Request and isn't exercised by this
  // suite (it calls the parser with plain values, not a real Request). This
  // test used to assert a literal `const b = body as Record<string, unknown>`
  // cast in route.ts; that cast no longer has anywhere to exist once property
  // access moves into the parser, so the assertion is repointed at the
  // parser's real behavior instead, preserving this test's original intent
  // (null/array/non-object bodies are rejected before any property access).
  if (requestModuleReadError) {
    throw new Error(
      `lib/orders/order-create-request.ts not found (expected to own the JSON-object-body guard per the Cycle 3 contract amendment 2): ${String(requestModuleReadError)}`,
    );
  }
  const requestModule = (await import("../lib/orders/order-create-request")) as {
    parseCreateOrderBody: (body: unknown) => { ok: boolean; status?: number; message?: string };
  };
  for (const body of [null, [], ["a"], "not-an-object", 42, true]) {
    const result = requestModule.parseCreateOrderBody(body);
    assert.equal(result.ok, false, `body ${JSON.stringify(body)} must be rejected`);
    assert.equal(result.status, 400);
    assert.equal(result.message, "JSON object body шаардлагатай.");
  }
});

test("non-null API assignees require orders.assign while null remains create-allowed", () => {
  assert.match(routeSource, /requirePermission\(auth\.user, "orders\.create"\)/);
  assert.match(
    routeSource,
    /if \(assignedToId\) \{[\s\S]{0,180}requirePermission\(auth\.user, "orders\.assign"\)/,
  );
  assert.match(routeSource, /assignedToId,\s*\n\s*scheduledAt/);
  assert.doesNotMatch(routeSource, /effectiveAssignedToId/);
});

test("assignee eligibility rejects cross-tenant, inactive, and wrong-branch targets", () => {
  const eligible = {
    isActive: true,
    tenantId: "tenant-a",
    isOwner: false,
    branchId: "branch-a",
    assignableBranchIds: [],
    role: { permissions: ["orders.assignable"] },
  };

  assert.equal(isAssigneeEligible(eligible, "tenant-a", "branch-a"), true);
  assert.equal(isAssigneeEligible({ ...eligible, tenantId: "tenant-b" }, "tenant-a", "branch-a"), false);
  assert.equal(isAssigneeEligible({ ...eligible, isActive: false }, "tenant-a", "branch-a"), false);
  assert.equal(isAssigneeEligible({ ...eligible, branchId: "branch-b" }, "tenant-a", "branch-a"), false);
  assert.equal(
    isAssigneeEligible(
      { ...eligible, branchId: "branch-b", assignableBranchIds: ["branch-a"] },
      "tenant-a",
      "branch-a",
    ),
    true,
  );
});

test("API scheduledAt accepts strict business-local datetimes only", () => {
  assert.equal(Number.isNaN(parseBusinessLocalDateTime("2030-02-30T10:00").getTime()), true);
  assert.equal(Number.isNaN(parseBusinessLocalDateTime("2030-01-01T24:00").getTime()), true);
  assert.equal(Number.isNaN(parseBusinessLocalDateTime("2030-01-01T10:00Z").getTime()), true);
  assert.equal(
    parseBusinessLocalDateTime("2030-01-01T10:00").toISOString(),
    "2030-01-01T02:00:00.000Z",
  );
  // D-123 Cycle 3 repoint: this call moved out of the route and into
  // lib/orders/order-create-request.ts (CLUSTER-3-CONTRACT.md, "The seam").
  // The route itself no longer parses scheduledAt inline, so the assertion
  // that used to read `routeSource` for `parseBusinessLocalDateTime(b.scheduledAt)`
  // now reads the new module instead — same intent (business-local parsing is
  // used, a naive `new Date(...)` re-interpretation is not), new location.
  if (requestModuleReadError) {
    throw new Error(
      `lib/orders/order-create-request.ts not found (expected once scheduledAt parsing is extracted there per the Cycle 3 contract): ${String(requestModuleReadError)}`,
    );
  }
  assert.match(requestModuleSource!, /parseBusinessLocalDateTime\(/);
  assert.doesNotMatch(requestModuleSource!, /new Date\([^)]*scheduledAt/);
  assert.doesNotMatch(
    routeSource,
    /parseBusinessLocalDateTime\(/,
    "the route should no longer call parseBusinessLocalDateTime itself now that body parsing is a thin adapter over lib/orders/order-create-request.ts",
  );
});

test("reference validation, assignee locking, and creation share one transaction", () => {
  const start = commandSource.indexOf("const createdOrder = await withBookingTransaction");
  const end = commandSource.indexOf("    } catch (error)", start);
  assert.ok(start >= 0);
  assert.ok(end > start);
  const transactionBody = commandSource.slice(start, end);

  assert.match(transactionBody, /tx\.branch\.findFirst/);
  assert.match(transactionBody, /tx\.customer\.findFirst/);
  assert.match(transactionBody, /tx\.tenantVehicle\.findUnique/);
  assert.match(transactionBody, /validateOrderAssignee\(scopedTx/);
  assert.match(transactionBody, /tx\.serviceOrder\.create/);
  assert.match(transactionBody, /openOrderTimeBooking\(scopedTx/);
});

test("create transaction takes the number lock before assignee locks", () => {
  const start = commandSource.indexOf("const createdOrder = await withBookingTransaction");
  const end = commandSource.indexOf("    } catch (error)", start);
  const transactionBody = commandSource.slice(start, end);
  const numberLock = transactionBody.indexOf("const number = await nextOrderNumber");
  const assigneeLock = transactionBody.indexOf("validateOrderAssignee(");
  const create = transactionBody.indexOf("tx.serviceOrder.create");

  assert.ok(numberLock >= 0);
  assert.ok(assigneeLock > numberLock);
  assert.ok(create > assigneeLock);
});
