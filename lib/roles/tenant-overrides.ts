// Байгууллагын нийтийн роль дээрх нэмэлт/хасалт (TenantRoleOverride). Вэб action
// (app/_actions/tenant-role-overrides.ts) болон мобайл API (/api/v1/roles/[id]/override) хоёул
// ИЖИЛ логикийг дуудна. Дуудагч tenant context-ийг тавьсан байх ёстой (requireUser / requireApiUser)
// ба эзэн эсэхийг өөрөө шалгана. Томьёо: lib/auth/effective-permissions.ts.

import { logAudit } from "@/lib/audit";
import { computeEffectivePermissions, sanitizeOverride } from "@/lib/auth/effective-permissions";
import { prisma } from "@/lib/prisma";

type Db = Pick<typeof prisma, "role" | "tenantRoleOverride">;
type Audit = typeof logAudit;

export type RoleOverrideView = {
  roleId: string;
  name: string;
  description: string | null;
  /** Ролийн анхдагч эрх (систем админ). */
  rolePermissions: string[];
  /** Байгууллага өөрчилж болох эрх (систем админ зөвшөөрсөн). */
  editablePermissions: string[];
  /** Байгууллагын одоогийн нэмэлт / хасалт (зөвхөн хүчинтэй хэсэг). */
  add: string[];
  remove: string[];
  /** Үр дүнтэй эрх (хязгаарлалтгүй ажилтны хувьд). */
  effectivePermissions: string[];
};

/** Хуучирсан/утгагүй мөрийг цэвэрлэж харуулах хэлбэр: add нь ролид байхгүй, remove нь ролид байгаа editable код. */
function activeParts(
  rolePerms: readonly string[],
  editable: readonly string[],
  o: { addPermissions: string[]; removePermissions: string[] } | null | undefined,
) {
  const ed = new Set(editable);
  const role = new Set(rolePerms);
  return {
    add: (o?.addPermissions ?? []).filter((c) => ed.has(c) && !role.has(c)),
    remove: (o?.removePermissions ?? []).filter((c) => ed.has(c) && role.has(c)),
  };
}

function toView(
  role: { id: string; name: string; description: string | null; permissions: string[]; tenantEditablePermissions: string[] },
  override: { addPermissions: string[]; removePermissions: string[] } | null | undefined,
): RoleOverrideView {
  const { add, remove } = activeParts(role.permissions, role.tenantEditablePermissions, override);
  return {
    roleId: role.id,
    name: role.name,
    description: role.description,
    rolePermissions: role.permissions,
    editablePermissions: role.tenantEditablePermissions,
    add,
    remove,
    effectivePermissions: computeEffectivePermissions({
      rolePerms: role.permissions,
      editable: role.tenantEditablePermissions,
      add,
      remove,
    }),
  };
}

const ROLE_FIELDS = { id: true, name: true, description: true, permissions: true, tenantEditablePermissions: true } as const;

/** Систем админ ядаж нэг эрхийг өөрчлөхийг зөвшөөрсөн идэвхтэй ролиуд + энэ байгууллагын override. */
export async function listTenantRoleOverrides(tenantId: string, db: Db = prisma): Promise<RoleOverrideView[]> {
  const roles = await db.role.findMany({
    where: { isActive: true, NOT: { tenantEditablePermissions: { isEmpty: true } } },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: ROLE_FIELDS,
  });
  if (roles.length === 0) return [];
  const overrides = await db.tenantRoleOverride.findMany({
    where: { tenantId, roleId: { in: roles.map((r) => r.id) } },
    select: { roleId: true, addPermissions: true, removePermissions: true },
  });
  const byRole = new Map(overrides.map((o) => [o.roleId, o]));
  return roles.map((r) => toView(r, byRole.get(r.id)));
}

export type SaveOverrideResult =
  | { ok: true; view: RoleOverrideView }
  | { ok: false; code: "NOT_FOUND" | "LOCKED" | "VALIDATION"; message: string; fieldErrors?: Record<string, string> };

