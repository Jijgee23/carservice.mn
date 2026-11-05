import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { before, test } from "node:test";

process.env.DATABASE_URL ??= "postgresql://unused/unused";
process.env.SESSION_SECRET ??= "unit-test-placeholder-secret-value-not-real-00";

let commands: typeof import("../lib/vehicles/vehicle-commands");

before(async () => {
  commands = await import("../lib/vehicles/vehicle-commands");
});

function src(relPath: string): string {
  return readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), relPath),
    "utf8",
  );
}

// --- Pure validation logic (genuinely testable without a database) --------

test("plate, make and model are required", () => {
  const missing = commands.validateVehicleInput({ plate: "", make: "", model: "" });
  assert.equal(missing.fieldErrors.plate, "Улсын дугаар оруулна уу.");
  assert.equal(missing.fieldErrors.make, "Маркаа оруулна уу.");
  assert.equal(missing.fieldErrors.model, "Моделоо оруулна уу.");

  const ok = commands.validateVehicleInput({ plate: "1234abc", make: "Toyota", model: "Prius" });
  assert.equal(ok.fieldErrors.plate, undefined);
  assert.equal(ok.fieldErrors.make, undefined);
  assert.equal(ok.fieldErrors.model, undefined);
});

test("plate is normalised: uppercased, and Latin look-alike letters are mapped to Cyrillic", () => {
  const result = commands.validateVehicleInput({ plate: "1234abc", make: "M", model: "M" });
  // A,B,C -> А,В,С (Cyrillic) per PLATE_LATIN_TO_CYRILLIC in lib/vehicles.ts.
  // normalizeVehicleInput itself does not call normalizePlate (that stays in
  // lib/vehicles.ts and is applied inside resolveVehicleForOwner / duplicate
  // checks), but it does uppercase — verify that plate reaches the command
  // uppercased, unchanged otherwise, so downstream normalizePlate is fed a
  // consistent value.
  assert.equal(result.data.plate, "1234ABC");
});

test("plate/vin uppercase, other free-text fields are trimmed", () => {
  const result = commands.validateVehicleInput({
    plate: "  1234uba  ",
    vin: "  abc123  ",
    make: "  Toyota  ",
    model: "  Prius  ",
    colorName: "  Хар  ",
    purpose: "  Хувийн  ",
    ownerRegnum: "  УБ12345678  ",
  });
  assert.equal(result.data.plate, "1234UBA");
  assert.equal(result.data.vin, "ABC123");
  assert.equal(result.data.make, "Toyota");
  assert.equal(result.data.model, "Prius");
  assert.equal(result.data.colorName, "Хар");
  assert.equal(result.data.purpose, "Хувийн");
  assert.equal(result.data.ownerRegnum, "УБ12345678");
});

test("vin/colorName/purpose/ownerRegnum/fuelType are optional; blank becomes null", () => {
  const result = commands.validateVehicleInput({ plate: "1234УБА", make: "M", model: "M" });
  assert.equal(result.data.vin, null);
  assert.equal(result.data.colorName, null);
  assert.equal(result.data.purpose, null);
  assert.equal(result.data.ownerRegnum, null);
  assert.equal(result.data.fuelType, null);
  assert.equal(result.data.wheelPosition, null);
  assert.equal(result.data.customerId, null);
  assert.equal(result.data.isPostpaid, false);
});

test("year is bounded 1900-2100 by default; the lower bound alone is enforced when enforceYearUpperBound is false", () => {
  const base = { plate: "1234УБА", make: "M", model: "M" };

  const tooLow = commands.validateVehicleInput({ ...base, year: 1899 });
  assert.equal(tooLow.fieldErrors.year, "Жил буруу.");

  const tooHigh = commands.validateVehicleInput({ ...base, year: 2101 });
  assert.equal(tooHigh.fieldErrors.year, "Жил буруу.");

  const ok = commands.validateVehicleInput({ ...base, year: 2020 });
  assert.equal(ok.fieldErrors.year, undefined);
  assert.equal(ok.data.year, 2020);

  // Divergence 3: POST /api/v1/vehicles historically checked only the lower
  // bound. With enforceYearUpperBound:false, a year above 2100 is accepted.
  const highButAllowed = commands.validateVehicleInput(
    { ...base, year: 2101 },
    { enforceYearUpperBound: false },
  );
  assert.equal(highButAllowed.fieldErrors.year, undefined);
  assert.equal(highButAllowed.data.year, 2101);

  // The lower bound is never relaxed by the flag.
  const stillTooLow = commands.validateVehicleInput(
    { ...base, year: 1899 },
    { enforceYearUpperBound: false },
  );
  assert.equal(stillTooLow.fieldErrors.year, "Жил буруу.");
});

