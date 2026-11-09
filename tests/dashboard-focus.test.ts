import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Prisma } from "../app/generated/prisma/client";
import { orderWorkState, receivableAging, workloadByMaster } from "../lib/dashboard-focus-shared";

const D = (n: number | string) => new Prisma.Decimal(n);
const DAY = 86_400_000;

function readSource(relativePath: string): string {
  return readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), relativePath), "utf8");
}

// --- orderWorkState --------------------------------------------------------

test("orderWorkState: parts and cancelled rows are excluded from progress", () => {
  const s = orderWorkState([
    { status: "COMPLETED", kind: "LABOR", diagnosticReportId: null },
    { status: "PENDING", kind: "PART", diagnosticReportId: null },
    { status: "CANCELLED", kind: "LABOR", diagnosticReportId: null },
  ]);
  assert.deepEqual(s, { active: 1, done: 1, unfilledDiagnostics: 0, ready: true, percent: 100 });
});

test("orderWorkState: an unfilled diagnostic blocks 'ready' even when all rows are done", () => {
  const s = orderWorkState([
    { status: "COMPLETED", kind: "LABOR", diagnosticReportId: null },
    { status: "COMPLETED", kind: "DIAGNOSTIC", diagnosticReportId: null },
  ]);
  assert.equal(s.unfilledDiagnostics, 1);
  assert.equal(s.ready, false);
});

test("orderWorkState: an order without work rows is never 'ready'", () => {
  const s = orderWorkState([{ status: "PENDING", kind: "PART", diagnosticReportId: null }]);
  assert.equal(s.active, 0);
  assert.equal(s.ready, false);
  assert.equal(s.percent, 0);
});

// --- receivableAging -------------------------------------------------------

test("receivableAging: buckets outstanding balance by days since completion", () => {
  const now = new Date("2026-11-09T12:00:00+08:00");
  const at = (days: number) => new Date(now.getTime() - days * DAY);
  const r = receivableAging(
    [
      { completedAt: at(5), totalAmount: D(100), payments: [{ amount: D(40) }] }, // 60 → 0–30
      { completedAt: at(45), totalAmount: D(200), payments: [] }, // 200 → 31–60
      { completedAt: at(90), totalAmount: D(300), payments: [] }, // 300 → 60+
      { completedAt: at(10), totalAmount: D(50), payments: [{ amount: D(50) }] }, // paid → ignored
      { completedAt: at(10), totalAmount: D(50), payments: [{ amount: D(80) }] }, // overpaid → ignored
    ],
    now,
  );
  assert.equal(r.count, 3);
  assert.equal(r.total.toString(), "560");
  assert.deepEqual(r.buckets.map(String), ["60", "200", "300"]);
});

test("receivableAging: 30 and 60 days are the inclusive upper edges of their buckets", () => {
  const now = new Date("2026-11-09T12:00:00+08:00");
  const r = receivableAging(
    [
      { completedAt: new Date(now.getTime() - 30 * DAY), totalAmount: D(1), payments: [] },
      { completedAt: new Date(now.getTime() - 60 * DAY), totalAmount: D(2), payments: [] },
      { completedAt: null, totalAmount: D(4), payments: [] },
    ],
    now,
  );
  assert.deepEqual(r.buckets.map(String), ["5", "2", "0"]);
});

// --- workloadByMaster ------------------------------------------------------

test("workloadByMaster: groups by master, busiest first, unassigned last", () => {
  const a = { id: "a", firstName: "Бат", lastName: "Д" };
  const b = { id: "b", firstName: "Сүх", lastName: "Г" };
  const rows = workloadByMaster([
    { assignedTo: null, overdue: false },
    { assignedTo: null, overdue: false },
    { assignedTo: null, overdue: false },
    { assignedTo: a, overdue: true },
    { assignedTo: b, overdue: false },
    { assignedTo: b, overdue: true },
  ]);
  assert.deepEqual(
    rows.map((r) => [r.id, r.count, r.overdue]),
    [
      ["b", 2, 1],
      ["a", 1, 1],
      ["", 3, 0],
    ],
  );
  assert.equal(rows[2].name, "Мастергүй");
});

// --- STRUCTURAL: scoping of the loader ------------------------------------

test("STRUCTURAL: every order query is scoped by tenant, working branch and order visibility", () => {
  const src = readSource("../lib/dashboard-focus.ts");
  assert.match(src, /const orderWhere: Prisma\.ServiceOrderWhereInput = \{\s*tenantId: user\.tenantId,\s*\.\.\.branchWhere,\s*\.\.\.orderReadWhere\(user\),/);
  // No serviceOrder query may bypass orderWhere.
  const orderQueries = src.match(/prisma\.serviceOrder\.\w+\(\{\s*where: \{[^}]*/g) ?? [];
  assert.ok(orderQueries.length >= 5);
  for (const q of orderQueries) assert.match(q, /\.\.\.orderWhere/);
});

test("STRUCTURAL: day boundaries use Asia/Ulaanbaatar, not the host timezone", () => {
  const src = readSource("../lib/dashboard-focus.ts");
  assert.match(src, /bookingDayBounds\(todayKey\)/);
  assert.doesNotMatch(src, /new Date\(now\.getFullYear\(\)/);
});

test("STRUCTURAL: each section is gated by its view permission", () => {
  const src = readSource("../lib/dashboard-focus.ts");
  for (const key of ["orders", "appointments", "payments"]) {
    assert.match(src, new RegExp(`${key}: canView\\(user, "${key}"\\)`));
  }
  assert.match(src, /reviews: canView\(user, "customers"\)/);
});
