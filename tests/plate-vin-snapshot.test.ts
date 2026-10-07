import assert from "node:assert/strict";
import test, { before } from "node:test";

process.env.DATABASE_URL ??= "postgresql://unused/unused";
process.env.SESSION_SECRET ??= "unit-test-placeholder-secret-value-not-real-00";

import { buildOrderListWhere, orderVinSearchClauses, parseOrderListQuery, type OrderListQuery } from "../lib/orders/order-list-query";
import { formerPlate } from "../lib/vehicle-plate";

let shapeVinHistory: typeof import("../lib/vehicles/vin-history").shapeVinHistory;
before(async () => {
  ({ shapeVinHistory } = await import("../lib/vehicles/vin-history"));
});

function where(raw: string) {
  const p = parseOrderListQuery(new URLSearchParams(raw));
  assert.ok(p.ok);
  return buildOrderListWhere((p as unknown as { value: OrderListQuery }).value, {
    tenantId: "t1",
    readWhere: {},
  });
}

test("q and plate search match plateSnapshot OR vehicle.plate", () => {
  const s = JSON.stringify(where("q=1234&plate=1234"));
  assert.equal((s.match(/"plateSnapshot"/g) ?? []).length, 2);
  assert.equal((s.match(/"vehicle":\{"plate"/g) ?? []).length, 2);
});

test("formerPlate", () => {
  assert.equal(formerPlate(null, "1234УБА"), null);
  assert.equal(formerPlate("1234УБА", "1234УБА"), null);
  assert.equal(formerPlate("1234-УБА", "1234УБА"), null);
  assert.equal(formerPlate("1111УБА", "1234УБА"), "1111УБА");
  assert.equal(formerPlate("1234ABA", "1234АВА"), null);
});

test("shapeVinHistory: no VIN", () => {
  assert.deepEqual(shapeVinHistory(null, [], []), { vin: null, records: [], otherTenantRecords: 0 });
});

test("shapeVinHistory: records, owner, counts, other tenants without PII", () => {
  const d = (s: string) => new Date(s);
  const r = shapeVinHistory(
    "VIN1",
    [
      { id: "a", plate: "1111", make: "T", model: "P", year: 2010,
        link: { createdAt: d("2026-01-01"), customer: { fullName: "Bat", orgName: null, isOrganization: false } } },
      { id: "b", plate: "2222", make: "T", model: "P", year: null,
        link: { createdAt: d("2026-03-01"), customer: { fullName: "X", orgName: "Org LLC", isOrganization: true } } },
      { id: "c", plate: "3333", make: "T", model: "P", year: null,
        link: { createdAt: d("2026-02-01"), customer: null } },
      { id: "o1", plate: "SECRET", make: "T", model: "P", year: null },
      { id: "o2", plate: "SECRET2", make: "T", model: "P", year: null },
    ],
    [{ vehicleId: "a", count: 2, lastAt: d("2026-02-02") }],
  );
  assert.deepEqual(r.records.map((x) => x.vehicleId), ["b", "c", "a"]);
  assert.equal(r.records[0].ownerName, "Org LLC");
  assert.equal(r.records[1].ownerName, null);
  assert.equal(r.records[2].orderCount, 2);
  assert.equal(r.records[2].lastOrderAt, "2026-02-02T00:00:00.000Z");
  assert.equal(r.records[0].orderCount, 0);
  assert.equal(r.otherTenantRecords, 2);
  assert.ok(!JSON.stringify(r).includes("SECRET"));
});

test("order search: VIN matches snapshot and current vehicle VIN, ignores short text", () => {
  assert.deepEqual(orderVinSearchClauses("12"), []);
  assert.deepEqual(orderVinSearchClauses(" kmhec 41 "), [
    { vinSnapshot: { contains: "KMHEC41", mode: "insensitive" } },
    { vehicle: { vin: { contains: "KMHEC41", mode: "insensitive" } } },
  ]);
  const where = JSON.stringify(
    buildOrderListWhere({ q: "KMHEC41" } as OrderListQuery, { tenantId: "t1", readWhere: {} }),
  );
  assert.match(where, /"vinSnapshot":\{"contains":"KMHEC41"/);
  assert.match(where, /"vin":\{"contains":"KMHEC41"/);
});
