// Explicit-whitelist DTO builder for Role rows. Roles carry no secret
// fields today, but the whitelist keeps the same shape as
// `lib/employees/dto.ts` and protects against a future column (e.g. an
// internal note) leaking by default.

import type { Prisma } from "@/app/generated/prisma/client";
import type { RoleRow } from "./types";

export const ROLE_SELECT = {
  id: true,
  key: true,
  name: true,
  description: true,
  permissions: true,
  tenantEditablePermissions: true,
  isActive: true,
} satisfies Prisma.RoleSelect;

/** Tenant роль үүсгэх/засах/устгах оролдлогод (mobile API) буцаах мессеж. */
export const SYSTEM_MANAGED_MESSAGE =
  "Роль системээс тохируулагдана. Системийн админтай холбогдоно уу.";

export type FullRoleRow = Required<Pick<RoleRow, "id" | "name" | "description" | "permissions" | "isActive">> & {
  tenantEditablePermissions?: string[];
  key?: string | null;
  _count?: { users: number };
};

export type RoleDto = {
  id: string;
  name: string;
  description: string | null;
  permissions: string[];
  /** Байгууллага нэмж/хасч болох эрхүүд (систем админ тохируулсан); бусад нь түгжигдсэн. */
  editablePermissions: string[];
  isActive: boolean;
  /** Үндсэн системийн ролийн түлхүүр (MECHANIC…); null = нэмэлт роль. */
  key: string | null;
  userCount?: number;
};

export function toRoleDto(row: FullRoleRow): RoleDto {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    permissions: row.permissions,
    editablePermissions: row.tenantEditablePermissions ?? [],
    isActive: row.isActive,
    key: row.key ?? null,
    ...(row._count ? { userCount: row._count.users } : {}),
  };
}
