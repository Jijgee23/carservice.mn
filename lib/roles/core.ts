// Framework-free business rules for the global (system) roles managed by
// super admins at /system/roles. No `redirect`/`revalidatePath`/cookies/
// `"use server"`/`server-only` imports here — auth and revalidation stay in
// the action wrapper (`app/_actions/system-roles.ts`).

import type { RolesClient, ValidatedRole } from "./types";
import { s, validate } from "./validate";

export type FieldErr = {
  ok: false;
  code: "VALIDATION";
  error: string;
  fieldErrors: Record<string, string>;
};

export type MessageErr = {
  ok: false;
  code: "NOT_FOUND" | "DUPLICATE" | "UNKNOWN" | "ROLE_IN_USE" | "SYSTEM_ROLE";
  error: string;
};

// --- CREATE ---------------------------------------------------------------

export type CreateRoleResult =
  | {
      ok: true;
      id: string;
      summary: string;
      after: Record<string, unknown>;
    }
  | FieldErr
  | MessageErr;

export async function createRole(
  db: RolesClient,
  formData: FormData,
): Promise<CreateRoleResult> {
  const { data, errors } = validate(formData);
  if (Object.keys(errors).length > 0) {
    return { ok: false, code: "VALIDATION", error: "Оруулсан мэдээлэл буруу.", fieldErrors: errors };
  }

  let created;
  try {
    created = await db.role.create({
      data: {
        name: data.name,
        description: data.description,
        permissions: data.permissions,
        tenantEditablePermissions: data.tenantEditablePermissions,
        isActive: data.isActive,
      },
      select: { id: true, name: true },
    });
  } catch (e) {
    if (isP2002(e)) {
      return {
        ok: false,
        code: "DUPLICATE",
        error: "Энэ нэртэй роль аль хэдийн байна.",
      };
    }
    return {
      ok: false,
      code: "UNKNOWN",
      error: e instanceof Error ? e.message : "Үүсгэх явцад алдаа гарлаа.",
    };
  }

  return {
    ok: true,
    id: created.id,
    summary: `${data.name} · ${data.permissions.length} эрх`,
    after: {
      name: data.name,
      permissions: data.permissions,
      tenantEditablePermissions: data.tenantEditablePermissions,
      isActive: data.isActive,
    },
  };
}

// --- UPDATE ---------------------------------------------------------------

export type UpdateRoleResult =
  | {
      ok: true;
      id: string;
      summary: string;
      before: Record<string, unknown>;
      after: Record<string, unknown>;
    }
  | FieldErr
  | MessageErr;

export async function updateRole(
  db: RolesClient,
  id: string,
  formData: FormData,
): Promise<UpdateRoleResult> {
  const { data, errors } = validate(formData);
  if (Object.keys(errors).length > 0) {
    return { ok: false, code: "VALIDATION", error: "Оруулсан мэдээлэл буруу.", fieldErrors: errors };
  }

  const target = await db.role.findFirst({ where: { id } });
  if (!target) return { ok: false, code: "NOT_FOUND", error: "Роль олдсонгүй." };

  try {
    await db.role.update({
      where: { id: target.id },
      data: {
        name: data.name,
        description: data.description,
        permissions: data.permissions,
        tenantEditablePermissions: data.tenantEditablePermissions,
        isActive: data.isActive,
      },
    });
  } catch (e) {
    if (isP2002(e)) {
      return {
        ok: false,
        code: "DUPLICATE",
        error: "Энэ нэртэй роль аль хэдийн байна.",
      };
    }
    return {
      ok: false,
      code: "UNKNOWN",
      error: e instanceof Error ? e.message : "Шинэчлэх явцад алдаа гарлаа.",
    };
  }

  return {
    ok: true,
    id,
    summary: `${data.name} · ${data.permissions.length} эрх`,
    before: {
      name: target.name,
      permissions: target.permissions,
      tenantEditablePermissions: target.tenantEditablePermissions ?? [],
      isActive: target.isActive,
    },
    after: {
      name: data.name,
      permissions: data.permissions,
      tenantEditablePermissions: data.tenantEditablePermissions,
      isActive: data.isActive,
    },
  };
}

// --- DELETE ---------------------------------------------------------------

export type Noop = { ok: true; noop: true };

export type DeleteRoleResult =
  | Noop
  | { ok: true; id: string; summary: string }
  | { ok: false; code: "ROLE_IN_USE" | "SYSTEM_ROLE"; error: string };

export async function deleteRole(
  db: RolesClient,
  formData: FormData,
): Promise<DeleteRoleResult> {
  const id = s(formData, "id");
  if (!id) return { ok: true, noop: true };

  const target = await db.role.findFirst({
    where: { id },
    include: { _count: { select: { users: true } } },
  });
  if (!target) return { ok: true, noop: true };
  if (target.key) {
    return {
      ok: false,
      code: "SYSTEM_ROLE",
      error: "Үндсэн системийн ролийг устгах боломжгүй. Шаардлагагүй бол идэвхгүй болгоно уу.",
    };
  }
  const userCount = target._count?.users ?? 0;
  if (userCount > 0) {
    return {
      ok: false,
      code: "ROLE_IN_USE",
      error: `Энэ рольтой ${userCount} ажилтан (бүх байгууллагад) байна. Устгахын оронд идэвхгүй болгоно уу.`,
    };
  }

  await db.role.delete({ where: { id: target.id } });

  return { ok: true, id, summary: target.name ?? "" };
}

// --- helpers ---------------------------------------------------------------

function isP2002(e: unknown): boolean {
  return (
    typeof e === "object" &&
    e !== null &&
    "code" in e &&
    (e as { code?: unknown }).code === "P2002" &&
    "clientVersion" in e
  );
}

export type { ValidatedRole };
