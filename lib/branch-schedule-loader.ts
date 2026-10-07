import { prisma } from "@/lib/prisma";
import { bookingDayBounds } from "@/lib/booking-time";
import {
  buildBranchSchedule,
  orderCanCountForCapacity,
  type ScheduleIssue,
  type ScheduleInterval,
} from "@/lib/branch-schedule";
import { splitScheduleInterval } from "@/lib/schedule-intervals";
import {
  resolveOrderEffectiveInterval,
  resolveHistoricalOrderSessions,
  type OrderTimeBookingLike,
} from "@/lib/schedule-order-interval";
import { isPendingAppointmentPaymentExpired } from "@/lib/appointment-payment-status";
import { DEFAULT_SLOT_MINUTES } from "@/lib/appointment-slots";

/**
 * Loads one branch's real appointment/order rows for a single business-timezone
 * day (Asia/Ulaanbaatar, per lib/booking-time.ts — never the deployment host's
 * clock) and projects them through buildBranchSchedule. Kept in its own module,
 * separate from lib/branch-schedule.ts, because that module is deliberately
 * Prisma-free so its fixture tests (tests/scheduling.test.ts) can run without a
 * DATABASE_URL — importing @/lib/prisma at module scope there broke that.
 *
 * Only active-status rows are normally fetched: appointments still
 * PENDING/CONFIRMED and orders still SCHEDULED/IN_PROGRESS.
 * Terminal orders (COMPLETED/CANCELLED) are additionally fetched when an
 * active appointment points at them, solely to resolve the relationship and
 * avoid a false "missing order" warning. Terminal rows still carry no
 * capacity interval unless a legacy row explicitly says they occupy one.
 *
 * Appointments are floored at `rangeStart` (no carry-over from earlier days) —
 * unlike an order, an appointment has no "still in progress" concept, so a
 * long-stale PENDING/CONFIRMED appointment from months ago must never appear
 * on today's schedule; buildBranchSchedule would otherwise clamp its
 * out-of-range start into today and render a phantom midnight-to-midnight
 * entry (found live: several such stale rows, June/July requestedAt values,
 * all showing as "00:00–00:00" on the day view — this floor is the fix).
 * Orders deliberately keep no lower bound: a still-open job that started
 * before today legitimately keeps occupying capacity today (see
 * buildBranchSchedule's "carry-over active job from yesterday" case) — the
 * overdue/uncertain flags exist precisely to surface a job that's been open
 * unrealistically long, not to hide it.
 */
export type BranchScheduleAppointmentRow = Awaited<
  ReturnType<typeof fetchAppointmentRows>
>[number];
export type BranchScheduleOrderRow = Awaited<
  ReturnType<typeof fetchOrderRows>
>[number] & { carriedOver: boolean; continuesIntoDay: boolean };

export type AppointmentOrderRepairCandidate = {
  id: string;
  number: string;
  status: "SCHEDULED" | "IN_PROGRESS";
  scheduledAt: Date | null;
  customerId: string;
  vehicleId: string;
  customer: { fullName: string | null; phone: string | null } | null;
  vehicle: { plate: string; make: string; model: string } | null;
};

export type BranchScheduleAttentionAppointment = {
  appointment: BranchScheduleAppointmentRow;
  reason: "missing-order" | "linked-order-not-occupying";
};

// Тухайн файлд зөвхөн carriedOver/continuesIntoDay тэмдэглэхэд ашиглана;
// buildBranchSchedule-д дамжуулах өгөгдлийг өөрчлөхгүй. Эх логик нь
// lib/schedule-order-interval.ts-д нэгтгэгдсэн (buildBranchSchedule ба
// category-duration.ts-тэй хуваалцана).
function orderEffectiveDate(o: {
  status: string;
  occupiesCapacity: boolean | null;
  scheduledAt: Date | null;
  startedAt: Date | null;
  estimatedDurationMinutes: number | null;
  expectedFinishAt: Date | null;
}, bookings?: OrderTimeBookingLike[]): Date | null {
  return resolveOrderEffectiveInterval(o, bookings).start;
}

function orderEffectiveEnd(o: {
  status: string;
  occupiesCapacity: boolean | null;
  scheduledAt: Date | null;
  startedAt: Date | null;
  estimatedDurationMinutes: number | null;
  expectedFinishAt: Date | null;
}, fallbackDurationMinutes = DEFAULT_SLOT_MINUTES, bookings?: OrderTimeBookingLike[]): Date | null {
  const resolved = resolveOrderEffectiveInterval(o, bookings);
  if (resolved.end) return resolved.end;
  return resolved.scheduled && resolved.start
    ? new Date(resolved.start.getTime() + fallbackDurationMinutes * 60000)
    : null;
}

