// GET /api/v1/home-ийн JSON хэлбэр. PURE: Decimal → string, Date → ISO. Вэбийн
// dashboard-тай ИЖИЛ loadDashboardFocus + resolveHomeLayout-ийг ашигладаг тул апп
// нь вэбтэй яг ижил дүр, ижил тоог харна.

import type { DashboardFocus } from "@/lib/dashboard-focus";
import type { HomeLayout } from "@/lib/dashboard-persona";

export function serializeHome(layout: HomeLayout, focus: DashboardFocus) {
  const { orders, appointments, payments, reviews, access } = focus;
  return {
    persona: layout.persona,
    layout: {
      headline: layout.headline,
      attention: layout.attention,
      kpis: layout.kpis,
      main: layout.main,
      side: layout.side,
      income: layout.income,
      recent: layout.recent,
      base: layout.base,
      actions: layout.actions,
    },
    // Эрхгүй хэсэг false — апп энэ хэсгийг харуулахгүй (layout-д байсан ч).
    access,
    orders: {
      scheduled: orders.scheduled,
      inProgress: orders.inProgress,
      createdToday: orders.createdToday,
      staleScheduled: orders.staleScheduled,
      ready: orders.ready,
      overdue: orders.overdue,
      unfilledDiagnostics: orders.unfilledDiagnostics,
      top: orders.top.map((o) => ({
        id: o.id,
        number: o.number,
        customerName: o.customerName,
        plate: o.plate,
        vehicle: o.vehicle,
        masterName: o.masterName,
        expectedFinishAt: o.expectedFinishAt?.toISOString() ?? null,
        overdue: o.overdue,
        work: o.work,
      })),
      workload: orders.workload,
      monthCompleted: orders.monthCompleted,
      monthRevenue: orders.monthRevenue.toString(),
      monthAverage: orders.monthAverage?.toString() ?? null,
      receivable: {
        total: orders.receivable.total.toString(),
        count: orders.receivable.count,
        buckets: orders.receivable.buckets.map((b) => b.toString()),
      },
    },
    appointments: {
      today: appointments.today.map((a) => ({
        id: a.id,
        requestedAt: a.requestedAt.toISOString(),
        status: a.status,
        arrived: a.arrived,
        converted: a.converted,
        name: a.name,
        plate: a.plate,
        masterName: a.masterName,
      })),
      pending: appointments.pending,
    },
    payments: {
      total: payments.total.toString(),
      count: payments.count,
      byMethod: payments.byMethod.map((m) => ({ method: m.method, amount: m.amount.toString(), count: m.count })),
    },
    reviews,
  };
}
