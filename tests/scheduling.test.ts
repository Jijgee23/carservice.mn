import assert from "node:assert/strict";
import test from "node:test";
import { peakOccupancy } from "../lib/schedule-capacity";
import { buildDaySlots } from "../lib/appointment-slots";
import { buildBranchSchedule, type ScheduleOrder, type ScheduleAppointment } from "../lib/branch-schedule";
import { isSlotAvailable, resolveTakenAppointmentIntervals } from "../lib/category-duration";
import type { PrismaTransactionClient } from "../lib/prisma";
import { resolveEffectiveSchedule } from "../lib/branch-effective-schedule";
import { bookingDayBounds } from "../lib/booking-time";
import { splitScheduleInterval } from "../lib/schedule-intervals";
import { calculateServiceItemDurationMinutes } from "../lib/service-duration";
import {
  resolveOrderEffectiveInterval,
  resolveOrderIntervals,
  resolveHistoricalOrderSessions,
  type OrderTimeBookingLike,
  type OrderStatusChangeLike,
} from "../lib/schedule-order-interval";
import * as fs from "node:fs";
import * as path from "node:path";

// lib/order-time-booking.ts imports lib/prisma.ts, which throws at import
// time if DATABASE_URL isn't set (and, once set, opens a real pg Pool —
// though every warm-up query is `.catch`-swallowed, so a bogus/unreachable
// URL never actually touches a real database). This test file must not
// depend on a real DATABASE_URL being configured, so fall back to a
// deliberately unreachable one BEFORE importing the module. Top-level await
// isn't available under this test runner's (cjs) transform, so the import
// is deferred to a `before` hook instead of a static top-level import.
let runLockedOrderWork: (typeof import("../lib/order-time-booking"))["runLockedOrderWork"];
test.before(async () => {
  process.env.DATABASE_URL ??= "postgresql://invalid:invalid@127.0.0.1:1/invalid";
  ({ runLockedOrderWork } = await import("../lib/order-time-booking"));
});

const at = (time: string) => new Date(`2030-01-07T${time}:00+08:00`);
const scope = { tenantId: "tenant", branchId: "branch" };
const appointment = (over: Partial<ScheduleAppointment> = {}): ScheduleAppointment => ({
  ...scope, id: "appointment", status: "CONFIRMED", requestedAt: at("10:00"),
  estimatedDurationMinutes: 60, serviceOrderId: null, ...over,
});
const order = (over: Partial<ScheduleOrder> = {}): ScheduleOrder => ({
  ...scope, id: "order", status: "IN_PROGRESS", scheduledAt: at("10:00"),
  startedAt: at("10:00"), estimatedDurationMinutes: 60,
  expectedFinishAt: at("11:00"), occupiesCapacity: true, ...over,
});
const project = (
  orders: ScheduleOrder[],
  appointments: ScheduleAppointment[] = [],
  fallbackDurationMinutes?: number,
) =>
  buildBranchSchedule({
    ...scope,
    orders,
    appointments,
    now: at("10:30"),
    rangeStart: at("09:00"),
    rangeEnd: at("18:00"),
    fallbackDurationMinutes,
  });

const scheduleBranch = {
  openTime: "09:00", closeTime: "18:00",
  schedules: [
    { weekday: "MON" as const, isOpen: true, openTime: "10:00", closeTime: "17:00" },
    { weekday: "TUE" as const, isOpen: false, openTime: null, closeTime: null },
  ],
};

test("effective schedule applies exception, season, weekday, then default precedence", () => {
  const season = { name: "Summer", startsOn: "2030-01-01", endsOn: "2030-02-01", isActive: true,
    days: [{ weekday: "MON" as const, isOpen: true, openTime: "11:00", closeTime: "16:00" }] };
  const exception = { date: "2030-01-07", isOpen: true, openTime: "12:00", closeTime: "15:00", label: "Holiday opening" };
  assert.deepEqual(resolveEffectiveSchedule({ dateStr: "2030-01-07", branch: { ...scheduleBranch, scheduleSeasons: [season], scheduleExceptions: [exception] } }), {
    date: "2030-01-07", weekday: "MON", open: true, openTime: "12:00", closeTime: "15:00", source: "exception", label: "Holiday opening",
  });
  assert.equal(resolveEffectiveSchedule({ dateStr: "2030-01-14", branch: { ...scheduleBranch, scheduleSeasons: [season] } }).openTime, "11:00");
  assert.equal(resolveEffectiveSchedule({ dateStr: "2030-02-04", branch: scheduleBranch }).openTime, "10:00");
  assert.equal(resolveEffectiveSchedule({ dateStr: "2030-01-08", branch: scheduleBranch }).open, false);
});

test("consecutive jobs consume one place across a longer candidate", () => {
  assert.equal(peakOccupancy([{ startMs: 0, endMs: 30 }, { startMs: 30, endMs: 60 }], 0, 60), 1);
});
test("simultaneous jobs consume two places", () => {
  assert.equal(peakOccupancy([{ startMs: 0, endMs: 40 }, { startMs: 30, endMs: 60 }], 0, 60), 2);
});
test("jobs ending at candidate start or starting at its end don't overlap", () => {
  assert.equal(peakOccupancy([{ startMs: 0, endMs: 30 }, { startMs: 60, endMs: 90 }], 30, 60), 0);
});
test("peak occupancy is clipped to the candidate", () => {
  assert.equal(peakOccupancy([{ startMs: 0, endMs: 100 }, { startMs: 0, endMs: 10 }], 20, 30), 1);
});
test("invalid input cannot silently produce free capacity", () => {
  assert.throws(() => peakOccupancy([], 10, 10), RangeError);
  assert.throws(() => peakOccupancy([{ startMs: NaN, endMs: 30 }], 0, 60), RangeError);
});
test("slot picker leaves a second place available alongside consecutive jobs", () => {
  const local = (h: number, m = 0) => at(`${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`);
  const result = buildDaySlots({ dateStr: "2030-01-07", open: true,
    openTime: "10:00", closeTime: "12:00", slotMinutes: 30, capacity: 2,
    appointmentMinutes: 60, now: local(9), taken: [
      { start: local(10), durationMinutes: 30 }, { start: local(10, 30), durationMinutes: 30 },
    ] });
  assert.equal(result.slots[0].remaining, 1);
  assert.equal(result.slots[0].available, true);
  assert.equal(result.slots.at(-1)?.time, "11:00");
});

