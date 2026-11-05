import assert from "node:assert/strict";
import test from "node:test";
import { isSelfServePlan, resolveActiveSubscription } from "../lib/subscription";

const now = new Date("2026-11-05T00:00:00Z");
const day = 24 * 60 * 60 * 1000;

test("FREE subscription rows (legacy 14-day trial) never count as the active paid plan", () => {
  const info = resolveActiveSubscription(
    [{ id: "s1", plan: "FREE", status: "TRIAL", startsAt: new Date(now.getTime() - day), endsAt: new Date(now.getTime() + 5 * day) }],
    now,
  );
  assert.equal(info, null);
});

test("an active BUSINESS subscription is resolved even when a FREE row is newer", () => {
  const info = resolveActiveSubscription(
    [
      { id: "biz", plan: "BUSINESS", status: "ACTIVE", startsAt: new Date(now.getTime() - 10 * day), endsAt: new Date(now.getTime() + 20 * day) },
      { id: "free", plan: "FREE", status: "TRIAL", startsAt: new Date(now.getTime() - day), endsAt: new Date(now.getTime() + 13 * day) },
    ],
    now,
  );
  assert.equal(info?.subscription.id, "biz");
});

test("only BUSINESS is self-serve: FREE is free, ENTERPRISE is negotiated", () => {
  assert.equal(isSelfServePlan("BUSINESS"), true);
  assert.equal(isSelfServePlan("FREE"), false);
  assert.equal(isSelfServePlan("ENTERPRISE"), false);
});
