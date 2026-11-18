// Хэрэглэгчийн role.permissions-ийг ҮР ДҮНТЭЙ (effective) эрхээр солих нэг цэг —
// lib/auth/index.ts (вэб) болон lib/auth/api-token.ts (мобайл) хоёулаа дуудна. Доод талын
// бүх шалгалт (hasPermission, order-access, sidebar, API route) `user.role.permissions`-ийг
// уншдаг тул ингэснээр өөрчлөлтгүйгээр зөв ажиллана. Томьёо: lib/auth/effective-permissions.ts.

import { prisma } from "@/lib/prisma";
import { computeEffectivePermissions } from "./effective-permissions";

/** Loader-ийн role select — effective тооцоход хэрэгтэй талбарууд. */
export const EFFECTIVE_ROLE_SELECT = {
  id: true,
  name: true,
  permissions: true,
  isActive: true,
  tenantEditablePermissions: true,
} as const;

export type RawRole = {
  id: string;
  name: string;
  permissions: string[];
  isActive: boolean;
  tenantEditablePermissions: string[];
};

export type EffectiveRole = { id: string; name: string; permissions: string[]; isActive: boolean };

type OverrideReader = Pick<typeof prisma, "tenantRoleOverride">;

/**
 * Tenant context аль хэдийн тавигдсаны ДАРАА дуудна (TenantRoleOverride нь RLS-тэй).
 *  - Идэвхгүй (глобал) роль = эрхгүй (өмнөх дүрэм хэвээр).
 *  - Эзэн (isOwner) = hasPermission-д бүгдийг тойрдог тул хөндөхгүй.
 *  - Роль дээр «өөрчилж болох» эрх байхгүй бол override query хийхгүй (override-ийн нөлөө
 *    `∩ editable` = хоосон) → анхдагч нөхцөлд нэмэлт DB уншилт 0.
 */
export async function resolveEffectiveRole(
  user: { isOwner: boolean; tenantId: string; deniedPermissions: string[]; role: RawRole | null },
  db: OverrideReader = prisma,
): Promise<EffectiveRole | null> {
  const role = user.role;
  if (!role) return null;
  const base = { id: role.id, name: role.name, isActive: role.isActive };
  if (!role.isActive) return { ...base, permissions: [] };
  if (user.isOwner) return { ...base, permissions: role.permissions };

  // Хэсэгчилсэн өгөгдөлд (хуучин select/fake) тэсвэртэй: талбар байхгүй = хоосон.
  const editable = role.tenantEditablePermissions ?? [];
  let add: string[] = [];
  let remove: string[] = [];
  if (editable.length > 0) {
    const override = await db.tenantRoleOverride.findUnique({
      where: { tenantId_roleId: { tenantId: user.tenantId, roleId: role.id } },
      select: { addPermissions: true, removePermissions: true },
    });
    add = override?.addPermissions ?? [];
    remove = override?.removePermissions ?? [];
  }
  return {
    ...base,
    permissions: computeEffectivePermissions({
      rolePerms: role.permissions,
      editable,
      add,
      remove,
      denied: user.deniedPermissions ?? [],
    }),
  };
}
