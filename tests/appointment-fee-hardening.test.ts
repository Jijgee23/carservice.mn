import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

process.env.DATABASE_URL ??= "postgresql://unused/unused";
process.env.SESSION_SECRET ??= "unit-test-placeholder-secret-value-not-real-00";

const src = (rel: string) =>
  readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "..", rel), "utf8");

// --- Fix 3: REFUNDED mapping ------------------------------------------------

const D = (v: string) => ({ toString: () => v }) as never;

test("serializeAppointmentFee maps a REFUNDED payment to REFUNDED, PAID otherwise", async () => {
  const { serializeAppointmentFee } = await import("../lib/appointment-payments");
  const base = {
    feeAmount: D("5000"),
    feeCurrency: "MNT",
    feeQpayInvoiceId: "inv",
    feeQrImage: "img",
    feeQrText: "txt",
    feeQpayUrls: null,
    feeUnderpaidAmount: null,
  };
  const refunded = serializeAppointmentFee({ ...base, payment: { amount: D("5000"), currency: "MNT", status: "REFUNDED" } });
  assert.equal(refunded?.status, "REFUNDED");
  assert.equal(refunded?.qrImage, null);
  const paid = serializeAppointmentFee({ ...base, payment: { amount: D("5000"), currency: "MNT", status: "PAID" } });
  assert.equal(paid?.status, "PAID");
});

test("appointmentBookingPaymentStatus maps REFUNDED explicitly (not PENDING/FAILED)", async () => {
  const { appointmentBookingPaymentStatus } = await import("../lib/appointment-payment-status");
  const input = { feeAmount: 5000, feeQpayInvoiceId: "inv", feeUnderpaidAmount: null };
  assert.equal(appointmentBookingPaymentStatus({ ...input, payment: { status: "REFUNDED" } }), "REFUNDED");
  assert.equal(appointmentBookingPaymentStatus({ ...input, payment: { status: "PAID" } }), "PAID");
  assert.equal(appointmentBookingPaymentStatus({ ...input, payment: null }), "PENDING");
});

test("a refunded-but-not-cancelled booking keeps its slot (never TTL-expired)", async () => {
  const { isPendingAppointmentPaymentExpired } = await import("../lib/appointment-payment-status");
  const old = new Date(Date.now() - 3 * 60 * 60 * 1000);
  assert.equal(
    isPendingAppointmentPaymentExpired({ feeAmount: 5000, payment: { status: "REFUNDED" }, createdAt: old }),
    false,
  );
  assert.equal(
    isPendingAppointmentPaymentExpired({ feeAmount: 5000, payment: null, createdAt: old }),
    true,
  );
});

test("confirm/retry never treat a REFUNDED row as paid; customer routes select payment.status", () => {
  const s = src("lib/appointment-payments.ts");
  assert.match(s, /payment\?\.status === "REFUNDED"[\s\S]{0,200}paid: false/);
  for (const file of [
    "app/api/v1/app/appointments/route.ts",
    "app/api/v1/app/appointments/[id]/payment/route.ts",
    "app/api/v1/app/appointments/[id]/payment/retry/route.ts",
  ]) {
    assert.match(src(file), /payment: \{ select: \{ amount: true, currency: true, status: true \} \}/, file);
  }
});

// --- Fix 2: provider invoice cancel + late payment on dead booking ----------