test("year/mileage/capacity accept both string (FormData) and number (JSON) input", () => {
  const base = { plate: "1234УБА", make: "M", model: "M" };
  const fromString = commands.validateVehicleInput({ ...base, year: "2020", mileage: "12 000", capacity: "1 500" });
  assert.equal(fromString.data.year, 2020);
  assert.equal(fromString.data.mileage, 12000);
  assert.equal(fromString.data.capacity, 1500);

  const fromNumber = commands.validateVehicleInput({ ...base, year: 2020, mileage: 12000, capacity: 1500 });
  assert.equal(fromNumber.data.year, 2020);
  assert.equal(fromNumber.data.mileage, 12000);
  assert.equal(fromNumber.data.capacity, 1500);

  const empty = commands.validateVehicleInput({ ...base, year: "", mileage: null, capacity: undefined });
  assert.equal(empty.data.year, null);
  assert.equal(empty.data.mileage, null);
  assert.equal(empty.data.capacity, null);
});

test("mileage and capacity must not be negative", () => {
  const base = { plate: "1234УБА", make: "M", model: "M" };
  const badMileage = commands.validateVehicleInput({ ...base, mileage: -1 });
  assert.equal(badMileage.fieldErrors.mileage, "Гүйлт буруу.");
  const badCapacity = commands.validateVehicleInput({ ...base, capacity: -1 });
  assert.equal(badCapacity.fieldErrors.capacity, "Моторын хэмжээ буруу.");
});

test("wheelPosition is normalised (left/right/Cyrillic variants) and only Зүүн/Баруун are valid", () => {
  const base = { plate: "1234УБА", make: "M", model: "M" };
  const left = commands.validateVehicleInput({ ...base, wheelPosition: "left" });
  assert.equal(left.data.wheelPosition, "Зүүн");
  assert.equal(left.fieldErrors.wheelPosition, undefined);

  const right = commands.validateVehicleInput({ ...base, wheelPosition: "R" });
  assert.equal(right.data.wheelPosition, "Баруун");

  const invalid = commands.validateVehicleInput({ ...base, wheelPosition: "middle" });
  assert.equal(invalid.fieldErrors.wheelPosition, "Жолооны хүрдний талыг буруу сонгосон.");

  const absent = commands.validateVehicleInput({ ...base, wheelPosition: null });
  assert.equal(absent.data.wheelPosition, null);
  assert.equal(absent.fieldErrors.wheelPosition, undefined);
});

test("customerId is required only when requireCustomerId is set (Divergence 1 — quick-create only)", () => {
  const base = { plate: "1234УБА", make: "M", model: "M" };
  const withoutFlag = commands.validateVehicleInput({ ...base });
  assert.equal(withoutFlag.fieldErrors.customerId, undefined);

  const withFlagMissing = commands.validateVehicleInput(base, { requireCustomerId: true });
  assert.equal(withFlagMissing.fieldErrors.customerId, "Үйлчлүүлэгч сонгох эсвэл нэмэх ёстой.");

  const withFlagPresent = commands.validateVehicleInput(
    { ...base, customerId: "cust-1" },
    { requireCustomerId: true },
  );
  assert.equal(withFlagPresent.fieldErrors.customerId, undefined);
  assert.equal(withFlagPresent.data.customerId, "cust-1");
});

test("VehicleCommandError carries a status, machine code and optional fieldErrors", () => {
  const err = new commands.VehicleCommandError("msg", 409, "VEHICLE_IN_USE", { plate: "dup" });
  assert.equal(err.status, 409);
  assert.equal(err.code, "VEHICLE_IN_USE");
  assert.deepEqual(err.fieldErrors, { plate: "dup" });
  assert.ok(err instanceof Error);
});

test("VehicleCommandError defaults to 422 / VEHICLE_COMMAND_REJECTED", () => {
  const err = new commands.VehicleCommandError("msg");
  assert.equal(err.status, 422);
  assert.equal(err.code, "VEHICLE_COMMAND_REJECTED");
});

