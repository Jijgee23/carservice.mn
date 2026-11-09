import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parsePlateIntakeForm } from "../lib/orders/plate-intake";
import { NO_PLATE, PLATE_PATTERN, isStandardPlate, normalizePlate } from "../lib/vehicle-plate";

// «Улсын дугаар бичээд л» засварын хуудас. Сервер тал (plate-intake-server.ts,
// createOrderAction) prisma/server-only-оос хамаардаг тул энд DB байхгүй —
// бусад тестийн адил BEHAVIORAL (цэвэр задлагч) + STRUCTURAL (эх кодын дараалал).

function fd(entries: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
}

function readSource(relativePath: string): string {
  return readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), relativePath), "utf8");
}

// --- BEHAVIORAL: parsePlateIntakeForm --------------------------------------

test("BEHAVIORAL: valid input normalizes plate (Latin → Cyrillic) and phone", () => {
  const { input, errors } = parsePlateIntakeForm(
    fd({ plate: "1234 abc", phone: "+976 9911-2233", fullName: " Бат ", make: "Toyota", model: "Prius", year: "2015", fromLookup: "1" }),
  );
  assert.deepEqual(errors, {});
  assert.equal(input.plate, "1234АВС");
  assert.equal(input.plate, normalizePlate("1234АВС"));
  assert.equal(input.phone, "99112233");
  assert.equal(input.fullName, "Бат");
  assert.equal(input.vehicle.year, 2015);
  assert.equal(input.fromLookup, true);
});

test("BEHAVIORAL: missing plate / phone / make / model are reported per field", () => {
  const { errors } = parsePlateIntakeForm(fd({}));
  assert.deepEqual(Object.keys(errors).sort(), ["make", "model", "phone", "plate"]);
});

test("BEHAVIORAL: invalid phone gets a format error, not a required error", () => {
  const { errors } = parsePlateIntakeForm(fd({ plate: "1234УБА", phone: "123", make: "A", model: "B" }));
  assert.match(errors.phone, /8 оронтой/);
});

test("BEHAVIORAL: the no-plate marker is rejected (no-plate cars go through the list picker)", () => {
  const { errors } = parsePlateIntakeForm(fd({ plate: NO_PLATE, phone: "99112233", make: "A", model: "B" }));
  assert.ok(errors.plate);
});

test("BEHAVIORAL: optional vehicle attributes default to null, fromLookup to false", () => {
  const { input } = parsePlateIntakeForm(fd({ plate: "1234УБА", phone: "99112233", make: "A", model: "B" }));
  assert.equal(input.vehicle.year, null);
  assert.equal(input.vehicle.vin, null);
  assert.equal(input.fromLookup, false);
});

test("BEHAVIORAL: shared plate pattern accepts Cyrillic/Latin, rejects transit-style plates", () => {
  assert.ok(isStandardPlate("1234УБА"));
  assert.ok(isStandardPlate("1234ӨВӨ"));
  assert.ok(PLATE_PATTERN.test("1234ABC"));
  assert.ok(!isStandardPlate("12УБА"));
  assert.ok(!isStandardPlate("1234УБАА"));
});

// --- STRUCTURAL: lookup order + PII ----------------------------------------

test("STRUCTURAL: lookup checks tenant links, then global Vehicle, then HUR (rate-limited)", () => {
  const src = readSource("../lib/orders/plate-intake-server.ts");
  const tenantIdx = src.indexOf("prisma.tenantVehicle.findMany(");
  const globalIdx = src.indexOf("prisma.vehicle.findFirst(");
  const rateIdx = src.indexOf("consumeRateLimit(`hur:${actor.id}`");
  const hurIdx = src.indexOf("HurService.getVehicle(");
  for (const [name, idx] of Object.entries({ tenantIdx, globalIdx, rateIdx, hurIdx })) {
    assert.notEqual(idx, -1, `${name} missing`);
  }
  assert.ok(tenantIdx < globalIdx && globalIdx < rateIdx && rateIdx < hurIdx);
});

test("STRUCTURAL: lookup result never carries HUR owner PII", () => {
  const types = readSource("../lib/orders/plate-intake.ts");
  const lookupBlock = types.slice(types.indexOf("export type PlateLookupVehicle"), types.indexOf("export type TenantPlateMatch"));
  assert.doesNotMatch(lookupBlock, /owner|regnum|phone/i);
  const server = readSource("../lib/orders/plate-intake-server.ts");
  assert.doesNotMatch(server, /hur\.owner/);
});

test("STRUCTURAL: intake reuses customer by phone before creating, and links via createVehicleCommand", () => {
  const src = readSource("../lib/orders/plate-intake-server.ts");
  const findIdx = src.indexOf("findTenantCustomerIdByPhone(");
  const createCustomerIdx = src.indexOf("createCustomerCommand({");
  const createVehicleIdx = src.indexOf("createVehicleCommand({");
  assert.ok(findIdx !== -1 && findIdx < createCustomerIdx && createCustomerIdx < createVehicleIdx);
  assert.match(src, /rejectDuplicate: false/);
  assert.match(src, /requireCustomerId: true/);
});

// --- STRUCTURAL: createOrderAction wiring ----------------------------------

test("STRUCTURAL: createOrderAction validates everything (incl. branch scope) before registering, then creates the order", () => {
  const src = readSource("../app/_actions/orders.ts");
  const start = src.indexOf("export async function createOrderAction(");
  const body = src.slice(start, src.indexOf("export async function lookupPlateForOrderAction("));
  const parseIdx = body.indexOf("parsePlateIntakeForm(formData)");
  const scopeIdx = body.indexOf("Зөвхөн өөрийн салбарт");
  const errorsReturnIdx = body.indexOf("return { ok: false, fieldErrors: errors };");
  const resolveIdx = body.indexOf("resolvePlateIntake(user");
  const commandIdx = body.indexOf("createOrderCommand({");
  for (const [name, idx] of Object.entries({ parseIdx, scopeIdx, errorsReturnIdx, resolveIdx, commandIdx })) {
    assert.notEqual(idx, -1, `${name} missing`);
  }
  assert.ok(parseIdx < scopeIdx && scopeIdx < errorsReturnIdx && errorsReturnIdx < resolveIdx && resolveIdx < commandIdx);
  assert.match(body, /canCreate\(user, "vehicles"\)/);
  assert.match(body, /canCreateCustomer: canCreate\(user, "customers"\)/);
});

test("STRUCTURAL: plate mode only applies when no registered vehicle was picked", () => {
  const src = readSource("../app/_actions/orders.ts");
  assert.match(src, /s\(formData, "intakeMode"\) === "plate" && !data\.vehicleId/);
});
