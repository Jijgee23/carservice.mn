import assert from "node:assert/strict";
import { test } from "node:test";
import { homeLayoutFor, resolveHomeLayout, resolveHomePersona, type HomePersona } from "../lib/dashboard-persona";

const role = (...permissions: string[]) => ({ isOwner: false, role: { permissions } });

test("owner is manager regardless of role", () => {
  assert.equal(resolveHomePersona({ isOwner: true, role: null }), "manager");
  assert.equal(resolveHomePersona({ isOwner: true, role: { permissions: ["orders.viewOwn"] } }), "manager");
});

test("own-scope orders → mechanic, even with other perms", () => {
  assert.equal(resolveHomePersona(role("orders.viewOwn", "orders.editOwn")), "mechanic");
  assert.equal(resolveHomePersona(role("orders.viewOwn", "cash.manage")), "mechanic");
});

test("orders.view (branch scope) is not mechanic", () => {
  assert.notEqual(resolveHomePersona(role("orders.view", "orders.viewOwn")), "mechanic");
});

test("money without appointments → cashier; appointments without money → frontdesk", () => {
  assert.equal(resolveHomePersona(role("orders.view", "cash.manage")), "cashier");
  assert.equal(resolveHomePersona(role("orders.view", "payments.view")), "cashier");
  assert.equal(resolveHomePersona(role("orders.view", "appointments.view")), "frontdesk");
});

test("both or neither → manager; role-less non-owner → manager (data still permission-gated)", () => {
  assert.equal(resolveHomePersona(role("appointments.view", "cash.manage")), "manager");
  assert.equal(resolveHomePersona(role("customers.view")), "manager");
  assert.equal(resolveHomePersona({ isOwner: false, role: null }), "manager");
});

test("every persona layout is internally consistent", () => {
  const personas: HomePersona[] = ["manager", "mechanic", "frontdesk", "cashier"];
  for (const p of personas) {
    const l = homeLayoutFor(p);
    assert.equal(l.persona, p);
    const widgets = [...l.main, ...l.side];
    assert.equal(new Set(widgets).size, widgets.length, `${p}: widget duplicated`);
    assert.equal(new Set(l.kpis).size, l.kpis.length, `${p}: kpi duplicated`);
    assert.ok(l.kpis.length > 0 && l.actions.length > 0);
  }
});

test("money widgets never shown to mechanic or frontdesk", () => {
  for (const p of ["mechanic", "frontdesk"] as const) {
    const l = homeLayoutFor(p);
    for (const w of ["cash", "payments", "receivable"] as const) {
      assert.ok(![...l.main, ...l.side].includes(w), `${p} must not show ${w}`);
    }
    assert.equal(l.income, false);
    assert.ok(!l.kpis.includes("paymentsToday") && !l.kpis.includes("receivable"));
  }
});

test("layouts are fresh copies (callers cannot mutate shared config)", () => {
  const a = resolveHomeLayout({ isOwner: true });
  a.main.push("cash");
  assert.deepEqual(resolveHomeLayout({ isOwner: true }).main, ["appointments", "work"]);
});
