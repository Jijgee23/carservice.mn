import assert from "node:assert/strict";
import test from "node:test";
import { evaluateTrialEligibility, isValidTrialDays } from "../lib/plan-trials";
import { TRIAL_DAYS, trialEndDate } from "../lib/subscription";

const on = { enabled: true, days: 30 };

test("default trial is 30 days and trialEndDate honours a custom length", () => {
  assert.equal(TRIAL_DAYS, 30);
  const start = new Date("2026-11-20T00:00:00Z");
  assert.equal(trialEndDate(start).toISOString(), "2026-12-20T00:00:00.000Z");
  assert.equal(trialEndDate(start, 7).toISOString(), "2026-11-27T00:00:00.000Z");
});

test("each paid plan can be trialled once, independently", () => {
  const base = { setting: on, hasActivePaid: false } as const;
  assert.deepEqual(evaluateTrialEligibility({ ...base, plan: "BUSINESS", usedTrialPlans: [] }), { ok: true });
  assert.deepEqual(evaluateTrialEligibility({ ...base, plan: "BUSINESS", usedTrialPlans: ["BUSINESS"] }), {
    ok: false,
    reason: "already_used",
  });
  // BUSINESS-ээ туршсан ч ENTERPRISE нээлттэй.
  assert.deepEqual(evaluateTrialEligibility({ ...base, plan: "ENTERPRISE", usedTrialPlans: ["BUSINESS"] }), { ok: true });
});

test("FREE is not trialable; disabled plan is refused unless admin forces", () => {
  assert.deepEqual(evaluateTrialEligibility({ plan: "FREE", setting: on, usedTrialPlans: [], hasActivePaid: false }), {
    ok: false,
    reason: "not_trialable",
  });
  const off = { enabled: false, days: 30 };
  assert.deepEqual(evaluateTrialEligibility({ plan: "BUSINESS", setting: off, usedTrialPlans: [], hasActivePaid: false }), {
    ok: false,
    reason: "disabled",
  });
  assert.deepEqual(
    evaluateTrialEligibility({ plan: "BUSINESS", setting: off, usedTrialPlans: ["BUSINESS"], hasActivePaid: false, force: true }),
    { ok: true },
  );
});

test("an active paid plan is never overridden by a trial, even when forced", () => {
  assert.deepEqual(
    evaluateTrialEligibility({ plan: "ENTERPRISE", setting: on, usedTrialPlans: [], hasActivePaid: true, force: true }),
    { ok: false, reason: "has_paid_plan" },
  );
});

test("trial days are validated to 1..365 integers", () => {
  assert.equal(isValidTrialDays(30), true);
  assert.equal(isValidTrialDays(0), false);
  assert.equal(isValidTrialDays(366), false);
  assert.equal(isValidTrialDays(1.5), false);
});
