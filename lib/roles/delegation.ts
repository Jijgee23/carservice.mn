// Систем админ ролийн НЭГ эрхийг «байгууллага өөрчилж болно / түгжигдсэн» болгож солино
// (Role.tenantEditablePermissions). Эрх тус бүрийн switch-д зориулсан — роль засах форм (CRUD матриц)
// энэ талбарыг хөндөхгүй. Framework-free: auth/revalidate-ийг action хийнэ.

import { isValidPermissionCode } from "@/lib/auth/permissions";
import { prisma } from "@/lib/prisma";

type Db = Pick<typeof prisma, "role">;

export type DelegationView = {
  roleId: string;
  name: string;
  isActive: boolean;
  /** Ролийн эрхүүд (систем админ). */
  rolePermissions: string[];
  /** Байгууллага өөрчилж болох (нээлттэй) эрхүүд. */
  editablePermissions: string[];
};

export async function getRoleDelegation(roleId: string, db: Db = prisma): Promise<DelegationView | null> {
  const role = await db.role.findUnique({
    where: { id: roleId },
    select: { id: true, name: true, isActive: true, permissions: true, tenantEditablePermissions: true },
  });
  if (!role) return null;
  return {
    roleId: role.id,
    name: role.name,
    isActive: role.isActive,
    rolePermissions: role.permissions,
    editablePermissions: role.tenantEditablePermissions,
  };
}

export type SetDelegationResult =
  | { ok: true; code: string; open: boolean; editablePermissions: string[]; before: string[] }
  | { ok: false; code: "NOT_FOUND" | "VALIDATION"; message: string };

/** Нэг эрхийг нээх (open=true) эсвэл түгжих. Идемпотент: аль хэдийн тэр төлөвт байвал өөрчлөхгүй. */
export async function setRoleEditablePermission(
  roleId: string,
  code: unknown,
  open: unknown,
  db: Db = prisma,
): Promise<SetDelegationResult> {
  if (typeof code !== "string" || !isValidPermissionCode(code) || typeof open !== "boolean") {
    return { ok: false, code: "VALIDATION", message: "Хүсэлт буруу." };
  }
  const role = await db.role.findUnique({
    where: { id: roleId },
    select: { id: true, tenantEditablePermissions: true },
  });
  if (!role) return { ok: false, code: "NOT_FOUND", message: "Роль олдсонгүй." };

  const before = role.tenantEditablePermissions;
  const has = before.includes(code);
  if (has === open) return { ok: true, code, open, editablePermissions: before, before };

  const next = open ? [...before, code] : before.filter((c) => c !== code);
  await db.role.update({ where: { id: role.id }, data: { tenantEditablePermissions: next } });
  return { ok: true, code, open, editablePermissions: next, before };
}