/**
 * D-068 read-path swap: fetches every order's OrderTimeBooking rows in one
 * query and groups them by orderId. Passed through to resolveOrderEffectiveInterval
 * (via orderEffectiveDate/orderEffectiveEnd and buildBranchSchedule's
 * orderBookings) so the calendar/attention/conflict projections read from the
 * append-only booking table instead of the ServiceOrder scalar cache.
 */
async function fetchOrderBookings(
  orderIds: string[],
): Promise<Map<string, OrderTimeBookingLike[]>> {
  const map = new Map<string, OrderTimeBookingLike[]>();
  if (orderIds.length === 0) return map;
  const rows = await prisma.orderTimeBooking.findMany({
    where: { orderId: { in: orderIds } },
    select: { orderId: true, kind: true, startAt: true, endAt: true, closedAt: true },
  });
  for (const row of rows) {
    const existing = map.get(row.orderId);
    const entry: OrderTimeBookingLike = { kind: row.kind, startAt: row.startAt, endAt: row.endAt, closedAt: row.closedAt };
    if (existing) existing.push(entry);
    else map.set(row.orderId, [entry]);
  }
  return map;
}

const APPOINTMENT_ROW_SELECT = {
  id: true,
  tenantId: true,
  branchId: true,
  status: true,
  requestedAt: true,
  createdAt: true,
  estimatedDurationMinutes: true,
  serviceOrderId: true,
  arrivedAt: true,
  customerId: true,
  vehicleId: true,
  note: true,
  feeAmount: true,
  feeQpayInvoiceId: true,
  feeUnderpaidAmount: true,
  payment: { select: { status: true } },
  account: { select: { name: true, phone: true } },
  customer: { select: { fullName: true, phone: true } },
  // QA #28: хариуцах мастер (хуучин оноолтыг ч харуулна).
  assignedToId: true,
  assignedTo: { select: { id: true, firstName: true, lastName: true } },
} as const;

function fetchAppointmentRows(
  scope: { tenantId: string; branchId: string },
  rangeStart: Date,
  rangeEnd: Date,
) {
  return prisma.appointment.findMany({
    where: {
      ...scope,
      status: { in: ["PENDING", "CONFIRMED"] },
      requestedAt: { gte: rangeStart, lt: rangeEnd },
    },
    select: APPOINTMENT_ROW_SELECT,
  });
}

/**
 * D-076: orders that are otherwise out of scope (COMPLETED/CANCELLED) but
 * still have an open OrderTimeBooking row — a follow-up that survived the
 * order's own completion (see closeOpenOrderTimeBooking's "ACTIVE"-only
 * scoping on that transition). Without this, such an order is never fetched
 * at all by fetchOrderRows' status filter, so buildBranchSchedule's correct
 * `upcoming`-projection carve-out is unreachable for it in production.
 */
function fetchOrderIdsWithOpenBooking(scope: { tenantId: string; branchId: string }) {
  return prisma.orderTimeBooking
    .findMany({
      where: { ...scope, closedAt: null },
      select: { orderId: true },
      distinct: ["orderId"],
    })
    .then((rows) => rows.map((r) => r.orderId));
}

function fetchOrderRows(
  scope: { tenantId: string; branchId: string },
  rangeEnd: Date,
  linkedOrderIds: string[] = [],
  followUpOrderIds: string[] = [],
) {
  return prisma.serviceOrder.findMany({
    where: {
      ...scope,
      OR: [
        {
          status: { in: ["SCHEDULED", "IN_PROGRESS"] },
          OR: [{ scheduledAt: { lt: rangeEnd } }, { scheduledAt: null }],
        },
        ...(linkedOrderIds.length > 0 ? [{ id: { in: linkedOrderIds } }] : []),
        ...(followUpOrderIds.length > 0 ? [{ id: { in: followUpOrderIds } }] : []),
      ],
    },
    select: {
      id: true,
      number: true,
      tenantId: true,
      branchId: true,
      status: true,
      scheduledAt: true,
      startedAt: true,
      estimatedDurationMinutes: true,
      expectedFinishAt: true,
      occupiesCapacity: true,
      assignedToId: true,
      customerId: true,
      vehicleId: true,
      customer: { select: { fullName: true, phone: true } },
      vehicle: { select: { plate: true, make: true, model: true } },
    },
  });
}

