import assert from "node:assert/strict";
import test from "node:test";
import {
  buildOrderListWhere,
  parseOrderListQuery,
  type OrderListQuery,
} from "../lib/orders/order-list-query";

function query(raw = "") {
  const parsed = parseOrderListQuery(new URLSearchParams(raw));
  assert.equal(parsed.ok, true, parsed.ok ? undefined : parsed.message);
  return (parsed as { ok: true; value: OrderListQuery }).value;
}

test("parses every orders-list filter and decodes encoded search text", () => {
  const parsed = query(
    "status=IN_PROGRESS&branchId=branch-a&assignedToId=user-1" +
      "&paymentStatus=PARTIAL&postpaid=true&dateFrom=2026-09-01&dateTo=2026-09-30" +
      "&q=Jane%20Doe%2F9911&vehicleId=vehicle-1&customerId=customer-1&plate=%D0%A3%D0%91&page=2&pageSize=25",
  );

  assert.deepEqual(parsed, {
    status: "IN_PROGRESS",
    branchId: "branch-a",
    assignedToId: "user-1",
    paymentStatus: "PARTIAL",
    postpaid: true,
    internal: undefined,
    dateFrom: "2026-09-01",
    dateTo: "2026-09-30",
    q: "Jane Doe/9911",
    vehicleId: "vehicle-1",
    customerId: "customer-1",
    plate: "УБ",
    page: 2,
    pageSize: 25,
    skip: 25,
    take: 25,
  });
});

test("limit is accepted as a pageSize alias and canonical pageSize wins", () => {
  assert.equal(query("limit=7").pageSize, 7);
  assert.equal(query("pageSize=8&limit=7").pageSize, 8);
  assert.equal(
    parseOrderListQuery(new URLSearchParams("pageSize=8&limit=bad")).ok,
    false,
  );
});

test("rejects invalid enums, booleans, dates, ranges and pagination", () => {
  for (const raw of [
    "status=started",
    "paymentStatus=PARTIALLY_PAID",
    "postpaid=yes",
    "dateFrom=2026-02-30",
    "dateTo=not-a-date",
    "dateFrom=2026-10-01&dateTo=2026-09-30",
    "page=0",
    "page=-1",
    "page=1.5",
    "pageSize=0",
    "pageSize=101",
    "limit=not-a-number",
    "page=9007199254740991&pageSize=2",
  ]) {
    const parsed = parseOrderListQuery(new URLSearchParams(raw));
    assert.equal(parsed.ok, false, raw);
  }
});

test("date filters use Asia/Ulaanbaatar business-day boundaries", () => {
  const parsed = query("dateFrom=2026-09-01&dateTo=2026-09-01");
  const where = buildOrderListWhere(parsed, {
    tenantId: "tenant-a",
    readWhere: {},
  });
  const range = where.scheduledAt as { gte: Date; lt: Date };
  assert.equal(range.gte.toISOString(), "2026-08-31T16:00:00.000Z");
  assert.equal(range.lt.toISOString(), "2026-09-01T16:00:00.000Z");
});

test("search covers number, customer, phone, plate, make and model", () => {
  const where = buildOrderListWhere(query("q=Jane%20Doe"), {
    tenantId: "tenant-a",
    readWhere: {},
  });
  assert.deepEqual(where.AND, [
    {},
    {
      OR: [
        { number: { contains: "Jane Doe", mode: "insensitive" } },
        { customer: { fullName: { contains: "Jane Doe", mode: "insensitive" } } },
        { customer: { phone: { contains: "Jane Doe", mode: "insensitive" } } },
        { plateSnapshot: { contains: "Jane Doe", mode: "insensitive" } },
        { vehicle: { plate: { contains: "Jane Doe", mode: "insensitive" } } },
        { vehicle: { make: { contains: "Jane Doe", mode: "insensitive" } } },
        { vehicle: { model: { contains: "Jane Doe", mode: "insensitive" } } },
        { vinSnapshot: { contains: "JANEDOE", mode: "insensitive" } },
        { vehicle: { vin: { contains: "JANEDOE", mode: "insensitive" } } },
      ],
    },
  ]);
});

