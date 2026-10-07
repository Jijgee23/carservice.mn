/**
 * Calendar day-grid TRUTH — pure, serializable model for one branch's one
 * business-local day. Extracted per TENANT_MOBILE_SLICES.md P2-B4 so a
 * Flutter renderer never has to reimplement the heuristics currently inline
 * in `app/dashboard/appointments/calendar/grid-schedule.tsx` (status colour,
 * block title, open-ended/day-boundary handling, capacity overflow, legend).
 *
 * This module does NOT touch Prisma. It consumes the already-resolved output
 * of `lib/branch-schedule-loader.ts`'s `loadBranchSchedule` (which itself
 * projects through the Prisma-free `lib/branch-schedule.ts` /
 * `buildBranchSchedule` — the authority for D-110 terminal-linked-order
 * suppression and missing-link issue retention: a booking whose linked order
 * is COMPLETED/CANCELLED never reaches this module's `intervals`/`issues` at
 * all, while a MISSING linked order still arrives as a `missing-order`
 * issue). Lane/pixel geometry stays a renderer concern — this module only
 * reuses `assignLanes` to decide whether a block sits in an
 * over-capacity lane, never to compute layout percentages.
 *
 * The appointment-row selection (which interval rows belong to the
 * appointments-only day view, resolving an order-sourced interval back to
 * its linked appointment) and the schedule-issue labels now live in
 * `lib/appointments/calendar-selection.ts`, shared with
 * `app/dashboard/appointments/calendar/day-rows.tsx`'s `buildDayRows`
 * (P2-B4/P2-X1). That file stays a page-local React component (JSX,
 * "use client" `GridSchedule` import, server action bindings for row action
 * buttons) that an API route cannot import — only the pure selection rule
 * and the label data were extracted; its JSX and action wiring did not move.
 */

import { customerLabel } from "@/lib/customers";
import {
  APPOINTMENT_STATUS_LABEL,
  type AppointmentStatus,
} from "@/lib/appointments";
import {
  APPOINTMENT_BOOKING_PAYMENT_LABEL,
  appointmentBookingPaymentStatus,
  type AppointmentBookingPaymentStatus,
} from "@/lib/appointment-payment-status";
import type { ScheduleInterval, ScheduleIssue } from "@/lib/branch-schedule";
import { assignLanes } from "@/lib/schedule-grid-layout";
import {
  selectAppointmentIntervals,
  SCHEDULE_ISSUE_LABEL,
} from "@/lib/appointments/calendar-selection";

import { appointmentAssigneeLabel } from "@/lib/appointments/appointment-assignee-label";

export { SCHEDULE_ISSUE_LABEL };

export type CalendarAppointmentRow = {
  id: string;
  status: AppointmentStatus;
  requestedAt: Date;
  serviceOrderId: string | null;
  account: { name: string | null; phone: string | null } | null;
  customer: { fullName: string | null; phone: string | null } | null;
  /** QA #28 — optional so older callers/fixtures keep type-checking. */
  assignedToId?: string | null;
  assignedTo?: { id?: string; firstName: string | null; lastName: string | null } | null;
  feeAmount: unknown;
  feeQpayInvoiceId: string | null;
  feeUnderpaidAmount: unknown;
  payment: { status: string } | null;
};

export type CalendarDayModelInput = {
  branchId: string;
  branchName: string | null;
  dateKey: string; // YYYY-MM-DD, business-local (Asia/Ulaanbaatar)
  rangeStart: Date;
  rangeEnd: Date;
  intervals: readonly ScheduleInterval[];
  issues: readonly ScheduleIssue[];
  appointments: readonly CalendarAppointmentRow[];
  /** Branch's configured concurrent-slot count; always >= 1 for layout purposes. */
  slotCapacity: number;
};

export type CalendarBlockIssue = {
  reason: ScheduleIssue["reason"];
  label: string;
};

export type CalendarBlock = {
  key: string;
  appointmentId: string;
  laneIndex: number;
  /** ISO 8601 instants — mobile is expected to render them in Asia/Ulaanbaatar. */
  startAt: string;
  endAt: string;
  /**
   * True once a precise finish time is known. False for any block whose
   * duration/finish is not actually established (unknown/open-ended work) —
   * DISTINCT from `endsAtDayBoundary` below: a block can have a known finish
   * that simply happens to be exactly midnight, or an unknown finish that
   * was clipped to midnight only because the day window ends there.
   */
  finishKnown: boolean;
  /**
   * True when this block's end coincides with the end of the requested
   * business day (midnight). A renderer must not present that end as a
   * precise in-day finish even when `finishKnown` is true.
   */
  endsAtDayBoundary: boolean;
  status: AppointmentStatus | null;
  statusLabel: string;
  name: string;
  /** QA #28: responsible master id/name (null when none). */
  assignedToId: string | null;
  assigneeName: string | null;
  paymentStatus: AppointmentBookingPaymentStatus | null;
  paymentStatusLabel: string | null;
  issue: CalendarBlockIssue | null;
  /** True when this block's lane falls outside the branch's configured slot capacity. */
  capacityOverflow: boolean;
  /**
   * Full accessible label — every fact the block conveys visually (time
   * range, name, status, payment, issue, overflow) in one string, so a
   * narrow renderer may drop visible content without losing meaning.
   */
  accessibleLabel: string;
};

export type CalendarLegendEntry =
  | { kind: "status"; status: AppointmentStatus; label: string }
  | { kind: "issue"; reason: ScheduleIssue["reason"]; label: string };

