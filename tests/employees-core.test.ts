import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { before, test } from "node:test";

// `app/_actions/employees.ts` does `"use server"` and transitively imports
// `lib/subscription-server.ts` (`import "server-only"`), so plain
// `tsx --test` module resolution cannot import the action file directly —
// same import barrier documented in `tests/services-route-permissions.test.ts`
// and `tests/employee-schedule-commands.test.ts`. So: behavioural tests run
// the extracted `lib/employees/*` cores against an in-memory fake Prisma
// client, and a source-pattern test asserts the action file delegates to the
// core instead of reimplementing the logic inline.
//
// Because of that same barrier, a true "characterization" run of the
// PRE-move action file was not possible in this session — these tests encode
// the messages/behaviour read directly from the original
// `app/_actions/employees.ts` source (676 LOC, captured before editing),
// not a captured runtime trace.

process.env.DATABASE_URL ??= "postgresql://unused/unused";
process.env.SESSION_SECRET ??= "unit-test-placeholder-secret-value-not-real-00";

let core: typeof import("../lib/employees/core");
let dto: typeof import("../lib/employees/dto");
let guards: typeof import("../lib/employees/guards");

before(async () => {
  [core, dto, guards] = await Promise.all([
    import("../lib/employees/core"),
    import("../lib/employees/dto"),
    import("../lib/employees/guards"),
  ]);
});

function src(relPath: string): string {
  return readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), relPath), "utf8");
}

// --- In-memory fake Prisma client -------------------------------------------

type FakeUser = {
  id: string;
  tenantId: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  passwordHash: string | null;
  verified: boolean;
  isOwner: boolean;
  roleId: string | null;
  branchId: string | null;
  assignableBranchIds: string[];
  isActive: boolean;
  activeUntil: Date | null;
  deletedAt?: Date | null;
};
type FakeBranch = { id: string; tenantId: string; name: string; isActive: boolean };
type FakeRole = { id: string; tenantId: string; name: string; isActive: boolean };

function p2002(): Error & { code: string; clientVersion: string } {
  return Object.assign(new Error("Unique constraint failed"), { code: "P2002", clientVersion: "x" });
}
function p2003(): Error & { code: string; clientVersion: string } {
  return Object.assign(new Error("FK constraint failed"), { code: "P2003", clientVersion: "x" });
}

function makeFakeDb(
  seed: { users?: FakeUser[]; branches?: FakeBranch[]; roles?: FakeRole[]; openOrdersByUser?: Record<string, number> } = {},
) {
  const users = seed.users ?? [];
  const openOrdersByUser = seed.openOrdersByUser ?? {};
  const branches = seed.branches ?? [];
  const roles = seed.roles ?? [];
  const auditRows: unknown[] = [];

  function roleOf(u: FakeUser) {
    const r = roles.find((x) => x.id === u.roleId);
    return r ? { id: r.id, name: r.name } : null;
  }

  function matchWhere(u: FakeUser, where: Record<string, unknown>): boolean {
    for (const [k, v] of Object.entries(where)) {
      if (k === "id" && v && typeof v === "object" && "not" in (v as object)) {
        if (u.id === (v as { not: string }).not) return false;
        continue;
      }
      if (k === "id" && v && typeof v === "object" && "in" in (v as object)) {
        if (!(v as { in: string[] }).in.includes(u.id)) return false;
        continue;
      }
      const actual = (u as unknown as Record<string, unknown>)[k] ?? null;
      if (actual !== v) return false;
    }
    return true;
  }

  const db = {
    user: {
      async findFirst({ where }: { where: Record<string, unknown> }) {
        const u = users.find((x) => matchWhere(x, where));
        if (!u) return null;
        return { ...u, role: roleOf(u) };
      },
      async findMany({ where }: { where: Record<string, unknown> }) {
        return users.filter((x) => matchWhere(x, where)).map((u) => ({ ...u, role: roleOf(u) }));
      },
      async count({ where }: { where: Record<string, unknown> }) {
        return users.filter((x) => matchWhere(x, where)).length;
      },
      async create({ data }: { data: Record<string, unknown> }) {
        if (users.some((u) => u.email === data.email || u.phone === data.phone)) throw p2002();
        const u: FakeUser = {
          id: `u${users.length + 1}`,
          tenantId: data.tenantId as string,
          firstName: data.firstName as string,
          lastName: data.lastName as string,
          email: data.email as string,
          phone: data.phone as string,
          passwordHash: (data.passwordHash as string | null) ?? null,
          verified: (data.verified as boolean) ?? false,
          isOwner: (data.isOwner as boolean) ?? false,
          roleId: (data.roleId as string | null) ?? null,
          branchId: (data.branchId as string | null) ?? null,
          assignableBranchIds: (data.assignableBranchIds as string[]) ?? [],
          isActive: (data.isActive as boolean) ?? true,
          activeUntil: (data.activeUntil as Date | null) ?? null,
        };
        users.push(u);
        return { id: u.id, role: roleOf(u) };
      },
      async update({ where, data }: { where: { id: string }; data: Record<string, unknown> }) {
        const u = users.find((x) => x.id === where.id);
        if (!u) throw new Error("not found");
        if (
          (data.email && users.some((x) => x.id !== u.id && x.email === data.email)) ||
          (data.phone && users.some((x) => x.id !== u.id && x.phone === data.phone))
        ) {
          throw p2002();
        }
        Object.assign(u, data);
        return { id: u.id, role: roleOf(u) };
      },
      async delete({ where }: { where: { id: string } }) {
        const idx = users.findIndex((x) => x.id === where.id);
        if (idx < 0) throw new Error("not found");
        if ((users[idx] as unknown as { hasOrders?: boolean }).hasOrders) throw p2003();
        users.splice(idx, 1);
        return { id: where.id };
      },
    },
    branch: {
      async findFirst({ where }: { where: Record<string, unknown> }) {
        return branches.find((b) => (where.id ? b.id === where.id : true) && b.tenantId === where.tenantId && (where.isActive === undefined || b.isActive === where.isActive)) ?? null;
      },
      async findMany({ where }: { where: { tenantId: string; isActive?: boolean; id: { in: string[] } } }) {
        return branches.filter(
          (b) => b.tenantId === where.tenantId && (where.isActive === undefined || b.isActive === where.isActive) && where.id.in.includes(b.id),
        );
      },
    },
    role: {
      async findFirst({ where }: { where: Record<string, unknown> }) {
        return roles.find((r) => r.id === where.id && r.tenantId === where.tenantId) ?? null;
      },
    },
    serviceOrder: {
      async count({ where }: { where: { assignedToId: string } }) {
        return openOrdersByUser[where.assignedToId] ?? 0;
      },
    },
    auditLog: {
      async create({ data }: { data: unknown }) {
        auditRows.push(data);
        return data;
      },
    },
  };
  return { db, users, branches, roles, auditRows };
}

