"use server";

import type { ConfirmActionResult } from "@/lib/confirm-action";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireSuperAdmin } from "@/lib/auth/system";
import { createRole, deleteRole, updateRole } from "@/lib/roles/core";
import { setRoleEditablePermission } from "@/lib/roles/delegation";
import { prisma } from "@/lib/prisma";

// Системийн (глобал) роль — зөвхөн супер админ удирдана. Tenant-ууд эдгээрээс
// сонгож ажилтандаа онооно (lib/roles/system-roles.ts).

export type RoleActionState = {
  ok: boolean;
  message?: string;
  fieldErrors?: Record<string, string>;
} | null;

function revalidateRoles(id?: string) {
  revalidatePath("/system/roles");
  if (id) revalidatePath(`/system/roles/${id}`);
  // Ажилтны form/жагсаалт дахь роль сонголт бүх tenant-д шинэчлэгдэнэ.
  revalidatePath("/dashboard/employees", "layout");
}

export async function createRoleAction(
  _prev: RoleActionState,
  formData: FormData,
): Promise<RoleActionState> {
  await requireSuperAdmin();

  const result = await createRole(prisma, formData);
  if (!result.ok) {
    return "fieldErrors" in result
      ? { ok: false, fieldErrors: result.fieldErrors }
      : { ok: false, message: result.error };
  }

  revalidateRoles();
  redirect("/system/roles");
}

export async function updateRoleAction(
  id: string,
  _prev: RoleActionState,
  formData: FormData,
): Promise<RoleActionState> {
  await requireSuperAdmin();

  const result = await updateRole(prisma, id, formData);
  if (!result.ok) {
    return "fieldErrors" in result
      ? { ok: false, fieldErrors: result.fieldErrors }
      : { ok: false, message: result.error };
  }

  revalidateRoles(id);
  redirect("/system/roles");
}

export async function deleteRoleAction(formData: FormData): Promise<ConfirmActionResult> {
  await requireSuperAdmin();
  const result = await deleteRole(prisma, formData);
  if ("noop" in result) return;
  if (!result.ok) return { error: result.error };

  revalidateRoles();
  redirect("/system/roles");
}

/**
 * Ролийн НЭГ эрхийг «байгууллага өөрчилж болно / түгжигдсэн» болгоно (switch бүрт шууд).
 * Роль засах формоос тусдаа — тэр форм энэ жагсаалтыг хөндөхгүй.
 */
export async function setRoleEditablePermissionAction(
  roleId: string,
  code: string,
  open: boolean,
): Promise<{ ok: boolean; message?: string }> {
  await requireSuperAdmin();
  const r = await setRoleEditablePermission(roleId, code, open);
  if (!r.ok) return { ok: false, message: r.message };
  revalidatePath(`/system/roles/${roleId}/delegation`);
  revalidatePath("/system/roles");
  // Байгууллагын «Ролийн эрх» хуудас, ажилтны шалгалтууд шинэчлэгдэнэ.
  revalidatePath("/dashboard", "layout");
  return { ok: true };
}