export type CalendarDayModel = {
  branchId: string;
  branchName: string | null;
  dateKey: string;
  rangeStart: string;
  rangeEnd: string;
  slotCapacity: number;
  /** Highest lane index in use + 1 — always >= slotCapacity for grid sizing. */
  laneCount: number;
  hasCapacityOverflow: boolean;
  blocks: CalendarBlock[];
  legend: CalendarLegendEntry[];
};

function fmtUbTime(ms: number): string {
  return new Intl.DateTimeFormat("mn-MN", {
    timeZone: "Asia/Ulaanbaatar",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(ms));
}

function buildAccessibleLabel(block: {
  startMs: number;
  endMs: number;
  finishKnown: boolean;
  endsAtDayBoundary: boolean;
  name: string;
  statusLabel: string;
  paymentStatusLabel: string | null;
  issue: CalendarBlockIssue | null;
  capacityOverflow: boolean;
}): string {
  const end = !block.finishKnown
    ? "тодорхойгүй"
    : block.endsAtDayBoundary
      ? "24:00"
      : fmtUbTime(block.endMs);
  const parts = [`${fmtUbTime(block.startMs)}–${end}`, block.name];
  if (block.statusLabel) parts.push(block.statusLabel);
  if (block.paymentStatusLabel) parts.push(block.paymentStatusLabel);
  if (block.issue) parts.push(`Анхаарах: ${block.issue.label}`);
  if (block.capacityOverflow) parts.push("Салбарын багтаамжаас хэтэрсэн");
  return parts.join(" · ");
}

/**
 * Builds the full, serializable day-grid truth model for one branch/day.
 * Pure — no I/O, no Date.now() (a `now` boundary was already baked into
 * `intervals`/`issues` by `buildBranchSchedule`), safe to unit-test without a
 * database.
 */
export function buildCalendarDayModel(input: CalendarDayModelInput): CalendarDayModel {
  const rangeStartMs = input.rangeStart.getTime();
  const rangeEndMs = input.rangeEnd.getTime();
  if (!Number.isFinite(rangeStartMs) || !Number.isFinite(rangeEndMs) || rangeEndMs <= rangeStartMs) {
    throw new RangeError("Invalid calendar day range");
  }
  const slotCapacity = Math.max(1, Math.trunc(input.slotCapacity) || 1);

  const { rows, issueBySourceId } = selectAppointmentIntervals(input);
  const laned = assignLanes(rows);
  const laneCount = Math.max(slotCapacity, 1, ...laned.map((r) => r.lane + 1));

  const blocks: CalendarBlock[] = laned.map((row) => {
    const appt = row.appt;
    const issueRecord = appt ? issueBySourceId.get(`appointment:${appt.id}`) : undefined;
    const issue: CalendarBlockIssue | null = issueRecord
      ? { reason: issueRecord.reason, label: SCHEDULE_ISSUE_LABEL[issueRecord.reason] }
      : null;
    const name = appt
      ? customerLabel({
          fullName: appt.account?.name ?? appt.customer?.fullName,
          phone: appt.account?.phone ?? appt.customer?.phone,
        })
      : "—";
    const status = appt?.status ?? null;
    const statusLabel = status ? APPOINTMENT_STATUS_LABEL[status] : "Тодорхойгүй";
    const paymentStatus = appt ? appointmentBookingPaymentStatus(appt) : null;
    const showPaymentStatus = paymentStatus && paymentStatus !== "NOT_REQUIRED";
    const finishKnown = !row.uncertain;
    const endsAtDayBoundary = row.endMs === rangeEndMs;
    const capacityOverflow = row.lane >= slotCapacity;

    const base = {
      startMs: row.startMs,
      endMs: row.endMs,
      finishKnown,
      endsAtDayBoundary,
      name,
      statusLabel,
      paymentStatusLabel: showPaymentStatus
        ? APPOINTMENT_BOOKING_PAYMENT_LABEL[paymentStatus]
        : null,
      issue,
      capacityOverflow,
    };

    return {
      key: `${row.source}-${row.id}`,
      appointmentId: appt?.id ?? row.id,
      laneIndex: row.lane,
      startAt: new Date(row.startMs).toISOString(),
      endAt: new Date(row.endMs).toISOString(),
      finishKnown,
      endsAtDayBoundary,
      status,
      statusLabel,
      name,
      assignedToId: appt?.assignedToId ?? null,
      assigneeName: appointmentAssigneeLabel(appt?.assignedTo),
      paymentStatus: showPaymentStatus ? paymentStatus : null,
      paymentStatusLabel: base.paymentStatusLabel,
      issue,
      capacityOverflow,
      accessibleLabel: buildAccessibleLabel(base),
    };
  });

  // Legend restricted to statuses AND issues actually present that day —
  // two independent dimensions (a block can contribute to both: e.g. a
  // CONFIRMED booking with a missing-estimate issue shows in both sets).
  const statusSeen = new Map<AppointmentStatus, string>();
  const issueSeen = new Map<ScheduleIssue["reason"], string>();
  for (const block of blocks) {
    if (block.status) statusSeen.set(block.status, block.statusLabel);
    if (block.issue) issueSeen.set(block.issue.reason, block.issue.label);
  }
  const legend: CalendarLegendEntry[] = [
    ...[...statusSeen.entries()].map(
      ([status, label]): CalendarLegendEntry => ({ kind: "status", status, label }),
    ),
    ...[...issueSeen.entries()].map(
      ([reason, label]): CalendarLegendEntry => ({ kind: "issue", reason, label }),
    ),
  ];

  return {
    branchId: input.branchId,
    branchName: input.branchName,
    dateKey: input.dateKey,
    rangeStart: input.rangeStart.toISOString(),
    rangeEnd: input.rangeEnd.toISOString(),
    slotCapacity,
    laneCount,
    hasCapacityOverflow: laneCount > slotCapacity,
    blocks,
    legend,
  };
}