function fd(fields: Record<string, string | string[]>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) {
    if (Array.isArray(v)) for (const item of v) f.append(k, item);
    else f.set(k, v);
  }
  return f;
}

const ACTOR = { id: "me1", tenantId: "t1", isOwner: false };
const OWNER_ACTOR = { id: "owner1", tenantId: "t1", isOwner: true };
// A second owner not present in the fake DB — reaches the LAST_OWNER guard
// without tripping the self-action checks.
const CO_OWNER_ACTOR = { id: "owner-other", tenantId: "t1", isOwner: true };

// --- validateCommon / prepareCreateEmployee: exact Mongolian messages ------

test("prepareCreateEmployee: empty required fields produce the exact Mongolian field errors", async () => {
  const { db } = makeFakeDb();
  const result = await core.prepareCreateEmployee(db, ACTOR, fd({}));
  assert.equal(result.ok, false);
  if (result.ok) throw new Error("unreachable");
  assert.deepEqual(result.fieldErrors, {
    lastName: "Овгоо оруулна уу.",
    firstName: "Нэрээ оруулна уу.",
    email: "Имэйл хаяг буруу.",
    phone: "Утасны дугаар оруулна уу.",
    roleId: "Үүрэг сонгоно уу.",
  });
});

test("prepareCreateEmployee: invalid phone format", async () => {
  const { db } = makeFakeDb({ roles: [{ id: "r1", tenantId: "t1", name: "Мастер", isActive: true }] });
  const result = await core.prepareCreateEmployee(
    db,
    ACTOR,
    fd({ firstName: "A", lastName: "B", email: "a@b.com", phone: "123", roleId: "r1" }),
  );
  assert.equal(result.ok, false);
  if (result.ok) throw new Error("unreachable");
  assert.equal(result.fieldErrors.phone, "Утасны дугаар 8 оронтой тоо байх ёстой.");
});

test("prepareCreateEmployee: invalid activeUntil date", async () => {
  const { db } = makeFakeDb({ roles: [{ id: "r1", tenantId: "t1", name: "Мастер", isActive: true }] });
  const result = await core.prepareCreateEmployee(
    db,
    ACTOR,
    fd({
      firstName: "A",
      lastName: "B",
      email: "a@b.com",
      phone: "99112233",
      roleId: "r1",
      activeUntil: "not-a-date",
    }),
  );
  assert.equal(result.ok, false);
  if (result.ok) throw new Error("unreachable");
  assert.equal(result.fieldErrors.activeUntil, "Огноо буруу.");
});

test("prepareCreateEmployee: roleId required unless creating an owner", async () => {
  const { db } = makeFakeDb();
  const missingRole = await core.prepareCreateEmployee(
    db,
    ACTOR,
    fd({ firstName: "A", lastName: "B", email: "a@b.com", phone: "99112233" }),
  );
  assert.equal(missingRole.ok, false);
  if (missingRole.ok) throw new Error("unreachable");
  assert.equal(missingRole.fieldErrors.roleId, "Үүрэг сонгоно уу.");

  // wantsOwner path never requires roleId, even for a non-owner actor's
  // form submission — the core mirrors the original's `requireRole: !wantsOwner`.
  const ownerCreate = await core.prepareCreateEmployee(
    db,
    OWNER_ACTOR,
    fd({ firstName: "A", lastName: "B", email: "a@b.com", phone: "99112233", isOwner: "on" }),
  );
  assert.equal(ownerCreate.ok, true);
});

test("prepareCreateEmployee: only an owner actor's isOwner=on is honored (safety net)", async () => {
  const { db, users } = makeFakeDb({ roles: [{ id: "r1", tenantId: "t1", name: "Мастер", isActive: true }] });
  const nonOwnerTriesOwner = await core.prepareCreateEmployee(
    db,
    ACTOR, // isOwner: false
    fd({ firstName: "A", lastName: "B", email: "a@b.com", phone: "99112233", isOwner: "on", roleId: "r1" }),
  );
  assert.equal(nonOwnerTriesOwner.ok, true);
  if (!nonOwnerTriesOwner.ok) throw new Error("unreachable");
  assert.equal(nonOwnerTriesOwner.wantsOwner, false, "non-owner actor cannot set isOwner even if the form sends it");

  const created = await core.createEmployee(db, ACTOR, nonOwnerTriesOwner.data, nonOwnerTriesOwner.wantsOwner);
  assert.equal(created.ok, true);
  if (!created.ok) throw new Error("unreachable");
  assert.equal(users[0]!.isOwner, false);
});

