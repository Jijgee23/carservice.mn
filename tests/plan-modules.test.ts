import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { ALL_LIMIT_CODES, DEFAULT_PLAN_LIMITS, MODULE_LIMIT_CODES, PLAN_LIMIT_META, type PlanModuleCode } from "../lib/plan-limits";
import {
  API_MODULE_PATHS,
  DASHBOARD_MODULE_PATHS,
  ModuleDisabledError,
  firstDisabledModule,
  modulesForPath,
} from "../lib/plan-modules";
import { knownAuthorizationMessage } from "../lib/action-errors";

const enabled = (plan: "FREE" | "BUSINESS" | "ENTERPRISE") =>
  new Set(MODULE_LIMIT_CODES.filter((c) => DEFAULT_PLAN_LIMITS[plan][c].boolValue === true));

test("there are no numeric limits at all — every plan code is a module", () => {
  assert.deepEqual([...ALL_LIMIT_CODES].sort(), [...MODULE_LIMIT_CODES].sort());
  for (const code of ALL_LIMIT_CODES) assert.equal(PLAN_LIMIT_META[code].kind, "BOOLEAN", code);
});

test("default module split: FREE ⊂ BUSINESS ⊂ ENTERPRISE as agreed", () => {
  assert.deepEqual([...enabled("FREE")].sort(), ["enable_appointments", "enable_diagnostics"]);
  const business = enabled("BUSINESS");
  for (const c of ["online_booking", "enable_finance", "enable_inventory", "enable_staff_schedule", "enable_customer_broadcast", "enable_reports", "enable_multi_branch"] as PlanModuleCode[]) {
    assert.ok(business.has(c), c);
  }
  assert.ok(!business.has("enable_audit"));
  assert.ok(!business.has("enable_api"));
  assert.equal(enabled("ENTERPRISE").size, MODULE_LIMIT_CODES.length);
});

test("core pages and endpoints are never gated", () => {
  for (const p of ["/dashboard", "/dashboard/orders", "/dashboard/customers", "/dashboard/cash/sessions", "/dashboard/services/goods", "/dashboard/employees"]) {
    assert.deepEqual(modulesForPath(p, DASHBOARD_MODULE_PATHS), [], p);
  }
  for (const p of ["/api/v1/orders", "/api/v1/customers", "/api/v1/cash/sessions/current", "/api/v1/subscription", "/api/v1/app/appointments"]) {
    assert.deepEqual(modulesForPath(p, API_MODULE_PATHS), [], p);
  }
});

test("gated paths resolve to their module; nested stock report needs both inventory and reports", () => {
  assert.deepEqual(modulesForPath("/dashboard/cash/settlements/abc", DASHBOARD_MODULE_PATHS), ["enable_finance"]);
  assert.deepEqual(modulesForPath("/dashboard/reports/stock", DASHBOARD_MODULE_PATHS).sort(), ["enable_inventory", "enable_reports"]);
  assert.equal(firstDisabledModule("/api/v1/cash/entries", API_MODULE_PATHS, enabled("FREE")), "enable_finance");
  assert.equal(firstDisabledModule("/api/v1/cash/entries", API_MODULE_PATHS, enabled("BUSINESS")), null);
  assert.equal(firstDisabledModule("/api/v1/appointments/x/confirm", API_MODULE_PATHS, enabled("FREE")), null);
  // "/dashboard/reportsX" must not match the "/dashboard/reports" prefix.
  assert.deepEqual(modulesForPath("/dashboard/reportsX", DASHBOARD_MODULE_PATHS), []);
});

test("ModuleDisabledError message is surfaced to the user by server actions", () => {
  const e = new ModuleDisabledError("enable_finance");
  assert.equal(knownAuthorizationMessage(e), e.message);
  assert.match(e.message, /Санхүү/);
});

test("every gated dashboard path has a ModuleGate layout or is a route handler that checks the module", () => {
  const root = path.join(__dirname, "..");
  for (const [prefix, code] of DASHBOARD_MODULE_PATHS) {
    const layout = path.join(root, "app", ...prefix.split("/").filter(Boolean), "layout.tsx");
    assert.ok(fs.existsSync(layout), `missing ${layout}`);
    const src = fs.readFileSync(layout, "utf8");
    assert.ok(src.includes("ModuleGate") && src.includes(code), `${layout} must gate ${code}`);
  }
});

test("screens outside the plan are hidden, not locked: gate 404s, sidebar filters, no upsell lock", () => {
  const root = path.join(__dirname, "..");
  const gate = fs.readFileSync(path.join(root, "app/dashboard/_components/module-gate.tsx"), "utf8");
  assert.match(gate, /notFound\(\)/);
  assert.doesNotMatch(gate, /Багц харах/);
  const sidebar = fs.readFileSync(path.join(root, "app/_components/admin-sidebar.tsx"), "utf8");
  assert.doesNotMatch(sidebar, /LockMark/);
  assert.match(sidebar, /applyPlan/);
});
