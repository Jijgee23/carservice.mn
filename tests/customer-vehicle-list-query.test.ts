import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCustomerListWhere,
  parseCustomerListQuery,
  type CustomerListQuery,
} from "../lib/customers/customer-list-query";
import {
  buildVehicleListWhere,
  parseVehicleListQuery,
  type VehicleListQuery,
} from "../lib/vehicles/vehicle-list-query";

// P3-B6 — shared, validated list/search query contract for customers and
// vehicles. Pure functions, no Prisma client, no DB required: genuine
// behavioral coverage of parsing/validation and the resulting `where` shape.

function customerQuery(raw = "") {
  const parsed = parseCustomerListQuery(new URLSearchParams(raw));
  assert.equal(parsed.ok, true, parsed.ok ? undefined : parsed.message);
  return (parsed as { ok: true; value: CustomerListQuery }).value;
}

function vehicleQuery(raw = "") {
  const parsed = parseVehicleListQuery(new URLSearchParams(raw));
  assert.equal(parsed.ok, true, parsed.ok ? undefined : parsed.message);
  return (parsed as { ok: true; value: VehicleListQuery }).value;
}

// ---- customers ----

test("customers: parses q and pagination, defaults page/pageSize", () => {
  const parsed = customerQuery("q=Jane&page=2&pageSize=10");
  assert.deepEqual(parsed, {
    q: "Jane",
    page: 2,
    pageSize: 10,
    skip: 10,
    take: 10,
  });

  const defaults = customerQuery("");
  assert.equal(defaults.page, 1);
  assert.equal(defaults.pageSize, 50);
  assert.equal(defaults.skip, 0);
  assert.equal(defaults.q, undefined);
});

test("customers: limit is accepted as a pageSize alias and canonical pageSize wins", () => {
  assert.equal(customerQuery("limit=7").pageSize, 7);
  assert.equal(customerQuery("pageSize=8&limit=7").pageSize, 8);
  assert.equal(parseCustomerListQuery(new URLSearchParams("pageSize=8&limit=bad")).ok, false);
});

test("customers: rejects invalid and unknown parameters instead of dropping them", () => {
  for (const raw of [
    "page=0",
    "page=-1",
    "page=1.5",
    "pageSize=0",
    "pageSize=101",
    "limit=not-a-number",
    "status=active", // not a recognized customer-list param
    "sort=name",
  ]) {
    const parsed = parseCustomerListQuery(new URLSearchParams(raw));
    assert.equal(parsed.ok, false, raw);
  }
});

test("customers: search covers fullName, email and a normalised plate match (phone only when digits)", () => {
  const where = buildCustomerListWhere(customerQuery("q=Jane%20Doe"), {
    tenantId: "tenant-a",
  });
  assert.deepEqual(where, {
    tenantId: "tenant-a",
    OR: [
      { fullName: { contains: "Jane Doe", mode: "insensitive" } },
      { email: { contains: "Jane Doe", mode: "insensitive" } },
      { tenantVehicles: { some: { vehicle: { plate: { contains: "JАNЕDОЕ" } } } } },
      { orgName: { contains: "Jane Doe", mode: "insensitive" } },
    ],
  });
});

test("customers: plate search is canonicalised (dashes, Latin letters) like stored plates", () => {
  const where = buildCustomerListWhere(customerQuery("q=1111-UAA"), { tenantId: "tenant-a" });
  assert.deepEqual(where.OR?.[2], {
    tenantVehicles: { some: { vehicle: { plate: { contains: "1111UАА" } } } },
  });
  assert.deepEqual(where.OR?.[3], { phone: { contains: "1111UAA" } });
});

test("customers: tenantId is always present, even with no search text", () => {
  const where = buildCustomerListWhere(customerQuery(""), { tenantId: "tenant-a" });
  assert.deepEqual(where, { tenantId: "tenant-a" });
});

// ---- vehicles ----

test("vehicles: parses q, customerId, assigned, postpaid and pagination", () => {
  const parsed = vehicleQuery(
    "q=Toyota&customerId=cust-1&assigned=yes&postpaid=no&page=3&pageSize=15",
  );
  assert.deepEqual(parsed, {
    q: "Toyota",
    customerId: "cust-1",
    assigned: "yes",
    postpaid: "no",
    page: 3,
    pageSize: 15,
    skip: 30,
    take: 15,
  });
});

test("vehicles: rejects invalid and unknown parameters instead of dropping them", () => {
  for (const raw of [
    "assigned=maybe",
    "postpaid=1",
    "page=0",
    "pageSize=0",
    "pageSize=101",
    "limit=nope",
    "branchId=b1", // not a recognized vehicle-list param
  ]) {
    const parsed = parseVehicleListQuery(new URLSearchParams(raw));
    assert.equal(parsed.ok, false, raw);
  }
});

test(
  "vehicles: search now covers vehicle fields plus customer name/phone — " +
    "deliberately widened to match the dashboard (the pre-slice API route " +
    "searched vehicle fields only)",
  () => {
    const where = buildVehicleListWhere(vehicleQuery("q=Toyota"), {
      tenantId: "tenant-a",
    });
    assert.deepEqual(where, {
      tenantId: "tenant-a",
      OR: [
        { vehicle: { plate: { contains: "Toyota", mode: "insensitive" } } },
        { vehicle: { make: { contains: "Toyota", mode: "insensitive" } } },
        { vehicle: { model: { contains: "Toyota", mode: "insensitive" } } },
        { vehicle: { vin: { contains: "Toyota", mode: "insensitive" } } },
        { customer: { fullName: { contains: "Toyota", mode: "insensitive" } } },
        { customer: { phone: { contains: "Toyota" } } },
      ],
    });
  },
);

test("vehicles: assigned=yes/no maps to customerId not-null/null", () => {
  const yes = buildVehicleListWhere(vehicleQuery("assigned=yes"), { tenantId: "t1" });
  assert.deepEqual(yes.customerId, { not: null });
  const no = buildVehicleListWhere(vehicleQuery("assigned=no"), { tenantId: "t1" });
  assert.equal(no.customerId, null);
});

test("vehicles: postpaid=yes/no maps to isPostpaid true/false", () => {
  const yes = buildVehicleListWhere(vehicleQuery("postpaid=yes"), { tenantId: "t1" });
  assert.equal(yes.isPostpaid, true);
  const no = buildVehicleListWhere(vehicleQuery("postpaid=no"), { tenantId: "t1" });
  assert.equal(no.isPostpaid, false);
});

test("vehicles: an exact customerId filter wins over assigned when both are present", () => {
  const where = buildVehicleListWhere(vehicleQuery("customerId=cust-1&assigned=no"), {
    tenantId: "t1",
  });
  assert.equal(where.customerId, "cust-1");
});

test("vehicles: tenantId is always present, even with no filters", () => {
  const where = buildVehicleListWhere(vehicleQuery(""), { tenantId: "tenant-a" });
  assert.deepEqual(where, { tenantId: "tenant-a" });
});
