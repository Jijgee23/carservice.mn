/**
 * Appointment master is REQUIRED and never cleared (QA #28 ruling, mirrors
 * orders). Behavioral coverage of the pure rule module; source guards pin the
 * wiring in server-only command/route files (not importable under tsx --test).
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ASSIGNEE_CLEAR_MESSAGE,
  ASSIGNEE_REQUIRED_FIELD_MESSAGE,
  checkAssigneeChange,
  resolveConfirmAssignee,
  resolveCreateAssignee,
} from "../lib/appointments/appointment-assignee-rule";

const here = dirname(fileURLToPath(import.meta.url));
const readSource = (p: string) => readFileSync(resolve(here, p), "utf8");

test("create: orders.assign user without a master -> ASSIGNEE_REQUIRED with field error", () => {
  for (const requested of [undefined, null, ""]) {
    const r = resolveCreateAssignee({ canAssign: true, actorId: "me", requested });
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.equal(r.code, "ASSIGNEE_REQUIRED");
      assert.equal(r.fieldErrors.assignedToId, ASSIGNEE_REQUIRED_FIELD_MESSAGE);
      assert.equal(ASSIGNEE_REQUIRED_FIELD_MESSAGE, "Хариуцах мастер сонгоно уу.");
    }
  }
});

test("create: orders.assign user with a master keeps it", () => {
  assert.deepEqual(resolveCreateAssignee({ canAssign: true, actorId: "me", requested: "m1" }), {
    ok: true,
    assigneeId: "m1",
  });
});

test("create: user without orders.assign is assigned to themselves when none given", () => {
  for (const requested of [undefined, null]) {
    assert.deepEqual(resolveCreateAssignee({ canAssign: false, actorId: "me", requested }), {
      ok: true,
      assigneeId: "me",
    });
  }
  // an explicit other id is passed through (the 403 self-only check rejects it later)
  assert.deepEqual(resolveCreateAssignee({ canAssign: false, actorId: "me", requested: "other" }), {
    ok: true,
    assigneeId: "other",
  });
});

test("confirm: master-less appointment requires a master (orders.assign) or self-assigns", () => {
  const none = resolveConfirmAssignee({ canAssign: true, actorId: "me", requested: undefined, current: null });
  assert.equal(none.ok, false);
  const nullReq = resolveConfirmAssignee({ canAssign: true, actorId: "me", requested: null, current: null });
  assert.equal(nullReq.ok, false);
  assert.deepEqual(resolveConfirmAssignee({ canAssign: true, actorId: "me", requested: "m1", current: null }), {
    ok: true,
    assigneeId: "m1",
  });
  assert.deepEqual(resolveConfirmAssignee({ canAssign: false, actorId: "me", requested: undefined, current: null }), {
    ok: true,
    assigneeId: "me",
  });
});

test("confirm: an appointment that already has a master keeps it unless another is chosen", () => {
  assert.deepEqual(resolveConfirmAssignee({ canAssign: true, actorId: "me", requested: undefined, current: "m1" }), {
    ok: true,
    assigneeId: undefined,
  });
  assert.deepEqual(resolveConfirmAssignee({ canAssign: true, actorId: "me", requested: "m2", current: "m1" }), {
    ok: true,
    assigneeId: "m2",
  });
});

test("clearing a stored master is rejected on PATCH and confirm with the orders message", () => {
  const patch = checkAssigneeChange({ requested: null, current: "m1" });
  assert.equal(patch.ok, false);
  if (!patch.ok) {
    assert.equal(patch.code, "ASSIGNEE_REQUIRED");
    assert.equal(patch.message, ASSIGNEE_CLEAR_MESSAGE);
    assert.equal(patch.message, "Хариуцах мастерыг арилгах боломжгүй — өөр мастер сонгоно уу.");
  }
  const confirm = resolveConfirmAssignee({ canAssign: true, actorId: "me", requested: null, current: "m1" });
  assert.equal(confirm.ok, false);
});

test("changing to another master, or leaving it untouched, is allowed", () => {
  assert.deepEqual(checkAssigneeChange({ requested: "m2", current: "m1" }), { ok: true });
  assert.deepEqual(checkAssigneeChange({ requested: undefined, current: "m1" }), { ok: true });
  assert.deepEqual(checkAssigneeChange({ requested: "m1", current: "m1" }), { ok: true });
  // null on an already master-less (legacy) appointment is a harmless no-op
  assert.deepEqual(checkAssigneeChange({ requested: null, current: null }), { ok: true });
});

test("wiring: create, confirm and set-assignee commands apply the rules", () => {
  const create = readSource("../lib/appointments/appointment-create-command.ts");
  assert.match(create, /resolveCreateAssignee\(/);
  assert.match(create, /canAssign: canAssignOrders\(actor\)/);
  const commands = readSource("../lib/appointments/appointment-commands.ts");
  assert.match(commands, /resolveConfirmAssignee\(/);
  assert.match(commands, /checkAssigneeChange\(/);
  const assignee = readSource("../lib/appointments/appointment-assignee.ts");
  assert.match(assignee, /throw new AppointmentCommandError\(rule\.message, 422, rule\.code, rule\.fieldErrors\)/);
  assert.doesNotMatch(assignee, /requestedAssigneeId === null\) \{\s*\n\s*if/, "old clear-with-orders.assign branch must be gone");
});

test("web: picker has no clear option; confirm of a master-less appointment asks for a master", () => {
  const actions = readSource("../app/dashboard/appointments/appointment-row-actions.tsx");
  const picker = actions.slice(actions.indexOf("export function AppointmentAssigneePicker"));
  assert.doesNotMatch(picker, /clearable/);
  assert.match(actions, /needsAssignee/);
  assert.match(actions, /name="assignedToId"/);
  const form = readSource("../app/dashboard/appointments/appointment-form.tsx");
  assert.doesNotMatch(form, /clearable\s*\n\s*disabled=\{!branchId\}/);
  assert.match(form, /Хариуцах мастер \*/);
  assert.match(form, /currentUserId/);
});

test("customer booking API stays master-less", () => {
  const root = resolve(here, "../app/api/v1/app");
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((n) => {
      const full = resolve(dir, n);
      return statSync(full).isDirectory() ? walk(full) : /\.tsx?$/.test(n) ? [full] : [];
    });
  for (const file of walk(root)) {
    assert.doesNotMatch(readFileSync(file, "utf8"), /assignedTo|ASSIGNEE_REQUIRED/, file);
  }
  const reservations = readSource("../lib/appointment-reservations.ts");
  assert.doesNotMatch(reservations, /ASSIGNEE_REQUIRED/);
});

test("empty-picker reasons and kept-master recheck are wired", async () => {
  const { emptyAssigneeReason, NO_ASSIGN_PERMISSION_MESSAGE, NO_ELIGIBLE_MASTER_MESSAGE } = await import(
    "../lib/appointments/appointment-assignee-label"
  );
  assert.equal(emptyAssigneeReason("me"), NO_ASSIGN_PERMISSION_MESSAGE);
  assert.equal(emptyAssigneeReason(null), NO_ELIGIBLE_MASTER_MESSAGE);
  assert.match(NO_ELIGIBLE_MASTER_MESSAGE, /мастер алга/);
  const commands = readSource("../lib/appointments/appointment-commands.ts");
  assert.match(commands, /isCarriedAssigneeIneligible\(error, true\)/);
  assert.match(commands, /"ASSIGNEE_REQUIRED"/);
});
