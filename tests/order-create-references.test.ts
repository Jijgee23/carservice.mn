/**
 * D-123 Cycle 1 — behavioral + architecture-guard tests for the reference
 * validation seam that `createOrderCommand` must extract into a pure module.
 *
 * This file specifies (and pins) the API the implementer must build:
 *
 *   lib/orders/order-create-references.ts
 *
 *   export type BranchReferenceSnapshot = {
 *     id: string;
 *     slotMinutes: number | null;
 *     isActive: boolean;
 *   };
 *
 *   export type CustomerReferenceSnapshot = {
 *     id: string;
 *   };
 *
 *   export type VehicleReferenceSnapshot = {
 *     vehicleId: string;
 *     customerId: string | null;
 *     isPostpaid: boolean;
 *   };
 *
 *   export type AppointmentReferenceSnapshot = {
 *     id: string;
 *     customerId: string | null;
 *     accountId: string | null;
 *     vehicleId: string | null;
 *     serviceOrderId: string | null;
 *     branchId: string;
 *     estimatedDurationMinutes: number | null;
 *     arrivedAt: Date | null;
 *     categoryId: string | null;
 *     category: { name: string } | null;
 *     categories: Array<{ categoryId: string; category: { name: string } }>;
 *   };
 *
 *   export type ValidateOrderReferencesInput = {
 *     branchId: string;
 *     customerId: string;
 *     vehicleId: string;
 *     appointmentId: string | null | undefined;
 *     branch: BranchReferenceSnapshot | null;
 *     customer: CustomerReferenceSnapshot | null;
 *     vehicle: VehicleReferenceSnapshot | null;
 *     appointment: AppointmentReferenceSnapshot | null;
 *     accountVehicleToLink: boolean;
 *   };
 *
 *   export function validateOrderReferences(
 *     input: ValidateOrderReferencesInput,
 *   ): Record<string, string>;
 *
 * `validateOrderReferences` is the ONLY export the implementer must add. It is
 * pure: no imports of `@/lib/prisma` or anything environment-reading, no
 * `Date` construction, no randomness. It takes the already-fetched row
 * snapshots (mirroring the command's current `select` clauses, plus the two
 * fields the fix adds: `isActive` on the branch, `branchId` on the
 * appointment) and the caller's intent (`branchId`, `customerId`,
 * `vehicleId`, `appointmentId`), plus `accountVehicleToLink` — the boolean
 * result of the `AccountVehicle` fallback read, which stays a DB read in the
 * command and is passed in here as a plain boolean. It returns the
 * `fieldErrors` record directly (an empty object means the references are
 * all valid).
 *
 * Note on `scheduledAt`: the contract's "no dates" constraint, and the fact
 * that the current inline validation block never references `scheduledAt`
 * at all, both confirm it has no place in this seam's signature. The
 * inactive-branch fix must reject unconditionally, independent of whether
 * the caller is a walk-in (`scheduledAt: null`) or a scheduled booking
 * (`scheduledAt` set) — so a single call below (with no `scheduledAt`
 * parameter to vary) covers both request shapes; see the comment on that
 * test.
 */

import assert from "node:assert/strict";
import { before, test } from "node:test";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

process.env.DATABASE_URL ??= "postgresql://unused/unused";
process.env.SESSION_SECRET ??= "unit-test-placeholder-secret-value-not-real-00";

type ReferencesModule = typeof import("../lib/orders/order-create-references");
type ValidateInput = Parameters<ReferencesModule["validateOrderReferences"]>[0];

let mod: ReferencesModule | undefined;
let loadError: unknown;

before(async () => {
  try {
    mod = await import("../lib/orders/order-create-references");
  } catch (error) {
    loadError = error;
  }
});

function validate(input: ValidateInput): Record<string, string> {
  if (loadError || !mod) {
    const reason = loadError instanceof Error ? loadError.message : String(loadError);
    throw new Error(`lib/orders/order-create-references.ts failed to load: ${reason}`);
  }
  return mod.validateOrderReferences(input);
}

// ---------------------------------------------------------------------------
// Source-text helpers for architecture guards
// ---------------------------------------------------------------------------

const testsDir = dirname(fileURLToPath(import.meta.url));
const commandPath = resolve(testsDir, "../lib/orders/order-create-command.ts");
const referencesPath = resolve(testsDir, "../lib/orders/order-create-references.ts");

