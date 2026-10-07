/**
 * QA #28 — optional responsible master (`Appointment.assignedToId`).
 *
 * Behavioral: request parser, picker option helper, reservation persistence
 * (with a fake transaction client, same pattern as appointment-create-request),
 * calendar day model. Source guards pin what cannot be imported under
 * `tsx --test` (server-only modules): shared validation, permission mirror,
 * customer-API exclusion, carry-over to ServiceOrder.assignedToId.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Prisma } from "../app/generated/prisma/client";
import { reserveAppointmentInTransaction, ReservationError } from "../lib/appointment-reservations";
import { parseCreateAppointmentBody } from "../lib/appointments/appointment-create-request";
import { readdirSync, statSync } from "node:fs";
import { buildCalendarDayModel } from "../lib/appointments/calendar-day-model";
import {
  appointmentAssigneeLabel,
  isCarriedAssigneeIneligible,
  CARRIED_ASSIGNEE_INELIGIBLE_MESSAGE,
  assigneeOptionsForBranch,
  type AssigneeCandidate,
} from "../lib/appointments/appointment-assignee-label";

function readSource(relativePath: string): string {
  return readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), relativePath), "utf8");
}

const NOW = new Date("2030-01-07T09:00:00+08:00");
const body = { branchId: "b1", customerId: "c1", requestedAt: "2030-01-07T10:00:00" };

test("parser: assignedToId optional, trimmed, blank/null -> null, non-string -> 400", () => {
  for (const [input, expected] of [
    [undefined, null],
    [null, null],
    ["  ", null],
    [" u1 ", "u1"],
  ] as const) {
    const r = parseCreateAppointmentBody({ ...body, assignedToId: input }, NOW);
    assert.equal(r.ok, true);
    if (r.ok) assert.equal(r.value.assignedToId, expected);
  }
  const bad = parseCreateAppointmentBody({ ...body, assignedToId: 7 }, NOW);
  assert.equal(bad.ok, false);
  if (!bad.ok) assert.equal(bad.status, 400);
});

const candidates: AssigneeCandidate[] = [
  { id: "all", firstName: "Бат", lastName: "Дорж", branchId: null, assignableBranchIds: [] },
  { id: "b1", firstName: "Сүх", lastName: "Оюун", branchId: "b1", assignableBranchIds: [] },
  { id: "b2", firstName: "Нар", lastName: "Эрдэнэ", branchId: "b2", assignableBranchIds: [] },
  { id: "extra", firstName: "Саран", lastName: "Гэрэл", branchId: "b2", assignableBranchIds: ["b1"] },
];

test("picker options are scoped to the appointment's branch", () => {
  const ids = assigneeOptionsForBranch(candidates, "b1").map((o) => o.value);
  assert.deepEqual(ids.sort(), ["all", "b1", "extra"]);
});

test("picker options: self-only restriction and ineligible current assignee stays visible", () => {
  assert.deepEqual(
    assigneeOptionsForBranch(candidates, "b1", { onlyUserId: "b1" }).map((o) => o.value),
    ["b1"],
  );
  const withCurrent = assigneeOptionsForBranch(candidates, "b1", {
    current: { id: "gone", firstName: "Хуучин", lastName: "Мастер" },
  });
  const gone = withCurrent.find((o) => o.value === "gone");
  assert.equal(gone?.label, "Мастер Хуучин");
  assert.equal(appointmentAssigneeLabel(null), null);
});

function fakeTx(created: Prisma.AppointmentCreateArgs[]): Prisma.TransactionClient {
  return {
    $queryRaw: async () => [{ id: "branch" }],
    branch: {
      findFirst: async () => ({
        id: "branch",
        slotMinutes: 30,
        slotCapacity: 1,
        openTime: "10:00",
        closeTime: "11:00",
        schedules: [],
        tenant: { suspended: false, acceptsOnlineBooking: true },
      }),
      findUnique: async () => ({ slotMinutes: 30, slotCapacity: 1 }),
    },
    category: { findMany: async () => [] },
    accountVehicle: { findFirst: async () => null },
    customer: { findFirst: async () => ({ id: "customer" }) },
    appointment: {
      findMany: async () => [],
      create: async (args: Prisma.AppointmentCreateArgs) => {
        created.push(args);
        return { id: "a", status: args.data.status, requestedAt: args.data.requestedAt };
      },
    },
  } as unknown as Prisma.TransactionClient;
}

const reserveInput = {
  tenantId: "t",
  branchId: "branch",
  categoryIds: [] as string[],
  customerId: "customer",
  requestedAt: new Date("2030-01-07T10:00:00+08:00"),
};

test("reservation: staff booking persists the validated assignee inside the transaction", async () => {
  const created: Prisma.AppointmentCreateArgs[] = [];
  const validated: string[] = [];
  await reserveAppointmentInTransaction(
    fakeTx(created),
    {
      ...reserveInput,
      staffUserId: "staff",
      assignedToId: "master",
      validateAssignee: async (_tx, branchId) => {
        validated.push(branchId);
      },
    },
    NOW,
  );
  assert.equal(created[0].data.assignedToId, "master");
  assert.deepEqual(validated, ["branch"]);
});

test("reservation: a rejected assignee aborts before insert", async () => {
  const created: Prisma.AppointmentCreateArgs[] = [];
  await assert.rejects(
    reserveAppointmentInTransaction(
      fakeTx(created),
      {
        ...reserveInput,
        staffUserId: "staff",
        assignedToId: "master",
        validateAssignee: async () => {
          throw new Error("ineligible");
        },
      },
      NOW,
    ),
    /ineligible/,
  );
  assert.equal(created.length, 0);
});

test("reservation: an assignee without a validator is never persisted", async () => {
  const created: Prisma.AppointmentCreateArgs[] = [];
  await assert.rejects(
    reserveAppointmentInTransaction(
      fakeTx(created),
      { ...reserveInput, staffUserId: "staff", assignedToId: "master" },
      NOW,
    ),
    ReservationError,
  );
  assert.equal(created.length, 0);
});

test("reservation: customer (non-staff) bookings can never carry an assignee", async () => {
  const created: Prisma.AppointmentCreateArgs[] = [];
  await reserveAppointmentInTransaction(fakeTx(created), { ...reserveInput, assignedToId: "master" }, NOW);
  assert.equal(created[0].data.assignedToId, null);
});

test("calendar day model carries the master (even a stored one) per block", () => {
  const start = new Date("2030-01-07T10:00:00+08:00");
  const end = new Date("2030-01-07T10:30:00+08:00");
  const dayStart = new Date("2030-01-06T16:00:00Z");
  const dayEnd = new Date("2030-01-07T16:00:00Z");
  const appt = {
    id: "a1",
    status: "CONFIRMED" as const,
    requestedAt: start,
    serviceOrderId: null,
    account: null,
    customer: { fullName: "Үйлчлүүлэгч", phone: "99112233" },
    assignedToId: "m1",
    assignedTo: { id: "m1", firstName: "Сүх", lastName: "Оюун" },
    feeAmount: null,
    feeQpayInvoiceId: null,
    feeUnderpaidAmount: null,
    payment: null,
  };
  const model = buildCalendarDayModel({
    branchId: "b",
    branchName: "B",
    dateKey: "2030-01-07",
    rangeStart: dayStart,
    rangeEnd: dayEnd,
    intervals: [
      {
        id: "a1",
        source: "appointment",
        startMs: start.getTime(),
        endMs: end.getTime(),
        uncertain: false,
        role: "primary",
      },
    ] as never,
    issues: [],
    appointments: [appt] as never,
    slotCapacity: 1,
  });
  assert.equal(model.blocks.length, 1);
  assert.equal(model.blocks[0].assignedToId, "m1");
  assert.equal(model.blocks[0].assigneeName, "Оюун Сүх");
});

test("assignee validation reuses validateOrderAssignee and mirrors the orders.assign permission", () => {
  const src = readSource("../lib/appointments/appointment-assignee.ts");
  assert.match(src, /validateOrderAssignee\(/);
  assert.match(src, /canAssignOrders\(actor\)/);
  assert.doesNotMatch(src, /orderAssignableWhere|tx\.user\.find/, "must not duplicate the eligibility rules");

  const create = readSource("../lib/appointments/appointment-create-command.ts");
  assert.match(create, /assertCanSetAppointmentAssignee\(actor, assignedToId\)/);
  assert.match(create, /validateAppointmentAssignee\(tx,/);

  const commands = readSource("../lib/appointments/appointment-commands.ts");
  assert.match(commands, /export async function setAppointmentAssigneeCommand/);
  const confirmBody = commands.slice(
    commands.indexOf("export async function confirmAppointmentCommand"),
    commands.indexOf("export type SetAppointmentAssigneeResult"),
  );
  assert.match(confirmBody, /assertCanSetAppointmentAssignee\(/);
  assert.match(confirmBody, /validateAppointmentAssignee\(tx,/);
  const setBody = commands.slice(
    commands.indexOf("export async function setAppointmentAssigneeCommand"),
    commands.indexOf("export type RejectAppointmentResult"),
  );
  assert.match(setBody, /assertCanSetAppointmentAssignee\(/);
  assert.match(setBody, /validateAppointmentAssignee\(tx,/);
  // unchanged value is a no-op, so an ineligible stored master never blocks.
  assert.match(setBody, /assignedToId === appt\.assignedToId\) return/);
});

test("staff API accepts and returns assignedToId; customer API never touches it", () => {
  for (const file of ["../app/api/v1/appointments/route.ts", "../app/api/v1/appointments/[id]/route.ts"]) {
    const src = readSource(file);
    assert.match(src, /assignedToId: true,\s*\n\s*assignedTo: \{ select: \{ id: true, firstName: true, lastName: true \} \}/);
  }
  assert.match(readSource("../app/api/v1/appointments/route.ts"), /assignedToId,\s*\n\s*\}\);/);
  assert.match(readSource("../app/api/v1/appointments/[id]/route.ts"), /setAppointmentAssigneeCommand\(/);
  assert.match(readSource("../app/api/v1/appointments/[id]/confirm/route.ts"), /assignedToId/);

  const root = resolve(dirname(fileURLToPath(import.meta.url)), "../app/api/v1/app");
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((n) => {
      const full = resolve(dir, n);
      return statSync(full).isDirectory() ? walk(full) : /\.tsx?$/.test(n) ? [full] : [];
    });
  const files = walk(root);
  assert.ok(files.length > 5);
  for (const file of files) {
    assert.doesNotMatch(readFileSync(file, "utf8"), /assignedTo/, `${file} must not expose or accept the appointment master`);
  }
});

test("appointment -> order carry-over fills ServiceOrder.assignedToId and still validates", () => {
  const src = readSource("../lib/orders/order-create-command.ts");
  assert.match(src, /input\.assignedToId \?\? appointment\?\.assignedToId \?\? null/);
  assert.match(src, /validateOrderAssignee\(scopedTx,[\s\S]*assigneeId: assignedToId/);
  assert.match(src, /assignedToId,\s*\n\s*scheduledAt: input\.scheduledAt,/);
});

test("assertCanSetAppointmentAssignee: self / other, with and without orders.assign", async () => {
  process.env.DATABASE_URL ??= "postgresql://unused/unused";
  process.env.SESSION_SECRET ??= "unit-test-placeholder-secret-value-not-real-00";
  const { assertCanSetAppointmentAssignee } = await import("../lib/appointments/appointment-assignee");
  const mk = (perms: string[]) =>
    ({ id: "me", tenantId: "t", isOwner: false, role: { permissions: perms, isActive: true } }) as never;
  const assigner = mk(["orders.assign"]);
  const plain = mk([]);

  // undefined and unchanged values never throw
  assert.doesNotThrow(() => assertCanSetAppointmentAssignee(plain, undefined, "x"));
  assert.doesNotThrow(() => assertCanSetAppointmentAssignee(plain, "x", "x"));
  // self is allowed without orders.assign
  assert.doesNotThrow(() => assertCanSetAppointmentAssignee(plain, "me", null));
  // another person needs orders.assign
  assert.throws(() => assertCanSetAppointmentAssignee(plain, "other", "x"), { code: "APPOINTMENT_ASSIGN_FORBIDDEN" });
  assert.doesNotThrow(() => assertCanSetAppointmentAssignee(assigner, "other", "x"));
  // clearing is no longer a permission matter: it is rejected for everyone by
  // appointment-assignee-rule (ASSIGNEE_REQUIRED), see appointment-assignee-required.test.ts
  assert.doesNotThrow(() => assertCanSetAppointmentAssignee(assigner, null, "x"));
});

test("carried-over appointment master that became ineligible maps to ASSIGNEE_REQUIRED, explicit ones do not", () => {
  const ineligible = Object.assign(new Error("x"), { code: "ASSIGNEE_INELIGIBLE" });
  assert.equal(isCarriedAssigneeIneligible(ineligible, true), true);
  assert.equal(isCarriedAssigneeIneligible(ineligible, false), false);
  assert.equal(isCarriedAssigneeIneligible(new Error("other"), true), false);
  const src = readSource("../lib/orders/order-create-command.ts");
  assert.match(src, /isCarriedAssigneeIneligible\(assigneeError, !input\.assignedToId\)/);
  assert.match(src, /CARRIED_ASSIGNEE_INELIGIBLE_MESSAGE,\s*422,\s*"ASSIGNEE_REQUIRED"/);
  assert.match(CARRIED_ASSIGNEE_INELIGIBLE_MESSAGE, /идэвхгүй болсон/);
});
