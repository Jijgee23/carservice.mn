import assert from "node:assert/strict";
import { test } from "node:test";

process.env.DATABASE_URL ??= "postgresql://unused/unused";
process.env.SESSION_SECRET ??= "unit-test-placeholder-secret-value-not-real-00";

// Prod 2026-10-15: IN_PROGRESS orders started in June with no finish estimate blocked every online-booking slot of a
// capacity-1 branch — an unknown end used to mean «occupied through the end of whatever day is being asked about».
// It now means «at most UNKNOWN_END_OCCUPANCY_DAYS after the start».

const DAY = 86_400_000;
const dayStart = new Date("2026-10-16T00:00:00+08:00");
const dayEnd = new Date(dayStart.getTime() + DAY);

const inProgress = (id: string, startedAt: Date, over: object = {}) => ({
  id,
  status: "IN_PROGRESS",
  scheduledAt: null,
  startedAt,
  estimatedDurationMinutes: null,
  expectedFinishAt: null,
  occupiesCapacity: null,
  ...over,
});

const client = (orders: object[]) =>
  ({
    appointment: { findMany: async () => [] },
    serviceOrder: { findMany: async () => orders },
    orderTimeBooking: { findMany: async () => [] },
  }) as never;

test("an in-progress order with no estimate stops occupying capacity UNKNOWN_END_OCCUPANCY_DAYS after it started", async () => {
  const { resolveTakenCapacityIntervals, UNKNOWN_END_OCCUPANCY_DAYS } = await import("../lib/category-duration");
  assert.equal(UNKNOWN_END_OCCUPANCY_DAYS, 7);
  const june = inProgress("june", new Date("2026-06-04T16:26:00+08:00"));
  const twoDaysAgo = inProgress("recent", new Date(dayStart.getTime() - 2 * DAY + 10 * 3_600_000));
  const iv = await resolveTakenCapacityIntervals(client([june, twoDaysAgo]), "branch", dayStart, dayEnd, 30);
  // The June job no longer reaches this day; the two-day-old one still holds the whole day.
  assert.deepEqual(iv, [{ startMs: twoDaysAgo.startedAt.getTime(), endMs: dayEnd.getTime() }]);
});

test("the cut-off lands mid-day: occupied until exactly start + 7 days", async () => {
  const { resolveTakenCapacityIntervals } = await import("../lib/category-duration");
  const started = new Date(dayStart.getTime() - 7 * DAY + 12 * 3_600_000); // 7 days ago at noon
  const iv = await resolveTakenCapacityIntervals(client([inProgress("o", started)]), "branch", dayStart, dayEnd, 30);
  assert.deepEqual(iv, [{ startMs: started.getTime(), endMs: started.getTime() + 7 * DAY }]);
});

test("known estimates and explicit releases are unchanged", async () => {
  const { resolveTakenCapacityIntervals } = await import("../lib/category-duration");
  const today10 = new Date("2026-10-16T10:00:00+08:00");
  const estimated = inProgress("est", today10, { expectedFinishAt: new Date("2026-10-16T11:00:00+08:00"), estimatedDurationMinutes: 60, occupiesCapacity: true });
  const released = inProgress("rel", today10, { occupiesCapacity: false });
  const iv = await resolveTakenCapacityIntervals(client([estimated, released]), "branch", dayStart, dayEnd, 30);
  assert.deepEqual(iv, [{ startMs: today10.getTime(), endMs: new Date("2026-10-16T11:00:00+08:00").getTime() }]);
});