test("prepareCreateEmployee: unknown/inactive role is rejected with a field error", async () => {
  const { db } = makeFakeDb({ roles: [{ id: "r1", tenantId: "t1", name: "X", isActive: false }] });
  const result = await core.prepareCreateEmployee(
    db,
    ACTOR,
    fd({ firstName: "A", lastName: "B", email: "a@b.com", phone: "99112233", roleId: "r1" }),
  );
  assert.equal(result.ok, false);
  if (result.ok) throw new Error("unreachable");
  assert.equal(result.fieldErrors.roleId, "Үүрэг олдсонгүй эсвэл идэвхгүй байна.");
});

test("prepareCreateEmployee: branch not in tenant is rejected", async () => {
  const { db } = makeFakeDb({
    roles: [{ id: "r1", tenantId: "t1", name: "X", isActive: true }],
    branches: [{ id: "b1", tenantId: "t2", name: "Other tenant branch", isActive: true }],
  });
  const result = await core.prepareCreateEmployee(
    db,
    ACTOR,
    fd({ firstName: "A", lastName: "B", email: "a@b.com", phone: "99112233", roleId: "r1", branchId: "b1" }),
  );
  assert.equal(result.ok, false);
  if (result.ok) throw new Error("unreachable");
  assert.equal(result.fieldErrors.branchId, "Салбар олдсонгүй.");
});

test("prepareCreateEmployee: assignableBranchIds filtered to the tenant's own active branches", async () => {
  const { db } = makeFakeDb({
    roles: [{ id: "r1", tenantId: "t1", name: "X", isActive: true }],
    branches: [
      { id: "b1", tenantId: "t1", name: "Own", isActive: true },
      { id: "b2", tenantId: "t2", name: "Foreign", isActive: true },
      { id: "b3", tenantId: "t1", name: "Inactive", isActive: false },
    ],
  });
  const result = await core.prepareCreateEmployee(
    db,
    ACTOR,
    fd({
      firstName: "A",
      lastName: "B",
      email: "a@b.com",
      phone: "99112233",
      roleId: "r1",
      assignableBranchIds: ["b1", "b2", "b3"],
    }),
  );
  assert.equal(result.ok, true);
  if (!result.ok) throw new Error("unreachable");
  assert.deepEqual(result.data.assignableBranchIds, ["b1"]);
});

// --- createEmployee: duplicate mapping, audit-ready summary/after ----------

test("createEmployee: duplicate phone and email map to the exact create-time messages", async () => {
  const { db } = makeFakeDb({
    roles: [{ id: "r1", tenantId: "t1", name: "X", isActive: true }],
    users: [
      {
        id: "u0",
        tenantId: "t1",
        firstName: "Existing",
        lastName: "User",
        email: "dup@b.com",
        phone: "99112233",
        passwordHash: null,
        verified: false,
        isOwner: false,
        roleId: null,
        branchId: null,
        assignableBranchIds: [],
        isActive: true,
        activeUntil: null,
      },
    ],
  });
  const prep = await core.prepareCreateEmployee(
    db,
    ACTOR,
    fd({ firstName: "A", lastName: "B", email: "dup@b.com", phone: "99112233", roleId: "r1" }),
  );
  assert.equal(prep.ok, true);
  if (!prep.ok) throw new Error("unreachable");
  const result = await core.createEmployee(db, ACTOR, prep.data, prep.wantsOwner);
  assert.equal(result.ok, false);
  if (result.ok) throw new Error("unreachable");
  assert.equal(result.code, "DUPLICATE");
  assert.deepEqual(result.fieldErrors, {
    phone: "Энэ утасны дугаар аль хэдийн бүртгэгдсэн байна.",
    email: "Энэ имэйл хаяг аль хэдийн бүртгэгдсэн байна.",
  });
});

test("createEmployee: success returns id/summary/after for the wrapper's audit call", async () => {
  const { db } = makeFakeDb({ roles: [{ id: "r1", tenantId: "t1", name: "Мастер", isActive: true }] });
  const prep = await core.prepareCreateEmployee(
    db,
    ACTOR,
    fd({ firstName: "Bат", lastName: "Дорж", email: "a@b.com", phone: "99112233", roleId: "r1" }),
  );
  assert.equal(prep.ok, true);
  if (!prep.ok) throw new Error("unreachable");
  const result = await core.createEmployee(db, ACTOR, prep.data, prep.wantsOwner);
  assert.equal(result.ok, true);
  if (!result.ok) throw new Error("unreachable");
  assert.equal(result.summary, "Дорж Bат · Мастер");
  assert.equal(result.after.roleId, "r1");
});

test("createEmployee: owner creation labels the audit summary 'Админ'", async () => {
  const { db } = makeFakeDb();
  const prep = await core.prepareCreateEmployee(
    db,
    OWNER_ACTOR,
    fd({ firstName: "New", lastName: "Owner", email: "o@b.com", phone: "99112233", isOwner: "on" }),
  );
  assert.equal(prep.ok, true);
  if (!prep.ok) throw new Error("unreachable");
  assert.equal(prep.wantsOwner, true);
  const result = await core.createEmployee(db, OWNER_ACTOR, prep.data, prep.wantsOwner);
  assert.equal(result.ok, true);
  if (!result.ok) throw new Error("unreachable");
  assert.equal(result.summary, "Owner New · Админ");
});

// --- updateEmployee ---------------------------------------------------------

test("updateEmployee: target not found in tenant", async () => {
  const { db } = makeFakeDb();
  const result = await core.updateEmployee(
    db,
    ACTOR,
    "missing",
    fd({ firstName: "A", lastName: "B", email: "a@b.com", phone: "99112233", roleId: "r1" }),
  );
  assert.equal(result.ok, false);
  if (result.ok) throw new Error("unreachable");
  assert.equal(result.code, "NOT_FOUND");
  assert.equal(result.error, "Ажилтан олдсонгүй.");
});

