import assert from "node:assert/strict";
import { before, test } from "node:test";

process.env.DATABASE_URL ??= "postgresql://unused/unused";
process.env.SESSION_SECRET ??= "unit-test-placeholder-secret-value-not-real-00";

let serializeHome: typeof import("../lib/dashboard-home-dto").serializeHome;
let homeLayoutFor: typeof import("../lib/dashboard-persona").homeLayoutFor;
let Prisma: typeof import("../app/generated/prisma/client").Prisma;

before(async () => {
  ({ serializeHome } = await import("../lib/dashboard-home-dto"));
  ({ homeLayoutFor } = await import("../lib/dashboard-persona"));
  ({ Prisma } = await import("../app/generated/prisma/client"));
});

function focus() {
  const D = (n: number) => new Prisma.Decimal(n);
  return {
    access: { orders: true, appointments: true, payments: true, reviews: false },
    orders: {
      scheduled: 2, inProgress: 3, createdToday: 1, staleScheduled: 0, ready: 1, overdue: 1, unfilledDiagnostics: 0,
      top: [{
        id: "o1", number: "5", customerName: "Бат", plate: "1234УБА", vehicle: "Toyota Prius",
        masterName: null, expectedFinishAt: new Date("2026-11-18T05:00:00Z"), overdue: true,
        work: { active: 2, done: 1, unfilledDiagnostics: 0, ready: false, percent: 50 },
      }, {
        id: "o2", number: "6", customerName: "Дорж", plate: "5678УНА", vehicle: "Honda Fit",
        masterName: "Бат Д", expectedFinishAt: null, overdue: false,
        work: { active: 1, done: 1, unfilledDiagnostics: 0, ready: true, percent: 100 },
      }],
      workload: [{ id: "u1", name: "Бат", count: 2, overdue: 1 }],
      monthCompleted: 4, monthRevenue: D(1200000), monthAverage: D(300000),
      receivable: { total: D(150000), count: 2, buckets: [D(100000), D(50000), D(0)] as [typeof Prisma.Decimal.prototype, typeof Prisma.Decimal.prototype, typeof Prisma.Decimal.prototype] },
    },
    appointments: {
      today: [{ id: "a1", requestedAt: new Date("2026-11-18T02:00:00Z"), status: "CONFIRMED", arrived: false, converted: false, name: "Сараа", plate: null, masterName: null }],
      pending: 1,
    },
    payments: { total: D(80000), count: 2, byMethod: [{ method: "CASH", amount: D(80000), count: 2 }] },
    reviews: { average: null, count: 0, unreplied: 0 },
  };
}

test("serializes Decimal to string and Date to ISO; result is JSON round-trippable", () => {
  const dto = serializeHome(homeLayoutFor("manager"), focus());
  const round = JSON.parse(JSON.stringify(dto));
  assert.deepEqual(round, dto);
  assert.equal(dto.orders.monthRevenue, "1200000");
  assert.equal(dto.orders.monthAverage, "300000");
  assert.equal(dto.orders.receivable.total, "150000");
  assert.deepEqual(dto.orders.receivable.buckets, ["100000", "50000", "0"]);
  assert.equal(dto.orders.top[0].expectedFinishAt, "2026-11-18T05:00:00.000Z");
  assert.equal(dto.orders.top[1].expectedFinishAt, null);
  assert.equal(dto.appointments.today[0].requestedAt, "2026-11-18T02:00:00.000Z");
  assert.equal(dto.payments.total, "80000");
  assert.equal(dto.payments.byMethod[0].amount, "80000");
});

test("carries persona and layout so the app renders the same home as the web", () => {
  const dto = serializeHome(homeLayoutFor("mechanic"), focus());
  assert.equal(dto.persona, "mechanic");
  assert.deepEqual(dto.layout.main, ["work"]);
  assert.deepEqual(dto.layout.side, []);
  assert.equal(dto.layout.income, false);
  assert.deepEqual(dto.access, { orders: true, appointments: true, payments: true, reviews: false });
});

test("null monthAverage stays null", () => {
  const f = focus();
  f.orders.monthAverage = null as never;
  assert.equal(serializeHome(homeLayoutFor("cashier"), f).orders.monthAverage, null);
});
