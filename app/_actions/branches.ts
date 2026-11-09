"use server";

// Салбарын CRUD-ийн бизнес логик lib/branches-commands.ts-д байна (мобайл
// staff API — app/api/v1/branches/** — мөн тэрийг дууддаг). Энд зөвхөн
// эрх/багцын шалгалт, revalidate/redirect.

import type { ConfirmActionResult } from "@/lib/confirm-action";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { canCreate, canDelete, canEdit } from "@/lib/auth/roles";
import { assertActiveSubscription } from "@/lib/subscription-server";
import type { ScheduleImpact } from "@/lib/branch-schedule-impact";
import {
  createBranch,
  deleteBranch,
  toggleBranchActive,
  updateBranch,
} from "@/lib/branches-commands";

export type BranchActionState = {
  ok: boolean;
  message?: string;
  fieldErrors?: Record<string, string>;
  // S13 Phase 4: detailed affected-bookings preview (see
  // app/dashboard/branches/_components/schedule-impact-preview.tsx). Present
  // whenever a save was blocked or is pending confirmation because of
  // erased/clipped reservations.
  impact?: ScheduleImpact;
  // true when `impact.clipped` is non-empty and non-destructive (no erased
  // items) — the caller should resubmit with confirmed=true to proceed.
  needsConfirm?: boolean;
} | null;

function s(fd: FormData, key: string): string {
  const v = fd.get(key);
  return typeof v === "string" ? v.trim() : "";
}

async function authorize(action: "create" | "edit" | "delete") {
  const user = await requireUser();
  const ok =
    action === "create"
      ? canCreate(user, "branches")
      : action === "edit"
        ? canEdit(user, "branches")
        : canDelete(user, "branches");
  if (!ok) {
    throw new Error("Танд салбарт энэ үйлдэл хийх эрх байхгүй.");
  }
  await assertActiveSubscription(user.tenantId);
  return user;
}

export async function createBranchAction(
  _prev: BranchActionState,
  formData: FormData,
): Promise<BranchActionState> {
  let user;
  try {
    user = await authorize("create");
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Алдаа" };
  }

  const result = await createBranch(user, formData);
  if (!result.ok) {
    return result.code === "VALIDATION"
      ? { ok: false, fieldErrors: result.fieldErrors }
      : { ok: false, message: result.message };
  }

  revalidatePath("/dashboard/branches");
  revalidatePath("/dashboard");
  redirect("/dashboard/branches");
}

export async function updateBranchAction(
  id: string,
  _prev: BranchActionState,
  formData: FormData,
): Promise<BranchActionState> {
  let user;
  try {
    user = await authorize("edit");
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Алдаа" };
  }

  const confirmed = s(formData, "confirmed") === "true";
  const result = await updateBranch(user, id, formData, confirmed);
  if (!result.ok) {
    if (result.code === "VALIDATION") return { ok: false, fieldErrors: result.fieldErrors };
    if (result.code === "SCHEDULE_IMPACT") {
      return {
        ok: false,
        message: result.message,
        impact: result.impact,
        needsConfirm: result.needsConfirm,
      };
    }
    return { ok: false, message: result.message };
  }

  revalidatePath("/dashboard/branches");
  revalidatePath(`/dashboard/branches/${id}`);
  redirect(`/dashboard/branches${result.clipped ? `?scheduleWarning=${result.clipped}` : ""}`);
}

export async function toggleBranchActiveAction(formData: FormData): Promise<void> {
  const user = await authorize("edit");
  const id = s(formData, "id");
  if (!id) return;

  const result = await toggleBranchActive(user, id);
  if (!result.ok) {
    if (result.code === "NOT_FOUND") return;
    throw new Error(result.message);
  }

  revalidatePath("/dashboard/branches");
  revalidatePath("/dashboard");
}

export async function deleteBranchAction(formData: FormData): Promise<ConfirmActionResult> {
  const user = await authorize("delete");
  const id = s(formData, "id");
  if (!id) return;

  const result = await deleteBranch(user, id);
  if (!result.ok) {
    if (result.code === "NOT_FOUND") return;
    return { error: result.message };
  }

  revalidatePath("/dashboard/branches");
  revalidatePath("/dashboard");
}