function readCommandSource(): string {
  return readFileSync(commandPath, "utf8");
}

/**
 * Returns the substring from `openBraceIndex` (which must point at a `{`)
 * through its matching closing `}`, respecting nested braces. Used instead
 * of a fixed end-marker string so a guard survives reformatting of the
 * object it scopes into.
 */
function sliceBalancedBraces(source: string, openBraceIndex: number): string {
  assert.equal(source[openBraceIndex], "{", "sliceBalancedBraces must start at a '{'");
  let depth = 0;
  for (let i = openBraceIndex; i < source.length; i += 1) {
    if (source[i] === "{") depth += 1;
    else if (source[i] === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(openBraceIndex, i + 1);
    }
  }
  throw new Error("sliceBalancedBraces: unbalanced braces from the given start index");
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const MSG = {
  branchNotFound: "Салбар олдсонгүй.",
  customerNotFound: "Үйлчлүүлэгч олдсонгүй.",
  appointmentNotFound: "Цаг захиалга олдсонгүй.",
  appointmentAlreadyLinked: "Энэ цаг захиалгад засварын хуудас аль хэдийн үүссэн байна.",
  appointmentWrongBranch: "Цаг захиалга өөр салбарынх байна.",
  appointmentCustomerMismatch: "Цаг захиалгын үйлчлүүлэгчтэй таарахгүй байна.",
  vehicleLinkedToOtherAppointmentVehicle: "Энэ цаг захиалгад өөр машин холбогдсон байна.",
  vehicleOwnedByOtherCustomer: "Энэ машин сонгосон үйлчлүүлэгчийнх биш.",
  vehicleNotFound: "Машин олдсонгүй.",
} as const;

const activeBranch = { id: "branch-a", slotMinutes: 30, isActive: true };
const inactiveBranch = { id: "branch-a", slotMinutes: 30, isActive: false };
const validCustomer = { id: "customer-a" };
const ownedVehicle = { vehicleId: "vehicle-a", customerId: "customer-a", isPostpaid: false };

function appointmentFixture(overrides: Partial<ValidateInput["appointment"] & {}> = {}) {
  return {
    id: "appt-a",
    status: "CONFIRMED" as const,
    customerId: "customer-a",
    accountId: null,
    vehicleId: null,
    serviceOrderId: null,
    branchId: "branch-a",
    estimatedDurationMinutes: 30,
    arrivedAt: null,
    categoryId: null,
    category: null,
    categories: [],
    ...overrides,
  };
}

function baseInput(overrides: Partial<ValidateInput> = {}): ValidateInput {
  return {
    branchId: "branch-a",
    customerId: "customer-a",
    vehicleId: "vehicle-a",
    appointmentId: null,
    branch: activeBranch,
    customer: validCustomer,
    vehicle: ownedVehicle,
    appointment: null,
    accountVehicleToLink: false,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// C1-1 — active-branch requirement
// ---------------------------------------------------------------------------

test("C1-1: inactive same-tenant branch is rejected on branchId, regardless of scheduledAt (excluded from the seam)", () => {
  // The pure seam has no scheduledAt parameter (see file header). A caller
  // building input for a walk-in (scheduledAt: null) or a scheduled create
  // (scheduledAt set) produces the identical validator call below, so this
  // one assertion pins the fix for both request shapes described in the
  // contract matrix's C1-1 negative cases 1 and 2.
  const result = validate(baseInput({ branch: inactiveBranch }));
  assert.deepEqual(result, { branchId: MSG.branchNotFound });
});

test("C1-1 regression: null branch snapshot (cross-tenant branch id) is rejected with the same message", () => {
  const result = validate(baseInput({ branch: null }));
  assert.deepEqual(result, { branchId: MSG.branchNotFound });
});

test("C1-1 positive: active same-tenant branch does not populate branchId", () => {
  const result = validate(baseInput());
  assert.equal(result.branchId, undefined);
});

// ---------------------------------------------------------------------------
// C1-2 — appointment must belong to the order's branch
// ---------------------------------------------------------------------------

test("C1-2: appointment in a different branch than the order is rejected with the branch-specific message", () => {
  const result = validate(
    baseInput({
      appointmentId: "appt-a",
      appointment: appointmentFixture({ branchId: "branch-b" }),
    }),
  );
  assert.deepEqual(result, { appointmentId: MSG.appointmentWrongBranch });
});

test("C1-2 positive: appointment in the same branch as the order is accepted", () => {
  const result = validate(
    baseInput({
      appointmentId: "appt-a",
      appointment: appointmentFixture({ branchId: "branch-a" }),
    }),
  );
  assert.deepEqual(result, {});
});

// ---------------------------------------------------------------------------
// appointmentId precedence chain: not found -> already linked -> wrong branch
// -> customer mismatch
// ---------------------------------------------------------------------------

test("precedence + regression: appointment not found beats everything else and rejects on appointmentId", () => {
  const result = validate(baseInput({ appointmentId: "appt-missing", appointment: null }));
  assert.deepEqual(result, { appointmentId: MSG.appointmentNotFound });
});

test("regression: already-linked appointment (no other defects) rejects on appointmentId", () => {
  const result = validate(
    baseInput({
      appointmentId: "appt-a",
      appointment: appointmentFixture({ serviceOrderId: "order-existing" }),
    }),
  );
  assert.deepEqual(result, { appointmentId: MSG.appointmentAlreadyLinked });
});

test("precedence: an appointment that is BOTH cross-branch AND already linked reports already-linked, not wrong-branch", () => {
  const result = validate(
    baseInput({
      appointmentId: "appt-a",
      appointment: appointmentFixture({ branchId: "branch-b", serviceOrderId: "order-existing" }),
    }),
  );
  assert.deepEqual(result, { appointmentId: MSG.appointmentAlreadyLinked });
});

test("precedence: an appointment that is BOTH cross-branch AND customer-mismatched reports wrong-branch, not customer-mismatch", () => {
  const result = validate(
    baseInput({
      appointmentId: "appt-a",
      appointment: appointmentFixture({ branchId: "branch-b", customerId: "customer-other" }),
    }),
  );
  assert.deepEqual(result, { appointmentId: MSG.appointmentWrongBranch });
});

test("regression: appointment customer mismatch alone rejects on customerId, not appointmentId", () => {
  const result = validate(
    baseInput({
      appointmentId: "appt-a",
      appointment: appointmentFixture({ customerId: "customer-other" }),
    }),
  );
  assert.deepEqual(result, { customerId: MSG.appointmentCustomerMismatch });
});

// Mutation guard, not a red-first test: passes immediately against the
// landed implementation. It exists to catch a mutant comparison such as
// `appointment.customerId && appointment.customerId !== customerId`, which
// would treat a null (unresolved) appointment.customerId as "no mismatch"
// and would otherwise pass every test above.
test("mutation guard: appointment customer null still mismatches a non-null input.customerId", () => {
  const result = validate(
    baseInput({
      appointmentId: "appt-a",
      appointment: appointmentFixture({ customerId: null }),
    }),
  );
  assert.deepEqual(result, { customerId: MSG.appointmentCustomerMismatch });
});

// ---------------------------------------------------------------------------
// Other "must not regress" rows
// ---------------------------------------------------------------------------

test("regression: customer snapshot null rejects on customerId", () => {
  const result = validate(baseInput({ customer: null }));
  assert.deepEqual(result, { customerId: MSG.customerNotFound });
});

test("regression: appointment has a different linked vehicle rejects on vehicleId", () => {
  const result = validate(
    baseInput({
      appointmentId: "appt-a",
      appointment: appointmentFixture({ vehicleId: "vehicle-other" }),
    }),
  );
  assert.deepEqual(result, { vehicleId: MSG.vehicleLinkedToOtherAppointmentVehicle });
});

test("regression: tenant vehicle exists but is owned by another customer rejects on vehicleId", () => {
  const result = validate(
    baseInput({ vehicle: { vehicleId: "vehicle-a", customerId: "customer-other", isPostpaid: false } }),
  );
  assert.deepEqual(result, { vehicleId: MSG.vehicleOwnedByOtherCustomer });
});

// Mutation guard, not a red-first test: passes immediately against the
// landed implementation. It exists to catch a mutant comparison such as
// `vehicle.customerId && vehicle.customerId !== customerId`, which would
// treat a null (unresolved) tenantVehicle.customerId as "no mismatch" and
// would otherwise pass every test above.
test("mutation guard: tenant vehicle with null customerId still mismatches a non-null input.customerId", () => {
  const result = validate(
    baseInput({ vehicle: { vehicleId: "vehicle-a", customerId: null, isPostpaid: false } }),
  );
  assert.deepEqual(result, { vehicleId: MSG.vehicleOwnedByOtherCustomer });
});

test("regression: no tenant vehicle and no linkable account vehicle rejects on vehicleId", () => {
  const result = validate(baseInput({ vehicle: null, accountVehicleToLink: false }));
  assert.deepEqual(result, { vehicleId: MSG.vehicleNotFound });
});

// ---------------------------------------------------------------------------
// vehicleId overwrite precedence: appointment-vehicle-mismatch, then
// vehicle-owner-mismatch, then "not found" — later write wins for the same
// key. Pin today's behavior with two combined cases.
// ---------------------------------------------------------------------------

test("vehicleId precedence: appointment-vehicle mismatch + vehicle-owner mismatch -> owner-mismatch message survives", () => {
  const result = validate(
    baseInput({
      appointmentId: "appt-a",
      appointment: appointmentFixture({ vehicleId: "vehicle-other" }),
      vehicle: { vehicleId: "vehicle-a", customerId: "customer-other", isPostpaid: false },
    }),
  );
  assert.deepEqual(result, { vehicleId: MSG.vehicleOwnedByOtherCustomer });
});

test("vehicleId precedence: appointment-vehicle mismatch + vehicle not found -> not-found message survives", () => {
  const result = validate(
    baseInput({
      appointmentId: "appt-a",
      appointment: appointmentFixture({ vehicleId: "vehicle-other" }),
      vehicle: null,
      accountVehicleToLink: false,
    }),
  );
  assert.deepEqual(result, { vehicleId: MSG.vehicleNotFound });
});

// ---------------------------------------------------------------------------
// Clean positive case
// ---------------------------------------------------------------------------

test("positive: active branch, valid customer, vehicle owned by customer, no appointment -> no field errors", () => {
  const result = validate(baseInput());
  assert.deepEqual(result, {});
});

test("positive: accountVehicleToLink true lets the account-fallback vehicle through with no tenant vehicle row", () => {
  const result = validate(
    baseInput({
      vehicle: null,
      accountVehicleToLink: true,
      appointmentId: "appt-a",
      appointment: appointmentFixture({ accountId: "account-a", customerId: "customer-a" }),
    }),
  );
  assert.deepEqual(result, {});
});

// ---------------------------------------------------------------------------
// C1-3 — architecture guard (source-pattern assertion; the ONLY legitimate
// use of one under D-123 step 3). This runs against source text today and
// MUST fail right now, because the branchId predicate is not yet present.
// ---------------------------------------------------------------------------

test("C1-3 architecture guard: tx.appointment.updateMany where-clause asserts branchId", () => {
  const source = readCommandSource();

  const startMarker = "const linked = await tx.appointment.updateMany({";
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, "could not locate tx.appointment.updateMany call in order-create-command.ts");

  const dataMarker = "data: {";
  const dataStart = source.indexOf(dataMarker, start);
  assert.notEqual(dataStart, -1, "could not locate the updateMany data clause");

  const whereClause = source.slice(start, dataStart);
  assert.match(
    whereClause,
    /branchId:\s*input\.branchId/,
    "the appointment.updateMany where-clause must re-assert branchId: input.branchId so a concurrent move of the appointment to another branch fails the atomic link (linked.count !== 1) instead of silently succeeding",
  );
});

// ---------------------------------------------------------------------------
// Wiring guards — nothing above proves the command actually USES the seam.
// An implementer could add lib/orders/order-create-references.ts, satisfy
// every behavioral test above, and never touch order-create-command.ts,
// leaving both P1 defects live behind a green suite. These guards close
// that hole. Each is scoped to the relevant call's source slice, not the
// whole file, the same way C1-3 is scoped to the updateMany where-clause.
// ---------------------------------------------------------------------------

test("architecture guard: order-create-command.ts imports and calls validateOrderReferences from the seam", () => {
  const source = readCommandSource();

  assert.match(
    source,
    /import\s*\{[^}]*\bvalidateOrderReferences\b[^}]*\}\s*from\s*["'](?:\.\/order-create-references|@\/lib\/orders\/order-create-references)["']/,
    "order-create-command.ts must import validateOrderReferences from the new pure seam module",
  );
  assert.match(
    source,
    /validateOrderReferences\(/,
    "order-create-command.ts must actually call validateOrderReferences instead of leaving the inline checks in place",
  );
});

test("architecture guard: order-create-command.ts no longer duplicates the inline reference-validation messages", () => {
  const source = readCommandSource();

  // These strings must live in exactly one place (the new seam module) once
  // the extraction happens. Finding them here means the inline block was
  // copied instead of removed, which lets the two copies drift.
  assert.doesNotMatch(source, /Салбар олдсонгүй\./, "branchId not-found message must move to order-create-references.ts, not stay inline");
  assert.doesNotMatch(source, /Үйлчлүүлэгч олдсонгүй\./, "customerId not-found message must move to order-create-references.ts, not stay inline");
  assert.doesNotMatch(source, /Машин олдсонгүй\./, "vehicleId not-found message must move to order-create-references.ts, not stay inline");
});

test("architecture guard: tx.branch.findFirst selects isActive", () => {
  const source = readCommandSource();

  const callIndex = source.indexOf("tx.branch.findFirst({");
  assert.notEqual(callIndex, -1, "could not locate tx.branch.findFirst call in order-create-command.ts");

  const selectMarker = "select: {";
  const selectMarkerIndex = source.indexOf(selectMarker, callIndex);
  assert.notEqual(selectMarkerIndex, -1, "could not locate the branch findFirst select clause");

  const selectSlice = sliceBalancedBraces(source, selectMarkerIndex + selectMarker.length - 1);
  assert.match(
    selectSlice,
    /isActive:\s*true/,
    "tx.branch.findFirst's select must include isActive: true, or the pure validator always receives isActive === undefined and rejects every branch as inactive",
  );
});

test("architecture guard: tx.appointment.findFirst selects branchId", () => {
  const source = readCommandSource();

  const callIndex = source.indexOf("tx.appointment.findFirst({");
  assert.notEqual(callIndex, -1, "could not locate tx.appointment.findFirst call in order-create-command.ts");

  const selectMarker = "select: {";
  const selectMarkerIndex = source.indexOf(selectMarker, callIndex);
  assert.notEqual(selectMarkerIndex, -1, "could not locate the appointment findFirst select clause");

  const selectSlice = sliceBalancedBraces(source, selectMarkerIndex + selectMarker.length - 1);
  assert.match(
    selectSlice,
    /branchId:\s*true/,
    "tx.appointment.findFirst's select must include branchId: true, or the pure validator always receives branchId === undefined and rejects every linked appointment as cross-branch",
  );
});

test("architecture guard: order-create-references.ts imports nothing from Prisma or env-reading modules", () => {
  const source = readFileSync(referencesPath, "utf8");

  assert.doesNotMatch(source, /@\/lib\/prisma/, "the pure seam must not import @/lib/prisma");
  assert.doesNotMatch(source, /@\/app\/generated\/prisma\/client/, "the pure seam must not import the generated Prisma client");
  assert.doesNotMatch(source, /@\/lib\/env/, "the pure seam must not import @/lib/env");
});

// ---------------------------------------------------------------------------
// Dead appointments (cancelled / rejected / no-show) must not be linked —
// linking used to flip them back to CONFIRMED and drop the refund-needed fee.
// ---------------------------------------------------------------------------

for (const status of ["CANCELLED", "REJECTED", "NO_SHOW"] as const) {
  test(`appointment in ${status} status cannot get a service order`, () => {
    const result = validate(baseInput({ appointmentId: "appt-a", appointment: appointmentFixture({ status }) }));
    assert.ok(result.appointmentId, `expected appointmentId error for ${status}`);
  });
}

for (const status of ["PENDING", "CONFIRMED"] as const) {
  test(`appointment in ${status} status can get a service order`, () => {
    const result = validate(baseInput({ appointmentId: "appt-a", appointment: appointmentFixture({ status }) }));
    assert.equal(result.appointmentId, undefined);
  });
}

test("order-create link updateMany only flips linkable appointment statuses", () => {
  const source = readCommandSource();
  const link = source.slice(source.indexOf("tx.appointment.updateMany({"));
  const where = link.slice(0, link.indexOf("data:"));
  assert.match(where, /status: \{ in: \[\.\.\.LINKABLE_APPOINTMENT_STATUSES\] \}/);
});