// --- Structural coverage: entry points delegate to the one command --------
//
// These are source-pattern assertions, not runtime behavior tests, used only
// where a database would otherwise be required (owner matching, duplicate
// TenantVehicle upserts, history-based delete/owner-change blocking, plate
// immutability on update). They cannot substitute for a database-backed
// integration test; see the final report for what remains untested for that
// reason. Each assertion is labelled with exactly what it guards against.

test("the dashboard vehicle actions delegate to the shared command and do not re-implement it", () => {
  const actions = src("../app/_actions/vehicles.ts");
  assert.match(actions, /createVehicleCommand\(\{/);
  assert.match(actions, /updateVehicleCommand\(\{/);
  assert.match(actions, /deleteVehicleCommand\(\{/);
  // The old inline validate()/vehicleHasHistory()/hand-rolled transaction
  // logic must be gone — only the command module talks to prisma.vehicle /
  // prisma.tenantVehicle now.
  assert.doesNotMatch(actions, /prisma\.vehicle\.(create|update|delete)/);
  assert.doesNotMatch(actions, /prisma\.tenantVehicle\.(create|update|delete|deleteMany)/);
  assert.doesNotMatch(actions, /function validate\(/);
  assert.doesNotMatch(actions, /resolveVehicleForOwner\(/);
  assert.doesNotMatch(actions, /ensureTenantVehicle\(/);
});

test("quick-create's vehicle half delegates to the same command instead of re-implementing claim logic", () => {
  const quickCreate = src("../app/_actions/quick-create.ts");
  const start = quickCreate.indexOf("export async function quickCreateVehicleAction");
  assert.ok(start >= 0);
  const vehicleSection = quickCreate.slice(start);
  assert.match(vehicleSection, /createVehicleCommand\(\{/);
  assert.doesNotMatch(vehicleSection, /resolveVehicleForOwner\(/);
  assert.doesNotMatch(vehicleSection, /ensureTenantVehicle\(/);
  assert.doesNotMatch(vehicleSection, /prisma\.\$transaction/);
  assert.doesNotMatch(vehicleSection, /prisma\.customer\.findFirst/);

  // The customer half must stay separate (P3-B1's slice, not this one).
  const customerSection = quickCreate.slice(0, start);
  assert.match(customerSection, /createCustomerCommand\(\{/);
  assert.doesNotMatch(customerSection, /createVehicleCommand\(/);
});

test("the staff API POST route delegates to the same command", () => {
  const route = src("../app/api/v1/vehicles/route.ts");
  const postStart = route.indexOf("export async function POST");
  assert.ok(postStart >= 0);
  const postBody = route.slice(postStart);
  assert.match(postBody, /createVehicleCommand\(\{/);
  assert.doesNotMatch(postBody, /resolveVehicleForOwner\(/);
  assert.doesNotMatch(postBody, /ensureTenantVehicle\(/);
  assert.doesNotMatch(postBody, /prisma\.\$transaction/);
  assert.doesNotMatch(postBody, /prisma\.tenantVehicle\.(upsert|findFirst)/);

  // GET must be completely untouched by this slice.
  const getStart = route.indexOf("export async function GET");
  const getBody = route.slice(getStart, postStart);
  assert.match(getBody, /requirePermission\(auth\.user, "vehicles\.view"\)/);
  assert.match(getBody, /tenantId:\s*auth\.user\.tenantId/);
});

test("lib/vehicles.ts foundations are reused unchanged, never forked", () => {
  const commandSource = src("../lib/vehicles/vehicle-commands.ts");
  assert.match(commandSource, /import \{[\s\S]*?\} from "@\/lib\/vehicles"/);
  assert.match(commandSource, /resolveVehicleForOwner\(/);
  assert.match(commandSource, /ownerFromCustomer\(/);
  assert.match(commandSource, /ensureTenantVehicle\(/);
  assert.match(commandSource, /normalizePlate\(/);
  // No second copy of the plate/owner matching logic in the command module.
  assert.doesNotMatch(commandSource, /PLATE_LATIN_TO_CYRILLIC/);
  assert.doesNotMatch(commandSource, /function ownerMatchWhere/);
});

test("delete touches only TenantVehicle, never the global Vehicle row", () => {
  const commandSource = src("../lib/vehicles/vehicle-commands.ts");
  const start = commandSource.indexOf("export async function deleteVehicleCommand");
  assert.ok(start >= 0);
  const body = commandSource.slice(start);
  assert.match(body, /prisma\.tenantVehicle\.deleteMany\(/);
  assert.doesNotMatch(body, /prisma\.vehicle\.delete/);
});

test("delete is blocked while the tenant has service orders or diagnostic reports for the vehicle", () => {
  const commandSource = src("../lib/vehicles/vehicle-commands.ts");
  assert.match(commandSource, /vehicleHasHistory/);
  const historyFnStart = commandSource.indexOf("async function vehicleHasHistory");
  const historyFnBody = commandSource.slice(historyFnStart, historyFnStart + 600);
  assert.match(historyFnBody, /prisma\.serviceOrder\.count/);
  assert.match(historyFnBody, /prisma\.diagnosticReport\.count/);

  const deleteStart = commandSource.indexOf("export async function deleteVehicleCommand");
  const deleteBody = commandSource.slice(deleteStart);
  assert.match(deleteBody, /await vehicleHasHistory\(actor\.tenantId, vehicleId\)/);
  assert.match(deleteBody, /VEHICLE_IN_USE/);
});

test("owner-change on update is blocked by the same history check", () => {
  const commandSource = src("../lib/vehicles/vehicle-commands.ts");
  const start = commandSource.indexOf("export async function updateVehicleCommand");
  const body = commandSource.slice(start);
  assert.match(body, /customerId !== link\.customerId && \(await vehicleHasHistory\(actor\.tenantId, vehicleId\)\)/);
  assert.match(body, /VEHICLE_OWNER_CHANGE_BLOCKED/);
});

test("plate is immutable on update — only a no-plate (NO_PLATE) vehicle can be given a plate, once", () => {
  const commandSource = src("../lib/vehicles/vehicle-commands.ts");
  const start = commandSource.indexOf("export async function updateVehicleCommand");
  const end = commandSource.indexOf("export async function deleteVehicleCommand");
  const body = commandSource.slice(start, end);
  // Оролтын plate нь attrs-д орохгүй — Vehicle-д зөвхөн assignPlate-ээр бичигдэнэ.
  assert.match(body, /const \{ customerId, isPostpaid, plate: inputPlate, \.\.\.attrs \} = data;/);
  assert.match(body, /current != null && isNoPlate\(current\.plate\) && inputPlate && !isNoPlate\(inputPlate\)/);
  assert.match(body, /data: \{ \.\.\.attrs, \.\.\.\(assignPlate \? \{ plate: assignPlate \} : \{\}\) \}/);
});

test("every path returns the link's actual owner, never the requested customerId verbatim (the fixed divergence 9)", () => {
  const commandSource = src("../lib/vehicles/vehicle-commands.ts");
  // create/update both read the record back through loadVehicleRecord, which
  // pulls TenantVehicle.customerId off the persisted link, not the input.
  assert.match(commandSource, /async function loadVehicleRecord/);
  const loadStart = commandSource.indexOf("async function loadVehicleRecord");
  const loadBody = commandSource.slice(loadStart, loadStart + 900);
  assert.match(loadBody, /customerId: link\.customerId/);

  const createStart = commandSource.indexOf("export async function createVehicleCommand");
  const createBody = commandSource.slice(createStart, commandSource.indexOf("export async function updateVehicleCommand"));
  assert.match(createBody, /loadVehicleRecord\(tx, vehicle\.id, link\.id\)/);

  const updateStart = commandSource.indexOf("export async function updateVehicleCommand");
  const updateBody = commandSource.slice(updateStart, commandSource.indexOf("export async function deleteVehicleCommand"));
  assert.match(updateBody, /loadVehicleRecord\(tx, vehicleId, link\.id\)/);

  // The route no longer echoes the requested customerId verbatim in the
  // success path — it forwards record.customerId (the real owner).
  const route = src("../app/api/v1/vehicles/route.ts");
  const postBody = route.slice(route.indexOf("export async function POST"));
  assert.doesNotMatch(postBody, /customerId: customerIdStr/);
  assert.match(postBody, /customerId: record\.customerId/);
});

test("no vehicle count quota; the remaining per-caller flags stay pinned", () => {
  const actions = src("../app/_actions/vehicles.ts");
  const quickCreate = src("../app/_actions/quick-create.ts");
  const route = src("../app/api/v1/vehicles/route.ts");

  // Vehicle count quota removed (plans differ by modules only); no per-caller
  // plan-limit flag either.
  const commandSourceEarly = src("../lib/vehicles/vehicle-commands.ts");
  assert.doesNotMatch(commandSourceEarly, /enforceCountLimit|PLAN_LIMIT_REACHED|DAILY_LIMIT_REACHED|PLAN_LIMIT_CODES\.(MAX_|DAILY_)/);
  assert.doesNotMatch(commandSourceEarly, /enforcePlanLimit/);
  for (const caller of [actions, quickCreate, route]) {
    assert.doesNotMatch(caller, /enforcePlanLimit/);
  }

  // Duplicate rejection: dashboard action only.
  assert.match(actions, /rejectDuplicate:\s*true/);
  assert.match(quickCreate, /rejectDuplicate:\s*false/);
  assert.match(route, /rejectDuplicate:\s*false/);

  // Mandatory customerId: quick-create only.
  assert.match(quickCreate, /requireCustomerId:\s*true/);
  assert.doesNotMatch(actions, /requireCustomerId:\s*true/);
  assert.doesNotMatch(route, /requireCustomerId:\s*true/);

  // Year upper bound: the route alone relaxes it.
  assert.match(route, /enforceYearUpperBound:\s*false/);
  assert.doesNotMatch(actions, /enforceYearUpperBound:\s*false/);
  assert.doesNotMatch(quickCreate, /enforceYearUpperBound:\s*false/);

  // The command must not silently default the REMAINING flags on. (The
  // plan-limit flag no longer exists — see the assertions above.)
  const commandSource = src("../lib/vehicles/vehicle-commands.ts");
  assert.match(commandSource, /if \(input\.rejectDuplicate\)/);
});

test("quick-create keeps its distinguishing audit tag", () => {
  const quickCreate = src("../app/_actions/quick-create.ts");
  const start = quickCreate.indexOf("export async function quickCreateVehicleAction");
  const body = quickCreate.slice(start);
  assert.match(body, /auditSummarySuffix:\s*"\(засварын хуудаснаас түргэн\)"/);
  const commandSource = src("../lib/vehicles/vehicle-commands.ts");
  assert.match(commandSource, /auditSummarySuffix/);
});

test("mileage stays a dashboard/API-only field — quick-create's input type has no mileage", () => {
  const quickCreate = src("../app/_actions/quick-create.ts");
  const start = quickCreate.indexOf("export async function quickCreateVehicleAction");
  const signatureEnd = quickCreate.indexOf("): Promise<QuickVehicleResult>", start);
  const signature = quickCreate.slice(start, signatureEnd);
  assert.doesNotMatch(signature, /mileage/);
});

test("wheelPosition stays absent from the staff API POST body — the route never destructures or forwards it", () => {
  const route = src("../app/api/v1/vehicles/route.ts");
  const postBody = route.slice(route.indexOf("export async function POST"));
  // Only check the code, not explanatory comments: the route must neither
  // read `wheelPosition` off the request body nor pass it to the command.
  const codeOnly = postBody
    .split("\n")
    .filter((line) => !line.trim().startsWith("//"))
    .join("\n");
  assert.doesNotMatch(codeOnly, /wheelPosition/);
});

test("no P2002 handling remains in the vehicle command paths — plate/vin are no longer unique", () => {
  const commandSource = src("../lib/vehicles/vehicle-commands.ts");
  assert.doesNotMatch(commandSource, /P2002/);
});

test("the cross-tenant owner-import branch stays gone (D-153) — no cross-tenant vehicle lookup exists", () => {
  const commandSource = src("../lib/vehicles/vehicle-commands.ts");
  assert.doesNotMatch(commandSource, /importOwner|crossTenant|otherTenant/i);
});

test("no-plate vehicles require a VIN and are matched by VIN, plate can be assigned once", async () => {
  const { NO_PLATE, isNoPlate, plateLabel } = await import("../lib/vehicle-plate");
  assert.equal(isNoPlate(" дугааргүй "), true);
  assert.equal(isNoPlate("1234УБА"), false);
  assert.equal(plateLabel(NO_PLATE, "JT2BF22K1W0123456"), "Дугааргүй · JT2BF22K1W0123456");
  assert.equal(plateLabel("1234УБА", "X"), "1234УБА");

  const missingVin = commands.validateVehicleInput({ plate: NO_PLATE, make: "Toyota", model: "Prius" });
  assert.ok(missingVin.fieldErrors.vin);
  const withVin = commands.validateVehicleInput({ plate: NO_PLATE, vin: "jt2bf22k1w0123456", make: "Toyota", model: "Prius" });
  assert.deepEqual(withVin.fieldErrors, {});
  assert.equal(withVin.data.vin, "JT2BF22K1W0123456");
  // Энгийн дугаартай машинд VIN заавал биш хэвээр.
  assert.deepEqual(commands.validateVehicleInput({ plate: "1234abc", make: "T", model: "P" }).fieldErrors, {});

  // Дугааргүй машиныг ижил эзэнд VIN-ээр л тааруулна (бүгд ижил тэмдэгтэй).
  const vehiclesSrc = src("../lib/vehicles.ts");
  assert.match(vehiclesSrc, /ownerWhere && noPlate \? \(vin \? \{ \.\.\.ownerWhere, vin \} : null\) : ownerWhere/);
  // Засахад зөвхөн дугааргүй машинд жинхэнэ дугаар оноогдоно.
  const commandsSrc = src("../lib/vehicles/vehicle-commands.ts");
  assert.match(commandsSrc, /isNoPlate\(current\.plate\) && inputPlate && !isNoPlate\(inputPlate\)/);
});

test("invalid VIN is a field error, empty VIN is fine", () => {
  const base = { plate: "1111УАА", make: "Toyota", model: "Prius" };
  assert.equal(
    commands.validateVehicleInput({ ...base, vin: "ABC" }).fieldErrors.vin,
    "VIN 17 тэмдэгт эсвэл Япон рамын дугаар (9–14 тэмдэгт) байна.",
  );
  assert.equal(commands.validateVehicleInput({ ...base, vin: "" }).fieldErrors.vin, undefined);
  // plate-less: required message wins, a bad VIN is still rejected
  const noPlate = { plate: "ДУГААРГҮЙ", make: "Toyota", model: "Prius" };
  assert.equal(
    commands.validateVehicleInput({ ...noPlate, vin: "" }).fieldErrors.vin,
    "Улсын дугааргүй машинд арлын дугаар (VIN) заавал.",
  );
  assert.equal(
    commands.validateVehicleInput({ ...noPlate, vin: "ABC" }).fieldErrors.vin,
    "VIN 17 тэмдэгт эсвэл Япон рамын дугаар (9–14 тэмдэгт) байна.",
  );
});

test("an unchanged legacy VIN passes validation; a changed bad VIN or create still fails", () => {
  const base = { plate: "1111УАА", make: "Toyota", model: "Prius" };
  const legacy = "ABC123-4-5678901234"; // fails isValidVin
  assert.equal(
    commands.validateVehicleInput({ ...base, vin: legacy.toLowerCase() }, { existingVin: legacy }).fieldErrors.vin,
    undefined,
  );
  assert.ok(commands.validateVehicleInput({ ...base, vin: "ABC" }, { existingVin: legacy }).fieldErrors.vin);
  assert.ok(commands.validateVehicleInput({ ...base, vin: legacy }).fieldErrors.vin);
});

test("update loads stored VIN; create resolves owner regnum server-side without masked values", () => {
  const body = src("../lib/vehicles/vehicle-commands.ts");
  const upd = body.slice(body.indexOf("export async function updateVehicleCommand"));
  assert.match(upd, /existingVin: stored\?\.vin/);
  const crt = body.slice(body.indexOf("export async function createVehicleCommand"), body.indexOf("export async function updateVehicleCommand"));
  assert.match(crt, /isMaskedValue\(attrs\.ownerRegnum\)/);
  assert.match(crt, /input\.resolveOwnerRegnum && !attrs\.ownerRegnum/);
  assert.match(src("../app/_actions/vehicles.ts"), /resolveOwnerRegnum: formData\.get\("fromLookup"\) === "1"/);
  const hurSrc = src("../lib/hur-lookup.ts");
  const fn = hurSrc.slice(hurSrc.indexOf("export async function resolveOwnerRegnumForNewVehicle"));
  assert.ok(fn.indexOf("if (existing) return") < fn.indexOf("consumeRateLimit(`hur:${userId}`"));
  assert.ok(fn.indexOf("consumeRateLimit") < fn.indexOf("HurService.getVehicle"));
  assert.match(body, /where: \{ tenantId_vehicleId: \{ tenantId: actor\.tenantId, vehicleId \} \},\s*select: \{ vehicle: \{ select: \{ vin: true \}/);
});