test("updateEmployee: a tombstoned (deleted) target is treated as not found — no write", async () => {
  const { db, users } = makeFakeDb({
    users: [
      {
        id: "u1",
        tenantId: "t1",
        firstName: "Устгагдсан",
        lastName: "ажилтан",
        email: "deleted+u1@deleted.invalid",
        phone: "deleted:u1",
        passwordHash: null,
        verified: false,
        isOwner: false,
        roleId: null,
        branchId: null,
        assignableBranchIds: [],
        isActive: false,
        activeUntil: null,
        deletedAt: new Date("2026-01-01"),
      },
    ],
  });
  const before = { ...users[0] };
  const result = await core.updateEmployee(
    db,
    ACTOR,
    "u1",
    fd({ firstName: "New", lastName: "Name", email: "new@b.com", phone: "99112233", roleId: "r1" }),
  );
  assert.equal(result.ok, false);
  if (result.ok) throw new Error("unreachable");
  assert.equal(result.code, "NOT_FOUND");
  assert.equal(result.error, "Ажилтан олдсонгүй.");
  assert.deepEqual(users[0], before);
});

test("updateEmployee: an owner's role cannot be edited", async () => {
  const { db } = makeFakeDb({
    users: [
      {
        id: "u1",
        tenantId: "t1",
        firstName: "Boss",
        lastName: "Own",
        email: "boss@b.com",
        phone: "99112233",
        passwordHash: "x",
        verified: true,
        isOwner: true,
        roleId: null,
        branchId: null,
        assignableBranchIds: [],
        isActive: true,
        activeUntil: null,
      },
    ],
  });
  const result = await core.updateEmployee(
    db,
    OWNER_ACTOR,
    "u1",
    fd({ firstName: "Boss", lastName: "Own", email: "boss@b.com", phone: "99112233", roleId: "any-role" }),
  );
  assert.equal(result.ok, false);
  if (result.ok) throw new Error("unreachable");
  assert.equal(result.code, "OWNER_ROLE_LOCKED");
  assert.deepEqual(result.fieldErrors, { roleId: "Тенант админы үүргийг өөрчилж болохгүй." });
});

test("updateEmployee: an owner's profile can be edited; role and active state stay", async () => {
  const { db } = makeFakeDb({
    users: [
      {
        id: "u1",
        tenantId: "t1",
        firstName: "Boss",
        lastName: "Own",
        email: "boss@b.com",
        phone: "99112233",
        passwordHash: "x",
        verified: true,
        isOwner: true,
        roleId: null,
        branchId: null,
        assignableBranchIds: [],
        isActive: true,
        activeUntil: null,
      },
    ],
  });
  const result = await core.updateEmployee(
    db,
    OWNER_ACTOR,
    "u1",
    fd({ firstName: "Шинэ", lastName: "Own", email: "boss@b.com", phone: "99112244" }),
  );
  assert.equal(result.ok, true);
});

test("updateEmployee: duplicate phone/email against another user on update", async () => {
  const { db } = makeFakeDb({
    roles: [{ id: "r1", tenantId: "t1", name: "Мастер", isActive: true }],
    users: [
      {
        id: "u1",
        tenantId: "t1",
        firstName: "A",
        lastName: "B",
        email: "a@b.com",
        phone: "99112233",
        passwordHash: null,
        verified: false,
        isOwner: false,
        roleId: null,
        branchId: null,
        assignableBranchIds: [],
        isActive: true,
        activeUntil: null,
      },
      {
        id: "u2",
        tenantId: "t1",
        firstName: "C",
        lastName: "D",
        email: "c@d.com",
        phone: "99998888",
        passwordHash: null,
        verified: false,
        isOwner: false,
        roleId: null,
        branchId: null,
        assignableBranchIds: [],
        isActive: true,
        activeUntil: null,
      },
    ],
  });
  const result = await core.updateEmployee(
    db,
    ACTOR,
    "u2",
    fd({ firstName: "C", lastName: "D", email: "a@b.com", phone: "99112233", roleId: "r1" }),
  );
  assert.equal(result.ok, false);
  if (result.ok) throw new Error("unreachable");
  assert.deepEqual(result.fieldErrors, {
    phone: "Энэ утас өөр хэрэглэгчид ашиглагдсан байна.",
    email: "Энэ имэйл өөр хэрэглэгчид ашиглагдсан байна.",
  });
});

// --- toggleEmployeeActive ---------------------------------------------------

test("toggleEmployeeActive: cannot self-deactivate", async () => {
  const { db } = makeFakeDb({
    users: [
      {
        id: "me1",
        tenantId: "t1",
        firstName: "Me",
        lastName: "Self",
        email: "me@b.com",
        phone: "99112233",
        passwordHash: null,
        verified: false,
        isOwner: false,
        roleId: null,
        branchId: null,
        assignableBranchIds: [],
        isActive: true,
        activeUntil: null,
      },
    ],
  });
  const result = await core.toggleEmployeeActive(db, ACTOR, fd({ id: "me1" }));
  assert.equal(result.ok, false);
  if (result.ok) throw new Error("unreachable");
  assert.equal(result.code, "SELF_DEACTIVATE");
  assert.equal(result.error, "Та өөрийгөө идэвхгүй болгох боломжгүй.");
});

