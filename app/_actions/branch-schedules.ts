"use server";


import type { ConfirmActionResult } from "@/lib/confirm-action";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { canEdit } from "@/lib/auth/roles";
import { assertActiveSubscription } from "@/lib/subscription-server";
import { type BulkActionState } from "@/lib/bulk-action";
import { prisma } from "@/lib/prisma";
import type { ScheduleImpact } from "@/lib/branch-schedule-impact";
import {
  applyHolidayToAllBranches,
  type BranchScheduleCommandResult,
  deleteBranchScheduleException,
  deleteBranchScheduleSeason,
  upsertBranchScheduleException,
  upsertBranchScheduleSeason,
} from "@/lib/branch-schedule-commands";

// Бизнес логик (validation, Branch row lock + prisma.$transaction, impact
// шалгалт, audit) нь lib/branch-schedule-commands.ts-д — мобайл staff API
// (app/api/v1/branches/[id]/schedules/**) мөн адил функцуудыг дуудна.

export type BranchScheduleActionState = {
  ok: boolean;
  message?: string;
  fieldErrors?: Record<string, string>;
  // S13 Phase 4 — see app/dashboard/branches/_components/schedule-impact-preview.tsx.
  impact?: ScheduleImpact;
  needsConfirm?: boolean;
} | null;

function s(fd: FormData, key: string): string {
  const value = fd.get(key);
  return typeof value === "string" ? value.trim() : "";
}

async function authorizeBranch(branchId: string) {
  const user = await requireUser();
  if (!canEdit(user, "branches")) throw new Error("Танд салбарын хуваарь засах эрх байхгүй.");
  await assertActiveSubscription(user.tenantId);
  const branch = await prisma.branch.findFirst({
    where: { id: branchId, tenantId: user.tenantId },
    select: { id: true, tenantId: true, name: true },
  });
  if (!branch) throw new Error("Салбар олдсонгүй.");
  return { user, branch };
}

function toActionState(result: BranchScheduleCommandResult): BranchScheduleActionState {
  if (result.ok) return { ok: true, message: result.message };
  if (result.code === "VALIDATION") return { ok: false, fieldErrors: result.fieldErrors };
  if (result.code === "SCHEDULE_IMPACT") {
    return { ok: false, message: result.message, impact: result.impact, needsConfirm: result.needsConfirm };
  }
  return { ok: false, message: result.message };
}

function revalidateBranchSchedule(branchId: string) {
  revalidatePath(`/dashboard/branches/${branchId}/schedule`);
  revalidatePath(`/dashboard/branches/${branchId}`);
  revalidatePath("/dashboard/branches");
}

export async function upsertBranchScheduleExceptionAction(
  branchId: string,
  _prev: BranchScheduleActionState,
  formData: FormData,
): Promise<BranchScheduleActionState> {
  let auth;
  try { auth = await authorizeBranch(branchId); } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "Эрх шалгахад алдаа гарлаа." };
  }
  // S13 Phase 4: impact.erased → хатуу хориг; impact.clipped.length > 0 && !confirmed
  // → баталгаажуулалт шаардана (lib/branch-schedule-commands.ts).
  const confirmed = s(formData, "confirmed") === "true";
  const result = await upsertBranchScheduleException(auth.user, branchId, formData, confirmed);
  if (result.ok) revalidateBranchSchedule(branchId);
  return toActionState(result);
}

export async function deleteBranchScheduleExceptionAction(formData: FormData): Promise<ConfirmActionResult> {
  const branchId = s(formData, "branchId");
  const id = s(formData, "id");
  if (!branchId || !id) return;
  const { user } = await authorizeBranch(branchId);
  const result = await deleteBranchScheduleException(user, branchId, id);
  if (!result.ok) return { error: result.message };
  revalidatePath(`/dashboard/branches/${branchId}/schedule`);
  revalidatePath(`/dashboard/branches/${branchId}`);
}

export async function upsertBranchScheduleSeasonAction(
  branchId: string,
  _prev: BranchScheduleActionState,
  formData: FormData,
): Promise<BranchScheduleActionState> {
  let auth;
  try { auth = await authorizeBranch(branchId); } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "Эрх шалгахад алдаа гарлаа." };
  }
  const confirmed = s(formData, "confirmed") === "true";
  const result = await upsertBranchScheduleSeason(auth.user, branchId, formData, confirmed);
  if (result.ok) revalidateBranchSchedule(branchId);
  return toActionState(result);
}

export async function deleteBranchScheduleSeasonAction(formData: FormData): Promise<ConfirmActionResult> {
  const branchId = s(formData, "branchId");
  const id = s(formData, "id");
  if (!branchId || !id) return;
  const { user } = await authorizeBranch(branchId);
  const result = await deleteBranchScheduleSeason(user, branchId, id);
  if (!result.ok) return { error: result.message };
  revalidatePath(`/dashboard/branches/${branchId}/schedule`);
  revalidatePath(`/dashboard/branches/${branchId}`);
}

// --- ALL-BRANCH HOLIDAY (fan-out) ------------------------------------------

/**
 * Нэг л удаа (жишээ нь Шинэ жил) огноо оруулбал, тенантын БҮХ салбарт нэг
 * зэрэг "тусгай өдөр" (BranchScheduleException) тохируулна. Салбар бүрд ЯГ
 * адилхан `upsertBranchScheduleException`-г дуудна (lib/branch-schedule-commands.ts
 * applyHolidayToAllBranches) — нэг салбарт захиалга цуцлагдах эрсдэлтэй
 * (`erased`) эсвэл баталгаажуулаагүй (`needsConfirm`) тохиолдол гарвал ЗӨВХӨН
 * тэр салбар алгасагдаж, error жагсаалтад орно (тухайн салбарыг ажилтан дараа
 * нь /dashboard/branches/[id]/schedule хуудаснаас тусад нь баталгаажуулна).
 */
export async function applyHolidayToAllBranchesAction(
  _prev: BulkActionState,
  formData: FormData,
): Promise<BulkActionState> {
  const user = await requireUser();
  if (!canEdit(user, "branches")) {
    return { ok: false, message: "Танд салбарын хуваарь засах эрх байхгүй." };
  }
  await assertActiveSubscription(user.tenantId);

  const confirmed = s(formData, "confirmed") === "true";
  const result = await applyHolidayToAllBranches(user, formData, confirmed);
  if (!result) {
    return { ok: false, message: "Салбар олдсонгүй." };
  }
  for (const r of result.results) {
    if (r.result.ok) revalidateBranchSchedule(r.branchId);
  }
  revalidatePath("/dashboard/branches");

  const { ok, message, succeeded, failed, errors } = result;
  return { ok, message, succeeded, failed, errors };
}
