import assert from "node:assert/strict";
import { test } from "node:test";

import {
  customerRegnumClause,
  customerRelationSearchClauses,
  customerTextSearchClauses,
  orgRegnumSearchTerm,
} from "../lib/customers/customer-search";
import { buildCustomerListWhere } from "../lib/customers/customer-list-query";

const REGNUM = (v: string) => ({ orgRegnum: { startsWith: v } });

test("7-digit regnum matches orgRegnum startsWith", () => {
  assert.deepEqual(customerRegnumClause("1234567"), REGNUM("1234567"));
  assert.deepEqual(customerRegnumClause("  1234567 "), REGNUM("1234567"));
});

test("partial digits (1-6) match as prefix", () => {
  for (const q of ["1", "123", "123456"]) assert.deepEqual(customerRegnumClause(q), REGNUM(q));
});

test("8-digit phone search does not add a regnum clause", () => {
  assert.equal(orgRegnumSearchTerm("99112233"), null);
  assert.equal(customerRegnumClause("99112233"), null);
  const clauses = customerTextSearchClauses("99112233");
  assert.ok(!JSON.stringify(clauses).includes("orgRegnum"));
  assert.ok(JSON.stringify(clauses).includes('"phone":{"contains":"99112233"}'));
});

test("name / mixed text never adds a regnum clause and still matches name", () => {
  for (const q of ["Бат", "УБ1234567", "12ab", "12 34"]) assert.equal(customerRegnumClause(q), null, q);
  assert.deepEqual(customerTextSearchClauses("Бат")[0], { fullName: { contains: "Бат", mode: "insensitive" } });
});

test("text clauses combine name, phone and regnum; empty input yields none", () => {
  assert.deepEqual(customerTextSearchClauses("1234567"), [
    { fullName: { contains: "1234567", mode: "insensitive" } },
    { phone: { contains: "1234567" } },
    REGNUM("1234567"),
  ]);
  assert.deepEqual(customerTextSearchClauses("   "), []);
  assert.deepEqual(customerTextSearchClauses(undefined), []);
});

test("relation wrapper nests every clause under customer", () => {
  const out = customerRelationSearchClauses("1234567", (customer) => ({ customer }));
  assert.equal(out.length, 3);
  assert.deepEqual(out[2], { customer: REGNUM("1234567") });
});

test("customer list where keeps tenant scope and gains the regnum clause", () => {
  const q = { q: "1234567", page: 1, pageSize: 20, skip: 0, take: 20 };
  const where = buildCustomerListWhere(q, { tenantId: "t1" });
  assert.equal(where.tenantId, "t1");
  assert.ok(JSON.stringify(where.OR).includes('"orgRegnum":{"startsWith":"1234567"}'));
  const phone = buildCustomerListWhere({ ...q, q: "99112233" }, { tenantId: "t1" });
  assert.ok(!JSON.stringify(phone.OR).includes("orgRegnum"));
});