test("toggleEmployeeActive: cannot deactivate the last active owner", async () => {
  const { db } = makeFakeDb({
    users: [
      {
        id: "owner1",
        tenantId: "t1",
        firstName: "Boss",
        lastName: "Own",
        email: "boss@b.com",
        phone: "99112233",
        passwordHash: "x",
        verified: true,
        isOwner: true,
        roleId: null,
        branchId: null,
        assignableBranchIds: [],
        isActive: true,
        activeUntil: null,
      },
      {
        id: "actor1",
        tenantId: "t1",
        firstName: "Manager",
        lastName: "M",
        email: "mgr@b.com",
        phone: "99998877",
        passwordHash: "x",
        verified: true,
        isOwner: false,
        roleId: null,
        branchId: null,
        assignableBranchIds: [],
        isActive: true,
        activeUntil: null,
      },
    ],
  });
  const actor = { id: "actor1", tenantId: "t1", isOwner: true };
  const result = await core.toggleEmployeeActive(db, actor, fd({ id: "owner1" }));
  assert.equal(result.ok, false);
  if (result.ok) throw new Error("unreachable");
  assert.equal(result.code, "LAST_OWNER");
  assert.equal(result.error, "Сүүлийн админыг идэвхгүй болгох боломжгүй.");
});

test("toggleEmployeeActive: missing id or missing target is a silent no-op", async () => {
  const { db } = makeFakeDb();
  const missingId = await core.toggleEmployeeActive(db, ACTOR, fd({}));
  assert.deepEqual(missingId, { ok: true, noop: true });
  const missingTarget = await core.toggleEmployeeActive(db, ACTOR, fd({ id: "ghost" }));
  assert.deepEqual(missingTarget, { ok: true, noop: true });
});

test("toggleEmployeeActive: a tombstoned (deleted) target is a silent no-op — no write", async () => {
  const { db, users } = makeFakeDb({
    users: [
      {
        id: "u1",
        tenantId: "t1",
        firstName: "Устгагдсан",
        lastName: "ажилтан",
        email: "deleted+u1@deleted.invalid",
        phone: "deleted:u1",
        passwordHash: null,
        verified: false,
        isOwner: false,
        roleId: null,
        branchId: null,
        assignableBranchIds: [],
        isActive: false,
        activeUntil: null,
        deletedAt: new Date("2026-01-01"),
      },
    ],
  });
  const before = { ...users[0] };
  const result = await core.toggleEmployeeActive(db, ACTOR, fd({ id: "u1", isActive: "on" }));
  assert.deepEqual(result, { ok: true, noop: true });
  assert.deepEqual(users[0], before);
});

test("toggleEmployeeActive: success returns before/after for audit", async () => {
  const { db } = makeFakeDb({
    users: [
      {
        id: "u1",
        tenantId: "t1",
        firstName: "A",
        lastName: "B",
        email: "a@b.com",
        phone: "99112233",
        passwordHash: null,
        verified: false,
        isOwner: false,
        roleId: null,
        branchId: null,
        assignableBranchIds: [],
        isActive: true,
        activeUntil: null,
      },
    ],
  });
  const result = await core.toggleEmployeeActive(db, ACTOR, fd({ id: "u1" }));
  assert.equal(result.ok, true);
  if (!result.ok || "noop" in result) throw new Error("unreachable");
  assert.equal(result.summary, "B A · идэвхгүй болгов");
  assert.deepEqual(result.before, { isActive: true });
  assert.deepEqual(result.after, { isActive: false });
});

// --- deleteEmployee ---------------------------------------------------------

test("deleteEmployee: cannot delete self", async () => {
  const { db } = makeFakeDb();
  const result = await core.deleteEmployee(db, ACTOR, fd({ id: "me1" }));
  assert.equal(result.ok, false);
  if (result.ok) throw new Error("unreachable");
  assert.equal(result.code, "SELF_ACTION");
  assert.equal(result.error, "Та өөрийгөө устгах боломжгүй.");
});

test("deleteEmployee: cannot delete the last owner", async () => {
  const { db } = makeFakeDb({
    users: [
      {
        id: "owner1",
        tenantId: "t1",
        firstName: "Boss",
        lastName: "Own",
        email: "boss@b.com",
        phone: "99112233",
        passwordHash: "x",
        verified: true,
        isOwner: true,
        roleId: null,
        branchId: null,
        assignableBranchIds: [],
        isActive: true,
        activeUntil: null,
      },
    ],
  });
  const result = await core.deleteEmployee(db, CO_OWNER_ACTOR, fd({ id: "owner1" }));
  assert.equal(result.ok, false);
  if (result.ok) throw new Error("unreachable");
  assert.equal(result.code, "LAST_OWNER");
  assert.equal(result.error, "Сүүлийн админыг устгах боломжгүй.");
});

test("deleteEmployee: an admin-blocked co-owner does not count toward LAST_OWNER", async () => {
  const { db, users } = makeFakeDb({
    users: [
      {
        id: "o1",
        tenantId: "t1",
        firstName: "O",
        lastName: "o1",
        email: "o1@b.com",
        phone: "99112231",
        passwordHash: "x",
        verified: true,
        isOwner: true,
        roleId: null,
        branchId: null,
        assignableBranchIds: [],
        isActive: true,
        activeUntil: null,
      },
      {
        id: "o2",
        tenantId: "t1",
        firstName: "O",
        lastName: "o2",
        email: "o2@b.com",
        phone: "99112232",
        passwordHash: "x",
        verified: true,
        isOwner: true,
        roleId: null,
        branchId: null,
        assignableBranchIds: [],
        isActive: false,
        activeUntil: null,
      },
    ],
  });
  const result = await core.deleteEmployee(db, { id: "admin1", tenantId: "t1", isOwner: true }, fd({ id: "o1" }));
  assert.equal(result.ok, false);
  if (result.ok) throw new Error("unreachable");
  assert.equal(result.code, "LAST_OWNER");
  assert.equal((users[0] as unknown as { deletedAt?: Date }).deletedAt, undefined);
});

