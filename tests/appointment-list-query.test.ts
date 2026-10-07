import assert from "node:assert/strict";
import test from "node:test";
import {
  appointmentSearchWhere,
  parseAppointmentListQuery,
} from "../lib/appointments/appointment-list-query";

// All assertions below are BEHAVIORAL: they call parseAppointmentListQuery /
// appointmentSearchWhere directly and assert on their actual return values.
// There is no Prisma client, no route, and no mock in this file.

test("trims q and treats an empty or whitespace-only value as absent", () => {
  assert.deepEqual(parseAppointmentListQuery(new URLSearchParams("q=%20Ochroo%20")), {
    q: "Ochroo",
  });
  assert.deepEqual(parseAppointmentListQuery(new URLSearchParams("q=")), {
    q: undefined,
  });
  assert.deepEqual(parseAppointmentListQuery(new URLSearchParams("q=%20%20%20")), {
    q: undefined,
  });
  assert.deepEqual(parseAppointmentListQuery(new URLSearchParams()), {
    q: undefined,
  });
});

test("emits the web-parity OR plus the customer regnum clause for a present q", () => {
  const { q } = parseAppointmentListQuery(new URLSearchParams("q=9911"));
  assert.deepEqual(appointmentSearchWhere(q), [
    { account: { name: { contains: "9911", mode: "insensitive" } } },
    { account: { phone: { contains: "9911" } } },
    { customer: { fullName: { contains: "9911", mode: "insensitive" } } },
    { customer: { phone: { contains: "9911" } } },
    { customer: { orgRegnum: { startsWith: "9911" } } },
    { note: { contains: "9911", mode: "insensitive" } },
  ]);
});

test("phone clauses are case-sensitive while name/fullName/note are not", () => {
  const where = appointmentSearchWhere("MiXeD");
  assert.deepEqual(where?.[0], {
    account: { name: { contains: "MiXeD", mode: "insensitive" } },
  });
  assert.deepEqual(where?.[1], { account: { phone: { contains: "MiXeD" } } });
  assert.equal(
    (where?.[1] as { account: { phone: { mode?: string } } }).account.phone.mode,
    undefined,
  );
  assert.deepEqual(where?.[2], {
    customer: { fullName: { contains: "MiXeD", mode: "insensitive" } },
  });
  assert.deepEqual(where?.[3], { customer: { phone: { contains: "MiXeD" } } });
  assert.equal(
    (where?.[3] as { customer: { phone: { mode?: string } } }).customer.phone.mode,
    undefined,
  );
  assert.deepEqual(where?.[4], {
    note: { contains: "MiXeD", mode: "insensitive" },
  });
});

test("returns undefined (no OR fragment) for an absent q, never a vacuous filter", () => {
  assert.equal(appointmentSearchWhere(undefined), undefined);
  assert.equal(appointmentSearchWhere(""), undefined);
});

test("emits exactly five clauses — account x2, customer x2, note", () => {
  const where = appointmentSearchWhere("Jane");
  assert.equal(where?.length, 5);
});