function fetchAppointmentOrderRepairCandidates(
  scope: { tenantId: string; branchId: string },
  appointments: Array<{ customerId: string | null; vehicleId: string | null; serviceOrderId: string | null }>,
) {
  const pairs = appointments
    .filter((a) => a.serviceOrderId && a.customerId && a.vehicleId)
    .map((a) => ({ customerId: a.customerId!, vehicleId: a.vehicleId! }));
  const uniquePairs = Array.from(
    new Map(pairs.map((pair) => [`${pair.customerId}:${pair.vehicleId}`, pair])).values(),
  );
  if (uniquePairs.length === 0) return Promise.resolve([] as AppointmentOrderRepairCandidate[]);

  return prisma.serviceOrder.findMany({
    where: {
      ...scope,
      status: { in: ["SCHEDULED", "IN_PROGRESS"] },
      appointment: null,
      OR: uniquePairs,
    },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      number: true,
      status: true,
      scheduledAt: true,
      customerId: true,
      vehicleId: true,
      customer: { select: { fullName: true, phone: true } },
      vehicle: { select: { plate: true, make: true, model: true } },
    },
  }).then((rows) =>
    rows.map((row) => ({
      ...row,
      status: row.status as AppointmentOrderRepairCandidate["status"],
    })),
  );
}

export async function loadBranchSchedule(input: {
  tenantId: string;
  branchId: string;
  dateStr: string; // YYYY-MM-DD, business timezone
  now?: Date;
}): Promise<{
  intervals: ScheduleInterval[];
  issues: ScheduleIssue[];
  appointments: BranchScheduleAppointmentRow[];
  orders: BranchScheduleOrderRow[];
  repairCandidates: AppointmentOrderRepairCandidate[];
  rangeStart: Date;
  rangeEnd: Date;
}> {
  const { start: rangeStart, end: rangeEnd } = bookingDayBounds(input.dateStr);
  const scope = { tenantId: input.tenantId, branchId: input.branchId };

  const branch = await prisma.branch.findFirst({
    where: { tenantId: scope.tenantId, id: scope.branchId },
    select: { slotMinutes: true },
  });
  const fallbackDurationMinutes =
    branch?.slotMinutes && branch.slotMinutes > 0
      ? branch.slotMinutes
      : DEFAULT_SLOT_MINUTES;
  const appointmentRows = await fetchAppointmentRows(scope, rangeStart, rangeEnd);
  const linkedOrderIds = appointmentRows
    .map((appointment) => appointment.serviceOrderId)
    .filter((id): id is string => Boolean(id));
  const followUpOrderIds = await fetchOrderIdsWithOpenBooking(scope);
  const rawOrderRows = await fetchOrderRows(scope, rangeEnd, linkedOrderIds, followUpOrderIds);
  const repairCandidates = await fetchAppointmentOrderRepairCandidates(scope, appointmentRows);
  // D-068 read-path swap, resumed 2026-09-10 after the backfill/dual-write
  // bugs found by the real-data comparison were fixed (see COWORK.md Inbox)
  // and re-verified at 0 live mismatches.
  const orderBookings = await fetchOrderBookings(rawOrderRows.map((o) => o.id));

  // Бодит эхлэл нь энэ өдрийн цонхноос өмнө бол carriedOver. Харин төгсгөл
  // энэ өдөрт орж ирж байгаа мэдэгдэж буй interval бол хүчинтэй continuation
  // бөгөөд тухайн өдрийн мөрөнд заавал харагдана.
  const orderRows: BranchScheduleOrderRow[] = rawOrderRows.map((o) => {
    const bookings = orderBookings.get(o.id);
    const effectiveDate = orderEffectiveDate(o, bookings);
    const effectiveEnd = orderEffectiveEnd(
      o,
      fallbackDurationMinutes,
      bookings,
    );
    const carriedOver = effectiveDate == null || effectiveDate.getTime() < rangeStart.getTime();
    const continuesIntoDay =
      carriedOver &&
      effectiveDate != null &&
      effectiveEnd != null &&
      splitScheduleInterval(effectiveDate, effectiveEnd).some(
        (segment) => segment.dateStr === input.dateStr && segment.startsBeforeDay,
      );
    return {
      ...o,
      carriedOver,
      continuesIntoDay,
    };
  });

  const { intervals, issues } = buildBranchSchedule({
    ...scope,
    appointments: appointmentRows,
    orders: orderRows,
    now: input.now ?? new Date(),
    rangeStart,
    rangeEnd,
    fallbackDurationMinutes,
    orderBookings,
  });

  return {
    intervals,
    issues,
    appointments: appointmentRows,
    orders: orderRows,
    repairCandidates,
    rangeStart,
    rangeEnd,
  };
}