test("deleteEmployee: tombstones the row instead of hard-deleting it", async () => {
  const { db, users } = makeFakeDb({
    users: [
      {
        id: "u1",
        tenantId: "t1",
        firstName: "A",
        lastName: "B",
        email: "a@b.com",
        phone: "99112233",
        passwordHash: "x",
        verified: true,
        isOwner: false,
        roleId: null,
        branchId: null,
        assignableBranchIds: [],
        isActive: true,
        activeUntil: null,
      },
    ],
  });
  const result = await core.deleteEmployee(db, ACTOR, fd({ id: "u1" }));
  assert.equal(result.ok, true);
  if (!result.ok || "noop" in result) throw new Error("unreachable");
  assert.equal(result.summary, "B A · —", "summary uses the pre-tombstone name");
  assert.equal(users.length, 1, "row must be kept so order FKs survive");
  const u = users[0] as unknown as Record<string, unknown>;
  assert.equal(u.firstName, "Устгагдсан");
  assert.equal(u.phone, "deleted:u1");
  assert.equal(u.email, "deleted+u1@deleted.invalid");
  assert.equal(u.passwordHash, null);
  assert.equal(u.isActive, false);
  assert.ok(u.deletedAt instanceof Date);
});

test("deleteEmployee: blocked while the target has open orders", async () => {
  const { db, users } = makeFakeDb({
    users: [
      {
        id: "u1",
        tenantId: "t1",
        firstName: "A",
        lastName: "B",
        email: "a@b.com",
        phone: "99112233",
        passwordHash: "x",
        verified: true,
        isOwner: false,
        roleId: null,
        branchId: null,
        assignableBranchIds: [],
        isActive: true,
        activeUntil: null,
      },
    ],
    openOrdersByUser: { u1: 2 },
  });
  const result = await core.deleteEmployee(db, ACTOR, fd({ id: "u1" }));
  assert.equal(result.ok, false);
  if (result.ok) throw new Error("unreachable");
  assert.equal(result.code, "OPEN_ORDERS");
  assert.match(result.error, /2 нээлттэй захиалга/);
  assert.equal(users.length, 1, "user must not be deleted");
});

test("deleteEmployee: missing id or missing target is a silent no-op", async () => {
  const { db } = makeFakeDb();
  assert.deepEqual(await core.deleteEmployee(db, ACTOR, fd({})), { ok: true, noop: true });
  assert.deepEqual(await core.deleteEmployee(db, ACTOR, fd({ id: "ghost" })), { ok: true, noop: true });
});

test("deleteEmployee: a tombstoned (deleted) target is a silent no-op — no write", async () => {
  const { db, users } = makeFakeDb({
    users: [
      {
        id: "u1",
        tenantId: "t1",
        firstName: "Устгагдсан",
        lastName: "ажилтан",
        email: "deleted+u1@deleted.invalid",
        phone: "deleted:u1",
        passwordHash: null,
        verified: false,
        isOwner: false,
        roleId: null,
        branchId: null,
        assignableBranchIds: [],
        isActive: false,
        activeUntil: null,
        deletedAt: new Date("2026-01-01"),
      },
    ],
  });
  const result = await core.deleteEmployee(db, ACTOR, fd({ id: "u1" }));
  assert.deepEqual(result, { ok: true, noop: true });
  assert.equal(users.length, 1);
});

// --- resetEmployeePassword ---------------------------------------------------

test("resetEmployeePassword: cannot reset own password here", async () => {
  const { db } = makeFakeDb();
  const result = await core.resetEmployeePassword(db, ACTOR, fd({ id: "me1" }));
  assert.equal(result.ok, false);
  if (result.ok) throw new Error("unreachable");
  assert.equal(result.code, "SELF_ACTION");
  assert.equal(result.error, "Та өөрийн нууц үгээ энд шинэчлэх боломжгүй.");
});

test("resetEmployeePassword: never generates a password, sets passwordHash null and verified false", async () => {
  const { db, users } = makeFakeDb({
    users: [
      {
        id: "u1",
        tenantId: "t1",
        firstName: "A",
        lastName: "B",
        email: "a@b.com",
        phone: "99112233",
        passwordHash: "already-set-hash",
        verified: true,
        isOwner: false,
        roleId: null,
        branchId: null,
        assignableBranchIds: [],
        isActive: true,
        activeUntil: null,
      },
    ],
  });
  const result = await core.resetEmployeePassword(db, ACTOR, fd({ id: "u1" }));
  assert.equal(result.ok, true);
  if (!result.ok || "noop" in result) throw new Error("unreachable");
  assert.equal(users[0]!.passwordHash, null);
  assert.equal(users[0]!.verified, false);
  assert.equal(result.summary, "B A · нууц үг хүчингүй болгов");
});

test("resetEmployeePassword: missing id or missing target is a silent no-op", async () => {
  const { db } = makeFakeDb();
  assert.deepEqual(await core.resetEmployeePassword(db, ACTOR, fd({})), { ok: true, noop: true });
  assert.deepEqual(await core.resetEmployeePassword(db, ACTOR, fd({ id: "ghost" })), { ok: true, noop: true });
});

// --- bulkUpdateEmployeeRoleBranch: partial success, owners skipped ---------

test("bulkUpdateEmployeeRoleBranch: requires at least role or branch selection", async () => {
  const { db } = makeFakeDb();
  const result = await core.bulkUpdateEmployeeRoleBranch(db, ACTOR, fd({ employeeIdsJson: "[]" }));
  assert.equal(result.ok, false);
  assert.equal(result.message, "Үүрэг эсвэл салбарын аль нэгийг сонгоно уу.");
});