test("cancelAppointmentFeeInvoice: outcomes per provider result", async () => {
  const { cancelAppointmentFeeInvoice } = await import("../lib/appointment-fee-invoice");
  const run = async (res: unknown, appt = { id: "a", feeQpayInvoiceId: "inv" as string | null, hasPayment: false }) => {
    const calls: string[] = [];
    const out = await cancelAppointmentFeeInvoice(appt, {
      cancelInvoice: async () => {
        calls.push("cancel");
        return res as never;
      },
      confirmPaid: async (id) => {
        calls.push(`confirm:${id}`);
      },
    });
    return { out, calls };
  };
  assert.deepEqual(await run({ ok: true }), { out: "cancelled", calls: ["cancel"] });
  assert.deepEqual(await run({ ok: false, reason: "not_found" }), { out: "cancelled", calls: ["cancel"] });
  assert.deepEqual(await run({ ok: false, reason: "already_paid" }), { out: "paid", calls: ["cancel", "confirm:a"] });
  assert.deepEqual(await run({ ok: false, reason: "http_error" }), { out: "failed", calls: ["cancel"] });
  assert.deepEqual(await run({ ok: true }, { id: "a", feeQpayInvoiceId: null, hasPayment: false }), { out: "no_invoice", calls: [] });
  assert.deepEqual(await run({ ok: true }, { id: "a", feeQpayInvoiceId: "inv", hasPayment: true }), { out: "no_invoice", calls: [] });
});

test("cancelAppointmentFeeInvoice never throws when the provider call throws", async () => {
  const { cancelAppointmentFeeInvoice } = await import("../lib/appointment-fee-invoice");
  const out = await cancelAppointmentFeeInvoice(
    { id: "a", feeQpayInvoiceId: "inv", hasPayment: false },
    {
      cancelInvoice: async () => {
        throw new Error("boom");
      },
      confirmPaid: async () => {},
    },
  );
  assert.equal(out, "failed");
});