const HISTORY_ORDER_SELECT = {
  id: true,
  number: true,
  tenantId: true,
  branchId: true,
  status: true,
  scheduledAt: true,
  startedAt: true,
  estimatedDurationMinutes: true,
      expectedFinishAt: true,
      occupiesCapacity: true,
      assignedToId: true,
  customerId: true,
  vehicleId: true,
  customer: { select: { fullName: true, phone: true } },
  vehicle: { select: { plate: true, make: true, model: true } },
} as const;

export type BranchScheduleHistorySession = {
  orderId: string;
  kind: "SCHEDULED" | "ACTIVE";
  start: Date;
  end: Date;
  wasWorked: boolean;
  order: Awaited<ReturnType<typeof fetchHistoryOrders>>[number] | null;
};

function fetchHistoryOrders(scope: { tenantId: string; branchId: string }, orderIds: string[]) {
  // Always issue the (possibly empty `in: []`) query rather than
  // short-circuiting with a manually-typed empty array — that keeps the
  // inferred return type tied to HISTORY_ORDER_SELECT in exactly one place.
  return prisma.serviceOrder.findMany({
    where: { ...scope, id: { in: orderIds } },
    select: HISTORY_ORDER_SELECT,
  });
}

/**
 * S11: historical session loader — the additive sibling to loadBranchSchedule
 * that answers "what actually happened" for a past day/range instead of
 * "what does the branch currently occupy". Unlike fetchOrderRows (which gates
 * on the parent ServiceOrder's CURRENT status being
 * SCHEDULED/IN_PROGRESS, or a still-active appointment/open
 * booking link), this queries OrderTimeBooking directly by its own
 * startAt/endAt overlap against the requested range — so a COMPLETED or
 * CANCELLED order with only closed booking rows for that day is still found.
 * `endAt: null` (an open row, e.g. still-ACTIVE at query time) is treated as
 * open-ended (overlaps anything ending after rangeStart).
 *
 * Deliberately does NOT touch loadBranchSchedule/fetchOrderRows/
 * resolveOrderIntervals — this is a parallel read path for a past range, not
 * a modification of the live-occupancy pipeline.
 */
export async function loadBranchScheduleHistory(input: {
  tenantId: string;
  branchId: string;
  rangeStart: Date;
  rangeEnd: Date;
  now?: Date;
}): Promise<{ sessions: BranchScheduleHistorySession[] }> {
  const scope = { tenantId: input.tenantId, branchId: input.branchId };
  const now = input.now ?? new Date();

  const bookingRows = await prisma.orderTimeBooking.findMany({
    where: {
      ...scope,
      startAt: { lt: input.rangeEnd },
      OR: [{ endAt: null }, { endAt: { gt: input.rangeStart } }],
    },
    select: { orderId: true, kind: true, startAt: true, endAt: true, closedAt: true },
    orderBy: { startAt: "asc" },
  });

  const byOrder = new Map<string, OrderTimeBookingLike[]>();
  for (const row of bookingRows) {
    const entry: OrderTimeBookingLike = { kind: row.kind, startAt: row.startAt, endAt: row.endAt, closedAt: row.closedAt };
    const existing = byOrder.get(row.orderId);
    if (existing) existing.push(entry);
    else byOrder.set(row.orderId, [entry]);
  }

  const orderIds = Array.from(byOrder.keys());
  const orders = await fetchHistoryOrders(scope, orderIds);
  const orderById = new Map(orders.map((o) => [o.id, o]));

  const sessions: BranchScheduleHistorySession[] = [];
  for (const [orderId, bookings] of byOrder) {
    const resolved = resolveHistoricalOrderSessions(
      bookings,
      input.rangeStart,
      input.rangeEnd,
      now,
    );
    for (const session of resolved) {
      sessions.push({
        orderId,
        kind: session.kind,
        start: session.start,
        end: session.end,
        wasWorked: session.wasWorked,
        order: orderById.get(orderId) ?? null,
      });
    }
  }

  sessions.sort((a, b) => a.start.getTime() - b.start.getTime());
  return { sessions };
}

/**
 * All currently uncertain/overdue order occupancy for a branch, regardless of
 * date — the flip side of loadBranchSchedule's per-day view excluding
 * carried-over orders. A stuck order (no estimate, unknown occupancy,
 * overdue) would otherwise repeat identically on every single day paged
 * through from its stale start date onward; this gives it one dedicated,
 * date-independent place instead. Computed by running buildBranchSchedule
 * over a deliberately enormous window (so nothing gets clamped as if it were
 * "carried over" — every order's real date is used as-is) and keeping only
 * the intervals it marks `uncertain`. Orders-only: appointments are already
 * floored to their own day in loadBranchSchedule and have no equivalent
 * indefinite-carry-over failure mode.
 */