export async function saveTenantRoleOverride(
  ctx: { tenantId: string; userId: string },
  roleId: string,
  input: { add?: unknown; remove?: unknown },
  deps: { db?: Db; audit?: Audit } = {},
): Promise<SaveOverrideResult> {
  const db = deps.db ?? prisma;
  const audit = deps.audit ?? logAudit;

  const role = await db.role.findUnique({ where: { id: roleId }, select: { ...ROLE_FIELDS, isActive: true } });
  if (!role || !role.isActive) return { ok: false, code: "NOT_FOUND", message: "Роль олдсонгүй." };
  if (role.tenantEditablePermissions.length === 0) {
    return { ok: false, code: "LOCKED", message: "Энэ ролийн эрхийг өөрчлөх боломжгүй (системээс түгжсэн)." };
  }

  const parsed = sanitizeOverride({ rolePerms: role.permissions, editable: role.tenantEditablePermissions }, input);
  if (!parsed.ok) return { ok: false, code: "VALIDATION", message: "Оруулсан мэдээлэл буруу.", fieldErrors: parsed.fieldErrors };

  const existing = await db.tenantRoleOverride.findUnique({
    where: { tenantId_roleId: { tenantId: ctx.tenantId, roleId } },
    select: { addPermissions: true, removePermissions: true },
  });
  const before = activeParts(role.permissions, role.tenantEditablePermissions, existing);

  let saved: { addPermissions: string[]; removePermissions: string[] } | null = null;
  if (parsed.add.length === 0 && parsed.remove.length === 0) {
    // Анхдагч руу буцаах — мөрийг устгана (мөр байхгүй = роль яг анхдагчаар).
    await db.tenantRoleOverride.deleteMany({ where: { tenantId: ctx.tenantId, roleId } });
  } else {
    saved = await db.tenantRoleOverride.upsert({
      where: { tenantId_roleId: { tenantId: ctx.tenantId, roleId } },
      create: { tenantId: ctx.tenantId, roleId, addPermissions: parsed.add, removePermissions: parsed.remove, updatedById: ctx.userId },
      update: { addPermissions: parsed.add, removePermissions: parsed.remove, updatedById: ctx.userId },
      select: { addPermissions: true, removePermissions: true },
    });
  }

  await audit({
    tenantId: ctx.tenantId,
    entity: "Role",
    entityId: roleId,
    action: "UPDATE",
    summary: `${role.name} · байгууллагын эрх: нэмсэн ${parsed.add.length}, хассан ${parsed.remove.length}`,
    before,
    after: { add: parsed.add, remove: parsed.remove },
    userId: ctx.userId,
  });

  return { ok: true, view: toView(role, saved) };
}

/**
 * Нэг эрхийг шууд асаах/унтраах (switch). Одоогийн override дээр ЗӨВХӨН энэ кодыг өөрчилж
 * saveTenantRoleOverride-оор дамжуулна (ижил шалгалт, аудит, түгжигдсэн код → VALIDATION).
 * on=true: ролид байгаа бол «хассан»-аас гаргана, байхгүй бол «нэмсэн»-д оруулна.
 * on=false: ролид байгаа бол «хассан»-д оруулна, байхгүй бол «нэмсэн»-ээс гаргана.
 */
export async function toggleTenantRolePermission(
  ctx: { tenantId: string; userId: string },
  roleId: string,
  code: unknown,
  on: unknown,
  deps: { db?: Db; audit?: Audit } = {},
): Promise<SaveOverrideResult> {
  const db = deps.db ?? prisma;
  if (typeof code !== "string" || typeof on !== "boolean") {
    return { ok: false, code: "VALIDATION", message: "Хүсэлт буруу.", fieldErrors: { code: "Эрхийн код, төлөв шаардлагатай." } };
  }
  const current = await getTenantRoleOverrideView(ctx.tenantId, roleId, db);
  if (!current) return { ok: false, code: "NOT_FOUND", message: "Роль олдсонгүй." };

  const inRole = current.rolePermissions.includes(code);
  const add = new Set(current.add);
  const remove = new Set(current.remove);
  if (on) {
    if (inRole) remove.delete(code);
    else add.add(code);
  } else if (inRole) {
    remove.add(code);
  } else {
    add.delete(code);
  }
  return saveTenantRoleOverride(ctx, roleId, { add: [...add], remove: [...remove] }, deps);
}

/** Нэг ролийн харагдац (өөрчилж болох эрхгүй ч буцна — editablePermissions = []). Идэвхгүй/олдохгүй → null. */
export async function getTenantRoleOverrideView(
  tenantId: string,
  roleId: string,
  db: Db = prisma,
): Promise<RoleOverrideView | null> {
  const role = await db.role.findUnique({ where: { id: roleId }, select: { ...ROLE_FIELDS, isActive: true } });
  if (!role || !role.isActive) return null;
  const override =
    role.tenantEditablePermissions.length > 0
      ? await db.tenantRoleOverride.findUnique({
          where: { tenantId_roleId: { tenantId, roleId } },
          select: { addPermissions: true, removePermissions: true },
        })
      : null;
  return toView(role, override);
}
