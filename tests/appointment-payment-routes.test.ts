import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

process.env.DATABASE_URL ??= "postgresql://unused/unused";
process.env.SESSION_SECRET ??= "unit-test-placeholder-secret-value-not-real-00";

let requireAppointmentRefundPermission: typeof import("../lib/appointments/refund-permission").requireAppointmentRefundPermission;
test.before(async () => {
  ({ requireAppointmentRefundPermission } = await import("../lib/appointments/refund-permission"));
});

// D-148's test tsconfig maps the Next-only `server-only` import, so that
// module is no longer the blocker under `tsx --test`. Full request behavior
// still needs Prisma/QPay mocks and a database-independent route seam; the
// refund permission boundary is intentionally factored into a small
// production seam and exercised behaviorally below. The remaining assertions
// are source-level wiring and persistence guards.

function readSource(relativePath: string): string {
  return readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), relativePath), "utf8");
}

const checkSource = () => readSource("../app/api/v1/appointments/[id]/payment/route.ts");
const retrySource = () => readSource("../app/api/v1/appointments/[id]/payment/retry/route.ts");
const refundSource = () => readSource("../app/api/v1/appointments/[id]/payment/refund/route.ts");

// --- Auth wiring: every route requires an authenticated ApiUser ------------

for (const [name, source] of [
  ["check", checkSource],
  ["retry", retrySource],
] as const) {
  test(`${name} route requires an authenticated ApiUser`, () => {
    const src = source();
    assert.match(src, /requireApiUser\(req\)/);
    assert.match(src, /if \(auth\.response\) return auth\.response;/);
  });

  test(`${name} route resolves the X-Working-Branch scope and early-returns on rejection`, () => {
    const src = source();
    assert.match(src, /resolveWorkingBranch\(req, auth\.user\)/);
    assert.match(src, /if \(scopeResult\.response\) return scopeResult\.response;/);
  });

  test(`${name} route scopes the appointment lookup by tenantId and rejects a branch mismatch`, () => {
    const src = source();
    assert.match(src, /tenantId:\s*auth\.user\.tenantId/);
    assert.match(
      src,
      /scopeResult\.branchId != null && appt\.branchId !== scopeResult\.branchId/,
    );
  });
}

// --- P2-B6's whole point: permission boundary per operation ----------------

test("check route requires payments.view", () => {
  const src = checkSource();
  assert.match(src, /requirePermission\(auth\.user,\s*"payments\.view"\)/);
  assert.match(src, /if \(denied\) return denied;/);
});

test("retry route requires payments.edit", () => {
  const src = retrySource();
  assert.match(src, /requirePermission\(auth\.user,\s*"payments\.edit"\)/);
  assert.match(src, /if \(denied\) return denied;/);
});

// Booking-fee refund is PLATFORM-only (paid to the platform QPay merchant):
// no tenant permission unlocks it through the staff API.
for (const [label, user] of [
  ["payments.edit-only actor", { isOwner: false, role: { permissions: ["payments.edit"] } }],
  ["payments.delete actor", { isOwner: false, role: { permissions: ["payments.delete"] } }],
  ["tenant owner", { isOwner: true, role: null }],
] as const) {
  test(`refund gate refuses a ${label} with 403 PLATFORM_REFUND_ONLY`, async () => {
    const response = requireAppointmentRefundPermission(
      user as unknown as Parameters<typeof requireAppointmentRefundPermission>[0],
    );
    assert.equal(response.status, 403);
    const body = await response.json();
    assert.equal(body.code, "PLATFORM_REFUND_ONLY");
    assert.equal(body.error, "Захиалгын хураамжийг зөвхөн платформын админ буцаана.");
  });
}

test("refund route authenticates first, then refuses before any DB/QPay work", () => {
  const src = refundSource();
  const authIdx = src.indexOf("requireApiUser(req)");
  const gateIdx = src.indexOf("requireAppointmentRefundPermission(auth.user)");
  assert.ok(authIdx >= 0 && gateIdx > authIdx, "auth must run before the platform-only gate");
  assert.match(src, /if \(auth\.response\) return auth\.response;/);
  assert.doesNotMatch(src, /prisma/);
  assert.doesNotMatch(src, /QPayService/);
  assert.doesNotMatch(src, /claimAppointmentRefund/);
});

test("check route does NOT require payments.edit or payments.delete (weaker than retry/refund)", () => {
  const src = checkSource();
  assert.doesNotMatch(src, /requirePermission\(auth\.user,\s*"payments\.edit"\)/);
  assert.doesNotMatch(src, /requirePermission\(auth\.user,\s*"payments\.delete"\)/);
});

// --- Persisted state is the source of truth, never a client scalar ---------

test("check route re-verifies payment state via confirmAppointmentPayment, not a client-supplied paid/amount field", () => {
  const src = checkSource();
  assert.match(src, /confirmAppointmentPayment\(appt\.id\)/);
  // No request-body parsing at all — nothing client-supplied could feed the
  // paid/amount decision.
  assert.doesNotMatch(src, /req\.json\(\)/);
});

test("retry route delegates to retryAppointmentFeeCheckout, which itself re-reads Appointment.payment before acting", () => {
  const src = retrySource();
  assert.match(src, /retryAppointmentFeeCheckout\(appt\.id\)/);
  const libSrc = readSource("../lib/appointment-payments.ts");
  const fnStart = libSrc.indexOf("export async function retryAppointmentFeeCheckout");
  assert.notEqual(fnStart, -1);
  const fnBody = libSrc.slice(fnStart, fnStart + 1500);
  // Idempotency / concurrent-retry safety: an existing payment row short-
  // circuits before any new QPay checkout is requested.
  assert.match(fnBody, /if \(appt\.payment\) return \{ ok: true, required: true \}/);
});

test("retry checkout uses QPay sender uniqueness and conditional local writes instead of holding a DB lock across provider I/O", () => {
  const libSrc = readSource("../lib/appointment-payments.ts");
  const fnStart = libSrc.indexOf("export async function retryAppointmentFeeCheckout");
  assert.notEqual(fnStart, -1);
  const fnBody = libSrc.slice(fnStart, fnStart + 4200);
  const invoiceCheckIdx = fnBody.indexOf("appt.feeQpayInvoiceId");
  const providerCallIdx = fnBody.indexOf("requestFeeCheckout(");
  assert.ok(invoiceCheckIdx >= 0, "retry must short-circuit when an invoice is already persisted");
  assert.ok(providerCallIdx > invoiceCheckIdx, "retry must call QPay only after the persisted-state check");
  assert.doesNotMatch(fnBody, /withBookingTransaction\(appt\.tenantId/);
  assert.match(libSrc, /feeQpayInvoiceId:\s*null,\s*payment:\s*\{ is: null \}/);
  assert.match(libSrc, /QPay requires sender_invoice_no to be unique|QPay's unique sender_invoice_no/);
});

test("retry route requires an active subscription before mutating", () => {
  const src = retrySource();
  assert.match(src, /requireActiveSubscriptionApi\(auth\.user\)/);
  assert.match(src, /if \(locked\) return locked;/);
});

test("no route imports or touches the customer-realm /api/v1/app/appointments payment tree", () => {
  for (const source of [checkSource, retrySource, refundSource]) {
    const src = source();
    assert.doesNotMatch(src, /api\/v1\/app\/appointments/);
    assert.doesNotMatch(src, /getApiAccountFromRequest/);
  }
});
