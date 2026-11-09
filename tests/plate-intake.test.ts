import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parsePlateCustomerForm, parsePlateIntakeForm } from "../lib/orders/plate-intake";
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

test("STRUCTURAL: customer is reused by phone before one is created", () => {
  const src = readSource("../lib/orders/plate-intake-server.ts");
  const fn = src.slice(src.indexOf("async function findOrCreateCustomerByPhone("), src.indexOf("export async function linkPlateCustomer("));
  const findIdx = fn.indexOf("findTenantCustomerIdByPhone(");
  const createCustomerIdx = fn.indexOf("createCustomerCommand({");
  assert.ok(findIdx !== -1 && findIdx < createCustomerIdx);
  const fallback = src.slice(src.indexOf("export async function resolvePlateIntake("));
  assert.match(fallback, /requireCustomerId: true/);
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

test("STRUCTURAL: plate mode links an owner to a registered vehicle, else falls back to full intake", () => {
  const src = readSource("../app/_actions/orders.ts");
  assert.match(src, /plateMode && data\.vehicleId && !data\.customerId/);
  assert.match(src, /plateMode && !data\.vehicleId/);
  const body = src.slice(src.indexOf("export async function createOrderAction("));
  const linkIdx = body.indexOf("linkPlateCustomer(user, plateLink");
  const commandIdx = body.indexOf("createOrderCommand({");
  assert.ok(linkIdx !== -1 && linkIdx < commandIdx, "owner must be linked before the order is created");
});

// --- Step 1: vehicle without owner; Step 2: owner by phone -----------------

test("BEHAVIORAL: parsePlateCustomerForm requires a valid phone, name optional", () => {
  assert.ok(parsePlateCustomerForm(fd({})).errors.phone);
  assert.match(parsePlateCustomerForm(fd({ phone: "12" })).errors.phone, /8 оронтой/);
  const ok = parsePlateCustomerForm(fd({ phone: "9911 2233", fullName: " Бат " }));
  assert.deepEqual(ok.errors, {});
  assert.equal(ok.phone, "99112233");
  assert.equal(ok.fullName, "Бат");
});

test("STRUCTURAL: registerPlateVehicle reuses an ownerless tenant link before creating a vehicle without owner", () => {
  const src = readSource("../lib/orders/plate-intake-server.ts");
  const fn = src.slice(src.indexOf("export async function registerPlateVehicle("), src.indexOf("async function findOrCreateCustomerByPhone("));
  const reuseIdx = fn.indexOf("customerId: null, vehicle: { plate }");
  const createIdx = fn.indexOf("createVehicleCommand({");
  assert.ok(reuseIdx !== -1 && reuseIdx < createIdx, "must look for an ownerless link first");
  assert.match(fn, /customerId: null,\s*\n\s*\},\s*\n\s*rejectDuplicate: false,\s*\n\s*requireCustomerId: false/);
});

test("STRUCTURAL: linkPlateCustomer never overwrites an existing owner", () => {
  const src = readSource("../lib/orders/plate-intake-server.ts");
  const attach = src.slice(src.indexOf("export async function attachOwnerToUnownedVehicle("), src.indexOf("export async function linkPlateCustomer("));
  assert.match(attach, /if \(link\.customerId\) return link\.customerId;/);
  assert.match(attach, /ensureTenantVehicle\(tx,/);
  assert.match(attach, /logAudit\(/);
  const link = src.slice(src.indexOf("export async function linkPlateCustomer("), src.indexOf("export async function resolvePlateIntake("));
  assert.match(link, /attachOwnerToUnownedVehicle\(actor, input\.vehicleId, customerId\)/);
  assert.match(link, /owner !== customerId/);
});

// --- List mode: «+ дугаар бүртгэх» in the vehicle search -------------------

test("STRUCTURAL: Select offers a create row from the search query (click + Enter)", () => {
  const src = readSource("../app/_components/select.tsx");
  assert.match(src, /creatable\?: \{/);
  assert.match(src, /creatable\.getLabel\(query\)/);
  assert.match(src, /else if \(createRow && activeIndex === visible\.length\) create\(\);/);
  assert.match(src, /filtered\.length === 0 && !createRow/);
});

test("STRUCTURAL: order form has no vehicle add button/modal; vehicle search registers by plate", () => {
  const src = readSource("../app/dashboard/orders/order-form.tsx");
  assert.doesNotMatch(src, /CreateVehicleModal/);
  assert.doesNotMatch(src, /showVehicleForm/);
  assert.match(src, /getLabel: vehicleCreateRow/);
  assert.match(src, /registerVehicleFromPlateAction\(/);
  // Only standard plates that are not already in the list get the create row.
  const fn = src.slice(src.indexOf("function vehicleCreateRow("), src.indexOf("async function registerVehicle("));
  assert.match(fn, /isStandardPlate\(plate\)/);
  assert.match(fn, /filteredVehicles\.some\(\(v\) => normalizePlate\(v\.plate\) === plate\)/);
});

test("STRUCTURAL: registerVehicleFromPlate asks for details when nothing is found, owner optional", () => {
  const src = readSource("../lib/orders/plate-intake-server.ts");
  const fn = src.slice(src.indexOf("export async function registerVehicleFromPlate("), src.indexOf("export class PlateIntakeError"));
  assert.match(fn, /needsDetails: true/);
  assert.match(fn, /fetchPlateVehicleData\(actor, plate\)/);
  assert.match(fn, /if \(!input\.customerId\) \{\s*\n\s*const unowned = await registerPlateVehicle\(/);
});

test("STRUCTURAL: createOrderAction attaches the picked customer to an ownerless vehicle before creating", () => {
  const src = readSource("../app/_actions/orders.ts");
  const body = src.slice(src.indexOf("export async function createOrderAction("));
  const attachIdx = body.indexOf("attachOwnerToUnownedVehicle(user, data.vehicleId, data.customerId)");
  const commandIdx = body.indexOf("createOrderCommand({");
  assert.ok(attachIdx !== -1 && attachIdx < commandIdx);
});

test("STRUCTURAL: step actions require order-create and vehicle-create rights", () => {
  const src = readSource("../app/_actions/orders.ts");
  const reg = src.slice(src.indexOf("export async function registerPlateVehicleAction("), src.indexOf("export async function linkPlateCustomerAction("));
  assert.match(reg, /authorize\("create"\)/);
  assert.match(reg, /canCreate\(user, "vehicles"\)/);
  const link = src.slice(src.indexOf("export async function linkPlateCustomerAction("));
  assert.match(link, /authorize\("create"\)/);
  assert.match(link, /canCreateCustomer: canCreate\(user, "customers"\)/);
});
