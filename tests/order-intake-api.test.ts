import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { INTAKE_MILEAGE_ERROR, INTAKE_NOTES_MAX, INTAKE_PHOTOS_MAX, formatMileageKm, intakeStagingSubdir } from "../lib/orders/order-intake";
import { INTAKE_PATH_CLAIMED_MESSAGE, readIntakeBody, validateIntakeFields } from "../lib/orders/order-intake-server";
import { toIntakeView, type IntakeViewRow } from "../lib/orders/order-intake-view";

const T = "tenant_1";
const U = "user_1";
const staged = (n: number) => `/uploads/${intakeStagingSubdir(T, U)}/${n.toString(16).padStart(24, "0")}.jpg`;

test("validateIntakeFields: empty input yields null intake", async () => {
  assert.deepEqual(await validateIntakeFields({}, T, U), { intake: null });
  assert.deepEqual(await validateIntakeFields({ notes: "  ", photoPaths: [""], signaturePath: " " }, T, U), { intake: null });
});

test("validateIntakeFields: notes too long", async () => {
  const r = await validateIntakeFields({ notes: "x".repeat(INTAKE_NOTES_MAX + 1) }, T, U);
  assert.equal(r.intake, null);
  assert.ok(r.error);
});

test("validateIntakeFields: too many photos", async () => {
  const photoPaths = Array.from({ length: INTAKE_PHOTOS_MAX + 1 }, (_, i) => staged(i + 1));
  const r = await validateIntakeFields({ photoPaths }, T, U);
  assert.equal(r.intake, null);
  assert.ok(r.error);
});

test("validateIntakeFields: foreign or malformed paths are rejected", async () => {
  for (const p of [
    staged(1).replace(U, "user_2"),
    `/uploads/logos/${"a".repeat(24)}.jpg`,
    "/etc/passwd",
  ]) {
    const asPhoto = await validateIntakeFields({ photoPaths: [p] }, T, U);
    assert.equal(asPhoto.intake, null);
    assert.ok(asPhoto.error);
    const asSig = await validateIntakeFields({ signaturePath: p }, T, U);
    assert.equal(asSig.intake, null);
    assert.ok(asSig.error);
  }
});

test("readIntakeBody: type guards", () => {
  assert.deepEqual(readIntakeBody(undefined), { fields: null });
  assert.deepEqual(readIntakeBody(null), { fields: null });
  for (const bad of ["x", 1, [], { notes: 1 }, { photoPaths: "a" }, { photoPaths: [1] }, { signaturePath: 5 }]) {
    assert.ok(readIntakeBody(bad).error, `expected error for ${JSON.stringify(bad)}`);
  }
  assert.deepEqual(readIntakeBody({ notes: "n" }), {
    fields: { notes: "n", photoPaths: [], signaturePath: null, mileageKm: null },
  });
  assert.equal(readIntakeBody({ mileageKm: 152300 }).fields?.mileageKm, 152300);
  assert.equal(readIntakeBody({ mileageKm: null }).fields?.mileageKm, null);
  for (const bad of [{ mileageKm: "5" }, { mileageKm: true }, { mileageKm: {} }]) {
    assert.equal(readIntakeBody(bad).error, INTAKE_MILEAGE_ERROR);
  }
});