test("plate filter matches the snapshot or the vehicle plate, conjunctive with search", () => {
  const where = buildOrderListWhere(query("plate=1234&q=Jane"), {
    tenantId: "tenant-a",
    readWhere: {},
  });
  assert.deepEqual((where.AND as unknown[]).at(-1), {
    OR: [
      { plateSnapshot: { contains: "1234", mode: "insensitive" } },
      { vehicle: { plate: { contains: "1234", mode: "insensitive" } } },
    ],
  });
  assert.equal((where.AND as unknown[]).length, 3);
});

test("working branch overrides a requested branch without widening tenant scope", () => {
  const where = buildOrderListWhere(query("branchId=branch-attacker"), {
    tenantId: "tenant-a",
    workingBranchId: "branch-allowed",
    readWhere: {},
  });
  assert.equal(where.tenantId, "tenant-a");
  assert.equal(where.branchId, "branch-allowed");
  assert.notEqual(where.branchId, "branch-attacker");
});

test("viewOwn read predicate is retained alongside tenant and branch predicates", () => {
  const where = buildOrderListWhere(query("status=IN_PROGRESS&branchId=branch-a"), {
    tenantId: "tenant-a",
    workingBranchId: "branch-a",
    readWhere: { assignedToId: "user-own" },
  });
  assert.deepEqual(where, {
    tenantId: "tenant-a",
    status: "IN_PROGRESS",
    branchId: "branch-a",
    AND: [{ assignedToId: "user-own" }],
  });
});

test("no-access read predicate remains an empty result invariant", () => {
  const where = buildOrderListWhere(query(), {
    tenantId: "tenant-a",
    workingBranchId: "branch-a",
    readWhere: { id: { in: [] } },
  });
  assert.equal(where.tenantId, "tenant-a");
  assert.equal(where.branchId, "branch-a");
  assert.deepEqual(where.AND, [{ id: { in: [] } }]);
});

test("tenant scope cannot be overridden by an access predicate", () => {
  const where = buildOrderListWhere(query(), {
    tenantId: "tenant-authoritative",
    readWhere: { tenantId: "tenant-attacker" },
  });
  assert.equal(where.tenantId, "tenant-authoritative");
  assert.deepEqual(where.AND, [{ tenantId: "tenant-attacker" }]);
});

test("viewOwn access remains conjunctive with an attacker-supplied assignee", () => {
  const where = buildOrderListWhere(query("assignedToId=user-attacker"), {
    tenantId: "tenant-a",
    readWhere: { assignedToId: "user-own" },
  });
  assert.equal(where.assignedToId, "user-attacker");
  assert.deepEqual(where.AND, [{ assignedToId: "user-own" }]);
});

test("empty access remains conjunctive with all client filters", () => {
  const where = buildOrderListWhere(query("assignedToId=user-attacker&q=secret"), {
    tenantId: "tenant-a",
    readWhere: { id: { in: [] } },
  });
  assert.deepEqual(where.AND, [
    { id: { in: [] } },
    {
      OR: [
        { number: { contains: "secret", mode: "insensitive" } },
        { customer: { fullName: { contains: "secret", mode: "insensitive" } } },
        { customer: { phone: { contains: "secret", mode: "insensitive" } } },
        { plateSnapshot: { contains: "secret", mode: "insensitive" } },
        { vehicle: { plate: { contains: "secret", mode: "insensitive" } } },
        { vehicle: { make: { contains: "secret", mode: "insensitive" } } },
        { vehicle: { model: { contains: "secret", mode: "insensitive" } } },
        { vinSnapshot: { contains: "SECRET", mode: "insensitive" } },
        { vehicle: { vin: { contains: "SECRET", mode: "insensitive" } } },
      ],
    },
  ]);
});
