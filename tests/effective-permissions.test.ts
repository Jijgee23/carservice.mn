import assert from "node:assert/strict";
import { test } from "node:test";
import {
  computeEffectivePermissions,
  sanitizeOverride,
  sanitizeUserDenials,
} from "../lib/auth/effective-permissions";

const ROLE = ["orders.view", "orders.edit", "orders.create", "customers.view", "orders.itemPrice"];

test("no override/denial → role permissions returned verbatim (legacy behaviour)", () => {
  assert.deepEqual(computeEffectivePermissions({ rolePerms: ROLE }), ROLE);
  // legacy role with unusual shape is NOT normalised when nothing is delegated
  assert.deepEqual(computeEffectivePermissions({ rolePerms: ["orders.edit"] }), ["orders.edit"]);
});

test("locked codes in add/remove are ignored (only editable codes can change)", () => {
  const eff = computeEffectivePermissions({
    rolePerms: ROLE,
    editable: ["orders.itemPrice"],
    add: ["payments.view"], // not editable → ignored
    remove: ["orders.create", "orders.itemPrice"], // create locked, itemPrice editable
  });
  assert.ok(eff.includes("orders.create"));
  assert.ok(!eff.includes("orders.itemPrice"));
  assert.ok(!eff.includes("payments.view"));
});

test("editable add grants a code the role lacks", () => {
  const eff = computeEffectivePermissions({
    rolePerms: ["orders.viewOwn"],
    editable: ["customers.view"],
    add: ["customers.view"],
  });
  assert.deepEqual(eff.sort(), ["customers.view", "orders.viewOwn"]);
});

test("stale override (admin later locked the code) is ignored", () => {
  const eff = computeEffectivePermissions({
    rolePerms: ROLE,
    editable: [], // admin locked everything again
    remove: ["orders.itemPrice"],
    add: ["payments.view"],
  });
  assert.deepEqual(eff, ROLE);
});

test("invalid / duplicate codes in override are dropped", () => {
  const eff = computeEffectivePermissions({
    rolePerms: ROLE,
    editable: ["orders.itemPrice", "bogus.code"],
    remove: ["bogus.code", "orders.itemPrice", "orders.itemPrice"],
  });
  assert.ok(!eff.includes("orders.itemPrice"));
  assert.equal(eff.length, ROLE.length - 1);
});

test("per-user denial removes codes (no editable requirement) and never adds", () => {
  const eff = computeEffectivePermissions({ rolePerms: ROLE, denied: ["customers.view", "payments.view"] });
  assert.ok(!eff.includes("customers.view"));
  assert.ok(!eff.includes("payments.view")); // was never there, still not granted
  assert.equal(eff.length, ROLE.length - 1);
});

test("order scopes stay consistent after removal: view removed → edit dropped", () => {
  const eff = computeEffectivePermissions({
    rolePerms: ["orders.viewOwn", "orders.editOwn", "customers.view"],
    denied: ["orders.viewOwn"],
  });
  assert.ok(!eff.includes("orders.editOwn"));
  assert.ok(eff.includes("customers.view"));
});

test("branch edit needs branch view; own scope keeps own edit", () => {
  const eff = computeEffectivePermissions({
    rolePerms: ["orders.view", "orders.edit", "orders.viewOwn", "orders.editOwn"],
    denied: ["orders.view"],
  });
  assert.ok(!eff.includes("orders.edit"));
  assert.ok(eff.includes("orders.editOwn"));
});

test("sanitizeOverride: locked or unknown code rejected; inapplicable entries cleaned", () => {
  const ctx = { rolePerms: ROLE, editable: ["orders.itemPrice", "payments.view"] };
  const locked = sanitizeOverride(ctx, { remove: ["orders.create"] });
  assert.equal(locked.ok, false);
  const unknown = sanitizeOverride(ctx, { add: ["nope.nope"] });
  assert.equal(unknown.ok, false);
  const ok = sanitizeOverride(ctx, {
    add: ["payments.view", "orders.itemPrice"], // itemPrice already held → cleaned
    remove: [],
  });
  assert.deepEqual(ok, { ok: true, add: ["payments.view"], remove: [] });
  const rm = sanitizeOverride(ctx, { remove: ["orders.itemPrice", "payments.view"] }); // payments.view not held → cleaned
  assert.deepEqual(rm, { ok: true, add: [], remove: ["orders.itemPrice"] });
});

test("sanitizeOverride: same code in add and remove rejected; bad shapes rejected", () => {
  const ctx = { rolePerms: ROLE, editable: ["payments.view"] };
  assert.equal(sanitizeOverride(ctx, { add: ["payments.view"], remove: ["payments.view"] }).ok, false);
  assert.equal(sanitizeOverride(ctx, { add: "payments.view" }).ok, false);
  assert.equal(sanitizeOverride(ctx, { add: [1] }).ok, false);
  assert.deepEqual(sanitizeOverride(ctx, {}), { ok: true, add: [], remove: [] });
});

test("sanitizeUserDenials: only currently effective codes kept; unknown code rejected", () => {
  assert.deepEqual(sanitizeUserDenials(ROLE, ["customers.view", "payments.view"]), {
    ok: true,
    denied: ["customers.view"],
  });
  assert.equal(sanitizeUserDenials(ROLE, ["nope.nope"]).ok, false);
  assert.equal(sanitizeUserDenials(ROLE, "customers.view").ok, false);
  assert.deepEqual(sanitizeUserDenials(ROLE, undefined), { ok: true, denied: [] });
});

test("result never exceeds role ∪ editable-add (no escalation through denial or override)", () => {
  const eff = computeEffectivePermissions({
    rolePerms: ["orders.viewOwn"],
    editable: ["orders.itemPrice", "orders.viewOwn"],
    add: ["orders.itemPrice"],
    remove: ["orders.viewOwn", "customers.delete"], // customers.delete locked → ignored
    denied: ["orders.itemPrice"],
  });
  assert.deepEqual(eff, []);
  // locked removal is ignored: same input without viewOwn being editable keeps it
  assert.deepEqual(
    computeEffectivePermissions({ rolePerms: ["orders.viewOwn"], editable: [], remove: ["orders.viewOwn"] }),
    ["orders.viewOwn"],
  );
});