test("validateIntakeFields: mileage valid, missing, and bounds", async () => {
  const ok = await validateIntakeFields({ mileageKm: 152300 }, T, U);
  assert.deepEqual(ok, { intake: { notes: null, photoPaths: [], signaturePath: null, mileageKm: 152300 } });
  assert.equal((await validateIntakeFields({ mileageKm: 0 }, T, U)).intake?.mileageKm, 0);
  assert.equal((await validateIntakeFields({ mileageKm: 2_000_000 }, T, U)).intake?.mileageKm, 2_000_000);
  // Missing / null mileage: still empty intake.
  assert.deepEqual(await validateIntakeFields({ mileageKm: null }, T, U), { intake: null });
  assert.equal((await validateIntakeFields({ notes: "n" }, T, U)).intake?.mileageKm, null);
  for (const bad of [-1, 2_000_001, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    const r = await validateIntakeFields({ mileageKm: bad }, T, U);
    assert.equal(r.intake, null);
    assert.equal(r.error, INTAKE_MILEAGE_ERROR, `mileage ${bad}`);
  }
});

test("parseIntakeInput: strips commas from intakeMileageKm and rejects junk", async () => {
  const { parseIntakeInput } = await import("../lib/orders/order-intake-server");
  const fd = (v: string) => {
    const f = new FormData();
    f.set("intakeMileageKm", v);
    return f;
  };
  assert.equal((await parseIntakeInput(fd("152,300"), T, U)).intake?.mileageKm, 152300);
  assert.deepEqual(await parseIntakeInput(fd(""), T, U), { intake: null });
  assert.equal((await parseIntakeInput(fd("12a"), T, U)).error, INTAKE_MILEAGE_ERROR);
  assert.equal((await parseIntakeInput(fd("2,000,001"), T, U)).error, INTAKE_MILEAGE_ERROR);
});

test("formatMileageKm groups thousands", () => {
  assert.equal(formatMileageKm(152300), "152,300 км");
  assert.equal(formatMileageKm(0), "0 км");
});

const recorded: IntakeViewRow = {
  intakeNotes: "Scratch on door",
  intakeRecordedAt: new Date("2026-10-02T09:30:00.000Z"),
  intakeSignaturePath: "/uploads/sig.png",
  intakeMileageKm: 152300,
  intakeChecklist: [{ label: "Тос", status: "ISSUE", note: "бага" }, { label: "bad" }],
  intakePhotos: [
    { id: "p2", path: "/uploads/b.jpg" },
    { id: "p1", path: "/uploads/a.jpg" },
  ],
  intakeRecordedBy: { firstName: "Bat", lastName: "Dorj" },
};

test("toIntakeView: null when not recorded", () => {
  const row = { ...recorded, intakeRecordedAt: null };
  assert.equal(toIntakeView(row, { includeRecordedBy: true }), null);
});

test("toIntakeView: staff view includes recordedBy and keeps photo order", () => {
  const v = toIntakeView(recorded, { includeRecordedBy: true });
  assert.deepEqual(v, {
    notes: "Scratch on door",
    photos: [
      { id: "p2", url: "/uploads/b.jpg" },
      { id: "p1", url: "/uploads/a.jpg" },
    ],
    signatureUrl: "/uploads/sig.png",
    mileageKm: 152300,
    // Буруу хэлбэрийн мөрийг алгасна.
    checklist: [{ label: "Тос", status: "ISSUE", note: "бага" }],
    recordedAt: "2026-10-02T09:30:00.000Z",
    recordedBy: "Dorj Bat",
  });
});

test("toIntakeView: mileageKm is null when not entered", () => {
  assert.equal(toIntakeView({ ...recorded, intakeMileageKm: null }, { includeRecordedBy: true })?.mileageKm, null);
});

test("toIntakeView: customer view hides recordedBy; missing user gives null", () => {
  assert.equal(toIntakeView(recorded, { includeRecordedBy: false })?.recordedBy, null);
  assert.equal(toIntakeView({ ...recorded, intakeRecordedBy: null }, { includeRecordedBy: true })?.recordedBy, null);
});

test("routes use the shared intake view and uploads handles kind=intake", async () => {
  const staff = await readFile(new URL("../app/api/v1/orders/[id]/route.ts", import.meta.url), "utf8");
  const customer = await readFile(new URL("../app/api/v1/app/orders/[id]/route.ts", import.meta.url), "utf8");
  const create = await readFile(new URL("../app/api/v1/orders/route.ts", import.meta.url), "utf8");
  const uploads = await readFile(new URL("../app/api/v1/uploads/route.ts", import.meta.url), "utf8");

  for (const [label, src] of [["staff detail", staff], ["customer detail", customer]] as const) {
    assert.match(src, /\.\.\.INTAKE_VIEW_SELECT/, `${label} must spread INTAKE_VIEW_SELECT`);
    assert.match(src, /toIntakeView\(/, `${label} must use toIntakeView`);
  }
  assert.match(staff, /includeRecordedBy:\s*true/);
  assert.match(customer, /includeRecordedBy:\s*false/);
  assert.match(create, /validateIntakeFields\(/);
  assert.match(create, /\n\s*intake,\s*\n/, "create route must pass intake to createOrderCommand");
  assert.match(create, /intakeChecklist: \(body as Record<string, unknown>\)\.intakeChecklist,/);
  assert.match(uploads, /kind === "intake"/);
  assert.match(uploads, /requirePermission\(auth\.user, "orders\.create"\)/);
  assert.match(uploads, /intakeStagingSubdir\(auth\.user\.tenantId, auth\.user\.id\)/);
  // PATCH writes no intake fields.
  const patch = staff.slice(staff.indexOf("export async function PATCH"));
  assert.doesNotMatch(patch, /intake(Notes|Photos|Signature)/i);
});

test("validateIntakeFields: same path as photo and signature is rejected", async () => {
  const p = staged(7);
  const r = await validateIntakeFields({ photoPaths: [p], signaturePath: p }, T, U, async () => false);
  assert.equal(r.intake, null);
  assert.equal(r.error, INTAKE_PATH_CLAIMED_MESSAGE);
});

test("already-claimed lookup and P2002 mapping are wired", async () => {
  const server = await readFile(new URL("../lib/orders/order-intake-server.ts", import.meta.url), "utf8");
  assert.match(server, /serviceOrderIntakePhoto\.findFirst/);
  assert.match(server, /intakeSignaturePath:\s*\{ in: paths \}/);
  assert.match(server, /await isClaimed\(tenantId, all\)/);
  const cmd = await readFile(new URL("../lib/orders/order-create-command.ts", import.meta.url), "utf8");
  assert.match(cmd, /INTAKE_PATH_CLAIMED/);
  assert.match(cmd, /P2002[\s\S]*INTAKE_PATH_CLAIMED_MESSAGE[\s\S]*continue;/);
});