test("every appointment cancel path cancels the provider invoice after its conditional write", () => {
  const cancelCall = /cancelAppointmentFeeInvoiceById\(/;
  assert.match(src("app/api/v1/app/appointments/[id]/cancel/route.ts"), cancelCall);
  assert.match(src("app/api/cron/expire-appointments/route.ts"), /cancelAppointmentFeeInvoicesBounded\(/);
  assert.match(src("app/api/v1/appointments/[id]/route.ts"), cancelCall);
  const cmd = src("lib/appointments/appointment-commands.ts");
  assert.ok((cmd.match(/cancelAppointmentFeeInvoiceById\(/g) ?? []).length >= 2, "account cancel + reject");
});

test("late payment on a CANCELLED/REJECTED booking: recorded, flagged, no staff notification", () => {
  const s = src("lib/appointment-payments.ts");
  assert.match(s, /currentStatus === "CANCELLED" \|\| currentStatus === "REJECTED"/);
  assert.match(s, /if \(!capacityLostOnFullPayment && !paidOnDeadBooking\)/);
  assert.match(s, /appendDeadBookingNote/);
  // status is NOT rewritten for the dead-booking branch
  const branch = s.slice(s.indexOf("data: deadBooking"), s.indexOf("appendDeadBookingNote(currentNote)"));
  assert.doesNotMatch(branch, /status:/);
  assert.match(
    src("app/system/(authed)/booking-revenue/page.tsx"),
    /appointment: \{ status: \{ in: \["CANCELLED", "REJECTED"\] \} \}/,
  );
});

// --- Fix 5: atomic refund claim --------------------------------------------

type Row = {
  id: string;
  tenantId: string;
  status: string;
  refundNote: string | null;
  updatedAt: Date;
  amount: string;
  currency: string;
  paymentType: string | null;
  qpayPaymentId: string | null;
  refundedAt?: Date;
  refundedById?: string;
};

function fakeDb(row: Row) {
  type Cond = Record<string, unknown>;
  const matches = (w: Cond): boolean => {
    for (const [k, v] of Object.entries(w)) {
      if (k === "OR") {
        if (!(v as Cond[]).some((c) => matches(c))) return false;
      } else if (k === "AND") {
        if (!(v as Cond[]).every((c) => matches(c))) return false;
      } else if (k === "NOT") {
        if (matches(v as Cond)) return false;
      } else if (k === "updatedAt") {
        if (!(row.updatedAt < (v as { lt: Date }).lt)) return false;
      } else if (k === "refundNote" && v && typeof v === "object") {
        const sw = (v as { startsWith: string }).startsWith;
        if (!(row.refundNote !== null && row.refundNote.startsWith(sw))) return false;
      } else if ((row as unknown as Cond)[k] !== v) return false;
    }
    return true;
  };
  return {
    row,
    async updateMany({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) {
      if (!matches(where)) return { count: 0 };
      Object.assign(row, data, { updatedAt: new Date() });
      return { count: 1 };
    },
    async findFirst({ where }: { where: Record<string, unknown> }) {
      return matches(where) ? (row as never) : null;
    },
  };
}
const paidRow = (): Row => ({
  id: "p1",
  tenantId: "t1",
  status: "PAID",
  refundNote: null,
  updatedAt: new Date(Date.now() - 60_000),
  amount: "5000",
  currency: "MNT",
  paymentType: "CARD",
  qpayPaymentId: "q1",
});

test("refund claim: only one of two concurrent claimers wins; loser is IN_PROGRESS", async () => {
  const { claimAppointmentRefund } = await import("../lib/appointment-refund");
  const db = fakeDb(paidRow());
  const [a, b] = await Promise.all([
    claimAppointmentRefund(db, { paymentId: "p1" }),
    claimAppointmentRefund(db, { paymentId: "p1" }),
  ]);
  assert.equal([a, b].filter((r) => r.claimed).length, 1);
  const loser = [a, b].find((r) => !r.claimed)!;
  assert.equal((loser as { reason: string }).reason, "IN_PROGRESS");
});

test("refund claim -> finalize makes REFUNDED; a later claim says ALREADY_REFUNDED", async () => {
  const { claimAppointmentRefund, finalizeAppointmentRefund } = await import("../lib/appointment-refund");
  const db = fakeDb(paidRow());
  const claim = await claimAppointmentRefund(db, { paymentId: "p1" });
  assert.equal(claim.claimed, true);
  const token = claim.claimed ? claim.token : "";
  assert.equal(await finalizeAppointmentRefund(db, { paymentId: "p1", token: "wrong", refundNote: "n" }), false);
  assert.equal(await finalizeAppointmentRefund(db, { paymentId: "p1", token, refundNote: "n", refundedById: "sa" }), true);
  assert.equal(db.row.status, "REFUNDED");
  assert.equal(db.row.refundNote, "n");
  const again = await claimAppointmentRefund(db, { paymentId: "p1" });
  assert.deepEqual(again.claimed ? null : again.reason, "ALREADY_REFUNDED");
});

test("refund claim rollback: release lets the refund be retried", async () => {
  const { claimAppointmentRefund, releaseAppointmentRefundClaim } = await import("../lib/appointment-refund");
  const db = fakeDb(paidRow());
  const claim = await claimAppointmentRefund(db, { paymentId: "p1" });
  assert.equal(claim.claimed, true);
  await releaseAppointmentRefundClaim(db, "p1", "wrong-token");
  assert.notEqual(db.row.refundNote, null, "a foreign token cannot release the claim");
  await releaseAppointmentRefundClaim(db, "p1", claim.claimed ? claim.token : "");
  assert.equal(db.row.status, "PAID");
  assert.equal(db.row.refundNote, null);
  assert.equal((await claimAppointmentRefund(db, { paymentId: "p1" })).claimed, true);
});

test("refund claim: stale claim can be reclaimed; wrong tenant is NOT_FOUND; non-PAID is NOT_PAID", async () => {
  const { claimAppointmentRefund, REFUND_CLAIM_PREFIX, REFUND_CLAIM_STALE_MS } = await import("../lib/appointment-refund");
  const stale = {
    ...paidRow(),
    refundNote: `${REFUND_CLAIM_PREFIX}old`,
    updatedAt: new Date(Date.now() - REFUND_CLAIM_STALE_MS - 1000),
  };
  assert.equal((await claimAppointmentRefund(fakeDb(stale), { paymentId: "p1" })).claimed, true);
  const other = await claimAppointmentRefund(fakeDb(paidRow()), { paymentId: "p1", tenantId: "other" });
  assert.equal(other.claimed ? null : other.reason, "NOT_FOUND");
  const failed = await claimAppointmentRefund(fakeDb({ ...paidRow(), status: "FAILED" }), { paymentId: "p1" });
  assert.equal(failed.claimed ? null : failed.reason, "NOT_PAID");
});

test("refund entry points claim before QPay; tenant route holds no transaction across QPay", () => {
  const action = src("app/_actions/booking-revenue.ts");
  assert.ok(action.indexOf("claimAppointmentRefund(") < action.indexOf("QPayService.refundPayment"));
  assert.match(action, /releaseAppointmentRefundClaim/);
  const route = src("app/api/v1/appointments/[id]/payment/refund/route.ts");
  const qpayAt = route.indexOf("QPayService.refundPayment");
  assert.ok(route.indexOf("claimAppointmentRefund(") < qpayAt);
  assert.doesNotMatch(route, /\$transaction/);
  assert.doesNotMatch(route, /FOR UPDATE/);
  assert.doesNotMatch(route, /\$\{qpay\.error\}/);
});

// --- Subscription activation race + raw error text -------------------------

test("subscription activation locks the SubscriptionPayment row before re-checking status", () => {
  const s = src("lib/subscription-payments.ts");
  const lockAt = s.indexOf('FROM "SubscriptionPayment" WHERE id = ${payment.id} FOR UPDATE');
  const checkAt = s.indexOf('fresh?.status === "PAID"');
  assert.ok(lockAt > 0 && checkAt > lockAt);
});

test("raw QPay error text is not returned to clients", () => {
  assert.doesNotMatch(src("app/_actions/subscription-payments.ts"), /message: inv\.error/);
  assert.doesNotMatch(src("lib/subscription-payments.ts"), /message: check\.error/);
  assert.doesNotMatch(src("lib/subscription-payments.ts"), /message: e\.message/);
  assert.doesNotMatch(src("lib/appointment-payments.ts"), /error: inv\.error/);
  assert.doesNotMatch(src("lib/appointment-payments.ts"), /message: check\.error/);
});

test("stale reclaim by B: A's late finalize/release cannot touch B's claim", async () => {
  const { claimAppointmentRefund, finalizeAppointmentRefund, releaseAppointmentRefundClaim, REFUND_CLAIM_STALE_MS } =
    await import("../lib/appointment-refund");
  const db = fakeDb(paidRow());
  const a = await claimAppointmentRefund(db, { paymentId: "p1" });
  db.row.updatedAt = new Date(Date.now() - REFUND_CLAIM_STALE_MS - 1000);
  const b = await claimAppointmentRefund(db, { paymentId: "p1" });
  assert.ok(a.claimed && b.claimed && a.token !== b.token);
  if (!(a.claimed && b.claimed)) return;
  await releaseAppointmentRefundClaim(db, "p1", a.token);
  assert.equal(db.row.refundNote, b.token);
  assert.equal(await finalizeAppointmentRefund(db, { paymentId: "p1", token: a.token, refundNote: "x" }), false);
  assert.equal(db.row.status, "PAID");
});

test("isDefiniteRefundRejection: only 4xx (not 408/429) is definite", async () => {
  const { isDefiniteRefundRejection } = await import("../lib/appointment-refund");
  assert.equal(isDefiniteRefundRejection("QPay буцаахад алдаа: 400 {}"), true);
  assert.equal(isDefiniteRefundRejection("QPay буцаахад алдаа: 404 nf"), true);
  assert.equal(isDefiniteRefundRejection("QPay буцаахад алдаа: 408 t"), false);
  assert.equal(isDefiniteRefundRejection("QPay буцаахад алдаа: 429 t"), false);
  assert.equal(isDefiniteRefundRejection("QPay буцаахад алдаа: 502 bad"), false);
  assert.equal(isDefiniteRefundRejection("QPay буцаахад алдаа: AbortError"), false);
  assert.equal(isDefiniteRefundRejection("TimeoutError"), false);
});

test("finalizeAppointmentRefundWithRetry retries once on a thrown error", async () => {
  const { finalizeAppointmentRefundWithRetry } = await import("../lib/appointment-refund");
  let calls = 0;
  const db = {
    async updateMany() {
      calls++;
      if (calls === 1) throw new Error("db down");
      return { count: 1 };
    },
    async findFirst() {
      return null;
    },
  };
  assert.equal(await finalizeAppointmentRefundWithRetry(db, { paymentId: "p1", token: "t", refundNote: "n" }), true);
  assert.equal(calls, 2);
});

test("booking-revenue refund keeps the claim on ambiguous failures and finalizes without an audit tx", () => {
  const action = src("app/_actions/booking-revenue.ts");
  assert.match(action, /isDefiniteRefundRejection\(result\.error\)/);
  assert.match(action, /finalizeAppointmentRefundWithRetry/);
  assert.match(action, /REFUND_AMBIGUOUS_MESSAGE/);
});

test("fee checkout requires a live appointment status and cancels the orphan invoice otherwise", () => {
  const s = src("lib/appointment-payments.ts");
  assert.match(s, /status: \{ in: \[\.\.\.FEE_CHECKOUT_LIVE_STATUSES\] \}/);
  assert.match(s, /QPayService\.cancelInvoice\(inv\.invoice_id\)/);
  assert.equal((s.match(/!isFeeCheckoutLive\(appt\.status\)/g) ?? []).length, 2, "ensure + retry");
});

test("platform QPayService exposes cancelInvoice; no duplicate QPaySettings store", () => {
  assert.match(src("lib/qpay.ts"), /cancelInvoice: \(invoiceId: string\)/);
  assert.doesNotMatch(src("lib/appointment-fee-invoice.ts"), /createQPayClient|qPaySettings/);
});

test("claim flags a stale takeover as reclaimed; a fresh claim is not", async () => {
  const { claimAppointmentRefund, REFUND_CLAIM_PREFIX, REFUND_CLAIM_STALE_MS } = await import("../lib/appointment-refund");
  const fresh = await claimAppointmentRefund(fakeDb(paidRow()), { paymentId: "p1" });
  assert.ok(fresh.claimed && fresh.reclaimed === false);
  const held = { ...paidRow(), refundNote: `${REFUND_CLAIM_PREFIX}old`, updatedAt: new Date(Date.now() - REFUND_CLAIM_STALE_MS - 1000) };
  const taken = await claimAppointmentRefund(fakeDb(held), { paymentId: "p1" });
  assert.ok(taken.claimed && taken.reclaimed === true);
});

test("staff (allowReclaim:false) can never take over a held claim, even a stale one", async () => {
  const { claimAppointmentRefund, REFUND_CLAIM_PREFIX, REFUND_CLAIM_STALE_MS } = await import("../lib/appointment-refund");
  const held = { ...paidRow(), refundNote: `${REFUND_CLAIM_PREFIX}old`, updatedAt: new Date(Date.now() - REFUND_CLAIM_STALE_MS - 1000) };
  const r = await claimAppointmentRefund(fakeDb(held), { paymentId: "p1", allowReclaim: false });
  assert.equal(r.claimed ? null : r.reason, "IN_PROGRESS");
});

test("markAppointmentRefundVerified finalizes only rows that hold a claim", async () => {
  const { markAppointmentRefundVerified, REFUND_CLAIM_PREFIX } = await import("../lib/appointment-refund");
  const held = fakeDb({ ...paidRow(), refundNote: `${REFUND_CLAIM_PREFIX}x` });
  assert.equal(await markAppointmentRefundVerified(held, { paymentId: "p1", refundNote: "ok", refundedById: "sa" }), true);
  assert.equal(held.row.status, "REFUNDED");
  assert.equal(held.row.refundNote, "ok");
  const plain = fakeDb(paidRow());
  assert.equal(await markAppointmentRefundVerified(plain, { paymentId: "p1", refundNote: "ok", refundedById: "sa" }), false);
  assert.equal(plain.row.status, "PAID");
  const done = fakeDb({ ...paidRow(), status: "REFUNDED", refundNote: "x" });
  assert.equal(await markAppointmentRefundVerified(done, { paymentId: "p1", refundNote: "ok", refundedById: "sa" }), false);
});

test("mark-verified action is super-admin only, audited; page lists held claims; reclaim never auto-releases", () => {
  const action = src("app/_actions/booking-revenue.ts");
  const fn = action.slice(action.indexOf("export async function markAppointmentRefundVerifiedAction"));
  assert.match(fn, /await requireSuperAdmin\(\)/);
  assert.match(fn, /markAppointmentRefundVerified\(db/);
  assert.match(fn, /logAudit\(/);
  assert.ok(fn.indexOf("requireSuperAdmin") < fn.indexOf("markAppointmentRefundVerified(db"));
  const refund = action.slice(action.indexOf("export async function refundAppointmentPaymentAction"), action.indexOf("export async function markAppointmentRefundVerifiedAction"));
  assert.ok(refund.indexOf("claim.reclaimed") < refund.indexOf("releaseAppointmentRefundClaim(db"), "reclaimed check precedes release");
  assert.match(refund, /REFUND_VERIFY_MESSAGE/);
  const page = src("app/system/(authed)/booking-revenue/page.tsx");
  assert.match(page, /startsWith: REFUND_CLAIM_PREFIX/);
  assert.match(page, /VerifyRefundButton/);
  const route = src("app/api/v1/appointments/[id]/payment/refund/route.ts");
  assert.match(route, /allowReclaim: false/);
  assert.match(route, /REFUND_STAFF_WAIT_MESSAGE/);
  assert.doesNotMatch(route, /REFUND_VERIFY_MESSAGE|REFUND_AMBIGUOUS_MESSAGE/);
});

test("account deletion cancels the QPay fee invoice of each cancelled appointment after the tx", () => {
  const s = src("lib/account-closure/customer.ts");
  const txEnd = s.indexOf('notifyAccountClosed(tokens, "deleted")');
  const cancelAt = s.indexOf("cancelAppointmentFeeInvoiceById(id)");
  assert.ok(txEnd > 0 && cancelAt > txEnd);
  assert.match(s, /cancelledIds: cancellable\.map/);
});

// --- Appointment/refund risk fixes (C, D, 1, 4, 6, 7) ------------------------

test("C: pre-send QPay failures (token/config) are a definite refund rejection", async () => {
  const { isDefiniteRefundRejection, QPAY_NOT_SENT_PREFIX } = await import("../lib/appointment-refund");
  assert.equal(isDefiniteRefundRejection(`${QPAY_NOT_SENT_PREFIX}QPay токен авах явцад алдаа гарлаа.`), true);
  assert.equal(isDefiniteRefundRejection("QPay буцаахад алдаа: AbortError"), false);
  const core = src("lib/qpay-core.ts");
  assert.match(core, /QPAY_NOT_SENT_PREFIX\}\$\{tokenResult\.error\}/);
});

test("D: staff refund messages tell staff to wait for the super admin; super-admin message unchanged", async () => {
  const { REFUND_STAFF_WAIT_MESSAGE, REFUND_VERIFY_MESSAGE } = await import("../lib/appointment-refund");
  assert.match(REFUND_STAFF_WAIT_MESSAGE, /Суперадмин/);
  assert.doesNotMatch(REFUND_STAFF_WAIT_MESSAGE, /Буцаасан гэж тэмдэглэх|10 минут/);
  assert.match(REFUND_VERIFY_MESSAGE, /Буцаасан гэж тэмдэглэх/);
  const route = src("app/api/v1/appointments/[id]/payment/refund/route.ts");
  assert.match(route, /"QPAY_REFUND_UNCERTAIN"/);
  assert.match(route, /IN_PROGRESS" \? REFUND_STAFF_WAIT_MESSAGE/);
});

test("1: customer cancel reports refundPending also for an already-PAID fee payment", () => {
  const route = src("app/api/v1/app/appointments/[id]/cancel/route.ts");
  assert.match(route, /appointmentPayment\.findFirst\(\{\s*where: \{ appointmentId: appt\.id, status: "PAID" \}/);
  assert.match(route, /refundPending/);
});

test("4: cancelAppointmentFeeInvoicesBounded caps concurrency, honours the time budget, never throws", async () => {
  const { cancelAppointmentFeeInvoicesBounded } = await import("../lib/appointment-fee-invoice");
  let running = 0;
  let maxRunning = 0;
  const seen: string[] = [];
  const ids = Array.from({ length: 12 }, (_, i) => `a${i}`);
  const res = await cancelAppointmentFeeInvoicesBounded(ids, {
    concurrency: 5,
    cancel: async (id) => {
      running++;
      maxRunning = Math.max(maxRunning, running);
      seen.push(id);
      await new Promise((r) => setTimeout(r, 5));
      running--;
      if (id === "a3") throw new Error("boom");
    },
  });
  assert.equal(res.attempted, 12);
  assert.equal(res.skipped, 0);
  assert.ok(maxRunning <= 5 && maxRunning > 1, `max concurrency ${maxRunning}`);
  // Budget exhausted before start: nothing attempted, no throw.
  const t = 0;
  let clock = t;
  const none = await cancelAppointmentFeeInvoicesBounded(ids, {
    budgetMs: 10,
    now: () => (clock += 100),
    cancel: async () => {
      throw new Error("must not run");
    },
  });
  assert.equal(none.attempted, 0);
  assert.equal(none.skipped, 12);
  const cron = src("app/api/cron/expire-appointments/route.ts");
  assert.match(cron, /cancelAppointmentFeeInvoicesBounded\(cancelledIds/);
  assert.match(cron, /\} finally \{[\s\S]*?await cancelAppointmentFeeInvoicesBounded/);
  assert.match(cron, /try \{\s*await logAudit\(/);
  assert.doesNotMatch(cron, /await cancelAppointmentFeeInvoiceById/);
});

test("6: dead-booking fee checkout returns 409 APPOINTMENT_NOT_PAYABLE in both retry routes", () => {
  for (const rel of [
    "app/api/v1/app/appointments/[id]/payment/retry/route.ts",
    "app/api/v1/appointments/[id]/payment/retry/route.ts",
  ]) {
    const route = src(rel);
    assert.match(route, /result\.code === APPOINTMENT_NOT_PAYABLE_CODE/);
    assert.match(route, /jsonError\(409, result\.error, \{ code: APPOINTMENT_NOT_PAYABLE_CODE \}\)/);
  }
  const lib = src("lib/appointment-payments.ts");
  assert.equal((lib.match(/error: FEE_CHECKOUT_DEAD_MESSAGE, code: APPOINTMENT_NOT_PAYABLE_CODE/g) ?? []).length, 3);
});

test("7: a concurrent checkout loser cancels its own just-created invoice and returns the existing one", () => {
  const lib = src("lib/appointment-payments.ts");
  const fn = lib.slice(lib.indexOf("async function requestFeeCheckout"), lib.indexOf("export async function ensureAppointmentFeeCheckout"));
  assert.match(fn, /current\.feeQpayInvoiceId !== inv\.invoice_id/);
  const dupIdx = fn.indexOf("could not cancel duplicate invoice");
  assert.ok(dupIdx > fn.indexOf("persisted.count !== 1"));
  assert.match(fn.slice(dupIdx), /return \{ ok: true, required: true \};/);
});

test("7b: a checkout loser with nothing attached cancels its orphan invoice and reports failure", () => {
  const lib = src("lib/appointment-payments.ts");
  const fn = lib.slice(lib.indexOf("async function requestFeeCheckout"), lib.indexOf("export async function ensureAppointmentFeeCheckout"));
  const i = fn.indexOf("could not cancel orphan invoice:");
  assert.ok(i > fn.indexOf("could not cancel duplicate invoice"));
  assert.match(fn, /!current \|\| \(!current\.payment && !current\.feeQpayInvoiceId\)/);
  assert.match(fn.slice(i), /return \{ ok: false, required: true, error: FEE_CHECKOUT_ERROR_MESSAGE \};/);
});
