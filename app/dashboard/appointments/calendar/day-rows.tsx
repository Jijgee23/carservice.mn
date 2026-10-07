import Link from "next/link";
import {
  APPOINTMENT_STATUS_BADGE,
  APPOINTMENT_STATUS_LABEL,
  isAppointmentOverdue,
  type AppointmentStatus,
} from "@/lib/appointments";
import { customerLabel } from "@/lib/customers";
import {
  appointmentAssigneeLabel,
  assigneeOptionsForBranch,
  emptyAssigneeReason,
  type AssigneeCandidate,
} from "@/lib/appointments/appointment-assignee-label";
import type { ScheduleIssue } from "@/lib/branch-schedule";
import {
  type BranchScheduleAppointmentRow,
  type BranchScheduleOrderRow,
} from "@/lib/branch-schedule-loader";
import { ORDER_STATUS_BADGE, ORDER_STATUS_LABEL } from "@/lib/orders";
import {
  AppointmentArrivedButton,
  AppointmentConfirmReject,
  AppointmentNoShowButton,
  AppointmentRescheduleButton,
} from "@/app/dashboard/appointments/appointment-row-actions";
import {
  AppointmentOrderLinkRepair,
  type AppointmentOrderRepairCandidateView,
} from "./appointment-order-link-repair";
import {
  APPOINTMENT_BOOKING_PAYMENT_BADGE,
  APPOINTMENT_BOOKING_PAYMENT_LABEL,
  appointmentBookingPaymentStatus,
} from "@/lib/appointment-payment-status";
import {
  selectAppointmentIntervals,
  SCHEDULE_ISSUE_LABEL,
} from "@/lib/appointments/calendar-selection";

export { SCHEDULE_ISSUE_LABEL };

export function appointmentDisplayName(a: BranchScheduleAppointmentRow): string {
  return customerLabel({
    fullName: a.account?.name ?? a.customer?.fullName,
    phone: a.account?.phone ?? a.customer?.phone,
  });
}

// Still used by app/_actions/schedule-preview.ts (the booking-form preview
// grid, unrelated to the staff calendar's own day view) which continues to
// show order occupancy — only the calendar's day view dropped orders.
export function orderDisplayName(o: BranchScheduleOrderRow): string {
  const vehicle = o.vehicle
    ? `${o.vehicle.plate} · ${o.vehicle.make} ${o.vehicle.model}`
    : null;
  const customer = customerLabel({
    fullName: o.customer?.fullName,
    phone: o.customer?.phone,
  });
  return vehicle ? `${customer} — ${vehicle}` : customer;
}

export function repairCandidateDisplayName(candidate: {
  customer: { fullName: string | null; phone: string | null } | null;
  vehicle: { plate: string; make: string; model: string } | null;
}): string {
  const customer = customerLabel({
    fullName: candidate.customer?.fullName,
    phone: candidate.customer?.phone,
  });
  const vehicle = candidate.vehicle
    ? `${candidate.vehicle.plate} · ${candidate.vehicle.make} ${candidate.vehicle.model}`
    : null;
  return vehicle ? `${customer} — ${vehicle}` : customer;
}

export type DayRow = {
  key: string;
  source: "appointment";
  id: string;
  startMs: number;
  endMs: number;
  endsAtDayBoundary: boolean;
  uncertain: boolean;
  name: string;
  // QA #28: хариуцах мастер (хуучин оноолтыг ч харуулна), байхгүй бол null.
  assigneeName: string | null;
  // Түүхий төлөв — `statusLabel`/`statusClass` нь жагсаалтын badge-д зориулагдсан
  // бол `GridSchedule` блокийн өнгийг төлвөөр (`STATUS_COLOR`) шийддэг тул
  // класс задлан унших биш, enum-ыг нь шууд авна.
  status: AppointmentStatus | null;
  statusLabel: string;
  statusClass: string;
  paymentStatusLabel: string | null;
  paymentStatusClass: string | null;
  issueLabel: string | null;
  actions: React.ReactNode | null;
};