test("bulkUpdateEmployeeRoleBranch: partial success skips owners and reports per-row errors", async () => {
  const { db } = makeFakeDb({
    roles: [{ id: "r1", tenantId: "t1", name: "Мастер", isActive: true }],
    users: [
      {
        id: "owner1",
        tenantId: "t1",
        firstName: "Boss",
        lastName: "Own",
        email: "boss@b.com",
        phone: "99112233",
        passwordHash: "x",
        verified: true,
        isOwner: true,
        roleId: null,
        branchId: null,
        assignableBranchIds: [],
        isActive: true,
        activeUntil: null,
      },
      {
        id: "u1",
        tenantId: "t1",
        firstName: "A",
        lastName: "B",
        email: "a@b.com",
        phone: "99998877",
        passwordHash: null,
        verified: false,
        isOwner: false,
        roleId: null,
        branchId: null,
        assignableBranchIds: [],
        isActive: true,
        activeUntil: null,
      },
    ],
  });
  const result = await core.bulkUpdateEmployeeRoleBranch(
    db,
    ACTOR,
    fd({ roleId: "r1", employeeIdsJson: JSON.stringify(["owner1", "u1", "ghost"]) }),
  );
  assert.equal(result.ok, true);
  if (!("succeeded" in result)) throw new Error("unreachable");
  assert.equal(result.succeeded, 1);
  assert.equal(result.failed, 2);
  assert.ok(result.errors.some((e) => e.includes("Тенант админыг өөрчлөх боломжгүй.")));
  assert.ok(result.errors.some((e) => e.includes("Олдсонгүй.")));
});

test("bulkUpdateEmployeeRoleBranch: unknown role/branch id fails with the exact message", async () => {
  const { db } = makeFakeDb();
  const badRole = await core.bulkUpdateEmployeeRoleBranch(db, ACTOR, fd({ roleId: "ghost", employeeIdsJson: "[]" }));
  assert.equal(badRole.ok, false);
  assert.equal(badRole.message, "Сонгосон үүрэг олдсонгүй эсвэл идэвхгүй байна.");

  const badBranch = await core.bulkUpdateEmployeeRoleBranch(db, ACTOR, fd({ branchId: "ghost", employeeIdsJson: "[]" }));
  assert.equal(badBranch.ok, false);
  assert.equal(badBranch.message, "Сонгосон салбар олдсонгүй.");
});

// --- guards: ensureRoleBelongsToTenant / filterOwnBranchIds ----------------

test("ensureRoleBelongsToTenant: cross-tenant role id is rejected", async () => {
  const { db } = makeFakeDb({ roles: [{ id: "r1", tenantId: "other", name: "X", isActive: true }] });
  const result = await guards.ensureRoleBelongsToTenant(db, "t1", "r1");
  assert.equal(result.ok, false);
});

test("filterOwnBranchIds: empty input short-circuits without a query", async () => {
  const { db } = makeFakeDb();
  assert.deepEqual(await guards.filterOwnBranchIds(db, "t1", []), []);
});

// --- toEmployeeDto: secret-field exclusion ----------------------------------

test("toEmployeeDto never emits passwordHash/failedLoginAttempts/lockedAt/OTP fields", () => {
  const row = {
    id: "u1",
    firstName: "A",
    lastName: "B",
    email: "a@b.com",
    phone: "99112233",
    isOwner: false,
    roleId: "r1",
    isActive: true,
    activeUntil: null,
    tenantId: "t1",
    branchId: null,
    assignableBranchIds: [],
    verified: true,
    role: { name: "Мастер" },
    // Fields the DTO must never read/emit, present here to prove the
    // builder ignores them structurally (whitelist, not a blocklist).
    passwordHash: "super-secret-hash",
    failedLoginAttempts: 4,
    lockedAt: new Date(),
  };
  const out = dto.toEmployeeDto(row);
  const json = JSON.stringify(out);
  assert.ok(!("passwordHash" in out));
  assert.ok(!("failedLoginAttempts" in out));
  assert.ok(!("lockedAt" in out));
  assert.ok(!json.includes("super-secret-hash"));
  assert.equal(out.roleName, "Мастер");
});

// --- source-pattern: the action file delegates to the core -----------------

test("app/_actions/employees.ts delegates every mutation to lib/employees/core instead of reimplementing it", () => {
  const source = src("../app/_actions/employees.ts");
  for (const fn of [
    "prepareCreateEmployee",
    "createEmployee",
    "updateEmployee",
    "bulkUpdateEmployeeRoleBranch",
    "toggleEmployeeActive",
    "deleteEmployee",
    "resetEmployeePassword",
  ]) {
    assert.ok(source.includes(fn), `action file must call core.${fn}`);
  }
  assert.ok(source.includes('from "@/lib/employees/core"'));
  // The action file must not re-implement Prisma unique/duplicate mapping —
  // that belongs to the core only.
  assert.doesNotMatch(source, /P2002|P2003/);
});

// ---------------------------------------------------------------------------
// Owner protection: a non-owner with employees.edit must not be able to take
// over the owner (phone swap → password-reset OTP) or lock them out.
// ---------------------------------------------------------------------------

function ownerFixture() {
  return {
    id: "o1",
    tenantId: "t1",
    firstName: "Boss",
    lastName: "Own",
    email: "boss@b.com",
    phone: "99112233",
    passwordHash: "x",
    verified: true,
    isOwner: true,
    roleId: null,
    branchId: null,
    assignableBranchIds: [],
    isActive: true,
    activeUntil: null,
  };
}

test("updateEmployee: a non-owner cannot edit an owner's profile (phone swap)", async () => {
  const { db, users } = makeFakeDb({ users: [ownerFixture()] });
  const result = await core.updateEmployee(
    db,
    ACTOR,
    "o1",
    fd({ firstName: "Boss", lastName: "Own", email: "boss@b.com", phone: "99112244", roleId: "r1" }),
  );
  assert.equal(result.ok, false);
  if (result.ok) throw new Error("unreachable");
  assert.equal(result.code, "OWNER_ONLY");
  assert.equal(users[0]!.phone, "99112233");
});

