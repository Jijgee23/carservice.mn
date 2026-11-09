// Хяналтын самбарын «Анхаарах», «Өнөөдөр», «Мөнгө» хэсгийн өгөгдөл.
// Бүх тоо тухайн хэрэглэгчийн харж чадах хүрээнд: ажлын салбар
// (workingBranchScopeId), захиалгын харагдац (orderReadWhere — мастер өөрийнхөө),
// модуль бүрийн харах эрх (canView). Өдрийн хил — Asia/Ulaanbaatar (bookingDayBounds).

import { Prisma } from "@/app/generated/prisma/client";
import type { requireUser } from "@/lib/auth";
import { orderReadWhere } from "@/lib/auth/order-access";
import { canView, workingBranchScopeId } from "@/lib/auth/roles";
import { bookingDateKey, bookingDayBounds } from "@/lib/booking-time";
import { customerLabel } from "@/lib/customers";
import {
  orderWorkState,
  receivableAging,
  workloadByMaster,
  type OrderWorkState,
  type ReceivableAging,
  type WorkloadRow,
} from "@/lib/dashboard-focus-shared";
import { RECEIVABLE_ORDER_SELECT, RECEIVABLE_ORDER_WHERE } from "@/lib/orders/order-receivable";
import { prisma } from "@/lib/prisma";

type User = Awaited<ReturnType<typeof requireUser>>;

const IN_PROGRESS_LIMIT = 200;
const APPOINTMENT_LIMIT = 40;

export type FocusOrder = {
  id: string;
  number: string;
  customerName: string;
  plate: string;
  vehicle: string;
  masterName: string | null;
  expectedFinishAt: Date | null;
  overdue: boolean;
  work: OrderWorkState;
};

export type FocusAppointment = {
  id: string;
  requestedAt: Date;
  status: string;
  arrived: boolean;
  converted: boolean;
  name: string;
  plate: string | null;
  masterName: string | null;
};

export type PaymentMethodTotal = { method: string; amount: Prisma.Decimal; count: number };

export type DashboardFocus = {
  access: { orders: boolean; appointments: boolean; payments: boolean; reviews: boolean };
  orders: {
    scheduled: number;
    inProgress: number;
    createdToday: number;
    staleScheduled: number;
    ready: number;
    overdue: number;
    unfilledDiagnostics: number;
    /** Анхаарах эрэмбээр: хэтэрсэн → бэлэн → дуусах хугацаагаар. */
    top: FocusOrder[];
    workload: WorkloadRow[];
    monthCompleted: number;
    monthRevenue: Prisma.Decimal;
    monthAverage: Prisma.Decimal | null;
    receivable: ReceivableAging;
  };
  appointments: { today: FocusAppointment[]; pending: number };
  payments: { total: Prisma.Decimal; count: number; byMethod: PaymentMethodTotal[] };
  reviews: { average: number | null; count: number; unreplied: number };
};

function personName(p: { firstName: string; lastName: string } | null): string | null {
  return p ? `${p.lastName} ${p.firstName}`.trim() : null;
}