export async function loadBranchAttentionOrders(input: {
  tenantId: string;
  branchId: string;
  now?: Date;
}): Promise<{
  intervals: ScheduleInterval[];
  issues: ScheduleIssue[];
  orders: BranchScheduleOrderRow[];
}> {
  const now = input.now ?? new Date();
  const scope = { tenantId: input.tenantId, branchId: input.branchId };
  const rangeStart = new Date(0);
  const rangeEnd = new Date(now.getTime() + 100 * 365 * 24 * 60 * 60 * 1000);

  const branch = await prisma.branch.findFirst({
    where: { tenantId: scope.tenantId, id: scope.branchId },
    select: { slotMinutes: true },
  });
  const fallbackDurationMinutes =
    branch?.slotMinutes && branch.slotMinutes > 0
      ? branch.slotMinutes
      : DEFAULT_SLOT_MINUTES;
  const rawOrderRows = await fetchOrderRows(scope, rangeEnd);
  const orderBookings = await fetchOrderBookings(rawOrderRows.map((o) => o.id));
  const orderRows: BranchScheduleOrderRow[] = rawOrderRows.map((o) => ({
    ...o,
    carriedOver: false, // энд утга алга — attention харагдац өөрөө date-агнаст
    continuesIntoDay: false,
  }));

  const { intervals, issues } = buildBranchSchedule({
    ...scope,
    appointments: [],
    orders: orderRows,
    now,
    rangeStart,
    rangeEnd,
    fallbackDurationMinutes,
    orderBookings,
  });

  const uncertainIds = new Set(
    intervals.filter((i) => i.uncertain).map((i) => i.id),
  );
  return {
    intervals: intervals.filter((i) => i.uncertain),
    issues: issues.filter((issue) => uncertainIds.has(issue.id)),
    orders: orderRows.filter((o) => uncertainIds.has(o.id)),
  };
}

/**
 * PENDING appointments whose booking fee has gone unpaid past
 * PENDING_APPOINTMENT_PAYMENT_TTL_MINUTES, plus active appointments whose
 * linked order is missing or no longer contributes capacity. These are kept
 * separate from uncertain/overdue order occupancy because they are appointment
 * or relationship housekeeping rather than a stuck order interval.
 */
export async function loadBranchAttentionAppointments(input: {
  tenantId: string;
  branchId: string;
  now?: Date;
}): Promise<{
  appointments: BranchScheduleAppointmentRow[];
  inconsistentAppointments: BranchScheduleAttentionAppointment[];
}> {
  const now = input.now ?? new Date();
  const [expiredRows, linkedRows] = await Promise.all([
    prisma.appointment.findMany({
      where: {
        tenantId: input.tenantId,
        branchId: input.branchId,
        status: "PENDING",
        feeAmount: { not: null },
      },
      select: APPOINTMENT_ROW_SELECT,
    }),
    prisma.appointment.findMany({
      where: {
        tenantId: input.tenantId,
        branchId: input.branchId,
        status: { in: ["PENDING", "CONFIRMED"] },
        serviceOrderId: { not: null },
      },
      select: {
        ...APPOINTMENT_ROW_SELECT,
        serviceOrder: {
          select: {
            tenantId: true,
            branchId: true,
            status: true,
            occupiesCapacity: true,
          },
        },
      },
    }),
  ]);
  const appointments = expiredRows.filter((a) => isPendingAppointmentPaymentExpired(a, now));
  const expiredIds = new Set(appointments.map((a) => a.id));
  const linkedOrderContributesCapacity = (order: {
    tenantId: string;
    branchId: string;
    status: string;
    occupiesCapacity: boolean | null;
  } | null) => {
    if (!order) return false;
    return (
      order.tenantId === input.tenantId &&
      order.branchId === input.branchId &&
      orderCanCountForCapacity(order as Parameters<typeof orderCanCountForCapacity>[0])
    );
  };
  const linkedOrderMatchesScope = (order: {
    tenantId: string;
    branchId: string;
  } | null) =>
    Boolean(
      order &&
      order.tenantId === input.tenantId &&
      order.branchId === input.branchId,
    );
  const inconsistentAppointments = linkedRows
    .filter(
      (row) =>
        !expiredIds.has(row.id) &&
        !linkedOrderContributesCapacity(row.serviceOrder),
    )
    .map((row) => ({
      appointment: row,
      reason: row.serviceOrder && linkedOrderMatchesScope(row.serviceOrder)
        ? ("linked-order-not-occupying" as const)
        : ("missing-order" as const),
    }));
  return { appointments, inconsistentAppointments };
}
