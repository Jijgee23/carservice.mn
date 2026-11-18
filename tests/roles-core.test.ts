import assert from "node:assert/strict";
import { DEFAULT_TENANT_EDITABLE_PERMISSIONS } from "../lib/roles/tenant-editable-defaults";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { before, test } from "node:test";

// Roles are global (system) and managed by super admins via
// `app/_actions/system-roles.ts`, which does `"use server"` and its sibling employees
// action transitively imports server-only code, so tests exercise the
// extracted `lib/roles/*` cores against an in-memory fake client (same
// import-barrier rationale as `tests/employees-core.test.ts`). As there, the
// true pre-move characterization of the "use server" action was not
// possible; these tests encode the messages read from the original
// original tenant-scoped `app/_actions/roles.ts` source.

process.env.DATABASE_URL ??= "postgresql://unused/unused";
process.env.SESSION_SECRET ??= "unit-test-placeholder-secret-value-not-real-00";

let core: typeof import("../lib/roles/core");
let dto: typeof import("../lib/roles/dto");
let validate: typeof import("../lib/roles/validate");

before(async () => {
  [core, dto, validate] = await Promise.all([
    import("../lib/roles/core"),
    import("../lib/roles/dto"),
    import("../lib/roles/validate"),
  ]);
});

function src(relPath: string): string {
  return readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), relPath), "utf8");
}

type FakeRole = {
  id: string;
  key?: string | null;
  name: string;
  description: string | null;
  permissions: string[];
  tenantEditablePermissions?: string[];
  isActive: boolean;
  userCount?: number;
};

function p2002(): Error & { code: string; clientVersion: string } {
  return Object.assign(new Error("Unique constraint failed"), { code: "P2002", clientVersion: "x" });
}

function makeFakeDb(seed: { roles?: FakeRole[] } = {}) {
  const roles = seed.roles ?? [];
  const db = {
    role: {
      async findFirst({ where }: { where: { id: string } }) {
        const r = roles.find((x) => x.id === where.id);
        if (!r) return null;
        return { ...r, _count: { users: r.userCount ?? 0 } };
      },
      async create({ data }: { data: Record<string, unknown> }) {
        if ("tenantId" in data) throw new Error("roles are global — no tenantId");
        if (roles.some((r) => r.name === data.name)) throw p2002();
        const r: FakeRole = {
          id: `r${roles.length + 1}`,
          name: data.name as string,
          description: (data.description as string | null) ?? null,
          permissions: (data.permissions as string[]) ?? [],
          tenantEditablePermissions: (data.tenantEditablePermissions as string[]) ?? [],
          isActive: (data.isActive as boolean) ?? true,
        };
        roles.push(r);
        return { id: r.id, name: r.name };
      },
      async update({ where, data }: { where: { id: string }; data: Record<string, unknown> }) {
        const r = roles.find((x) => x.id === where.id);
        if (!r) throw new Error("not found");
        if (data.name && roles.some((x) => x.id !== r.id && x.name === data.name)) {
          throw p2002();
        }
        // Prisma нь `undefined` талбарыг хөндөхгүй — fake ч адил.
        Object.assign(r, Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined)));
        return { id: r.id };
      },
      async delete({ where }: { where: { id: string } }) {
        const idx = roles.findIndex((x) => x.id === where.id);
        if (idx < 0) throw new Error("not found");
        roles.splice(idx, 1);
        return { id: where.id };
      },
    },
  };
  return { db, roles };
}

function fd(fields: Record<string, string | string[]>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) {
    if (Array.isArray(v)) for (const item of v) f.append(k, item);
    else f.set(k, v);
  }
  return f;
}

// --- validate: exact Mongolian messages ------------------------------------

test("validate: no name, no permissions", () => {
  const { errors } = validate.validate(fd({}));
  assert.equal(errors.name, "Үүргийн нэрээ оруулна уу.");
  assert.equal(errors.permissions, "Хамгийн багадаа нэг эрх сонгоно уу.");
});

test("validate: name over 60 chars", () => {
  const { errors } = validate.validate(fd({ name: "x".repeat(61), permissions: ["orders.view"] }));
  assert.equal(errors.name, "Нэр 60 тэмдэгтээс хэтрэхгүй.");
});

test("validateOrderScopes: edit without any view scope", () => {
  const errors: Record<string, string> = {};
  validate.validateOrderScopes(["orders.edit"], errors);
  assert.equal(errors.orderScopes, "Салбарын засах эрхэд Салбарын харах эрх шаардлагатай.");
});

