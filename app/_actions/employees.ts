"use server";


import type { ConfirmActionResult } from "@/lib/confirm-action";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { Prisma } from "@/app/generated/prisma/client";
import { logAudit } from "@/lib/audit";
import { requireUser } from "@/lib/auth";
import { canCreate, canDelete, canEdit } from "@/lib/auth/roles";
import { assertActiveSubscription } from "@/lib/subscription-server";
import type { BulkActionState } from "@/lib/bulk-action";
import {
  bulkUpdateEmployeeRoleBranch,
  createEmployee,
  deleteEmployee,
  prepareCreateEmployee,
  resetEmployeePassword,
  toggleEmployeeActive,
  updateEmployee,
} from "@/lib/employees/core";
import type { EmployeeActor } from "@/lib/employees/types";
import { purgeStaffAccess } from "@/lib/account-closure/staff";
import { prisma } from "@/lib/prisma";

export type EmployeeActionState = {
  ok: boolean;
  message?: string;
  fieldErrors?: Record<string, string>;
} | null;

async function authorize(action: "create" | "edit" | "delete"): Promise<EmployeeActor> {
  const user = await requireUser();
  const ok =
    action === "create"
      ? canCreate(user, "employees")
      : action === "edit"
        ? canEdit(user, "employees")
        : canDelete(user, "employees");
  if (!ok) {
    throw new Error("Танд ажилтанд энэ үйлдэл хийх эрх байхгүй.");
  }
  await assertActiveSubscription(user.tenantId);
  return user;
}

// --- CREATE ---------------------------------------------------------------

export async function createEmployeeAction(
  _prev: EmployeeActionState,
  formData: FormData,
): Promise<EmployeeActionState> {
  let user: EmployeeActor;
  try {
    user = await authorize("create");
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Алдаа" };
  }

  const prep = await prepareCreateEmployee(prisma, user, formData);
  if (!prep.ok) {
    return { ok: false, fieldErrors: prep.fieldErrors };
  }

  const result = await createEmployee(prisma, user, prep.data, prep.wantsOwner);
  if (!result.ok) {
    return result.fieldErrors
      ? { ok: false, fieldErrors: result.fieldErrors }
      : { ok: false, message: result.error };
  }

  await logAudit({
    tenantId: user.tenantId,
    userId: user.id,
    entity: "User",
    entityId: result.id,
    action: "CREATE",
    summary: result.summary,
    after: result.after as Prisma.InputJsonValue,
  });

  revalidatePath("/dashboard/employees");
  revalidatePath("/dashboard");
  redirect("/dashboard/employees");
}

// --- UPDATE ---------------------------------------------------------------

export async function updateEmployeeAction(
  id: string,
  _prev: EmployeeActionState,
  formData: FormData,
): Promise<EmployeeActionState> {
  let me: EmployeeActor;
  try {
    me = await authorize("edit");
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Алдаа" };
  }

  const result = await updateEmployee(prisma, me, id, formData);
  if (!result.ok) {
    return result.fieldErrors
      ? { ok: false, fieldErrors: result.fieldErrors }
      : { ok: false, message: result.error };
  }

  await logAudit({
    tenantId: me.tenantId,
    userId: me.id,
    entity: "User",
    entityId: id,
    action: "UPDATE",
    summary: result.summary,
    before: result.before as Prisma.InputJsonValue,
    after: result.after as Prisma.InputJsonValue,
  });

  revalidatePath("/dashboard/employees");
  revalidatePath(`/dashboard/employees/${id}`);
  redirect("/dashboard/employees");
}

// --- BULK UPDATE (role / main branch) --------------------------------------

export async function bulkUpdateEmployeeRoleBranchAction(
  _prev: BulkActionState,
  formData: FormData,
): Promise<BulkActionState> {
  let user: EmployeeActor;
  try {
    user = await authorize("edit");
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Алдаа" };
  }

  const result = await bulkUpdateEmployeeRoleBranch(prisma, user, formData);

  if (!("succeeded" in result)) {
    // Validation failed before the per-row loop ran (no selection, role/
    // branch not found, no ids) — the original action never revalidated
    // in this case either.
    return { ok: false, message: result.message };
  }

  revalidatePath("/dashboard/employees");
  return result;
}

// --- ACTIVATE / DEACTIVATE -----------------------------------------------

export async function toggleEmployeeActiveAction(formData: FormData): Promise<void> {
  const me = await authorize("edit");
  const result = await toggleEmployeeActive(prisma, me, formData);
  if ("noop" in result) return;
  if (!result.ok) {
    throw new Error(result.error);
  }

  await logAudit({
    tenantId: me.tenantId,
    userId: me.id,
    entity: "User",
    entityId: result.id,
    action: "UPDATE",
    summary: result.summary,
    before: result.before as Prisma.InputJsonValue,
    after: result.after as Prisma.InputJsonValue,
  });

  revalidatePath("/dashboard/employees");
  revalidatePath(`/dashboard/employees/${result.id}`);
}

// --- DELETE ---------------------------------------------------------------

export async function deleteEmployeeAction(formData: FormData): Promise<ConfirmActionResult> {
  const me = await authorize("delete");
  const result = await deleteEmployee(prisma, me, formData);
  if ("noop" in result) return;
  if (!result.ok) {
    return { error: result.error };
  }

  await purgeStaffAccess(result.id);

  await logAudit({
    tenantId: me.tenantId,
    userId: me.id,
    entity: "User",
    entityId: result.id,
    action: "DELETE",
    summary: result.summary,
  });

  revalidatePath("/dashboard/employees");
  revalidatePath("/dashboard");
}

/** `deleteEmployeeAction`-той ижил, гэхдээ ажилтны ДЭЛГЭРЭНГҮЙ хуудаснаас
 * дуудагдана — устгасны дараа тэр хуудас өөрөө байхгүй болдог тул жагсаалт
 * руу буцаана. */
export async function deleteEmployeeAndReturnAction(formData: FormData): Promise<ConfirmActionResult> {
  const result = await deleteEmployeeAction(formData);
  if (result?.error) return result;
  redirect("/dashboard/employees");
}

// --- RESET PASSWORD ---------------------------------------------------------

export async function resetEmployeePasswordAction(formData: FormData): Promise<ConfirmActionResult> {
  const me = await authorize("edit");
  const result = await resetEmployeePassword(prisma, me, formData);
  if ("noop" in result) return;
  if (!result.ok) {
    return { error: result.error };
  }

  await logAudit({
    tenantId: me.tenantId,
    userId: me.id,
    entity: "User",
    entityId: result.id,
    action: "UPDATE",
    summary: result.summary,
  });

  revalidatePath(`/dashboard/employees/${result.id}`);
}
