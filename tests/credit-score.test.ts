import assert from "node:assert/strict";
import test from "node:test";
import {
  CREDIT_UNBLOCK_MARGIN,
  type CreditBlockState,
  computeCreditScore,
  decideCreditBlock,
} from "../lib/credit-score";
import { ReviewError, parseReviewInput } from "../lib/reviews";
import { maskReviewerName } from "../lib/reviews-public";

const EMPTY = {
  ratingSum: 0,
  ratingCount: 0,
  bookingConfirmed: 0,
  bookingRejected: 0,
  ordersCompleted: 0,
  ordersCancelled: 0,
  onTime: 0,
  onTimeTotal: 0,
};

const OK: CreditBlockState = { suspended: false, creditHidden: false, creditSuspended: false, creditExempt: false };
const HIDE = { autoBlock: true, threshold: 40, mode: "HIDE" as const };
const SUSPEND = { autoBlock: true, threshold: 40, mode: "SUSPEND" as const };

test("a new tenant with no data starts comfortably above a 40 threshold (priors)", () => {
  const r = computeCreditScore(EMPTY);
  assert.ok(r.score >= 75 && r.score <= 80, String(r.score));
  assert.equal(r.components.length, 4);
});

test("bad service drives the score down; great service up; adjustment is clamped to ±50", () => {
  const bad = computeCreditScore({
    ratingSum: 30 * 1, ratingCount: 30,
    bookingConfirmed: 2, bookingRejected: 30,
    ordersCompleted: 5, ordersCancelled: 40,
    onTime: 1, onTimeTotal: 30,
  });
  assert.ok(bad.score < 25, String(bad.score));
  const good = computeCreditScore({
    ratingSum: 50 * 5, ratingCount: 50,
    bookingConfirmed: 60, bookingRejected: 0,
    ordersCompleted: 100, ordersCancelled: 1,
    onTime: 95, onTimeTotal: 100,
  });
  assert.ok(good.score >= 95, String(good.score));
  assert.equal(computeCreditScore(EMPTY, 500).adjustment, 50);
  assert.equal(computeCreditScore(EMPTY, -500).score, Math.max(0, computeCreditScore(EMPTY).base - 50));
});

test("HIDE mode: below threshold hides; recovers only above threshold + margin (hysteresis)", () => {
  const blocked = decideCreditBlock(39, OK, HIDE);
  assert.deepEqual(blocked, { next: { suspended: false, creditHidden: true, creditSuspended: false }, event: "blocked" });
  const hidden = { ...OK, creditHidden: true };
  assert.equal(decideCreditBlock(40 + CREDIT_UNBLOCK_MARGIN - 1, hidden, HIDE).next.creditHidden, true);
  const back = decideCreditBlock(40 + CREDIT_UNBLOCK_MARGIN, hidden, HIDE);
  assert.deepEqual(back, { next: { suspended: false, creditHidden: false, creditSuspended: false }, event: "unblocked" });
});

test("SUSPEND mode suspends and auto-restores only credit suspensions, never a manual one", () => {
  const s = decideCreditBlock(10, OK, SUSPEND);
  assert.deepEqual(s, { next: { suspended: true, creditHidden: false, creditSuspended: true }, event: "blocked" });
  const restored = decideCreditBlock(90, { ...OK, suspended: true, creditSuspended: true }, SUSPEND);
  assert.deepEqual(restored.next, { suspended: false, creditHidden: false, creditSuspended: false });
  assert.equal(restored.event, "unblocked");
  // Admin suspended manually: a good score must not lift it.
  const manual = decideCreditBlock(90, { ...OK, suspended: true }, SUSPEND);
  assert.equal(manual.next.suspended, true);
  assert.equal(manual.event, null);
});

test("exempt tenants and a disabled auto-block are never blocked (and get unblocked)", () => {
  assert.equal(decideCreditBlock(5, { ...OK, creditExempt: true }, HIDE).next.creditHidden, false);
  const off = decideCreditBlock(5, { ...OK, creditHidden: true }, { ...HIDE, autoBlock: false });
  assert.deepEqual(off, { next: { suspended: false, creditHidden: false, creditSuspended: false }, event: "unblocked" });
});

test("switching HIDE → SUSPEND moves an already-blocked tenant without a duplicate 'blocked' event", () => {
  const r = decideCreditBlock(10, { ...OK, creditHidden: true }, SUSPEND);
  assert.deepEqual(r.next, { suspended: true, creditHidden: false, creditSuspended: true });
  assert.equal(r.event, null);
});

test("review input: 1..5 integer stars, trimmed optional comment", () => {
  assert.deepEqual(parseReviewInput("5", "  Маш сайн  "), { rating: 5, comment: "Маш сайн" });
  assert.deepEqual(parseReviewInput(3, ""), { rating: 3, comment: null });
  for (const bad of [0, 6, 2.5, "x", null]) assert.throws(() => parseReviewInput(bad, ""), ReviewError);
  assert.throws(() => parseReviewInput(4, "x".repeat(1001)), ReviewError);
});

test("public reviewer names are masked", () => {
  assert.equal(maskReviewerName("Батболд Ганбаатар"), "Батболд Г.");
  assert.equal(maskReviewerName("Сараа"), "Сараа");
  assert.equal(maskReviewerName("  "), "Үйлчлүүлэгч");
});