test("validateOrderScopes: branch edit without branch view (but has viewOwn) still requires branch view", () => {
  const errors: Record<string, string> = {};
  validate.validateOrderScopes(["orders.edit", "orders.viewOwn"], errors);
  assert.equal(errors.orderScopes, "Салбарын засах эрхэд Салбарын харах эрх шаардлагатай.");
});

test("validateOrderScopes: editOwn without any view scope", () => {
  const errors: Record<string, string> = {};
  validate.validateOrderScopes(["orders.editOwn"], errors);
  assert.equal(errors.orderScopes, "Засах эрх олгохын өмнө засварын хуудсыг харах хүрээг сонгоно уу.");
});

test("validateOrderScopes: view+edit together is valid", () => {
  const errors: Record<string, string> = {};
  validate.validateOrderScopes(["orders.view", "orders.edit"], errors);
  assert.equal(errors.orderScopes, undefined);
});

test("getCheckedPermissions: dedupes and drops invalid codes", () => {
  const form = fd({ permissions: ["orders.view", "orders.view", "not-a-real-code"] });
  assert.deepEqual(validate.getCheckedPermissions(form), ["orders.view"]);
});

// --- createRole --------------------------------------------------------------

test("createRole: duplicate name maps to the exact message", async () => {
  const { db } = makeFakeDb({
    roles: [{ id: "r1", name: "Мастер", description: null, permissions: ["orders.view"], isActive: true }],
  });
  const result = await core.createRole(db, fd({ name: "Мастер", permissions: ["orders.view"] }));
  assert.equal(result.ok, false);
  if (result.ok) throw new Error("unreachable");
  assert.equal(result.code, "DUPLICATE");
  assert.equal(result.error, "Энэ нэртэй роль аль хэдийн байна.");
});

test("createRole: success returns audit-ready summary/after", async () => {
  const { db } = makeFakeDb();
  const result = await core.createRole(db, fd({ name: "Мастер", permissions: ["orders.view", "orders.edit"] }));
  assert.equal(result.ok, true);
  if (!result.ok) throw new Error("unreachable");
  assert.equal(result.summary, "Мастер · 2 эрх");
  assert.deepEqual(result.after, {
    name: "Мастер",
    permissions: ["orders.view", "orders.edit"],
    tenantEditablePermissions: [...DEFAULT_TENANT_EDITABLE_PERMISSIONS],
    isActive: true,
  });
});

test("createRole: validation error surfaces field errors, not a message", async () => {
  const { db } = makeFakeDb();
  const result = await core.createRole(db, fd({}));
  assert.equal(result.ok, false);
  if (result.ok) throw new Error("unreachable");
  assert.equal(result.code, "VALIDATION");
  assert.ok("fieldErrors" in result);
});

// --- updateRole --------------------------------------------------------------

test("updateRole: target not found", async () => {
  const { db } = makeFakeDb();
  const result = await core.updateRole(db, "ghost", fd({ name: "X", permissions: ["orders.view"] }));
  assert.equal(result.ok, false);
  if (result.ok) throw new Error("unreachable");
  assert.equal(result.code, "NOT_FOUND");
  assert.equal(result.error, "Роль олдсонгүй.");
});

test("updateRole: duplicate name against another role", async () => {
  const { db } = makeFakeDb({
    roles: [
      { id: "r1", name: "Мастер", description: null, permissions: ["orders.view"], isActive: true },
      { id: "r2", name: "Менежер", description: null, permissions: ["orders.view"], isActive: true },
    ],
  });
  const result = await core.updateRole(db, "r2", fd({ name: "Мастер", permissions: ["orders.view"] }));
  assert.equal(result.ok, false);
  if (result.ok) throw new Error("unreachable");
  assert.equal(result.code, "DUPLICATE");
  assert.equal(result.error, "Энэ нэртэй роль аль хэдийн байна.");
});

test("updateRole: success returns before/after for audit", async () => {
  const { db } = makeFakeDb({
    roles: [{ id: "r1", name: "Мастер", description: null, permissions: ["orders.view"], isActive: true }],
  });
  const result = await core.updateRole(db, "r1", fd({ name: "Мастер 2", permissions: ["orders.view", "orders.edit"] }));
  assert.equal(result.ok, true);
  if (!result.ok) throw new Error("unreachable");
  assert.deepEqual(result.before, {
    name: "Мастер",
    permissions: ["orders.view"],
    tenantEditablePermissions: [],
    isActive: true,
  });
  assert.equal(result.summary, "Мастер 2 · 2 эрх");
});

