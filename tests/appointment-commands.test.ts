import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// `lib/appointments/appointment-commands.ts` transitively imports
// `lib/subscription-server.ts`, which does `import "server-only"` — a package
// Next's bundler resolves specially at build time but that plain Node module
// resolution cannot see, so it is not importable under `tsx --test` (see the
// KNOWN GAP note in tests/api-branch-routes.test.ts, and the order-commands
// precedent this slice mirrors, which avoids the same trap by never touching
// a server-only-tagged module from its command file). We therefore verify
// this slice's structure and pinned regressions from source text rather than
// a live module import; behavioral coverage is `npm run build` + `npm run
// lint` + manual/staging verification, same as every other server-only-
// adjacent command module in this codebase.

process.env.DATABASE_URL ??= "postgresql://unused/unused";
process.env.SESSION_SECRET ??= "unit-test-placeholder-secret-value-not-real-00";

function readSource(relativePath: string): string {
  return readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), relativePath), "utf8");
}

const actionsSource = () => readSource("../app/_actions/appointments.ts");
const commandsSource = () => readSource("../lib/appointments/appointment-commands.ts");
const bulkSource = () => readSource("../lib/appointments/appointment-bulk-commands.ts");
const createSource = () => readSource("../lib/appointments/appointment-create-command.ts");

// --- Module shape -----------------------------------------------------------

test("appointment commands module exports the expected typed commands", () => {
  const source = commandsSource();
  for (const name of [
    "confirmAppointmentCommand",
    "rejectAppointmentCommand",
    "markAppointmentNoShowCommand",
    "markAppointmentArrivedCommand",
    "cancelAppointmentByAccountCommand",
    "rescheduleAppointmentCommand",
    "rescheduleAppointmentByAccountCommand",
    "assertStaffScope",
    "AppointmentCommandError",
  ]) {
    assert.match(source, new RegExp(`export (async function|class|const) ${name}\\b`));
  }
  assert.match(bulkSource(), /export (async function|const) bulkChangeAppointmentCategoryCommand\b/);
  assert.match(bulkSource(), /export (async function|const) changeAppointmentCategoryCommand\b/);
  assert.match(createSource(), /export (async function|const) registerAppointmentByStaffCommand\b/);
});

test("AppointmentCommandError declares status, code and optional field errors", () => {
  const source = commandsSource();
  const classStart = source.indexOf("export class AppointmentCommandError");
  assert.notEqual(classStart, -1);
  const classBody = source.slice(classStart, classStart + 400);
  assert.match(classBody, /public readonly status = 422/);
  assert.match(classBody, /public readonly code = "APPOINTMENT_COMMAND_REJECTED"/);
  assert.match(classBody, /public readonly fieldErrors\?: Record<string, string>/);
});

// --- D-132: linked-order reschedule correction is carried, not re-derived ---

test("D-132: reschedule command routes a still-SCHEDULED linked order through moveLinkedAppointmentOrder", () => {
  const source = commandsSource();
  const linkedBlockStart = source.indexOf("if (appt.serviceOrderId) {", source.indexOf("rescheduleAppointmentCommand"));
  const linkedBlockEnd = source.indexOf("const requestedDateStr = bookingDateKey", linkedBlockStart);
  assert.notEqual(linkedBlockStart, -1);
  const block = source.slice(linkedBlockStart, linkedBlockEnd);
  assert.match(block, /appt\.serviceOrder\?\.status !== "SCHEDULED"/);
  assert.match(block, /moveLinkedAppointmentOrder\(/);
  assert.match(block, /canEditOrder\(actor, linked\)/);
});

// --- D-111: the capacity-blind overlap-confirm warning stays removed --------

test("D-111: reschedule command never reintroduces the generic overlap-confirm warning", () => {
  const source = commandsSource();
  assert.doesNotMatch(source, /давхцаж байна/); // the removed overlap-warning Mongolian phrase
  assert.doesNotMatch(source, /overlapWarning|confirmNeeded.*overlap/i);
  assert.match(source, /D-111/); // the removal stays documented, not silently dropped
});

// --- D-135/D-136: every requireUser() catch rethrows NEXT_REDIRECT first ---

test("D-136: every requireUser() catch in app/_actions/appointments.ts calls unstable_rethrow first", () => {
  const source = actionsSource();
  const requireUserCatchStarts: number[] = [];
  const pattern = /=\s*await requireUser\(\);\s*\n\s*\}\s*catch \(e\) \{/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source))) {
    requireUserCatchStarts.push(match.index + match[0].length);
  }
  // D-135 recorded seven requireUser() catches in this file (repair, confirm,
  // reject, no-show, reschedule's nested auth catch, arrived, bulk category);
  // QA #28 added an eighth (setAppointmentAssigneeAction).
  assert.equal(
    requireUserCatchStarts.length,
    8,
    `expected 8 requireUser() catches, found ${requireUserCatchStarts.length}`,
  );
  for (const start of requireUserCatchStarts) {
    const nextLines = source.slice(start, start + 200);
    assert.match(
      nextLines,
      /unstable_rethrow\(e\);/,
      `catch block starting at offset ${start} does not call unstable_rethrow(e) first`,
    );
  }
});

test("app/_actions/appointments.ts imports unstable_rethrow from next/navigation", () => {
  const source = actionsSource();
  assert.match(source, /import \{ redirect, unstable_rethrow \} from "next\/navigation";/);
});