export async function loadDashboardFocus(user: User, now = new Date()): Promise<DashboardFocus> {
  const todayKey = bookingDateKey(now);
  const { start: todayStart, end: tomorrowStart } = bookingDayBounds(todayKey);
  const monthStart = bookingDayBounds(`${todayKey.slice(0, 8)}01`).start;

  const scope = workingBranchScopeId(user);
  const branchWhere = scope ? { branchId: scope } : {};
  const access = {
    orders: canView(user, "orders"),
    appointments: canView(user, "appointments"),
    payments: canView(user, "payments"),
    // Үнэлгээний хуудас «Үйлчлүүлэгч» харах эрхээр хамгаалагдсан.
    reviews: canView(user, "customers"),
  };
  const orderWhere: Prisma.ServiceOrderWhereInput = {
    tenantId: user.tenantId,
    ...branchWhere,
    ...orderReadWhere(user),
  };
  const todayRange = { gte: todayStart, lt: tomorrowStart };

  const [
    inProgressRows,
    scheduled,
    createdToday,
    staleScheduled,
    monthAgg,
    receivableRows,
    appointmentRows,
    pendingAppointments,
    paymentGroups,
    reviewAgg,
    unrepliedReviews,
  ] = await Promise.all([
    access.orders
      ? prisma.serviceOrder.findMany({
          where: { ...orderWhere, status: "IN_PROGRESS" },
          orderBy: [{ expectedFinishAt: { sort: "asc", nulls: "last" } }, { startedAt: "asc" }],
          take: IN_PROGRESS_LIMIT,
          select: {
            id: true,
            number: true,
            expectedFinishAt: true,
            assignedTo: { select: { id: true, firstName: true, lastName: true } },
            customer: { select: { fullName: true, phone: true } },
            vehicle: { select: { plate: true, make: true, model: true } },
            items: { select: { status: true, kind: true, diagnosticReportId: true } },
          },
        })
      : Promise.resolve([]),
    access.orders ? prisma.serviceOrder.count({ where: { ...orderWhere, status: "SCHEDULED" } }) : Promise.resolve(0),
    access.orders ? prisma.serviceOrder.count({ where: { ...orderWhere, createdAt: todayRange } }) : Promise.resolve(0),
    // Товлосон өдөр нь өнгөрсөн ч эхлээгүй хуудас.
    access.orders
      ? prisma.serviceOrder.count({ where: { ...orderWhere, status: "SCHEDULED", scheduledAt: { lt: todayStart } } })
      : Promise.resolve(0),
    access.orders
      ? prisma.serviceOrder.aggregate({
          where: { ...orderWhere, status: "COMPLETED", isInternal: false, completedAt: { gte: monthStart } },
          _sum: { totalAmount: true },
          _count: { _all: true },
        })
      : Promise.resolve(null),
    access.orders
      ? prisma.serviceOrder.findMany({
          where: { ...orderWhere, ...RECEIVABLE_ORDER_WHERE },
          select: { ...RECEIVABLE_ORDER_SELECT, completedAt: true },
        })
      : Promise.resolve([]),
    access.appointments
      ? prisma.appointment.findMany({
          where: {
            tenantId: user.tenantId,
            ...branchWhere,
            requestedAt: todayRange,
            status: { in: ["PENDING", "CONFIRMED", "NO_SHOW"] },
          },
          orderBy: { requestedAt: "asc" },
          take: APPOINTMENT_LIMIT,
          select: {
            id: true,
            requestedAt: true,
            status: true,
            arrivedAt: true,
            serviceOrderId: true,
            account: { select: { name: true } },
            customer: { select: { fullName: true } },
            vehicle: { select: { plate: true } },
            assignedTo: { select: { firstName: true, lastName: true } },
          },
        })
      : Promise.resolve([]),
    // Хариу хүлээж буй (өнөөдрөөс хойших) онлайн цаг захиалга.
    access.appointments
      ? prisma.appointment.count({
          where: { tenantId: user.tenantId, ...branchWhere, status: "PENDING", requestedAt: { gte: todayStart } },
        })
      : Promise.resolve(0),
    // Өнөөдөр бодитоор хүлээн авсан мөнгө (PAID), төлбөрийн аргаар.
    access.payments
      ? prisma.orderPayment.groupBy({
          by: ["method"],
          where: {
            tenantId: user.tenantId,
            status: "PAID",
            ...(scope ? { order: { branchId: scope } } : {}),
            OR: [{ paidAt: todayRange }, { paidAt: null, createdAt: todayRange }],
          },
          _sum: { amount: true },
          _count: { _all: true },
        })
      : Promise.resolve([]),
    access.reviews
      ? prisma.review.aggregate({
          where: { tenantId: user.tenantId, ...branchWhere, hidden: false },
          _avg: { rating: true },
          _count: { _all: true },
        })
      : Promise.resolve(null),
    access.reviews
      ? prisma.review.count({ where: { tenantId: user.tenantId, ...branchWhere, hidden: false, reply: null } })
      : Promise.resolve(0),
  ]);

  const inProgress = inProgressRows.map((o) => {
    const overdue = Boolean(o.expectedFinishAt && o.expectedFinishAt.getTime() < now.getTime());
    return {
      order: o,
      overdue,
      work: orderWorkState(o.items),
    };
  });
  const rank = (x: (typeof inProgress)[number]) => (x.overdue ? 0 : x.work.ready ? 1 : 2);
  const top: FocusOrder[] = [...inProgress]
    .sort((a, b) => rank(a) - rank(b))
    .slice(0, 6)
    .map(({ order: o, overdue, work }) => ({
      id: o.id,
      number: o.number,
      // Нэргүй үйлчлүүлэгч → утас (эсвэл «Нэргүй»).
      customerName: customerLabel(o.customer),
      plate: o.vehicle.plate,
      vehicle: `${o.vehicle.make} ${o.vehicle.model}`.trim(),
      masterName: personName(o.assignedTo),
      expectedFinishAt: o.expectedFinishAt,
      overdue,
      work,
    }));

  const monthCompleted = monthAgg?._count._all ?? 0;
  const monthRevenue = new Prisma.Decimal(monthAgg?._sum.totalAmount ?? 0);

  const byMethod: PaymentMethodTotal[] = paymentGroups
    .map((g) => ({ method: g.method, amount: new Prisma.Decimal(g._sum.amount ?? 0), count: g._count._all }))
    .sort((a, b) => b.amount.comparedTo(a.amount));

  return {
    access,
    orders: {
      scheduled,
      inProgress: inProgressRows.length,
      createdToday,
      staleScheduled,
      ready: inProgress.filter((x) => x.work.ready).length,
      overdue: inProgress.filter((x) => x.overdue).length,
      unfilledDiagnostics: inProgress.reduce((sum, x) => sum + x.work.unfilledDiagnostics, 0),
      top,
      workload: workloadByMaster(inProgress.map((x) => ({ assignedTo: x.order.assignedTo, overdue: x.overdue }))),
      monthCompleted,
      monthRevenue,
      monthAverage: monthCompleted > 0 ? monthRevenue.div(monthCompleted) : null,
      receivable: receivableAging(receivableRows, now),
    },
    appointments: {
      today: appointmentRows.map((a) => ({
        id: a.id,
        requestedAt: a.requestedAt,
        status: a.status,
        arrived: Boolean(a.arrivedAt),
        converted: Boolean(a.serviceOrderId),
        name: a.account?.name?.trim() || a.customer?.fullName?.trim() || "Нэргүй",
        plate: a.vehicle?.plate ?? null,
        masterName: personName(a.assignedTo),
      })),
      pending: pendingAppointments,
    },
    payments: {
      total: byMethod.reduce((sum, m) => sum.plus(m.amount), new Prisma.Decimal(0)),
      count: byMethod.reduce((sum, m) => sum + m.count, 0),
      byMethod,
    },
    reviews: {
      average: reviewAgg?._avg.rating ?? null,
      count: reviewAgg?._count._all ?? 0,
      unreplied: unrepliedReviews,
    },
  };
}