// `DaySchedule` (жагсаалт) болон `GridSchedule` (визуал grid) хоёулаа ижил
// мөрийн тодорхойлолт ашиглана — үйлдлийн товчнуудыг (server action bindings)
// нэг л газар (энд) угсарч, харагдацын код зөвхөн байршуулалтад анхаарна.
// Only appointments (bookings) become rows here — orders/walk-ins are not
// part of this view at all, regardless of who's looking.
export function buildDayRows(
  schedule: {
    intervals: Array<{
      id: string;
      source: "appointment" | "order";
      startMs: number;
      endMs: number;
      uncertain: boolean;
      role: "primary" | "upcoming";
    }>;
    issues: ScheduleIssue[];
    appointments: BranchScheduleAppointmentRow[];
    orders: BranchScheduleOrderRow[];
    repairCandidates: Array<{
      id: string;
      number: string;
      status: "SCHEDULED" | "IN_PROGRESS";
      customerId: string;
      vehicleId: string;
      customer: { fullName: string | null; phone: string | null } | null;
      vehicle: { plate: string; make: string; model: string } | null;
    }>;
    rangeEnd: Date;
  },
  canRespondAppointments: boolean,
  canEditOrders: boolean,
  // Одоогийн хуваарийн хуудасны URL (interval/anchor/branchId г.м. хэвээр) —
  // "Засварын хуудас үүсгэх" линкэд `next`-ээр дамжуулж, захиалга
  // үүсгэсний дараа яг энэ хуудас руу буцаах боломж олгоно.
  returnTo?: string,
  // QA #28: a master-less PENDING appointment needs a master to be confirmed.
  assignees?: { candidates: AssigneeCandidate[]; onlyUserId: string | null },
): { rows: DayRow[]; issues: ScheduleIssue[] } {
  // Selection rule (which interval rows belong to this appointments-only
  // view, and resolving an order-sourced interval back to the appointment it
  // represents) lives in `lib/appointments/calendar-selection.ts`, shared
  // with the API/mobile day model — see that module's doc comment.
  const { rows: selectedRows, issueBySourceId } = selectAppointmentIntervals({
    intervals: schedule.intervals,
    issues: schedule.issues,
    appointments: schedule.appointments,
  });
  const issues = schedule.issues.filter((issue) => issue.source === "appointment");

  const rows: DayRow[] = selectedRows.map((row) => {
      const appt = row.appt;
      const issue = appt ? issueBySourceId.get(`appointment:${appt.id}`) : undefined;
      const name = appt ? appointmentDisplayName(appt) : "—";
      const overdue = appt ? isAppointmentOverdue(appt) : false;
      const statusLabel = appt ? (overdue ? "Хугацаа хэтэрсэн" : APPOINTMENT_STATUS_LABEL[appt.status]) : "";
      const statusClass = appt
        ? overdue
          ? "bg-[var(--oc-panel2)] text-[var(--oc-muted2)] border border-[var(--oc-line)]"
          : APPOINTMENT_STATUS_BADGE[appt.status]
        : "";
      const paymentStatus = appt ? appointmentBookingPaymentStatus(appt) : null;

      const showConfirmReject = appt?.status === "PENDING" && canRespondAppointments;
      const showArrivalActions =
        appt?.status === "CONFIRMED" && canRespondAppointments && !appt.arrivedAt;
      const showCreateOrderLink =
        appt?.status === "CONFIRMED" && canRespondAppointments && !appt.serviceOrderId;
      const repairCandidates: AppointmentOrderRepairCandidateView[] =
        appt?.serviceOrderId && issue?.reason === "missing-order"
          ? schedule.repairCandidates
              .filter(
                (candidate) =>
                  candidate.customerId === appt.customerId &&
                  candidate.vehicleId === appt.vehicleId,
              )
              .map((candidate) => ({
                id: candidate.id,
                number: candidate.number,
                label: repairCandidateDisplayName(candidate),
                statusLabel: ORDER_STATUS_LABEL[candidate.status],
                statusClass: ORDER_STATUS_BADGE[candidate.status],
              }))
          : [];
      const showRepairAction =
        Boolean(appt?.serviceOrderId) &&
        issue?.reason === "missing-order" &&
        canRespondAppointments &&
        canEditOrders;
      const hasActions =
        showConfirmReject || showArrivalActions || showCreateOrderLink || showRepairAction;
      const orderHref = appt
        ? `/dashboard/orders/new?${new URLSearchParams({
            customerId: appt.customerId ?? "",
            vehicleId: appt.vehicleId ?? "",
            branchId: appt.branchId,
            scheduledAt: new Date(row.startMs).toISOString(),
            note: appt.note ?? "",
            appointmentId: appt.id,
            ...(returnTo ? { next: returnTo } : {}),
          }).toString()}`
        : "";

      const actions = hasActions ? (
        <>
          {showConfirmReject && appt ? (
            <AppointmentConfirmReject
              appointmentId={appt.id}
              canConfirm={
                !overdue &&
                (paymentStatus === "NOT_REQUIRED" || paymentStatus === "PAID")
              }
              overdue={overdue}
              needsAssignee={!appt.assignedTo}
              assigneeOptions={
                assignees
                  ? assigneeOptionsForBranch(assignees.candidates, appt.branchId, {
                      onlyUserId: assignees.onlyUserId,
                    })
                  : null
              }
              assigneeEmptyReason={assignees ? emptyAssigneeReason(assignees.onlyUserId) : null}
            />
          ) : null}
          {showArrivalActions && appt ? (
            <>
              <AppointmentArrivedButton appointmentId={appt.id} />
              <AppointmentNoShowButton appointmentId={appt.id} />
              <AppointmentRescheduleButton
                appointmentId={appt.id}
                requestedAt={appt.requestedAt.toISOString()}
              />
            </>
          ) : null}
          {showCreateOrderLink ? (
            <Link
              href={orderHref}
              className="text-xs px-3 py-1.5 rounded-lg border border-[var(--oc-line)] bg-[var(--oc-panel2)] text-[var(--oc-ink2)] hover:border-[var(--oc-line2)] hover:bg-white/[0.05] transition-colors"
            >
              Засварын хуудас үүсгэх →
            </Link>
          ) : null}
          {showRepairAction && appt ? (
            <AppointmentOrderLinkRepair
              appointmentId={appt.id}
              candidates={repairCandidates}
            />
          ) : null}
        </>
      ) : null;

      return {
        key: `${row.source}-${row.id}`,
        source: "appointment" as const,
        // `row.id` is the ORDER id for a row resolved via `appointmentByOrderId`
        // — callers (e.g. grid-schedule.tsx's goToBookingDetail) expect an
        // appointment id here, so always resolve through `appt` when present.
        id: appt?.id ?? row.id,
        startMs: row.startMs,
        endMs: row.endMs,
        endsAtDayBoundary: row.endMs === schedule.rangeEnd.getTime(),
        uncertain: row.uncertain,
        name,
        assigneeName: appointmentAssigneeLabel(appt?.assignedTo),
        status: appt?.status ?? null,
        statusLabel,
        statusClass,
        paymentStatusLabel:
          paymentStatus && paymentStatus !== "NOT_REQUIRED"
            ? APPOINTMENT_BOOKING_PAYMENT_LABEL[paymentStatus]
            : null,
        paymentStatusClass:
          paymentStatus && paymentStatus !== "NOT_REQUIRED"
            ? APPOINTMENT_BOOKING_PAYMENT_BADGE[paymentStatus]
            : null,
        issueLabel: issue ? SCHEDULE_ISSUE_LABEL[issue.reason] : null,
        actions,
      };
    });

  return { rows, issues };
}