// --- Adapters delegate to the shared commands, not a second implementation --

test("action adapters call the shared appointment commands rather than reimplementing them", () => {
  const source = actionsSource();
  for (const call of [
    "confirmAppointmentCommand(",
    "rejectAppointmentCommand(",
    "markAppointmentNoShowCommand(",
    "markAppointmentArrivedCommand(",
    "cancelAppointmentByAccountCommand(",
    "rescheduleAppointmentCommand(",
    "rescheduleAppointmentByAccountCommand(",
    "registerAppointmentByStaffCommand(",
    "bulkChangeAppointmentCategoryCommand(",
  ]) {
    assert.ok(source.includes(call), `expected action adapters to call ${call}`);
  }
});

test("command modules carry no FormData, redirect, revalidatePath or NextResponse", () => {
  const source = commandsSource() + createSource() + bulkSource();
  assert.doesNotMatch(source, /FormData/);
  assert.doesNotMatch(source, /revalidatePath/);
  assert.doesNotMatch(source, /redirect\(/);
  assert.doesNotMatch(source, /NextResponse/);
});

test("bulk category command allows partial success and locks each target independently", () => {
  const source = bulkSource();
  assert.match(source, /for \(const appointmentId of input\.appointmentIds\) \{/);
  assert.match(source, /try \{[\s\S]*?changeAppointmentCategoryCommand\(/);
  assert.match(source, /catch \(error\) \{[\s\S]*?failed\.push/);
});

test("STAFF_SCOPE_MESSAGES constant lists exactly the two assertStaffScope throw messages", () => {
  const source = commandsSource();
  assert.match(
    source,
    /export const STAFF_SCOPE_MESSAGES = \[\s*STAFF_SCOPE_FORBIDDEN_MESSAGE,\s*STAFF_SCOPE_WRONG_BRANCH_MESSAGE,\s*\] as const;/,
  );
});

test("confirm/reject/no-show/arrived/reschedule preserve tenant scoping before mutating", () => {
  const source = commandsSource();
  for (const fn of [
    "confirmAppointmentCommand",
    "rejectAppointmentCommand",
    "markAppointmentNoShowCommand",
    "markAppointmentArrivedCommand",
  ]) {
    const start = source.indexOf(`export async function ${fn}(`);
    assert.notEqual(start, -1, `missing ${fn}`);
    const end = source.indexOf("\nexport ", start + 10);
    const body = source.slice(start, end === -1 ? undefined : end);
    assert.match(body, /assertStaffTenantScope\(actor, appt\)/, `${fn} must assert staff+tenant scope`);
  }
});

test("registerAppointmentByStaffCommand preserves working-branch scope and reservation override semantics", () => {
  const source = createSource();
  assert.match(source, /workingBranchScopeId\(actor\)/);
  assert.match(source, /ReservationConflictError/);
  assert.match(source, /confirmed/);
});

test("staff registration uses appointments.create, not the edit-only lifecycle gate", () => {
  const source = createSource();
  assert.match(source, /canCreate\(actor, "appointments"\)/);
  assert.match(source, /assertActiveSubscription\(actor\.tenantId\)/);
  const fnStart = source.indexOf("export async function registerAppointmentByStaffCommand");
  assert.notEqual(fnStart, -1);
  const body = source.slice(fnStart);
  assert.doesNotMatch(body, /assertStaffScope\(actor/);
});

test("pending appointment in the past is overdue; confirmed or future is not", async () => {
  const { isAppointmentOverdue } = await import("../lib/appointments");
  const now = new Date("2026-09-28T10:00:00Z");
  assert.equal(isAppointmentOverdue({ status: "PENDING", requestedAt: new Date("2026-09-24T10:00:00Z") }, now), true);
  assert.equal(isAppointmentOverdue({ status: "PENDING", requestedAt: new Date("2026-09-29T10:00:00Z") }, now), false);
  assert.equal(isAppointmentOverdue({ status: "CONFIRMED", requestedAt: new Date("2026-09-24T10:00:00Z") }, now), false);
});

test("confirmAppointmentCommand rejects overdue appointments with APPOINTMENT_OVERDUE", () => {
  const source = commandsSource();
  const start = source.indexOf("export async function confirmAppointmentCommand");
  assert.ok(start >= 0);
  const body = source.slice(start, source.indexOf("export async function", start + 10));
  assert.match(body, /isAppointmentOverdue\(appt\)/);
  assert.match(body, /APPOINTMENT_OVERDUE/);
});

test("account cancel refuses an appointment that already has a linked service order", () => {
  const source = commandsSource();
  const start = source.indexOf("export async function cancelAppointmentByAccountCommand");
  assert.notEqual(start, -1);
  const body = source.slice(start, source.indexOf("export type RescheduleAppointmentResult", start));
  assert.match(body, /serviceOrderId: true/);
  assert.match(body, /if \(!appt \|\| appt\.serviceOrderId \|\|/);
  assert.match(body, /serviceOrderId: null,\s*\},\s*data: \{ status: "CANCELLED" \}/);
});

test("app cancel route refuses an appointment with a linked service order (409)", () => {
  const route = readFileSync(new URL("../app/api/v1/app/appointments/[id]/cancel/route.ts", import.meta.url), "utf8");
  assert.match(route, /if \(appt\.serviceOrderId\) \{\s*return jsonError\(409,/);
  assert.match(route, /updateMany\(\{\s*where: \{.*serviceOrderId: null \}/);
});
