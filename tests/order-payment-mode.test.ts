import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  defaultModeForVehicle,
  flagsFromMode,
  modeAfterVehicleChange,
  modeFromFlags,
} from "../lib/orders/payment-mode";

test("mode <-> flags round trip", () => {
  for (const m of ["regular", "postpaid", "internal"] as const) {
    assert.equal(modeFromFlags(flagsFromMode(m)), m);
  }
  assert.deepEqual(flagsFromMode("regular"), { isPostpaid: false, isInternal: false });
  assert.deepEqual(flagsFromMode("postpaid"), { isPostpaid: true, isInternal: false });
  assert.deepEqual(flagsFromMode("internal"), { isPostpaid: false, isInternal: true });
  assert.equal(modeFromFlags({}), "regular");
  assert.equal(modeFromFlags({ isPostpaid: true, isInternal: true }), "internal");
});

test("vehicle defaults, internal is sticky", () => {
  assert.equal(defaultModeForVehicle({ isPostpaid: true }), "postpaid");
  assert.equal(defaultModeForVehicle(undefined), "regular");
  assert.equal(modeAfterVehicleChange("internal", { isPostpaid: true }), "internal");
  assert.equal(modeAfterVehicleChange("postpaid", { isPostpaid: false }), "regular");
  assert.equal(modeAfterVehicleChange("regular", { isPostpaid: true }), "postpaid");
});

test("order form uses the selector, not the old checkboxes", () => {
  const src = readFileSync("app/dashboard/orders/order-form.tsx", "utf8");
  assert.match(src, /Төлбөрийн нөхцөл/);
  assert.doesNotMatch(src, /type="checkbox"/);
  assert.match(src, /name="isPostpaidField"/);
  assert.match(src, /name="isInternalField"/);
});