test("updateEmployee: a non-owner cannot change their own role", async () => {
  const { db, users } = makeFakeDb({
    users: [{ ...ownerFixture(), id: "me1", isOwner: false, roleId: "r-low", email: "me@b.com", phone: "99001122" }],
    roles: [{ id: "r-high", name: "High", isActive: true, tenantId: "t1" }],
  });
  const result = await core.updateEmployee(
    db,
    ACTOR,
    "me1",
    fd({ firstName: "Boss", lastName: "Own", email: "me@b.com", phone: "99001122", roleId: "r-high" }),
  );
  assert.equal(result.ok, false);
  if (result.ok) throw new Error("unreachable");
  assert.equal(result.code, "SELF_ACTION");
  assert.equal(users[0]!.roleId, "r-low");
});

test("toggleEmployeeActive / deleteEmployee / resetEmployeePassword: non-owner gets OWNER_ONLY on an owner", async () => {
  const { db, users } = makeFakeDb({ users: [ownerFixture(), { ...ownerFixture(), id: "o2", email: "o2@b.com", phone: "99112234" }] });
  const toggled = await core.toggleEmployeeActive(db, ACTOR, fd({ id: "o1" }));
  const deleted = await core.deleteEmployee(db, ACTOR, fd({ id: "o1" }));
  const reset = await core.resetEmployeePassword(db, ACTOR, fd({ id: "o1" }));
  for (const result of [toggled, deleted, reset]) {
    assert.equal(result.ok, false);
    if (result.ok) throw new Error("unreachable");
    assert.equal(result.code, "OWNER_ONLY");
  }
  assert.equal(users[0]!.isActive, true);
  assert.equal(users[0]!.passwordHash, "x");
});

test("resetEmployeePassword: an owner can still reset another owner", async () => {
  const { db, users } = makeFakeDb({ users: [ownerFixture()] });
  const result = await core.resetEmployeePassword(db, CO_OWNER_ACTOR, fd({ id: "o1" }));
  assert.equal(result.ok, true);
  assert.equal(users[0]!.passwordHash, null);
});

// ---------------------------------------------------------------------------
// importEmployees (Excel import): per-row partial success, same create rules,
// plan-limit cut-off, never creates an owner.
// ---------------------------------------------------------------------------

function importRow(n: number, overrides: Record<string, string> = {}) {
  return {
    key: `r${n}`,
    excelRow: n,
    lastName: "Бат",
    firstName: `Ажилтан${n}`,
    phone: `991100${String(n).padStart(2, "0")}`,
    email: `a${n}@b.com`,
    roleId: "r1",
    branchId: "",
    activeUntil: "",
    roleRaw: "",
    branchRaw: "",
    ...overrides,
  };
}

test("importEmployees: valid rows are created, invalid ones reported per row", async () => {
  const { db, users } = makeFakeDb({ roles: [{ id: "r1", name: "Мастер", isActive: true, tenantId: "t1" }] });
  const created: string[] = [];
  const result = await core.importEmployees(
    db,
    OWNER_ACTOR,
    [importRow(2), importRow(3, { roleId: "ghost-role" }), importRow(4, { email: "bad" }), importRow(5)],
    { remaining: null, limitMessage: "limit", onCreated: async (c) => void created.push(c.id) },
  );
  assert.equal(result.succeeded, 2);
  assert.equal(result.failed, 2);
  assert.deepEqual(result.results.map((r) => [r.key, r.ok]), [["r2", true], ["r3", false], ["r4", false], ["r5", true]]);
  assert.equal(result.results[1]!.fieldErrors?.roleId, "Үүрэг олдсонгүй эсвэл идэвхгүй байна.");
  assert.equal(result.results[2]!.fieldErrors?.email, "Имэйл хаяг буруу.");
  assert.equal(users.length, 2);
  assert.equal(created.length, 2);
  assert.ok(users.every((u) => u.isOwner === false && u.roleId === "r1" && u.passwordHash === null));
});

test("importEmployees: rows beyond the remaining plan quota fail with the limit message", async () => {
  const { db, users } = makeFakeDb({ roles: [{ id: "r1", name: "Мастер", isActive: true, tenantId: "t1" }] });
  const result = await core.importEmployees(db, ACTOR, [importRow(2), importRow(3), importRow(4)], {
    remaining: 2,
    limitMessage: "Багцын хязгаар",
  });
  assert.equal(result.succeeded, 2);
  assert.deepEqual(result.results[2], { key: "r4", ok: false, error: "Багцын хязгаар" });
  assert.equal(users.length, 2);
});

test("importEmployees: an owner actor still cannot create owners or role-less rows", async () => {
  const { db, users } = makeFakeDb({ roles: [{ id: "r1", name: "Мастер", isActive: true, tenantId: "t1" }] });
  const result = await core.importEmployees(db, OWNER_ACTOR, [importRow(2, { roleId: "" })], {
    remaining: null,
    limitMessage: "limit",
  });
  assert.equal(result.succeeded, 0);
  assert.equal(result.results[0]!.fieldErrors?.roleId, "Үүрэг сонгоно уу.");
  assert.equal(users.length, 0);
});

test("importEmployees: an impossible date (2026-02-30) is rejected server-side, not rolled over", async () => {
  const { db, users } = makeFakeDb({ roles: [{ id: "r1", name: "Мастер", isActive: true, tenantId: "t1" }] });
  const result = await core.importEmployees(db, OWNER_ACTOR, [importRow(2, { activeUntil: "2026-02-30" })], {
    remaining: null,
    limitMessage: "limit",
  });
  assert.equal(result.succeeded, 0);
  assert.equal(result.results[0]!.fieldErrors?.activeUntil, "Огноо буруу.");
  assert.equal(users.length, 0);
});
