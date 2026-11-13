import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";

process.env.DATABASE_URL ??= "postgresql://unused/unused";
process.env.SESSION_SECRET ??= "unit-test-placeholder-secret-value-not-real-00";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

function fnBody(src: string, signature: string): string {
  const start = src.indexOf(signature);
  assert.notEqual(start, -1, `${signature} not found`);
  const next = src.indexOf("\nexport async function ", start + signature.length);
  return src.slice(start, next === -1 ? undefined : next);
}

// --- #10 branch change moves open time bookings ------------------------------

test("updateOrderAction moves open OrderTimeBooking rows to the new branch in the same transaction", () => {
  const body = fnBody(read("app/_actions/orders.ts"), "export async function updateOrderAction(");
  assert.match(body, /fresh\.branchId !== data\.branchId/);
  assert.match(
    body,
    /tx\.orderTimeBooking\.updateMany\(\{\s*where: \{ orderId: id, tenantId: user\.tenantId, closedAt: null \},\s*data: \{ branchId: data\.branchId \},/,
  );
});

// --- #15 repair link: working-branch scope + subscription --------------------

test("repairAppointmentOrderLinkAction enforces working-branch scope and active subscription before writing", () => {
  const body = fnBody(read("app/_actions/appointments.ts"), "export async function repairAppointmentOrderLinkAction(");
  const scopeIdx = body.indexOf("await assertStaffScope(actorFrom(user), appointment.branchId)");
  const firstWrite = body.indexOf("updateMany(");
  assert.ok(scopeIdx !== -1 && scopeIdx < firstWrite, "scope check must precede any write");
  assert.match(body, /knownAuthorizationMessage\(e, STAFF_SCOPE_MESSAGES\)/);
  const cmd = read("lib/appointments/appointment-commands.ts");
  const assertFn = cmd.slice(cmd.indexOf("export async function assertStaffScope("));
  assert.match(assertFn.slice(0, 500), /scope && branchId && branchId !== scope/);
  assert.match(assertFn.slice(0, 500), /assertActiveSubscription\(actor\.tenantId\)/);
});

// --- #17 command errors become displayable results ---------------------------

test("delete/cancel/status/price order actions return { error } instead of throwing OrderCommandError", () => {
  const src = read("app/_actions/orders.ts");
  for (const sig of [
    "export async function deleteOrderAction(",
    "export async function cancelOrderItemAction(",
    "export async function changeOrderItemStatusAction(",
    "export async function changeOrderItemPriceAction(",
  ]) {
    const body = fnBody(src, sig);
    assert.match(body, /Promise<ConfirmActionResult>/, sig);
    assert.match(body, /catch \(e\) \{\s*return orderConfirmError\(e\);/, sig);
  }
  // redirect() stays outside the try so its control-flow throw is not swallowed.
  const del = fnBody(src, "export async function deleteOrderAction(");
  assert.ok(del.indexOf("redirect(") > del.indexOf("return orderConfirmError(e)"));
  const ui = read("app/dashboard/orders/[id]/order-items.tsx");
  assert.match(ui, /const result = await changeOrderItemStatusAction\(fd\);\s*if \(result\?\.error\) toast\?\.error\(result\.error\);/);
  assert.match(ui, /const result = await changeOrderItemPriceAction\(fd\);/);
});

// --- #18 / #19 request validation -------------------------------------------

test("PATCH /orders/[id] without a recognised field is a 400 VALIDATION, never a fall-through 500", () => {
  const src = read("app/api/v1/orders/[id]/route.ts");
  const patch = src.slice(src.indexOf("export async function PATCH"));
  assert.match(patch, /if \(!hasStatus && !hasAssignment && !hasNotes && !hasPostpaid && !hasInternal\) \{\s*return jsonError\(400, "Өөрчлөх талбар шаардлагатай\.", \{ code: "VALIDATION" \}\);/);
  assert.ok(patch.indexOf('"VALIDATION"') < patch.indexOf("prisma.serviceOrder.findFirst"), "validation precedes DB work");
});

test("appointment routes reject null / non-object JSON bodies with 400", () => {
  for (const file of [
    "app/api/v1/appointments/[id]/route.ts",
    "app/api/v1/app/appointments/route.ts",
    "app/api/v1/app/appointments/[id]/reschedule/route.ts",
  ]) {
    const src = read(file);
    const guard = src.indexOf('if (body === null || typeof body !== "object" || Array.isArray(body))');
    assert.ok(guard !== -1, `${file} must guard the body shape`);
    const firstRead = src.indexOf("body as {", src.indexOf("await req.json()"));
    assert.ok(firstRead !== -1 && guard < firstRead, `${file} guards before reading fields`);
  }
});

// --- #22 no writes before checks --------------------------------------------

test("catalog adoption runs only after the order scope/access/lock pre-check", () => {
  const action = fnBody(read("app/_actions/orders.ts"), "export async function addOrderItemAction(");
  assert.ok(action.indexOf("assertOrderItemAddPrecheck(user, orderId)") < action.indexOf("adoptCatalogItemForTenant("));
  const route = read("app/api/v1/orders/[id]/items/route.ts");
  assert.ok(route.indexOf("assertOrderItemAddPrecheck(auth.user, id, scopeResult.branchId)") < route.indexOf("adoptCatalogItemForTenant(auth.user"));
  const cmd = read("lib/orders/order-item-commands.ts");
  const pre = cmd.slice(cmd.indexOf("export async function assertOrderItemAddPrecheck("));
  assert.match(pre.slice(0, 700), /assertOrderItemAccess\(actor, order, scope\)/);
});

// --- #23 account booking abuse limits ---------------------------------------

test("account booking: per-account rate limit and open-appointment cap on mobile and web", async () => {
  const { MAX_OPEN_ACCOUNT_APPOINTMENTS, hasReachedOpenAppointmentLimit, ACCOUNT_BOOKING_RATE_LIMIT } =
    await import("../lib/appointments/account-booking-limits");
  assert.equal(MAX_OPEN_ACCOUNT_APPOINTMENTS, 5);
  assert.deepEqual(ACCOUNT_BOOKING_RATE_LIMIT, { limit: 10, windowMs: 10 * 60_000 });
  assert.equal(hasReachedOpenAppointmentLimit(4), false);
  assert.equal(hasReachedOpenAppointmentLimit(5), true);

  const limits = read("lib/appointments/account-booking-limits.ts");
  assert.match(limits, /status: \{ in: \["PENDING", "CONFIRMED"\] \},\s*requestedAt: \{ gte: now \}/);
  assert.match(limits, /return await prisma\.appointment\.count/);

  const route = read("app/api/v1/app/appointments/route.ts");
  const post = route.slice(route.indexOf("export async function POST"));
  assert.match(post, /enforceRateLimit\(req, ACCOUNT_BOOKING_RATE_BUCKET, ACCOUNT_BOOKING_RATE_LIMIT, account\.id\)/);
  assert.match(post, /jsonError\(409, OPEN_APPOINTMENTS_LIMIT_MESSAGE, \{ code: "TOO_MANY_OPEN_APPOINTMENTS" \}\)/);
  assert.ok(post.indexOf("countOpenAccountAppointments") < post.indexOf("reserveAppointment("));

  const web = fnBody(read("app/_actions/appointments.ts"), "export async function createAppointment(");
  assert.match(web, /consumeRateLimit\(`\$\{ACCOUNT_BOOKING_RATE_BUCKET\}:\$\{account\.id\}`/);
  assert.match(web, /countOpenAccountAppointments\(account\.id\)/);
});

// --- #30 / #31 untyped server-action args, bulk caps -------------------------

test("plate/customer step actions and schedule detail type-check client arguments", () => {
  const src = read("app/_actions/orders.ts");
  assert.match(fnBody(src, "export async function lookupPlateForOrderAction("), /typeof plate !== "string"/);
  assert.match(fnBody(src, "export async function registerVehicleFromPlateAction("), /!isOptString\(input\.plate\)/);
  assert.match(fnBody(src, "export async function registerPlateVehicleAction("), /typeof input\.fromLookup !== "boolean"/);
  assert.match(fnBody(src, "export async function registerCustomerFromSearchAction("), /!isOptString\(input\.phone\)/);
  assert.match(fnBody(src, "export async function linkPlateCustomerAction("), /typeof input\.vehicleId !== "string"/);
  assert.match(read("app/_actions/schedule-order-detail.ts"), /typeof orderId !== "string" \|\| !orderId/);
});

test("bulk order actions de-duplicate ids and cap at MAX_BULK_ORDER_IDS", () => {
  const src = read("app/_actions/orders.ts");
  for (const sig of ["export async function bulkChangeOrderStatusAction(", "export async function bulkAssignOrderAction("]) {
    const body = fnBody(src, sig);
    assert.match(body, /const ids = \[\.\.\.new Set\(parseIdsJson\(s\(formData, "orderIdsJson"\)\)\)\];/, sig);
    assert.match(body, /if \(ids\.length > MAX_BULK_ORDER_IDS\)/, sig);
  }
});

// --- #32 RLS: return await --------------------------------------------------

test("attachOwnerToUnownedVehicle awaits its transaction (RLS AsyncLocalStorage)", () => {
  const src = read("lib/orders/plate-intake-server.ts");
  const fn = src.slice(src.indexOf("export async function attachOwnerToUnownedVehicle("), src.indexOf("export async function linkPlateCustomer("));
  assert.match(fn, /return await prisma\.\$transaction\(/);
  assert.doesNotMatch(fn, /return prisma\.\$transaction\(/);
});