// Only the query methods used by these helpers are stubbed. No Prisma runtime
// or database connection is imported by this suite.
const client = (rows: object[] = [], orderRows: object[] = [], capacity = 2) => ({
  branch: { findUnique: async () => ({ slotMinutes: 30, slotCapacity: capacity }) },
  appointment: { findMany: async () => rows },
  serviceOrder: { findMany: async () => orderRows },
  category: { findMany: async () => [{ id: "category", durationMinutes: 120 }] },
}) as unknown as PrismaTransactionClient;
test("submission capacity agrees with slot picker for consecutive appointments", async () => {
  const rows = [10, 10.5].map((hour) => ({ requestedAt: new Date(2030, 0, 7, Math.floor(hour), hour % 1 * 60), categoryId: null, categories: [] }));
  assert.equal(await isSlotAvailable(client(rows), "branch", new Date(2030, 0, 7, 10), 60), true);
});
test("active orders share appointment capacity", async () => {
  const activeOrder = {
    id: "order-1", status: "IN_PROGRESS", scheduledAt: null,
    startedAt: new Date(2030, 0, 7, 10), estimatedDurationMinutes: 60,
    expectedFinishAt: new Date(2030, 0, 7, 11), occupiesCapacity: true,
  };
  const secondOrder = { ...activeOrder, id: "order-2" };
  assert.equal(
    await isSlotAvailable(client([], [activeOrder, secondOrder]), "branch", new Date(2030, 0, 7, 10), 60),
    false,
  );
});
// D-076: a client variant that also serves OrderTimeBooking rows, so a
// follow-up (kind: SCHEDULED, still open) can be exercised end-to-end
// through isSlotAvailable -> resolveTakenCapacityIntervals.
const clientWithBookings = (orderRows: object[], bookingRows: object[], capacity = 2) => ({
  branch: { findUnique: async () => ({ slotMinutes: 30, slotCapacity: capacity }) },
  appointment: { findMany: async () => [] },
  serviceOrder: { findMany: async () => orderRows },
  orderTimeBooking: { findMany: async (args: { where: unknown }) => {
    // Distinguish the two call shapes by presence of `orderId` in `where`.
    const where = args.where as { orderId?: { in: string[] }; branchId?: string };
    if (where.orderId) return bookingRows.filter((r) => where.orderId!.in.includes((r as { orderId: string }).orderId));
    return bookingRows; // followUpOrderIds lookup — test data has no extra out-of-scope orders
  } },
  category: { findMany: async () => [{ id: "category", durationMinutes: 120 }] },
}) as unknown as PrismaTransactionClient;
test("D-076: a live customer cannot double-book a slot an IN_PROGRESS order's follow-up already claims", async () => {
  const activeOrder = {
    id: "order-1", status: "IN_PROGRESS", scheduledAt: null,
    startedAt: at("09:00"), estimatedDurationMinutes: 60,
    expectedFinishAt: at("10:00"), occupiesCapacity: true,
  };
  const bookings = [
    { orderId: "order-1", kind: "ACTIVE", startAt: at("09:00"), endAt: at("10:00"), closedAt: null },
    { orderId: "order-1", kind: "SCHEDULED", startAt: at("15:00"), endAt: at("16:00"), closedAt: null },
  ];
  // The follow-up's own window (15:00-16:00) must now be unavailable.
  assert.equal(
    await isSlotAvailable(clientWithBookings([activeOrder], bookings, 1), "branch", at("15:00"), 60),
    false,
  );
  // A window that overlaps neither the current work nor the follow-up stays free.
  assert.equal(
    await isSlotAvailable(clientWithBookings([activeOrder], bookings, 1), "branch", at("12:00"), 60),
    true,
  );
});
test("saved estimate takes precedence over a subsequently changed category", async () => {
  const [interval] = await resolveTakenAppointmentIntervals(client(), [{
    requestedAt: at("10:00"), estimatedDurationMinutes: 45, categoryId: "category", categories: [],
  }], 30);
  assert.equal(interval.durationMinutes, 45);
});
test("legacy duration fallback remains compatible until migration wiring", async () => {
  const [interval] = await resolveTakenAppointmentIntervals(client(), [{
    requestedAt: at("10:00"), categoryId: "category", categories: [],
  }], 30);
  assert.equal(interval.durationMinutes, 120);
});
test("linked appointment and order count once", () => {
  const result = project([order()], [appointment({ serviceOrderId: "order" })]);
  assert.equal(result.intervals.length, 1);
  assert.equal(result.intervals[0].source, "order");
});
test("walk-in without appointment consumes capacity", () => {
  assert.equal(project([order()]).intervals.length, 1);
});
test("completed and explicitly released work clears its linked appointment quietly", () => {
  // A COMPLETED order is the normal, successful outcome — not an issue.
  // Appointment status has no terminal "done" state of its own, so the
  // ordinary same-day book -> convert -> finish path must not flag every
  // completed job as a "linked order not occupying" issue.
  const result = project([order({ status: "COMPLETED", occupiesCapacity: false })],
    [appointment({ serviceOrderId: "order" })]);
  assert.equal(result.intervals.length, 0);
  assert.ok(!result.issues.some((issue) => issue.reason === "linked-order-not-occupying"));
});
// D-110 supersedes the former "cancelled linked order still flags its
// appointment for attention" expectation (D-067). A terminal linked order —
// COMPLETED or CANCELLED — settles the booking, so it leaves the day view
// entirely rather than reappearing with a warning nobody could act on.
test("D-110: a booking whose linked order was cancelled leaves the day view entirely", () => {
  const result = project([order({ status: "CANCELLED", occupiesCapacity: false })],
    [appointment({ serviceOrderId: "order" })]);
  assert.equal(result.intervals.length, 0, "expected no interval for the booking or the cancelled order");
  assert.equal(result.issues.length, 0, "expected no attention issue — the state is settled, not broken");
});
test("D-110: the same holds for a completed linked order", () => {
  const result = project([order({ status: "COMPLETED", occupiesCapacity: false })],
    [appointment({ serviceOrderId: "order" })]);
  assert.equal(result.intervals.length, 0);
  assert.equal(result.issues.length, 0);
});
test("D-110: a MISSING linked order is still a broken reference and still flagged", () => {
  const result = project([], [appointment({ serviceOrderId: "order" })]);
  assert.ok(result.issues.some((issue) => issue.reason === "missing-order"));
});
test("completed car still in workspace continues to consume capacity", () => {
  assert.equal(project([order({ status: "COMPLETED" })]).intervals.length, 1);
});
test("work past its saved finish boundary is never flagged as late", () => {
  const result = project([order({ expectedFinishAt: at("10:15") })]);
  assert.equal(result.intervals[0].endMs, at("10:15").getTime());
  assert.equal(result.intervals[0].uncertain, false);
  assert.equal(result.issues.length, 0);
});
test("unknown active occupancy is not treated as free", () => {
  const result = project([order({ occupiesCapacity: null })]);
  assert.equal(result.intervals[0].endMs, at("18:00").getTime());
  assert.ok(result.issues.some((issue) => issue.reason === "unknown-occupancy"));
});
test("scheduled order reserves future time even before physical occupancy", () => {
  const result = project([order({ status: "SCHEDULED", occupiesCapacity: false, startedAt: null, expectedFinishAt: null })]);
  assert.equal(result.intervals[0].endMs, at("11:00").getTime());
  assert.equal(result.intervals[0].uncertain, false);
});
test("scheduled order without an estimate uses a bounded slot fallback but stays flagged", () => {
  const result = project(
    [order({
      status: "SCHEDULED",
      occupiesCapacity: false,
      scheduledAt: at("11:00"),
      startedAt: null,
      estimatedDurationMinutes: null,
      expectedFinishAt: null,
    })],
    [],
    45,
  );
  assert.equal(result.intervals[0].endMs, at("11:45").getTime());
  assert.equal(result.intervals[0].uncertain, true);
  assert.ok(result.issues.some((issue) => issue.reason === "missing-estimate"));
});
test("resolveOrderEffectiveInterval prefers OrderTimeBooking rows over scalars when given any", () => {
  const scalarOnly = order({ status: "IN_PROGRESS", startedAt: at("10:00"), expectedFinishAt: at("11:00") });
  const booking: OrderTimeBookingLike = { kind: "ACTIVE", startAt: at("12:00"), endAt: at("13:00"), closedAt: null };
  const resolved = resolveOrderEffectiveInterval(scalarOnly, [booking]);
  assert.equal(resolved.scheduled, false);
  assert.equal(resolved.start?.getTime(), at("12:00").getTime());
  assert.equal(resolved.end?.getTime(), at("13:00").getTime());
});
test("resolveOrderEffectiveInterval with bookings picks the most recent row (closed ones stay part of history)", () => {
  const scalarOnly = order({ status: "COMPLETED" });
  const closed: OrderTimeBookingLike = { kind: "ACTIVE", startAt: at("09:00"), endAt: at("10:00"), closedAt: at("10:00") };
  const latest: OrderTimeBookingLike = { kind: "ACTIVE", startAt: at("14:00"), endAt: at("15:00"), closedAt: at("15:00") };
  const resolved = resolveOrderEffectiveInterval(scalarOnly, [closed, latest]);
  assert.equal(resolved.start?.getTime(), at("14:00").getTime());
  assert.equal(resolved.end?.getTime(), at("15:00").getTime());
});
test("resolveOrderEffectiveInterval with an empty bookings array falls back to scalars unchanged", () => {
  const scalarOnly = order({ status: "IN_PROGRESS", startedAt: at("10:00"), expectedFinishAt: at("11:00") });
  const resolved = resolveOrderEffectiveInterval(scalarOnly, []);
  assert.equal(resolved.start?.getTime(), at("10:00").getTime());
  assert.equal(resolved.end?.getTime(), at("11:00").getTime());
});
test("resolveOrderEffectiveInterval with bookings still flags a corrupt end <= start as invalid", () => {
  const scalarOnly = order({ status: "IN_PROGRESS" });
  const bad: OrderTimeBookingLike = { kind: "ACTIVE", startAt: at("12:00"), endAt: at("11:00"), closedAt: null };
  const resolved = resolveOrderEffectiveInterval(scalarOnly, [bad]);
  assert.equal(resolved.invalid, true);
  assert.equal(resolved.end, null);
});
test("resolveOrderIntervals: a single open ACTIVE booking is current, no upcoming", () => {
  const scalarOnly = order({ status: "IN_PROGRESS" });
  const active: OrderTimeBookingLike = { kind: "ACTIVE", startAt: at("10:00"), endAt: at("11:00"), closedAt: null };
  const { current, upcoming } = resolveOrderIntervals(scalarOnly, [active]);
  assert.equal(current.start?.getTime(), at("10:00").getTime());
  assert.equal(current.scheduled, false);
  assert.equal(upcoming.length, 0);
});
test("resolveOrderIntervals: a single open SCHEDULED booking is current, no upcoming (D-068 return-time case)", () => {
  const scalarOnly = order({ status: "IN_PROGRESS", occupiesCapacity: false });
  const scheduled: OrderTimeBookingLike = { kind: "SCHEDULED", startAt: at("14:00"), endAt: at("15:00"), closedAt: null };
  const { current, upcoming } = resolveOrderIntervals(scalarOnly, [scheduled]);
  assert.equal(current.start?.getTime(), at("14:00").getTime());
  assert.equal(current.scheduled, true);
  assert.equal(upcoming.length, 0);
});
test("resolveOrderIntervals: an open ACTIVE plus an open SCHEDULED follow-up — ACTIVE is current, SCHEDULED is upcoming", () => {
  const scalarOnly = order({ status: "IN_PROGRESS" });
  const active: OrderTimeBookingLike = { kind: "ACTIVE", startAt: at("09:00"), endAt: at("11:00"), closedAt: null };
  const followUp: OrderTimeBookingLike = { kind: "SCHEDULED", startAt: at("15:00"), endAt: at("16:00"), closedAt: null };
  const { current, upcoming } = resolveOrderIntervals(scalarOnly, [active, followUp]);
  assert.equal(current.start?.getTime(), at("09:00").getTime());
  assert.equal(current.scheduled, false);
  assert.equal(upcoming.length, 1);
  assert.equal(upcoming[0].start?.getTime(), at("15:00").getTime());
  assert.equal(upcoming[0].scheduled, true);
});
test("resolveOrderIntervals: a terminal order's only (closed) booking is still current, matching resolveOrderEffectiveInterval", () => {
  const scalarOnly = order({ status: "COMPLETED", occupiesCapacity: false });
  const closed: OrderTimeBookingLike = { kind: "ACTIVE", startAt: at("09:00"), endAt: at("10:00"), closedAt: at("10:00") };
  const { current, upcoming } = resolveOrderIntervals(scalarOnly, [closed]);
  assert.equal(current.start?.getTime(), at("09:00").getTime());
  assert.equal(current.end?.getTime(), at("10:00").getTime());
  assert.equal(upcoming.length, 0);
  // Must match resolveOrderEffectiveInterval exactly (thin-wrapper guarantee).
  const viaWrapper = resolveOrderEffectiveInterval(scalarOnly, [closed]);
  assert.deepEqual(current, viaWrapper);
});
test("resolveOrderIntervals: closed history wins current over an open future follow-up", () => {
  // A closed ACTIVE (a past work session) plus an open SCHEDULED (a future
  // follow-up). "current" must resolve to the real past session, not the
  // not-yet-happened follow-up — an open row's startAt being later must
  // never let it outrank actual closed history. The follow-up booking
  // correctly surfaces as `upcoming` instead.
  const scalarOnly = order({ status: "IN_PROGRESS", occupiesCapacity: false });
  const closedActive: OrderTimeBookingLike = { kind: "ACTIVE", startAt: at("08:00"), endAt: at("09:00"), closedAt: at("09:00") };
  const openScheduled: OrderTimeBookingLike = { kind: "SCHEDULED", startAt: at("14:00"), endAt: at("15:00"), closedAt: null };
  const { current, upcoming } = resolveOrderIntervals(scalarOnly, [closedActive, openScheduled]);
  assert.equal(current.start?.getTime(), at("08:00").getTime());
  assert.equal(upcoming.length, 1);
  assert.equal(upcoming[0].start?.getTime(), at("14:00").getTime());
});
// --- S11 fix: resolveHistoricalOrderSessions / loadBranchScheduleHistory ---
// (WEB_SCHEDULING_ASSESSMENT_2026-09-10.md) — the calendar had no way to
// reconstruct what actually happened on a past day: resolveOrderIntervals
// collapses every order down to one "current" row and discards closed
// history once a later booking exists, and fetchOrderRows gates on the
// order's CURRENT status so a COMPLETED/CANCELLED order with only closed
// booking rows is never fetched for a past day at all.
test("S11: a Monday-worked, Tuesday-released, Wednesday-resumed order still shows Monday's real session when querying Monday's history", () => {
  const mondayWork: OrderTimeBookingLike = {
    kind: "ACTIVE",
    startAt: new Date("2030-01-07T09:00:00+08:00"), // Monday
    endAt: new Date("2030-01-07T12:00:00+08:00"),
    closedAt: new Date("2030-01-07T12:00:00+08:00"),
  };
  const wednesdayResume: OrderTimeBookingLike = {
    kind: "ACTIVE",
    startAt: new Date("2030-01-09T09:00:00+08:00"), // Wednesday
    endAt: null,
    closedAt: null,
  };
  const mondayStart = new Date("2030-01-07T00:00:00+08:00");
  const mondayEnd = new Date("2030-01-08T00:00:00+08:00");
  const sessions = resolveHistoricalOrderSessions(
    [mondayWork, wednesdayResume],
    mondayStart,
    mondayEnd,
    new Date("2030-01-09T10:00:00+08:00"),
  );
  // Only Monday's real session intersects Monday's range — the still-open
  // Wednesday resume must not swallow it, nor leak into Monday's results.
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].start.getTime(), mondayWork.startAt.getTime());
  assert.equal(sessions[0].end.getTime(), mondayWork.endAt!.getTime());
  assert.equal(sessions[0].wasWorked, true);
});
test("S11: a SCHEDULED booking closed without ever going ACTIVE is classified as not performed work", () => {
  // A reservation/return-time slot that was postponed/cancelled away before
  // any work happened — resolveOrderIntervals would treat this the same as
  // performed work if it were the only closed row; history must not.
  const cancelledReservation: OrderTimeBookingLike = {
    kind: "SCHEDULED",
    startAt: at("14:00"),
    endAt: at("14:00"), // closed immediately, never worked
    closedAt: at("14:00"),
  };
  const sessions = resolveHistoricalOrderSessions(
    [cancelledReservation],
    at("00:00"),
    new Date("2030-01-08T00:00:00+08:00"),
  );
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].wasWorked, false);
});
test("S12 follow-up: orderStatusChange history proves wasWorked true even when the booking kind alone would be ambiguous", () => {
  // A SCHEDULED-kind row that was actually worked under it (e.g. the booking
  // row itself was never flipped to ACTIVE for some legacy/edge reason) —
  // the naive kind proxy alone would say wasWorked: false here. The
  // OrderStatusChange timeline is ground truth and must override it.
  const ambiguousBooking: OrderTimeBookingLike = {
    kind: "SCHEDULED",
    startAt: at("08:00"),
    endAt: at("10:00"),
    closedAt: at("10:00"),
  };
  const statusChanges: OrderStatusChangeLike[] = [
    { fromStatus: "SCHEDULED", toStatus: "IN_PROGRESS", createdAt: at("08:30") },
    { fromStatus: "IN_PROGRESS", toStatus: "COMPLETED", createdAt: at("10:00") },
  ];
  const sessions = resolveHistoricalOrderSessions(
    [ambiguousBooking],
    at("00:00"),
    new Date("2030-01-08T00:00:00+08:00"),
    undefined,
    statusChanges,
  );
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].wasWorked, true);
});
test("S12 follow-up: orderStatusChange history proves wasWorked false, overriding a naive ACTIVE-kind guess", () => {
  // An ACTIVE-kind row that was never actually started (only SCHEDULED ->
  // CANCELLED ever happened) — the naive kind proxy would say wasWorked:
  // true. The timeline shows no IN_PROGRESS transition in the window at
  // all, so it must override to false.
  const bookingLooksActive: OrderTimeBookingLike = {
    kind: "ACTIVE",
    startAt: at("08:00"),
    endAt: at("08:00"),
    closedAt: at("08:00"),
  };
  const statusChanges: OrderStatusChangeLike[] = [
    { fromStatus: "SCHEDULED", toStatus: "CANCELLED", createdAt: at("08:00") },
  ];
  const sessions = resolveHistoricalOrderSessions(
    [bookingLooksActive],
    at("00:00"),
    new Date("2030-01-08T00:00:00+08:00"),
    undefined,
    statusChanges,
  );
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].wasWorked, false);
});
test("S12 follow-up: empty/absent orderStatusChange history falls back to the kind === ACTIVE proxy", () => {
  // Pre-S12 orders (or any order with no recorded transitions) must not
  // regress — passing no statusChanges (or an empty array) must behave
  // identically to the original S11 kind-only classification.
  const activeBooking: OrderTimeBookingLike = {
    kind: "ACTIVE",
    startAt: at("08:00"),
    endAt: at("09:00"),
    closedAt: at("09:00"),
  };
  const sessionsNoArg = resolveHistoricalOrderSessions(
    [activeBooking],
    at("00:00"),
    new Date("2030-01-08T00:00:00+08:00"),
  );
  const sessionsEmptyArray = resolveHistoricalOrderSessions(
    [activeBooking],
    at("00:00"),
    new Date("2030-01-08T00:00:00+08:00"),
    undefined,
    [],
  );
  assert.equal(sessionsNoArg.length, 1);
  assert.equal(sessionsNoArg[0].wasWorked, true);
  assert.equal(sessionsEmptyArray[0].wasWorked, true);
});
test("S11: resolveHistoricalOrderSessions ignores rows that don't intersect the requested range", () => {
  const unrelated: OrderTimeBookingLike = {
    kind: "ACTIVE",
    startAt: new Date("2030-01-09T09:00:00+08:00"),
    endAt: new Date("2030-01-09T10:00:00+08:00"),
    closedAt: new Date("2030-01-09T10:00:00+08:00"),
  };
  const sessions = resolveHistoricalOrderSessions(
    [unrelated],
    new Date("2030-01-07T00:00:00+08:00"),
    new Date("2030-01-08T00:00:00+08:00"),
  );
  assert.equal(sessions.length, 0);
});
test("S11: loadBranchScheduleHistory queries OrderTimeBooking directly (not gated by ServiceOrder's current status) — fixes the terminal-order omission", () => {
  // loadBranchSchedule's fetchOrderRows only fetches SCHEDULED/IN_PROGRESS
  // orders (plus specific linked/follow-up carve-outs) — a
  // COMPLETED or CANCELLED order with no live appointment and no open
  // booking is invisible to it. loadBranchScheduleHistory must instead query
  // OrderTimeBooking by its own startAt/endAt overlap and join back to
  // ServiceOrder unconditionally on status, so a terminal order's real past
  // session still appears. Verified by inspecting the source directly (same
  // approach as the S06/S10 tests above), since the loader talks to the
  // shared `@/lib/prisma` singleton rather than accepting an injectable
  // client the way buildBranchSchedule does.
  const src = fs.readFileSync(
    path.join(__dirname, "..", "lib", "branch-schedule-loader.ts"),
    "utf8",
  );
  const fnStart = src.indexOf("export async function loadBranchScheduleHistory");
  assert.ok(fnStart >= 0, "loadBranchScheduleHistory not found");
  const body = src.slice(fnStart);
  assert.ok(
    body.includes("prisma.orderTimeBooking.findMany("),
    "expected loadBranchScheduleHistory to query OrderTimeBooking directly",
  );
  // Must not filter on ServiceOrder.status at all in this function — the
  // whole point is to be independent of the order's current status.
  assert.ok(
    !/status:\s*{\s*in:\s*\[\s*"SCHEDULED"/.test(body),
    "loadBranchScheduleHistory must not gate on ServiceOrder's current status like fetchOrderRows does",
  );
  assert.ok(
    body.includes("resolveHistoricalOrderSessions("),
    "expected loadBranchScheduleHistory to reuse Phase 1's classifier",
  );
});

test("buildBranchSchedule resolves an order's interval from orderBookings when supplied", () => {
  // Scalars alone would place this order at 10:00-11:00 (the order() default);
  // a passed-in booking row should override that with the real 12:00-13:00.
  const bookings = new Map([
    ["order", [{ kind: "ACTIVE" as const, startAt: at("12:00"), endAt: at("13:00"), closedAt: null }]],
  ]);
  const result = buildBranchSchedule({
    ...scope,
    orders: [order()],
    appointments: [],
    now: at("10:30"),
    rangeStart: at("09:00"),
    rangeEnd: at("18:00"),
    orderBookings: bookings,
  });
  assert.equal(result.intervals[0].startMs, at("12:00").getTime());
  assert.equal(result.intervals[0].endMs, at("13:00").getTime());
});
test("buildBranchSchedule falls back to scalars when orderBookings has no entry for an order", () => {
  const result = buildBranchSchedule({
    ...scope,
    orders: [order()],
    appointments: [],
    now: at("10:30"),
    rangeStart: at("09:00"),
    rangeEnd: at("18:00"),
    orderBookings: new Map(),
  });
  assert.equal(result.intervals[0].startMs, at("10:00").getTime());
  assert.equal(result.intervals[0].endMs, at("11:00").getTime());
});
test("D-076: an IN_PROGRESS order with an open follow-up projects two intervals — primary now, upcoming later", () => {
  const bookings = new Map([
    ["order", [
      { kind: "ACTIVE" as const, startAt: at("10:00"), endAt: at("11:00"), closedAt: null },
      { kind: "SCHEDULED" as const, startAt: at("15:00"), endAt: at("16:00"), closedAt: null },
    ]],
  ]);
  const result = buildBranchSchedule({
    ...scope,
    orders: [order({ status: "IN_PROGRESS" })],
    appointments: [],
    now: at("10:30"),
    rangeStart: at("09:00"),
    rangeEnd: at("18:00"),
    orderBookings: bookings,
  });
  assert.equal(result.intervals.length, 2);
  const primary = result.intervals.find((i) => i.role === "primary");
  const upcoming = result.intervals.find((i) => i.role === "upcoming");
  assert.equal(primary?.startMs, at("10:00").getTime());
  assert.equal(primary?.endMs, at("11:00").getTime());
  assert.equal(upcoming?.startMs, at("15:00").getTime());
  assert.equal(upcoming?.endMs, at("16:00").getTime());
  assert.equal(upcoming?.uncertain, false);
});
test("D-076: a COMPLETED order's follow-up still projects even though the order itself no longer counts for capacity", () => {
  // occupiesCapacity:false + COMPLETED means orderCanCountForCapacity is
  // false for the order's own current interval — but a still-open follow-up
  // booking (survived completion, per closeOpenOrderTimeBooking's "ACTIVE"-
  // only scoping) must still appear on the calendar and count for conflicts.
  // A real COMPLETED order always has closed history too (it was ACTIVE
  // before it finished) — included here so "current" resolves to that real
  // finish, not the later-but-not-yet-happened follow-up.
  const bookings = new Map([
    ["order", [
      { kind: "ACTIVE" as const, startAt: at("09:00"), endAt: at("10:00"), closedAt: at("10:00") },
      { kind: "SCHEDULED" as const, startAt: at("15:00"), endAt: at("16:00"), closedAt: null },
    ]],
  ]);
  const result = buildBranchSchedule({
    ...scope,
    orders: [order({ status: "COMPLETED", occupiesCapacity: false })],
    appointments: [],
    now: at("10:30"),
    rangeStart: at("09:00"),
    rangeEnd: at("18:00"),
    orderBookings: bookings,
  });
  assert.equal(result.intervals.length, 1);
  assert.equal(result.intervals[0].role, "upcoming");
  assert.equal(result.intervals[0].startMs, at("15:00").getTime());
  assert.equal(result.intervals[0].endMs, at("16:00").getTime());
});
test("D-076: retroactive fix — a released order's scheduled follow-up time now actually appears on the calendar", () => {
  // Before this fix, orderCanCountForCapacity's early `continue` (a
  // non-terminal status + occupiesCapacity:false) skipped the order
  // entirely, so a booked follow-up never rendered at all — the "book a
  // follow-up slot" mechanism (D-068 step 4) was visually broken since it
  // shipped earlier this session, until this same D-076 carve-out fixed it.
  const bookings = new Map([
    ["order", [
      { kind: "ACTIVE" as const, startAt: at("08:00"), endAt: at("09:00"), closedAt: at("09:00") },
      { kind: "SCHEDULED" as const, startAt: at("14:00"), endAt: at("15:00"), closedAt: null },
    ]],
  ]);
  const result = buildBranchSchedule({
    ...scope,
    orders: [order({ status: "IN_PROGRESS", occupiesCapacity: false })],
    appointments: [],
    now: at("10:30"),
    rangeStart: at("09:00"),
    rangeEnd: at("18:00"),
    orderBookings: bookings,
  });
  assert.equal(result.intervals.length, 1);
  assert.equal(result.intervals[0].role, "upcoming");
  assert.equal(result.intervals[0].startMs, at("14:00").getTime());
  assert.equal(result.intervals[0].endMs, at("15:00").getTime());
});
test("D-076: an upcoming follow-up with no known duration is bounded by the branch slot fallback and flagged missing-estimate", () => {
  const bookings = new Map([
    ["order", [
      { kind: "ACTIVE" as const, startAt: at("10:00"), endAt: at("11:00"), closedAt: null },
      { kind: "SCHEDULED" as const, startAt: at("15:00"), endAt: null, closedAt: null },
    ]],
  ]);
  const result = buildBranchSchedule({
    ...scope,
    orders: [order({ status: "IN_PROGRESS" })],
    appointments: [],
    now: at("10:30"),
    rangeStart: at("09:00"),
    rangeEnd: at("18:00"),
    orderBookings: bookings,
    fallbackDurationMinutes: 45,
  });
  const upcoming = result.intervals.find((i) => i.role === "upcoming");
  assert.equal(upcoming?.startMs, at("15:00").getTime());
  assert.equal(upcoming?.endMs, at("15:45").getTime());
  assert.equal(upcoming?.uncertain, true);
  assert.ok(result.issues.some((i) => i.source === "order" && i.id === "order" && i.reason === "missing-estimate"));
});
test("scheduled carry-over fallback can continue into the next day", () => {
  const start = new Date("2030-01-06T23:50:00+08:00");
  const endOfDay = new Date("2030-01-07T00:00:00+08:00");
  const result = buildBranchSchedule({
    ...scope,
    orders: [order({
      status: "SCHEDULED",
      occupiesCapacity: false,
      scheduledAt: start,
      startedAt: null,
      estimatedDurationMinutes: null,
      expectedFinishAt: null,
    })],
    appointments: [],
    now: at("10:30"),
    rangeStart: endOfDay,
    rangeEnd: new Date("2030-01-07T23:59:00+08:00"),
    fallbackDurationMinutes: 30,
  });
  assert.equal(result.intervals.length, 1);
  assert.equal(result.intervals[0].startMs, endOfDay.getTime());
  assert.equal(result.intervals[0].endMs, new Date("2030-01-07T00:20:00+08:00").getTime());
});
test("missing linked order preserves reservation and raises an issue", () => {
  const result = project([], [appointment({ serviceOrderId: "missing" })]);
  assert.equal(result.intervals.length, 1);
  assert.ok(result.issues.some((issue) => issue.reason === "missing-order"));
});
test("cancelled and no-show appointments release reservations", () => {
  assert.equal(project([], [appointment({ status: "CANCELLED" }), appointment({ status: "NO_SHOW", id: "other" })]).intervals.length, 0);
});
test("projection excludes other branches and tenants", () => {
  const result = project([order({ tenantId: "other" }), order({ branchId: "other", id: "other" })],
    [appointment({ tenantId: "other" }), appointment({ branchId: "other", id: "other" })]);
  assert.deepEqual(result, { intervals: [], issues: [] });
});
test("carry-over active job from yesterday still occupies today", () => {
  const result = project([order({ startedAt: new Date("2030-01-06T16:00:00+08:00") })]);
  assert.equal(result.intervals[0].startMs, at("09:00").getTime());
});
test("new forecast changes capacity without moving the original appointment", () => {
  const original = appointment({ serviceOrderId: "order" });
  const result = project([order({ expectedFinishAt: at("12:00") })], [original]);
  assert.equal(result.intervals[0].endMs, at("12:00").getTime());
  assert.equal(original.requestedAt.getTime(), at("10:00").getTime());
  assert.equal(original.estimatedDurationMinutes, 60);
});
test("cross-midnight order is represented on both business dates", () => {
  const segments = splitScheduleInterval(
    new Date("2030-01-07T23:00:00+08:00"),
    new Date("2030-01-08T02:00:00+08:00"),
  );
  assert.equal(segments.length, 2);
  assert.equal(segments[0].start.toISOString(), "2030-01-07T15:00:00.000Z");
  assert.equal(segments[0].end.toISOString(), "2030-01-07T16:00:00.000Z");
  assert.equal(segments[1].startsBeforeDay, true);
  assert.equal(segments[1].start.toISOString(), "2030-01-07T16:00:00.000Z");
  assert.equal(segments[1].end.toISOString(), "2030-01-07T18:00:00.000Z");
});
test("an exact-midnight finish does not create a zero-length next-day segment", () => {
  const segments = splitScheduleInterval(
    new Date("2030-01-07T23:00:00+08:00"),
    new Date("2030-01-08T00:00:00+08:00"),
  );
  assert.equal(segments.length, 1);
  assert.equal(segments[0].endsAfterDay, false);
  assert.equal(segments[0].end.toISOString(), "2030-01-07T16:00:00.000Z");
});
test("invalid order interval is surfaced and does not occupy the rest of the day", () => {
  const result = project([order({ expectedFinishAt: at("09:30"), startedAt: at("10:00") })]);
  assert.deepEqual(result.intervals, []);
  assert.ok(result.issues.some((issue) => issue.reason === "invalid-interval"));
});

test("an unpaid PENDING appointment past the 15-minute window releases its slot and drops out of the day calendar entirely", () => {
  const result = buildBranchSchedule({
    ...scope,
    orders: [],
    appointments: [appointment({
      status: "PENDING", feeAmount: 5000, payment: null,
      createdAt: new Date(at("10:30").getTime() - 16 * 60000),
    })],
    now: at("10:30"), rangeStart: at("09:00"), rangeEnd: at("18:00"),
  });
  assert.deepEqual(result.intervals, []);
  assert.ok(result.issues.some((issue) => issue.reason === "payment-expired"));
});
test("a PENDING appointment still inside the payment window keeps its slot", () => {
  const result = buildBranchSchedule({
    ...scope,
    orders: [],
    appointments: [appointment({
      status: "PENDING", feeAmount: 5000, payment: null,
      createdAt: new Date(at("10:30").getTime() - 5 * 60000),
    })],
    now: at("10:30"), rangeStart: at("09:00"), rangeEnd: at("18:00"),
  });
  assert.equal(result.intervals.length, 1);
});
test("a paid appointment never expires regardless of age", () => {
  const result = buildBranchSchedule({
    ...scope,
    orders: [],
    appointments: [appointment({
      status: "PENDING", feeAmount: 5000, payment: { status: "PAID" },
      createdAt: new Date(at("10:30").getTime() - 60 * 60000),
    })],
    now: at("10:30"), rangeStart: at("09:00"), rangeEnd: at("18:00"),
  });
  assert.equal(result.intervals.length, 1);
});
test("live availability check also releases an expired unpaid appointment's slot", async () => {
  const expiredRow = {
    requestedAt: new Date(2030, 0, 7, 10), categoryId: null, categories: [],
    status: "PENDING", feeAmount: 5000, feeUnderpaidAmount: null, payment: null,
    createdAt: new Date(new Date(2030, 0, 7, 10).getTime() - 20 * 60000),
  };
  assert.equal(
    await isSlotAvailable(client([expiredRow]), "branch", new Date(2030, 0, 7, 10), 60),
    true,
  );
});
test("live availability uses the slot fallback for an unestimated scheduled order", async () => {
  const scheduledOrder = {
    id: "scheduled-order", status: "SCHEDULED", scheduledAt: at("10:00"),
    startedAt: null, estimatedDurationMinutes: null, expectedFinishAt: null,
    occupiesCapacity: false,
  };
  assert.equal(
    await isSlotAvailable(client([], [scheduledOrder], 1), "branch", at("10:15"), 30),
    false,
  );
});

test("service item durations provide a whole-order estimate and ignore parts", () => {
  assert.equal(
    calculateServiceItemDurationMinutes([
      {
        kind: "LABOR",
        status: "PENDING",
        quantity: 1,
        service: {
          durationValue: "1.5",
          durationUnit: { name: "цаг", code: "ц" },
        },
        diagnosticTemplate: null,
      },
      {
        kind: "DIAGNOSTIC",
        status: "PENDING",
        quantity: 1,
        service: null,
        diagnosticTemplate: { durationMin: 30 },
      },
      {
        kind: "PART",
        status: "PENDING",
        quantity: 1,
        service: null,
        diagnosticTemplate: null,
      },
      {
        kind: "LABOR",
        status: "COMPLETED",
        quantity: 1,
        service: {
          durationValue: 8,
          durationUnit: { name: "цаг", code: "ц" },
        },
        diagnosticTemplate: null,
      },
    ]),
    120,
  );
});

test("an untimed work item keeps the estimate unresolved", () => {
  assert.equal(
    calculateServiceItemDurationMinutes([
      {
        kind: "LABOR",
        status: "PENDING",
        quantity: 1,
        service: null,
        diagnosticTemplate: null,
      },
    ]),
    null,
  );
});

// --- S06 fix: withOrderTransaction / runLockedOrderWork -------------------
// (WEB_SCHEDULING_ASSESSMENT_2026-09-10.md) — staff order mutations used to
// validate against an unlocked `findFirst` read, then write inside a
// separate lock-free transaction, letting two concurrent operations on the
// same order (two staff members, or staff + the expiry cron) both pass
// validation against the same stale snapshot. `runLockedOrderWork` is the
// testable core of `withOrderTransaction` (lib/order-time-booking.ts) —
// `withOrderTransaction` itself opens a real pooled connection via
// withBookingTransaction and can't be driven by a fake client, so these
// tests exercise the lock-then-reread contract directly, the same way
// tests/reservations.test.ts drives reserveAppointmentInTransaction with a
// fake tx fixture instead of a real one.
function orderLockFixture(opts: { locked?: boolean; row?: Record<string, unknown> | null } = {}) {
  const calls: string[] = [];
  const tx = {
    $queryRaw: async () => {
      calls.push("lock");
      return opts.locked === false ? [] : [{ id: "order" }];
    },
    serviceOrder: {
      findFirst: async () => {
        calls.push("read");
        return opts.row === undefined ? { id: "order", status: "SCHEDULED" } : opts.row;
      },
    },
  };
  return { tx, calls };
}

test("runLockedOrderWork locks, then re-reads, before calling work — in that order", async () => {
  const f = orderLockFixture();
  await runLockedOrderWork(f.tx, "tenant", "order", { id: true, status: true }, async (_tx, order) => {
    f.calls.push("work");
    assert.deepEqual(order, { id: "order", status: "SCHEDULED" });
  });
  assert.deepEqual(f.calls, ["lock", "read", "work"]);
});

test("runLockedOrderWork hands work the freshly re-read row, not a stale pre-lock snapshot", async () => {
  // Simulate a concurrent writer having changed the order's status between
  // whenever a caller's OWN pre-lock read happened and when this lock is
  // actually acquired — the fixture's `findFirst` (called only AFTER the
  // lock) returns that changed state. `work` must see it, proving stale
  // pre-lock state can't leak into the write.
  const staleSnapshot = { id: "order", status: "SCHEDULED" };
  const f = orderLockFixture({ row: { id: "order", status: "CANCELLED" } });
  let seenByWork: unknown;
  await runLockedOrderWork(f.tx, "tenant", "order", { id: true, status: true }, async (_tx, order) => {
    seenByWork = order;
  });
  assert.deepEqual(seenByWork, { id: "order", status: "CANCELLED" });
  assert.notDeepEqual(seenByWork, staleSnapshot);
});

test("runLockedOrderWork never reads the row when the lock query finds nothing — work gets null", async () => {
  const f = orderLockFixture({ locked: false });
  let seenByWork: unknown = "not called";
  await runLockedOrderWork(f.tx, "tenant", "missing", { id: true }, async (_tx, order) => {
    seenByWork = order;
  });
  assert.deepEqual(f.calls, ["lock"]);
  assert.equal(seenByWork, null);
});

test("changeOrderStatusAction delegates to the shared locked command, whose core owns withOrderTransaction", () => {
  const src = fs.readFileSync(
    path.join(__dirname, "..", "app", "_actions", "orders.ts"),
    "utf8",
  );
  const fnStart = src.indexOf("export async function changeOrderStatusAction");
  assert.ok(fnStart >= 0, "changeOrderStatusAction not found");
  const fnEnd = src.indexOf("\nexport async function reviseExpectedFinishAction", fnStart);
  assert.ok(fnEnd > fnStart, "reviseExpectedFinishAction not found after changeOrderStatusAction");
  const body = src.slice(fnStart, fnEnd);
  assert.ok(body.includes("changeOrderStatusCommand("), "expected shared command delegation");
  const commandSrc = fs.readFileSync(
    path.join(__dirname, "..", "lib", "orders", "order-commands.ts"),
    "utf8",
  );
  const coreStart = commandSrc.indexOf("export async function applyOrderPatchCommand");
  const coreEnd = commandSrc.indexOf("export async function changeOrderStatusCommand", coreStart);
  assert.ok(coreStart >= 0 && coreEnd > coreStart, "shared patch core not found");
  assert.ok(commandSrc.slice(coreStart, coreEnd).includes("withOrderTransaction("), "shared patch core must own the row lock");
  assert.ok(!commandSrc.includes("prisma.$transaction("), "shared command must not use an unlocked transaction");
});

// S10 fix (WEB_SCHEDULING_ASSESSMENT_2026-09-10.md): the shared expected-finish
// command validates against the currently open ACTIVE booking's real startAt,
// while holding the order row lock. This source guard inspects the command
// implementation rather than the thin web adapter.
function reviseExpectedFinishCommandBody(): string {
  const src = fs.readFileSync(
    path.join(__dirname, "..", "lib", "orders", "order-schedule-commands.ts"),
    "utf8",
  );
  const fnStart = src.indexOf("export async function reviseExpectedFinishCommand");
  assert.ok(fnStart >= 0, "reviseExpectedFinishCommand not found");
  // The next top-level export after it closes the function body.
  const fnEnd = src.indexOf("\nexport type RescheduleOrderInput", fnStart);
  assert.ok(fnEnd > fnStart, "RescheduleOrderInput not found after reviseExpectedFinishCommand");
  return src.slice(fnStart, fnEnd);
}

test("reviseExpectedFinishCommand validates the past-check against the open ACTIVE booking's startAt under the order lock", () => {
  const body = reviseExpectedFinishCommandBody();
  assert.ok(
    body.includes("withOrderTransaction("),
    "expected the shared command to own the order row lock",
  );
  assert.ok(
    body.includes("getOpenOrderTimeBookings(tx, order.id)"),
    "expected the open ACTIVE booking to be read through the transaction client",
  );
  assert.ok(
    body.includes('openBookings.find((booking) => booking.kind === "ACTIVE")?.startAt ?? order.startedAt'),
    "expected the ACTIVE booking's startAt to take precedence, falling back to startedAt only when no ACTIVE row is open",
  );
  assert.ok(
    body.includes("input.expectedFinishAt.getTime() <= activeStartAt.getTime()"),
    "expected the past-check to compare against the fresh activeStartAt",
  );
  assert.ok(
    !body.includes("getOpenOrderTimeBookings(prisma"),
    "must not require an unlocked pre-read through the global Prisma client",
  );
  assert.ok(
    body.includes("expectedFinishNeedsWarning(tx"),
    "expected the schedule warning to use the same transaction",
  );
});

// S13 (WEB_SCHEDULING_ASSESSMENT_2026-09-10.md): inspectScheduleImpact used
// to only look at Appointment rows. It must now also scan open SCHEDULED
// OrderTimeBooking rows (kind: "SCHEDULED"), and must exclude an
// expired-unpaid PENDING appointment hold from its computation.
test("inspectScheduleImpact clips an affected SCHEDULED OrderTimeBooking row, not just appointments", async () => {
  const { inspectScheduleImpact } = await import("../lib/branch-schedule-impact");
  const { resolveEffectiveSchedule } = await import("../lib/branch-effective-schedule");

  const branch = {
    openTime: "09:00", closeTime: "12:00",
    schedules: [], scheduleExceptions: [], scheduleSeasons: [],
  };
  const bookingRow = { id: "booking-1", startAt: at("11:00"), endAt: at("13:00") };
  const fakeTx = {
    appointment: { findMany: async () => [], update: async () => ({}) },
    orderTimeBooking: {
      findMany: async () => [bookingRow],
      update: async (args: { where: { id: string }; data: { endAt: Date } }) => {
        assert.equal(args.where.id, "booking-1");
        // Closing at 12:00 (60 minutes after the 11:00 start) matches the
        // remaining time before the newly-shortened 12:00 close.
        assert.equal(args.data.endAt.toISOString(), at("12:00").toISOString());
        return {};
      },
    },
  };
  const impact = await inspectScheduleImpact(fakeTx, {
    tenantId: "tenant",
    branchId: "branch",
    from: at("00:00"),
    to: new Date(at("00:00").getTime() + 86400000),
    resolve: () => resolveEffectiveSchedule({ dateStr: "2030-01-07", branch }),
    fallbackDurationMinutes: 30,
  });
  assert.equal(impact.erased.length, 0);
  assert.equal(impact.clipped.length, 1);
  assert.equal(impact.clipped[0]!.kind, "ORDER_TIME_BOOKING");
  assert.equal(impact.clipped[0]!.id, "booking-1");
  assert.equal(impact.clipped[0]!.durationMinutes, 60);

  const { applyScheduleClips } = await import("../lib/branch-schedule-impact");
  await applyScheduleClips(fakeTx, impact);
});

test("inspectScheduleImpact excludes an expired-hold PENDING appointment", async () => {
  const { inspectScheduleImpact } = await import("../lib/branch-schedule-impact");
  const { resolveEffectiveSchedule } = await import("../lib/branch-effective-schedule");
  const { PENDING_APPOINTMENT_PAYMENT_TTL_MINUTES } = await import("../lib/appointment-payment-status");

  const branch = {
    openTime: "09:00", closeTime: "10:00",
    schedules: [], scheduleExceptions: [], scheduleSeasons: [],
  };
  // A PENDING online-booking-fee hold created well past the TTL, never paid —
  // isPendingAppointmentPaymentExpired should mark it expired, so it must not
  // be treated as a live reservation the hours change erases/clips.
  // inspectScheduleImpact checks expiry against the REAL current clock (it
  // doesn't thread a fixture `now` through), so createdAt must be relative to
  // Date.now(), not the fixture's fictional 2030 "at()" times.
  const expiredCreatedAt = new Date(Date.now() - (PENDING_APPOINTMENT_PAYMENT_TTL_MINUTES + 5) * 60000);
  const fakeTx = {
    appointment: {
      findMany: async () => [{
        id: "appt-expired",
        requestedAt: at("09:00"),
        estimatedDurationMinutes: 30,
        status: "PENDING",
        feeAmount: 5000,
        feeUnderpaidAmount: null,
        createdAt: expiredCreatedAt,
        payment: null,
      }],
      update: async () => { throw new Error("must not update an excluded expired hold"); },
    },
    orderTimeBooking: { findMany: async () => [], update: async () => ({}) },
  };
  const impact = await inspectScheduleImpact(fakeTx, {
    tenantId: "tenant",
    branchId: "branch",
    from: at("00:00"),
    to: new Date(at("00:00").getTime() + 86400000),
    // Close the branch entirely at this hour — if the expired hold were
    // still considered live, it would show up as erased.
    resolve: () => resolveEffectiveSchedule({ dateStr: "2030-01-07", branch: { ...branch, openTime: null, closeTime: null } }),
    fallbackDurationMinutes: 30,
  });
  assert.equal(impact.erased.length, 0);
  assert.equal(impact.clipped.length, 0);
});

// S13: booking creation/reschedule previously had no maximum advance-booking
// horizon at all. Verified by source inspection (no live-DB fixture path for
// reserveAppointmentInTransaction, matching the S06-era pattern above).
test("reserveAppointmentInTransaction and moveAppointmentInTransaction respect MAX_ADVANCE_BOOKING_DAYS", () => {
  const src = fs.readFileSync(
    path.join(__dirname, "..", "lib", "appointment-reservations.ts"),
    "utf8",
  );
  assert.ok(
    src.includes('import { bookingDateKey, MAX_ADVANCE_BOOKING_DAYS } from "@/lib/booking-time"'),
    "expected the shared advance-booking horizon constant to be imported",
  );
  assert.ok(
    src.includes("function assertWithinAdvanceBookingHorizon("),
    "expected a shared horizon-check helper",
  );
  const reserveStart = src.indexOf("export async function reserveAppointmentInTransaction");
  const moveStart = src.indexOf("export async function moveAppointmentInTransaction");
  assert.ok(reserveStart >= 0 && moveStart >= 0);
  const reserveBody = src.slice(reserveStart, moveStart);
  const moveBody = src.slice(moveStart);
  assert.ok(
    reserveBody.includes("assertWithinAdvanceBookingHorizon(input.requestedAt, now)"),
    "expected reserveAppointmentInTransaction to enforce the horizon",
  );
  assert.ok(
    moveBody.includes("assertWithinAdvanceBookingHorizon(input.requestedAt, now)"),
    "expected moveAppointmentInTransaction (reschedule) to enforce the same horizon",
  );

  const bookingTimeSrc = fs.readFileSync(
    path.join(__dirname, "..", "lib", "booking-time.ts"),
    "utf8",
  );
  assert.ok(
    bookingTimeSrc.includes("export const MAX_ADVANCE_BOOKING_DAYS = 366;"),
    "expected the shared constant to live in lib/booking-time.ts",
  );
});

// S13: all 5 branch-schedule mutation actions must take the branch row lock
// inside a real transaction, so the overlap check + impact inspection + save
// serialize against concurrent bookings from lib/appointment-reservations.ts.
// upsertBranchScheduleSeasonAction previously had no transaction at all.
test("all 5 branch-schedule mutation actions take the branch row lock inside a transaction", () => {
  // updateBranchAction + v1 PATCH /branches/[id] хоёул lib/branches-commands.ts
  // updateBranch-ийг дуудна — lock тэнд.
  const branchesSrc = fs.readFileSync(
    path.join(__dirname, "..", "lib", "branches-commands.ts"),
    "utf8",
  );
  const updateBranchStart = branchesSrc.indexOf("export async function updateBranch(");
  assert.ok(updateBranchStart >= 0, "updateBranch not found");
  const updateBranchBody = branchesSrc.slice(updateBranchStart);
  assert.ok(
    /await tx\.\$queryRaw`SELECT id FROM "Branch" WHERE id = \$\{id\} AND "tenantId" = \$\{actor\.tenantId\} FOR UPDATE`/.test(updateBranchBody),
    "expected updateBranch to take the Branch row lock inside its transaction",
  );

  const schedulesSrc = fs.readFileSync(
    path.join(__dirname, "..", "app", "_actions", "branch-schedules.ts"),
    "utf8",
  );
  const fns = [
    "upsertBranchScheduleExceptionAction",
    "deleteBranchScheduleExceptionAction",
    "upsertBranchScheduleSeasonAction",
    "deleteBranchScheduleSeasonAction",
  ];
  const starts = fns.map((name) => {
    const idx = schedulesSrc.indexOf(`export async function ${name}`);
    assert.ok(idx >= 0, `${name} not found`);
    return idx;
  });
  for (let i = 0; i < fns.length; i++) {
    const bodyStart = starts[i]!;
    const bodyEnd = i + 1 < starts.length ? starts[i + 1]! : schedulesSrc.length;
    const body = schedulesSrc.slice(bodyStart, bodyEnd);
    assert.ok(
      /FOR UPDATE`/.test(body),
      `expected ${fns[i]} to take the Branch row lock`,
    );
    assert.ok(
      /prisma\.\$transaction\(async \(tx\)/.test(body),
      `expected ${fns[i]} to run its lock + save inside prisma.$transaction`,
    );
  }
});

// S13 Phase 5: originalEstimatedDurationMinutes/originalDurationMinutes are
// populated once at creation, alongside the mutable estimatedDurationMinutes/
// endAt, and never touched again by applyScheduleClips.
test("reserveAppointmentInTransaction writes originalEstimatedDurationMinutes equal to estimatedDurationMinutes at creation", () => {
  const src = fs.readFileSync(
    path.join(__dirname, "..", "lib", "appointment-reservations.ts"),
    "utf8",
  );
  const createIdx = src.indexOf("tx.appointment.create(");
  assert.ok(createIdx >= 0, "expected an appointment.create call site");
  const createCall = src.slice(createIdx, createIdx + 400);
  assert.ok(
    /estimatedDurationMinutes:\s*duration,\s*originalEstimatedDurationMinutes:\s*duration,/.test(createCall),
    "expected originalEstimatedDurationMinutes to be set to the same `duration` value as estimatedDurationMinutes at creation",
  );
});

test("openOrderTimeBooking derives originalDurationMinutes from startAt/endAt, and null when endAt is unknown", async () => {
  const { openOrderTimeBooking } = await import("../lib/order-time-booking");
  const calls: Array<Record<string, unknown>> = [];
  const fakeTx = {
    orderTimeBooking: {
      create: async (args: { data: Record<string, unknown> }) => {
        calls.push(args.data);
        return {};
      },
    },
  } as unknown as PrismaTransactionClient;

  const startAt = at("09:00");
  const endAt = new Date(startAt.getTime() + 90 * 60000);
  await openOrderTimeBooking(fakeTx, {
    tenantId: "tenant", orderId: "order-1", branchId: "branch-1",
    kind: "SCHEDULED", startAt, endAt, createdById: null,
  });
  assert.equal(calls[0]!.originalDurationMinutes, 90);

  await openOrderTimeBooking(fakeTx, {
    tenantId: "tenant", orderId: "order-1", branchId: "branch-1",
    kind: "ACTIVE", startAt, endAt: null, createdById: null,
  });
  assert.equal(calls[1]!.originalDurationMinutes, null);
});

test("applyScheduleClips never writes to originalEstimatedDurationMinutes/originalDurationMinutes", () => {
  const src = fs.readFileSync(
    path.join(__dirname, "..", "lib", "branch-schedule-impact.ts"),
    "utf8",
  );
  const fnIdx = src.indexOf("export async function applyScheduleClips");
  assert.ok(fnIdx >= 0, "applyScheduleClips not found");
  const body = src.slice(fnIdx);
  assert.ok(!/data:\s*{[^}]*originalEstimatedDurationMinutes/.test(body), "must not write originalEstimatedDurationMinutes");
  assert.ok(!/data:\s*{[^}]*originalDurationMinutes/.test(body), "must not write originalDurationMinutes");
  assert.ok(/data:\s*{\s*estimatedDurationMinutes:\s*item\.durationMinutes\s*}/.test(body), "expected the appointment clip write to only touch estimatedDurationMinutes");
  assert.ok(/data:\s*{\s*endAt\s*}/.test(body), "expected the order-time-booking clip write to only touch endAt");
});

// S13 Phase 4: updateBranchAction / upsertBranchScheduleExceptionAction /
// upsertBranchScheduleSeasonAction must hard-block on any erased item
// regardless of confirmed, and require confirmed=true to proceed past a
// clipped-only warning (same convention as app/_actions/orders.ts's
// postpone/reschedule confirmed=true gate).
test("branch schedule mutation actions require confirmed=true past a clipped-only warning, and hard-block erased regardless of confirmed", () => {
  // branches.ts action нь confirmed-ийг уншиж, impact-ийн шалгалтыг
  // lib/branches-commands.ts updateBranch хийнэ — хоёуланг нэгтгэж шалгана.
  const branchesSrc =
    fs.readFileSync(path.join(__dirname, "..", "app", "_actions", "branches.ts"), "utf8") +
    fs.readFileSync(path.join(__dirname, "..", "lib", "branches-commands.ts"), "utf8");
  const schedulesSrc = fs.readFileSync(path.join(__dirname, "..", "app", "_actions", "branch-schedules.ts"), "utf8");

  for (const [label, src] of [["branches.ts", branchesSrc], ["branch-schedules.ts", schedulesSrc]] as const) {
    assert.ok(
      /confirmed\s*=\s*s\(formData,\s*"confirmed"\)\s*===\s*"true"/.test(src),
      `expected ${label} to read a confirmed=true flag from formData`,
    );
    assert.ok(
      /impact\.clipped\.length > 0 && !confirmed/.test(src),
      `expected ${label} to gate clipped-only impact on !confirmed`,
    );
    assert.ok(
      /impact\.erased\.length > 0/.test(src),
      `expected ${label} to still check erased independently of confirmed`,
    );
  }
});

// S14 (WEB_SCHEDULING_ASSESSMENT_2026-09-10.md): staff appointment reschedule
// and staff order reschedule used to write only their own entity, letting a
// linked appointment/order pair drift to two different times. Phase A adds
// lib/linked-reschedule.ts's moveLinkedAppointmentOrder as the one shared
// command both entry points now call in the dangerous window (appointment
// CONFIRMED + linked order SCHEDULED); Phase C's rejection stays as
// defense-in-depth for any other linked-order state. These tests inspect the
// source directly, matching the established style for this file's other
// lock/branching checks (see the S06/S10/S12 tests above) rather than driving
// the actions end-to-end against a real database.
// P2-B1 moved the reschedule mechanism into the command module, so the reader
// that sliced it out of the action body has no callers left. Removed rather
// than kept dead — the command reader below replaces it.

// P2-B1 moved the staff reschedule *mechanism* out of the action and into
// lib/appointments/appointment-commands.ts, leaving the action as a thin
// adapter. The guards below therefore read whichever file now owns the
// behavior each one is protecting: the command for the linked-order branching
// and the database reads, the action for parsing, revalidation and the error
// seam. Every original assertion is preserved — none was relaxed to
// accommodate the move.
function rescheduleAppointmentCommandBody(): string {
  const src = fs.readFileSync(
    path.join(__dirname, "..", "lib", "appointments", "appointment-commands.ts"),
    "utf8",
  );
  const fnStart = src.indexOf("export async function rescheduleAppointmentCommand");
  assert.ok(fnStart >= 0, "rescheduleAppointmentCommand not found");
  const fnEnd = src.indexOf("\nexport async function ", fnStart + 10);
  return src.slice(fnStart, fnEnd > fnStart ? fnEnd : undefined);
}

function rescheduleOrderActionBody(): string {
  const src = fs.readFileSync(path.join(__dirname, "..", "app", "_actions", "orders.ts"), "utf8");
  const fnStart = src.indexOf("export async function rescheduleOrderAction");
  assert.ok(fnStart >= 0, "rescheduleOrderAction not found");
  const fnEnd = src.indexOf("\nexport async function deleteOrderAction", fnStart);
  assert.ok(fnEnd > fnStart, "end of rescheduleOrderAction not found");
  return src.slice(fnStart, fnEnd);
}

test("Phase C/A final branching: rescheduleAppointmentAction routes a linked+SCHEDULED order through the shared moveLinkedAppointmentOrder command, and still refuses any other linked-order state", () => {
  const body = rescheduleAppointmentCommandBody();
  assert.ok(body.includes("serviceOrderId: true"), "expected the select to fetch serviceOrderId");
  assert.ok(body.includes("serviceOrder: { select: { id: true, status: true } }"), "expected the select to fetch the linked order's status");
  assert.ok(body.includes("moveLinkedAppointmentOrder("), "expected a call into the shared linked-move command");
  // The linked-but-not-SCHEDULED branch must still reject rather than fall
  // through to the plain single-entity write below (which would silently
  // move only the appointment while an IN_PROGRESS/etc. order stays put).
  const guardIdx = body.indexOf('appt.serviceOrder?.status !== "SCHEDULED"');
  assert.ok(guardIdx >= 0, "expected a guard on the linked order's status");
  const rejectIdx = body.indexOf("Захиалгын хуудаснаас цагийг нь шилжүүлнэ үү");
  assert.ok(rejectIdx > guardIdx, "expected a rejection message for the non-SCHEDULED linked-order case");
  const sharedCallIdx = body.indexOf("moveLinkedAppointmentOrder(");
  assert.ok(guardIdx < sharedCallIdx, "the non-SCHEDULED guard must be checked before calling the shared command");
});

test("Phase A final branching: rescheduleOrderAction uses the shared scheduling command", () => {
  const orderBody = rescheduleOrderActionBody();
  assert.ok(orderBody.includes("rescheduleOrderCommand("), "expected rescheduleOrderAction to call the shared scheduling command");
  assert.ok(orderBody.includes('revalidatePath("/dashboard/appointments")'));
  assert.ok(orderBody.includes('revalidatePath("/account")'));

  // P2-B1: the appointment side reaches the shared S14 primitive through its
  // command module rather than from the action file directly. The requirement
  // is unchanged — exactly one primitive, reached through an adapter — so the
  // assertion follows the import to where it now lives.
  const apptCommandSrc = fs.readFileSync(
    path.join(__dirname, "..", "lib", "appointments", "appointment-commands.ts"),
    "utf8",
  );
  const apptSrc = fs.readFileSync(path.join(__dirname, "..", "app", "_actions", "appointments.ts"), "utf8");
  const orderSrc = fs.readFileSync(path.join(__dirname, "..", "app", "_actions", "orders.ts"), "utf8");
  assert.ok(
    apptCommandSrc.includes('from "@/lib/linked-reschedule";') && orderSrc.includes('from "@/lib/orders/order-schedule-commands";'),
    "appointment and order actions must use the shared S14 primitive through their scheduling adapters",
  );
  assert.ok(
    !apptSrc.includes('from "@/lib/linked-reschedule";'),
    "the action must not reach past its command module to the linked-move primitive",
  );
});

test("Phase A fallback: the shared primitive permits an order-only move when the link is no longer confirmed", () => {
  const body = rescheduleOrderActionBody();
  assert.ok(body.includes("rescheduleOrderCommand("));
  const linkedSrc = fs.readFileSync(path.join(__dirname, "..", "lib", "linked-reschedule.ts"), "utf8");
  assert.ok(linkedSrc.includes("allowUnconfirmedOrderMove"));
});

test("P1-B4 order scheduling adapters keep typed domain errors, generic unexpected errors, and required revalidation", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "app", "_actions", "orders.ts"), "utf8");
  for (const name of ["reviseExpectedFinishAction", "rescheduleOrderAction"]) {
    const start = src.indexOf(`export async function ${name}`);
    const end = src.indexOf("\nexport async function ", start + 10);
    const body = src.slice(start, end > start ? end : undefined);
    assert.ok(body.includes("instanceof OrderScheduleCommandError"));
    assert.ok(body.includes("return orderActionErrorResult(e)"), "authorization failures must use the shared safe classifier");
    assert.equal(body.includes("message: e instanceof Error ? e.message"), false);
  }
  // D-132: the classifier moved to `lib/action-errors.ts` and is now shared with
  // appointments.ts. orders.ts keeps only the message it can throw itself; the
  // subscription lock is the seam's responsibility, asserted in its own test.
  assert.ok(src.includes("knownAuthorizationMessage(e, ORDER_ACTION_KNOWN_MESSAGES)"));
  assert.ok(src.includes("ORDER_EDIT_FORBIDDEN_MESSAGE"));
  assert.ok(src.includes("ACTION_GENERIC_ERROR_MESSAGE"));
  assert.equal(
    src.includes("function knownOrderAuthorizationMessage"),
    false,
    "the per-file classifier must not return — callers share one seam so a throw site cannot be missed in only one of them",
  );
  const reschedule = rescheduleOrderActionBody();
  assert.ok(reschedule.includes('revalidatePath("/dashboard/appointments")'));
  assert.ok(reschedule.includes('revalidatePath("/account")'));
});

test("P1-B4 staff appointment reschedule uses strict business-local parsing and safe unexpected errors", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "app", "_actions", "appointments.ts"), "utf8");
  const start = src.indexOf("export async function rescheduleAppointmentAction");
  const end = src.indexOf("\nexport async function ", start + 10);
  const body = src.slice(start, end > start ? end : undefined);
  assert.ok(body.includes("parseBusinessLocalDateTime(requestedRaw)"));
  assert.equal(body.includes("new Date(requestedRaw)"), false);
  assert.ok(body.includes("ACTION_GENERIC_ERROR_MESSAGE"));
  assert.equal(body.includes("message: e instanceof Error ? e.message"), false);
  // D-132 regression guard: the `assertStaffScope` catch classifies through the
  // shared seam. It previously inlined a two-literal allow-list that omitted
  // SUBSCRIPTION_LOCKED_MESSAGE, so a lapsed subscription surfaced as a generic
  // "try again" error the user could never act on.
  // P2-B1 renamed the catch binding from `e` to `error`; the requirement is the
  // classifier call, not the identifier, so match either binding rather than
  // pinning a variable name the refactor is free to change.
  assert.ok(
    body.includes("knownAuthorizationMessage(e, STAFF_SCOPE_MESSAGES)") ||
      body.includes("knownAuthorizationMessage(error, STAFF_SCOPE_MESSAGES)"),
    "the catch must classify through the shared seam with STAFF_SCOPE_MESSAGES",
  );
  assert.equal(
    body.includes('"Танд цаг захиалга удирдах эрх байхгүй."'),
    false,
    "allow-lists must reference the constants shared with the throw site, never copied literals",
  );
  assert.ok(body.includes("unstable_rethrow(error)"));
  // P2-B1: the database reads moved into the command, so the "every read sits
  // inside the error boundary" check now spans the adapter's try block and the
  // command it calls. The guarantee is identical: no appointment or linked
  // order read can escape the boundary and surface a raw error to the user.
  const boundaryStart = body.indexOf("try {", body.indexOf("requestedAt.getTime() < Date.now()"));
  const commandCall = body.indexOf("rescheduleAppointmentCommand(");
  const boundaryCatch = body.lastIndexOf("unstable_rethrow(error)");
  assert.ok(boundaryStart >= 0 && boundaryStart < commandCall && boundaryCatch > commandCall);
  assert.equal(
    body.includes("prisma."),
    false,
    "the adapter must not read the database directly — the command owns every read",
  );
  const command = rescheduleAppointmentCommandBody();
  assert.ok(command.includes("prisma.appointment.findUnique("));
  assert.ok(command.includes("prisma.serviceOrder.findFirst("));
});

test("D-132 the shared action-error seam owns the subscription lock, so no caller can omit it", () => {
  const seam = fs.readFileSync(path.join(__dirname, "..", "lib", "action-errors.ts"), "utf8");
  const fnStart = seam.indexOf("export function knownAuthorizationMessage");
  assert.ok(fnStart >= 0, "expected the shared classifier");
  const subscriptionCheck = seam.indexOf("SUBSCRIPTION_LOCKED_MESSAGE", fnStart);
  const extrasCheck = seam.indexOf("extraMessages.includes", fnStart);
  // The subscription message is matched inside the helper and BEFORE the
  // caller-supplied list, never passed in. Making it opt-in is precisely how it
  // went missing from the appointments allow-list in the first place.
  assert.ok(subscriptionCheck > fnStart, "the seam must match SUBSCRIPTION_LOCKED_MESSAGE itself");
  assert.ok(extrasCheck > subscriptionCheck, "caller extras must not be able to shadow the subscription lock");
  assert.equal(
    seam.includes("Таны багцын хугацаа дууссан"),
    false,
    "the seam must import the constant, not re-copy its text",
  );

  for (const file of ["orders.ts", "appointments.ts"]) {
    const src = fs.readFileSync(path.join(__dirname, "..", "app", "_actions", file), "utf8");
    assert.ok(src.includes('from "@/lib/action-errors"'), `${file} must classify through the shared seam`);
    assert.equal(
      src.includes("Таны багцын хугацаа дууссан"),
      false,
      `${file} must not copy the subscription message literal`,
    );
  }
});

test("moveLinkedAppointmentOrder (lib/linked-reschedule.ts) re-fetches the appointment AND order fresh, validates both statuses, and writes all three targets together", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "lib", "linked-reschedule.ts"), "utf8");
  const fnStart = src.indexOf("export async function moveLinkedAppointmentOrder");
  assert.ok(fnStart >= 0);
  const body = src.slice(fnStart);

  assert.ok(body.includes("withOrderTransaction("), "expected the ServiceOrder row lock via withOrderTransaction");
  assert.ok(
    body.includes('FOR UPDATE') && body.includes('"Appointment"'),
    "expected an additional explicit row lock on the linked Appointment",
  );
  assert.ok(
    body.includes("tx.appointment.findFirst("),
    "expected a fresh re-read of the appointment under lock, not reuse of a pre-lock snapshot",
  );
  assert.ok(body.includes('order.status !== "SCHEDULED"'), "expected a fresh order-status check");
  assert.ok(body.includes('appt.status !== "CONFIRMED"'), "expected a fresh appointment-status check");
  assert.ok(
    body.includes("appt.serviceOrderId !== order.id"),
    "expected a stale-link check — the appointment might have been relinked/unlinked concurrently",
  );

  // All three write targets, in the same locked transaction.
  assert.ok(body.includes("tx.appointment.update("), "expected the Appointment write");
  assert.ok(body.includes("tx.serviceOrder.update("), "expected the ServiceOrder write");
  assert.ok(body.includes("updateOpenOrderTimeBookingSchedule("), "expected the OrderTimeBooking write");

  const apptWriteIdx = body.indexOf("tx.appointment.update(");
  const orderWriteIdx = body.indexOf("tx.serviceOrder.update(");
  const bookingWriteIdx = body.indexOf("updateOpenOrderTimeBookingSchedule(");
  const statusCheckIdx = body.indexOf('order.status !== "SCHEDULED"');
  assert.ok(
    statusCheckIdx < apptWriteIdx && statusCheckIdx < orderWriteIdx && statusCheckIdx < bookingWriteIdx,
    "all three writes must come after the fresh status re-validation, not before it",
  );
});

test("createOrderAction opens its SCHEDULED booking with an endAt derived from the order's estimate, never a hardcoded null", () => {
  // Regression guard. createOrderAction used to pass `endAt: null` here while
  // writing a perfectly good estimatedDurationMinutes (for a booking, the sum
  // of the customer's picked categories) onto the order itself. Since the
  // D-068 step 3 read-path swap, resolveOrderIntervals prefers this row over
  // the ServiceOrder scalars and reads a null endAt as "no evidence of an
  // end" — so buildBranchSchedule collapsed the day-view block to one branch
  // slot (missing-estimate/uncertain) and resolveTakenCapacityIntervals
  // reserved only that slot, letting customers book over a job already in the
  // calendar. Every reschedule path and the one-off backfill script always
  // computed this end correctly; creation was the lone writer that did not.
  const src = fs.readFileSync(
    path.join(__dirname, "..", "lib", "orders", "order-create-command.ts"),
    "utf8",
  );
  const fnStart = src.indexOf("export async function createOrderCommand");
  assert.ok(fnStart >= 0, "createOrderCommand not found");
  const fnEnd = src.length;
  const body = src.slice(fnStart, fnEnd);

  const openIdx = body.indexOf("openOrderTimeBooking(");
  assert.ok(openIdx !== -1, "expected the D-068 dual-write openOrderTimeBooking call");
  const openCall = body.slice(openIdx, body.indexOf("});", openIdx));
  assert.ok(
    !/endAt:\s*null/.test(openCall),
    "createOrderAction must not hardcode endAt: null — derive it from the order's estimatedDurationMinutes",
  );
  assert.ok(
    openCall.includes("60000"),
    "expected endAt to be computed as startAt + duration minutes",
  );

  // The booking row's end and the order's own stored estimate must come from
  // the SAME expression — two independently written copies are exactly how
  // they drifted apart before.
  const estimateMatches = body.match(/estimatedDurationMinutes:\s*([A-Za-z0-9_]+)/g) ?? [];
  assert.ok(
    estimateMatches.some((m) => m.includes("durationMinutes")),
    "expected the order's estimatedDurationMinutes to be written from the shared hoisted constant",
  );
  assert.ok(
    openCall.includes("durationMinutes"),
    "expected the booking row's endAt to be derived from that same constant",
  );
});

test("moveLinkedAppointmentOrder validates hours inside its transaction without overlap checks", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "lib", "linked-reschedule.ts"), "utf8");
  assert.ok(src.includes("scheduleHoursError("), "expected tx-scoped schedule-hours validation");
  assert.ok(src.includes("await tx.branch.findFirst("), "expected branch settings to be read through tx");
  // D-111: the schedule-overlap check this path used to run was removed. It
  // never blocked a save and ignored slotCapacity.
  assert.ok(
    !src.includes("findScheduleConflict("),
    "the overlap confirmation was removed in D-111 — do not reintroduce it here",
  );
});

test("D-111: no schedule-overlap confirmation survives in any order or appointment write path", () => {
  for (const rel of [
    ["app", "_actions", "orders.ts"],
    ["app", "_actions", "appointments.ts"],
    ["lib", "linked-reschedule.ts"],
    ["lib", "order-schedule-validation.ts"],
  ]) {
    const src = fs.readFileSync(path.join(__dirname, "..", ...rel), "utf8");
    assert.ok(
      !src.includes("findScheduleConflict(") && !src.includes("findAppointmentRescheduleConflict("),
      `${rel.join("/")} must not call an overlap-conflict checker (removed in D-111)`,
    );
  }
  // The real constraints D-111 deliberately KEPT.
  const ordersSrc = fs.readFileSync(path.join(__dirname, "..", "app", "_actions", "orders.ts"), "utf8");
  assert.ok(
    ordersSrc.includes("validateScheduledOrderHours("),
    "working-hours validation must survive — it is a real branch constraint, not an overlap heuristic",
  );
  const reservationsSrc = fs.readFileSync(path.join(__dirname, "..", "lib", "appointment-reservations.ts"), "utf8");
  assert.ok(
    reservationsSrc.includes("isSlotAvailable("),
    "the real slotCapacity check on booking creation must survive",
  );
  assert.ok(
    reservationsSrc.includes("ReservationConflictError"),
    "the staff capacity-full override must survive — it guards a real capacity limit",
  );
});

test("Phase B: the dashboard appointments list and the calendar week/month view both surface the linked order's own time once it has progressed past SCHEDULED", () => {
  const listSrc = fs.readFileSync(path.join(__dirname, "..", "app", "dashboard", "appointments", "page.tsx"), "utf8");
  const calendarSrc = fs.readFileSync(
    path.join(__dirname, "..", "app", "dashboard", "appointments", "calendar", "page.tsx"),
    "utf8",
  );
  for (const [label, src] of [["appointments/page.tsx", listSrc], ["calendar/page.tsx", calendarSrc]] as const) {
    assert.ok(
      /serviceOrder\.status !== "SCHEDULED"/.test(src),
      `expected ${label} to conditionally show dual-time labeling only once the linked order has progressed past SCHEDULED`,
    );
  }
});

// --- S15-S16: shared public-availability service --------------------------
// (WEB_SCHEDULING_ASSESSMENT_2026-09-10.md). resolvePublicAvailability
// (lib/public-availability.ts) is a Prisma-calling async function with no
// pure/fixture-level seam, and this test file must not depend on a real
// database (see the DATABASE_URL note above). These are source-pattern
// tests: they confirm the fix is actually present in the code, in the right
// order, rather than exercising it end-to-end against a live DB.

test("resolvePublicAvailability validates the date with bookingDayBounds before any Prisma call (the S16 fix)", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "lib", "public-availability.ts"), "utf8");

  const boundsIdx = src.indexOf("bookingDayBounds(dateStr)");
  const findIdx = src.indexOf("prisma.branch.findFirst(");
  assert.ok(boundsIdx > -1 && findIdx > -1, "expected both the date-bounds check and the branch lookup to be present");
  assert.ok(
    boundsIdx < findIdx,
    "bookingDayBounds(dateStr) must be called (and its throw caught) BEFORE the branch is fetched — " +
      "branchScheduleForDateSelect(dateStr) also calls bookingDayBounds internally for its throwing side " +
      "effect, so fetching the branch first would let an impossible date like 2030-02-30 throw uncaught " +
      "during findFirst, before any try/catch around it could turn it into a clean rejection (S16)",
  );

  // The try/catch must wrap the bounds call itself, not just be present somewhere.
  assert.match(
    src,
    /try\s*{\s*bounds\s*=\s*bookingDayBounds\(dateStr\);\s*}\s*catch/,
    "expected bookingDayBounds(dateStr) to be directly wrapped in try/catch",
  );
});

test("resolvePublicAvailability rejects an impossible date via bookingDayBounds without throwing", () => {
  // Exercises the actual RangeError path bookingDayBounds throws for an
  // impossible calendar date — this is the real function the old code path
  // called too late (after the branch fetch). Confirms it throws (so the
  // service's try/catch is necessary) and that catching it cleanly is
  // possible, matching what resolvePublicAvailability now does up front.
  assert.throws(() => bookingDayBounds("2030-02-30"));
  let rejected = false;
  try {
    bookingDayBounds("2030-02-30");
  } catch {
    rejected = true;
  }
  assert.ok(rejected, "expected the impossible date to be catchable, not left to propagate uncaught");
});

test("resolvePublicAvailability fetches the branch with isActive: true (previously missing)", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "lib", "public-availability.ts"), "utf8");
  assert.match(
    src,
    /branch\.findFirst\(/,
    "expected the branch lookup to use findFirst (to allow the isActive filter alongside id)",
  );
  assert.match(
    src,
    /where:\s*\{\s*id:\s*branchId,\s*isActive:\s*true\s*\}/,
    "expected the branch lookup to exclude inactive branches, matching reserveAppointmentInTransaction",
  );
});

test("resolvePublicAvailability checks tenant.suspended, acceptsOnlineBooking, and the ONLINE_BOOKING plan feature together", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "lib", "public-availability.ts"), "utf8");
  assert.ok(src.includes("branch.tenant.suspended"), "expected a suspended-tenant check");
  assert.ok(src.includes("branch.tenant.acceptsOnlineBooking"), "expected an acceptsOnlineBooking check");
  assert.ok(
    src.includes("isFeatureEnabled(branch.tenantId, PLAN_LIMIT_CODES.ONLINE_BOOKING)"),
    "expected the ONLINE_BOOKING plan-limit gate to be checked",
  );
});

test("resolvePublicAvailability hard-rejects a foreign/inactive category id instead of silently defaulting its duration", () => {
  // P2-B10: category eligibility now lives once, in the shared
  // `computeBranchDayAvailability` (lib/appointments/day-availability.ts),
  // which both `resolvePublicAvailability` and the staff slot route call —
  // see that module's own behavioral tests for proof it actually rejects.
  // This test now only proves resolvePublicAvailability delegates instead of
  // re-expressing the rule inline.
  const src = fs.readFileSync(path.join(__dirname, "..", "lib", "public-availability.ts"), "utf8");
  const sharedSrc = fs.readFileSync(
    path.join(__dirname, "..", "lib", "appointments", "day-availability.ts"),
    "utf8",
  );
  assert.ok(
    src.includes('from "@/lib/appointments/day-availability"') &&
      src.includes("computeBranchDayAvailability("),
    "expected resolvePublicAvailability to delegate to the shared computeBranchDayAvailability",
  );
  assert.ok(
    !src.includes("prisma.category.findMany"),
    "expected no duplicated inline category eligibility query left in resolvePublicAvailability",
  );
  assert.match(
    sharedSrc,
    /category\.findMany\(\{\s*where:\s*\{\s*id:\s*\{\s*in:\s*categoryIds\s*\},\s*tenantId:\s*branch\.tenantId,\s*isActive:\s*true,/,
    "expected category eligibility to be scoped by tenantId + isActive, mirroring reserveAppointmentInTransaction",
  );
  assert.ok(
    sharedSrc.includes("branches: { some: { id: branch.id } }") && sharedSrc.includes("branches: { none: {} } }"),
    "expected the branch-assigned-or-global category eligibility rule to match lib/appointment-reservations.ts",
  );
  assert.ok(
    sharedSrc.includes("eligible.length !== categoryIds.length"),
    "expected a hard length-mismatch check (400-equivalent rejection), not a silent DEFAULT_CATEGORY_DURATION_MINUTES fallback",
  );
});

test("resolvePublicAvailability dedupes requested category ids before validating/querying them", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "lib", "public-availability.ts"), "utf8");
  assert.ok(
    src.includes("[...new Set((input.categoryIds ?? []).filter(Boolean))]"),
    "expected category ids to be deduplicated via Set before use",
  );
});

test("the public availability API route and the public web action both delegate to resolvePublicAvailability, with no duplicated inline logic left behind", () => {
  const routeSrc = fs.readFileSync(
    path.join(__dirname, "..", "app", "api", "v1", "app", "branches", "[branchId]", "availability", "route.ts"),
    "utf8",
  );
  const actionsSrc = fs.readFileSync(path.join(__dirname, "..", "app", "_actions", "appointments.ts"), "utf8");

  assert.ok(routeSrc.includes('from "@/lib/public-availability"'), "expected the API route to import the shared service");
  assert.ok(routeSrc.includes("resolvePublicAvailability("), "expected the API route to call the shared service");
  assert.ok(
    !routeSrc.includes("resolveCategoryDurations") && !routeSrc.includes("branchScheduleForDateSelect"),
    "expected the API route's old duplicated inline resolution logic to be removed, not left dead alongside the new call",
  );

  assert.ok(actionsSrc.includes('from "@/lib/public-availability"'), "expected getBranchDaySlots to import the shared service");
  const fnStart = actionsSrc.indexOf("export async function getBranchDaySlots(");
  const fnEnd = actionsSrc.indexOf("\n}", fnStart);
  const fnBody = actionsSrc.slice(fnStart, fnEnd);
  assert.ok(fnBody.includes("resolvePublicAvailability("), "expected getBranchDaySlots to call the shared service");
  assert.ok(
    !fnBody.includes("resolveCategoryDurations(") && !fnBody.includes("resolveTakenCapacityIntervals("),
    "expected getBranchDaySlots's old duplicated inline resolution logic to be removed",
  );
});

test("the staff schedule preview (getBranchDaySchedulePreview) is NOT routed through the public availability service", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "app", "_actions", "schedule-preview.ts"), "utf8");
  assert.ok(
    !src.includes("public-availability") && !src.includes("resolvePublicAvailability"),
    "staff preview access must not depend on the public/online-booking-plan-gated path (see that file's own doc comment)",
  );
  assert.ok(
    src.includes("requireUser(") && src.includes('canView(user, "appointments")'),
    "expected the staff preview to keep its own authenticated/permission-checked access, independent of the public path",
  );
});

// --- S17 fix (WEB_SCHEDULING_ASSESSMENT_2026-09-10.md), Phases A & B -------
// Source-pattern inspection, same approach as the S06/S10/S12 tests above —
// no live-DB fixture harness for cron routes here either.

test("S17: expire-appointments cron uses a conditional updateMany (not a blind single-row update) and gates its side effects on it actually flipping the row", () => {
  const src = fs.readFileSync(
    path.join(__dirname, "..", "app", "api", "cron", "expire-appointments", "route.ts"),
    "utf8",
  );
  assert.ok(!src.includes("prisma.appointment.update("), "expected the old blind single-row update to be gone");
  const updateManyIdx = src.indexOf("prisma.appointment.updateMany(");
  assert.ok(updateManyIdx !== -1, "expected a conditional updateMany for the expiry write");
  const updateManyCall = src.slice(updateManyIdx, src.indexOf(");", updateManyIdx));
  assert.ok(updateManyCall.includes('status: "PENDING"'), "expected the updateMany where-clause to re-check status: PENDING");
  assert.ok(updateManyCall.includes("requestedAt: { lt: now }"), "expected the updateMany where-clause to re-check requestedAt < now");
  assert.ok(updateManyCall.includes("status: \"CANCELLED\""), "expected the updateMany to still write CANCELLED");

  const countCheckIdx = src.indexOf("result.count !== 1");
  assert.ok(countCheckIdx !== -1, "expected a result.count check gating the side effects");
  assert.ok(countCheckIdx > updateManyIdx, "expected the count check to come after the updateMany call");
  const logAuditIdx = src.indexOf("logAudit(");
  assert.ok(logAuditIdx > countCheckIdx, "expected the audit log to only run after the count check");
});

test("S17: appointment-reminders cron claims each row before DB/push notification, with failure-safe single-write semantics", () => {
  const src = fs.readFileSync(
    path.join(__dirname, "..", "app", "api", "cron", "appointment-reminders", "route.ts"),
    "utf8",
  );
  const claimIdx = src.indexOf("prisma.appointment.updateMany(");
  assert.ok(claimIdx !== -1, "expected a conditional updateMany claim call");
  const claimCall = src.slice(claimIdx, src.indexOf(");", claimIdx));
  assert.ok(claimCall.includes("reminderSentAt: null"), "expected the claim's where-clause to require reminderSentAt: null");
  assert.ok(claimCall.includes("reminderSentAt: new Date()"), "expected the claim to set reminderSentAt");

  const gateIdx = src.indexOf("claim.count !== 1");
  assert.ok(gateIdx !== -1, "expected a claim.count check gating notification");
  const notifyIdx = src.indexOf("createNotification(");
  assert.ok(notifyIdx !== -1, "expected the current DB/push notification call");
  assert.ok(
    claimIdx < gateIdx && gateIdx < notifyIdx,
    "expected ordering: claim updateMany, then count check, then DB/push notification — never notify before claiming",
  );
  assert.equal(src.includes("sendSms("), false, "the reminder contract is DB/push notification, not SMS");
  assert.ok(src.includes("if (a.accountId)"), "expected notification failure/scope handling to remain account-gated");
  assert.ok(src.indexOf("try {") < notifyIdx, "expected notification failures to be caught after a successful claim");
  assert.ok(src.indexOf("catch (e)", notifyIdx) > notifyIdx, "expected a caught notification failure so the cron response remains safe");

  // A claimed row is never written again after notification success/failure;
  // this prevents duplicate sends on concurrent runs and avoids a second
  // post-notification state transition that could create retry races.
  const updateCalls = (src.match(/prisma\.appointment\.(update|updateMany)\(/g) ?? []).length;
  assert.equal(updateCalls, 1, "expected exactly one appointment write (the atomic claim), no separate post-send mark");
});

test("S17: shared cron-secret helper (lib/cron-auth.ts) checks only the Authorization header, never a query-string fallback", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "lib", "cron-auth.ts"), "utf8");
  assert.ok(src.includes("export function verifyCronSecret("), "expected an exported verifyCronSecret helper");
  assert.ok(src.includes('req.headers.get("authorization")'), "expected it to read the Authorization header");
  assert.ok(!src.includes("searchParams"), "expected no query-string fallback in the helper");
  assert.ok(!src.includes('"secret"'), "expected no reference to a ?secret= query param");
});

test("S17: all cron routes with the identical header-or-querystring pattern now import and use verifyCronSecret, with no local duplicate check left behind", () => {
  const cronDir = path.join(__dirname, "..", "app", "api", "cron");
  const migrated = [
    "appointment-reminders",
    "expire-appointments",
    "expire-subscriptions",
    "notifications-prune",
    "subscription-reminders",
  ];
  for (const name of migrated) {
    const src = fs.readFileSync(path.join(cronDir, name, "route.ts"), "utf8");
    assert.ok(src.includes('from "@/lib/cron-auth"'), `expected ${name}/route.ts to import verifyCronSecret`);
    assert.ok(src.includes("verifyCronSecret("), `expected ${name}/route.ts to call verifyCronSecret`);
    assert.ok(!src.includes("searchParams.get(\"secret\")"), `expected ${name}/route.ts to have no leftover query-string secret check`);
    assert.ok(!src.match(/const secret = process\.env\.CRON_SECRET/), `expected ${name}/route.ts to have no leftover local secret check`);
  }
});

test("S17: reminder SMS formatting (formatWhen) specifies the explicit Asia/Ulaanbaatar business timezone, not host-local formatting", () => {
  const src = fs.readFileSync(
    path.join(__dirname, "..", "app", "api", "cron", "appointment-reminders", "route.ts"),
    "utf8",
  );
  const fnStart = src.indexOf("function formatWhen(");
  const fnEnd = src.indexOf("\n}", fnStart);
  const fnBody = src.slice(fnStart, fnEnd);
  assert.ok(fnBody.includes('timeZone: "Asia/Ulaanbaatar"'), "expected formatWhen to pass an explicit Asia/Ulaanbaatar timeZone option");
});

test("S17 Phase B: moveAppointmentInTransaction (customer reschedule) resets reminderSentAt in the same write that changes requestedAt", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "lib", "appointment-reservations.ts"), "utf8");
  const fnStart = src.indexOf("export async function moveAppointmentInTransaction(");
  assert.ok(fnStart !== -1, "expected moveAppointmentInTransaction to exist");
  const fnBody = src.slice(fnStart);
  const updateIdx = fnBody.indexOf("tx.appointment.update(");
  assert.ok(updateIdx !== -1, "expected an appointment.update call");
  const updateCall = fnBody.slice(updateIdx, fnBody.indexOf(");", updateIdx));
  assert.ok(updateCall.includes("requestedAt: input.requestedAt"), "expected the write to set the new requestedAt");
  assert.ok(updateCall.includes("reminderSentAt: null"), "expected the SAME write to reset reminderSentAt to null");
});

test("S17 Phase B: moveLinkedAppointmentOrder (staff linked reschedule) resets reminderSentAt in the same write that changes requestedAt", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "lib", "linked-reschedule.ts"), "utf8");
  const fnStart = src.indexOf("export async function moveLinkedAppointmentOrder(");
  assert.ok(fnStart !== -1, "expected moveLinkedAppointmentOrder to exist");
  const fnBody = src.slice(fnStart);
  const updateIdx = fnBody.indexOf("tx.appointment.update(");
  assert.ok(updateIdx !== -1, "expected an appointment.update call");
  const updateCall = fnBody.slice(updateIdx, fnBody.indexOf("});", updateIdx));
  assert.ok(updateCall.includes("requestedAt: input.newTime"), "expected the write to set the new requestedAt");
  assert.ok(updateCall.includes("reminderSentAt: null"), "expected the SAME write to reset reminderSentAt to null");
});

test("D-087 superseded: reviseExpectedFinishAction's hard closing-time block is gone; past-check and confirm-warning remain", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "lib", "orders", "order-schedule-commands.ts"), "utf8");
  const fnStart = src.indexOf("export async function reviseExpectedFinishCommand");
  assert.ok(fnStart >= 0, "reviseExpectedFinishCommand not found");
  const body = src.slice(fnStart, src.indexOf("export type RescheduleOrderInput", fnStart));

  assert.ok(!body.includes("workDayCloseAt"), "expected the hard workDayCloseAt block to be removed");
  assert.ok(
    !/тухайн өдрийн ажлын цагийн төгсгөлөөс.*хэтрэхгүй байх ёстой/.test(body),
    "expected the old unconditional closing-time rejection message to be gone",
  );
  assert.ok(
    body.includes("expectedFinishAt.getTime() <= activeStartAt.getTime()"),
    "expected the expected-finish ordering check to remain",
  );
  assert.ok(
    body.includes("expectedFinishNeedsWarning("),
    "expected the confirm-based schedule warning to still be called",
  );
  assert.ok(body.includes('confirmNeeded: "true"'), "expected the confirm warning to use the confirmNeeded shape");
});

test("D-087 superseded: shared reschedule hours check only blocks when !input.confirmed", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "lib", "linked-reschedule.ts"), "utf8");
  const fnStart = src.indexOf("export async function moveLinkedAppointmentOrder(");
  assert.ok(fnStart >= 0, "expected moveLinkedAppointmentOrder to exist");
  const body = src.slice(fnStart);
  assert.ok(body.includes("const hoursError = await scheduleHoursError("), "expected a call to scheduleHoursError");
  assert.ok(
    /if\s*\(\s*hoursError\s*&&\s*!input\.confirmed\s*\)/.test(body),
    "expected the hours check to only short-circuit when !input.confirmed",
  );
  assert.ok(body.includes('{ confirmNeeded: "true" }'), "expected the confirmNeeded fieldErrors shape");
  assert.ok(!/fieldErrors:\s*{\s*scheduledAt:\s*hoursError\s*}/.test(body), "expected the old hard-block scheduledAt fieldErrors shape to be gone");
});

test("D-087 superseded: moveLinkedAppointmentOrder's tx-scoped hours check is gated by !input.confirmed", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "lib", "linked-reschedule.ts"), "utf8");
  const fnStart = src.indexOf("export async function moveLinkedAppointmentOrder(");
  assert.ok(fnStart >= 0, "expected moveLinkedAppointmentOrder to exist");
  const body = src.slice(fnStart);
  assert.ok(body.includes("const hoursError = await scheduleHoursError("), "expected a call to scheduleHoursError");
  assert.ok(
    /if\s*\(\s*hoursError\s*&&\s*!input\.confirmed\s*\)/.test(body),
    "expected the hours check to only throw when !input.confirmed",
  );
  assert.ok(body.includes('{ confirmNeeded: "true" }'), "expected the confirmNeeded fieldErrors shape");
  assert.ok(!/scheduledAt:\s*hoursError/.test(body), "expected the old hard-throw scheduledAt fieldErrors shape to be gone");
});

test("D-087 superseded regression guard: customer-facing appointment-reservations.ts hour validation is untouched (still hard-blocks, no confirm bypass)", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "lib", "appointment-reservations.ts"), "utf8");
  assert.ok(
    src.includes("export async function reserveAppointmentInTransaction") ||
      src.includes("export function reserveAppointmentInTransaction"),
    "expected reserveAppointmentInTransaction to still exist",
  );
  assert.ok(
    src.includes("export async function moveAppointmentInTransaction") ||
      src.includes("export function moveAppointmentInTransaction"),
    "expected moveAppointmentInTransaction to still exist",
  );
  assert.ok(
    !src.includes("hoursError && !confirmed") && !src.includes("hoursError && !input.confirmed"),
    "expected no confirm-gated hours bypass to have been introduced in appointment-reservations.ts",
  );
});