// --- deleteRole ----------------------------------------------------------

test("deleteRole: blocked while the role still has users", async () => {
  const { db } = makeFakeDb({
    roles: [
      { id: "r1", name: "Мастер", description: null, permissions: [], isActive: true, userCount: 3 },
    ],
  });
  const result = await core.deleteRole(db, fd({ id: "r1" }));
  assert.equal(result.ok, false);
  if (result.ok) throw new Error("unreachable");
  assert.equal(result.code, "ROLE_IN_USE");
  assert.equal(result.error, "Энэ рольтой 3 ажилтан (бүх байгууллагад) байна. Устгахын оронд идэвхгүй болгоно уу.");
});

test("deleteRole: built-in system role (key) can never be deleted, even unused", async () => {
  const { db, roles } = makeFakeDb({
    roles: [{ id: "sysrole_manager", key: "MANAGER", name: "Менежер", description: null, permissions: [], isActive: true, userCount: 0 }],
  });
  const result = await core.deleteRole(db, fd({ id: "sysrole_manager" }));
  assert.equal(result.ok, false);
  if (result.ok) throw new Error("unreachable");
  assert.equal(result.code, "SYSTEM_ROLE");
  assert.equal(roles.length, 1);
});

test("deleteRole: succeeds when no user has the role", async () => {
  const { db, roles } = makeFakeDb({
    roles: [{ id: "r1", name: "Мастер", description: null, permissions: [], isActive: true, userCount: 0 }],
  });
  const result = await core.deleteRole(db, fd({ id: "r1" }));
  assert.equal(result.ok, true);
  if (!result.ok || "noop" in result) throw new Error("unreachable");
  assert.equal(result.summary, "Мастер");
  assert.equal(roles.length, 0);
});

test("deleteRole: missing id or missing target is a silent no-op", async () => {
  const { db } = makeFakeDb();
  assert.deepEqual(await core.deleteRole(db, fd({})), { ok: true, noop: true });
  assert.deepEqual(await core.deleteRole(db, fd({ id: "ghost" })), { ok: true, noop: true });
});

// --- toRoleDto: whitelist ---------------------------------------------------

test("toRoleDto emits only whitelisted fields", () => {
  const out = dto.toRoleDto({
    id: "r1",
    name: "Мастер",
    description: "d",
    permissions: ["orders.view"],
    isActive: true,
    _count: { users: 2 },
  });
  assert.deepEqual(out, {
    id: "r1",
    name: "Мастер",
    description: "d",
    permissions: ["orders.view"],
    editablePermissions: [],
    isActive: true,
    key: null,
    userCount: 2,
  });
});

// --- source-pattern: the action file delegates to the core -----------------

test("app/_actions/system-roles.ts delegates every mutation to lib/roles/core and is super-admin gated", () => {
  const source = src("../app/_actions/system-roles.ts");
  assert.equal((source.match(/await requireSuperAdmin\(\)/g) ?? []).length, 4);
  assert.ok(source.includes("setRoleEditablePermission"), "per-permission switch action");
  for (const fn of ["createRole", "updateRole", "deleteRole"]) {
    assert.ok(source.includes(fn), `action file must call core.${fn}`);
  }
  assert.ok(source.includes('from "@/lib/roles/core"'));
  assert.doesNotMatch(source, /P2002/);
});

// --- system role defaults ----------------------------------------------------

test("SYSTEM_ROLE_DEFAULTS: 5 built-in roles, valid codes, migration SQL in sync", async () => {
  const { SYSTEM_ROLE_DEFAULTS } = await import("../lib/roles/system-roles");
  const { isValidPermissionCode } = await import("../lib/auth/permissions");
  assert.deepEqual(
    SYSTEM_ROLE_DEFAULTS.map((r) => r.name),
    ["Засварчин", "Инженер", "Нягтлан", "Кассын нярав", "Менежер"],
  );
  const sql = src("../prisma/migrations/20261113130000_global_system_roles/migration.sql");
  for (const r of SYSTEM_ROLE_DEFAULTS) {
    for (const code of r.permissions) assert.ok(isValidPermissionCode(code), `${r.key}: ${code}`);
    const errors: Record<string, string> = {};
    validate.validateOrderScopes(r.permissions, errors);
    assert.deepEqual(errors, {}, r.key);
    const arr = `ARRAY[${r.permissions.map((c) => `'${c}'`).join(",")}]`;
    assert.ok(sql.includes(`('${r.id}', '${r.key}', '${r.name}'`), `${r.key} row in migration`);
    assert.ok(sql.includes(arr), `${r.key} permissions match migration`);
  }
  // Менежер — зөвхөн харах.
  const manager = SYSTEM_ROLE_DEFAULTS.find((r) => r.key === "MANAGER")!;
  assert.ok(manager.permissions.every((c) => /\.view$|^orders\.itemHistory$/.test(c)));
});

// --- tenantEditablePermissions (role delegation) ----------------------------

test("validate: tenantEditable parsed, invalid and duplicate codes dropped, independent of permissions", () => {
  const { data, errors } = validate.validate(
    fd({
      name: "Засварчин",
      permissions: ["orders.viewOwn"],
      tenantEditable: ["orders.itemPrice", "orders.itemPrice", "bogus.code", "payments.view"],
    }),
  );
  assert.equal(errors.name, undefined);
  assert.deepEqual(data.tenantEditablePermissions, ["orders.itemPrice", "payments.view"]);
  assert.deepEqual(data.permissions, ["orders.viewOwn"]);
});

test("validate: no tenantEditable field → undefined (updates leave the switches alone, create uses open defaults)", () => {
  const { data } = validate.validate(fd({ name: "X", permissions: ["orders.viewOwn"] }));
  assert.equal(data.tenantEditablePermissions, undefined);
});

test("createRole / updateRole persist tenantEditablePermissions and report before/after", async () => {
  const { db, roles } = makeFakeDb();
  const created = await core.createRole(
    db as never,
    fd({ name: "Касс", permissions: ["payments.view"], tenantEditable: ["payments.create"] }),
  );
  assert.equal(created.ok, true);
  assert.deepEqual((roles[0] as unknown as { tenantEditablePermissions: string[] }).tenantEditablePermissions, ["payments.create"]);
  if (created.ok) assert.deepEqual((created.after as { tenantEditablePermissions: string[] }).tenantEditablePermissions, ["payments.create"]);

  const updated = await core.updateRole(
    db as never,
    roles[0].id,
    fd({ name: "Касс", permissions: ["payments.view"], tenantEditable: ["payments.create", "payments.edit"] }),
  );
  assert.equal(updated.ok, true);
  if (updated.ok) {
    assert.deepEqual((updated.after as { tenantEditablePermissions: string[] }).tenantEditablePermissions, ["payments.create", "payments.edit"]);
    // before reflects what was stored (fake row stored the field on create)
    assert.deepEqual((updated.before as { tenantEditablePermissions: string[] }).tenantEditablePermissions, ["payments.create"]);
  }
});

test("updating a role WITHOUT the tenantEditable field never touches the switches (no silent re-lock)", async () => {
  const { db, roles } = makeFakeDb();
  await core.createRole(db as never, fd({ name: "Касс", permissions: ["payments.view"], tenantEditable: ["payments.create"] }));
  const r = await core.updateRole(db as never, roles[0].id, fd({ name: "Касс 2", permissions: ["payments.view", "payments.edit"] }));
  assert.equal(r.ok, true);
  assert.deepEqual((roles[0] as unknown as { tenantEditablePermissions: string[] }).tenantEditablePermissions, ["payments.create"]);
  if (r.ok) assert.deepEqual((r.after as { tenantEditablePermissions: string[] }).tenantEditablePermissions, ["payments.create"]);
});

test("createRole without the field opens the default set; an explicit empty-capable field is honoured", async () => {
  const { db, roles } = makeFakeDb();
  await core.createRole(db as never, fd({ name: "А", permissions: ["payments.view"] }));
  assert.deepEqual((roles[0] as unknown as { tenantEditablePermissions: string[] }).tenantEditablePermissions, [...DEFAULT_TENANT_EDITABLE_PERMISSIONS]);
  await core.createRole(db as never, fd({ name: "Б", permissions: ["payments.view"], tenantEditable: ["payments.create"] }));
  assert.deepEqual((roles[1] as unknown as { tenantEditablePermissions: string[] }).tenantEditablePermissions, ["payments.create"]);
});

test("toRoleDto exposes editablePermissions (default [])", () => {
  const base = { id: "r1", name: "Касс", description: null, permissions: ["payments.view"], isActive: true };
  assert.deepEqual(dto.toRoleDto(base).editablePermissions, []);
  assert.deepEqual(dto.toRoleDto({ ...base, tenantEditablePermissions: ["payments.create"] }).editablePermissions, ["payments.create"]);
  assert.equal(dto.ROLE_SELECT.tenantEditablePermissions, true);
});
