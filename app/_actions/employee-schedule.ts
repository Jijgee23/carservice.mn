"use server";

import { assertModuleEnabled } from "@/lib/plan-modules-server";
import { revalidatePath } from "next/cache";
import { logAudit } from "@/lib/audit";
import { requireUser } from "@/lib/auth";
import { hasPermission } from "@/lib/auth/roles";
import {
  authorizeScheduleTarget,
  bulkUpsertEmployeeShiftCommand,
  resetEmployeeShiftCommand,
  upsertEmployeeShiftCommand,
} from "@/lib/employee-schedule-commands";
import { prisma } from "@/lib/prisma";
import { assertActiveSubscription } from "@/lib/subscription-server";

export type EmployeeScheduleActionState = {
  ok: boolean;
  message?: string;
  fieldErrors?: Record<string, string>;
} | null;

function s(fd: FormData, key: string): string {
  const v = fd.get(key);
  return typeof v === "string" ? v.trim() : "";
}

async function authorize(userId: string) {
  const actor = await requireUser();
  await assertModuleEnabled(actor.tenantId, "enable_staff_schedule");
  await assertActiveSubscription(actor.tenantId);
  const result = await authorizeScheduleTarget(prisma, {
    hasSchedulePermission: hasPermission(actor, "employees.schedule"),
    tenantId: actor.tenantId,
    userId,
  });
  if (!result.ok) throw new Error(result.message);
  return { actor, target: result.target };
}

/**
 * Ажилтны нэг өдрийн хувиарыг тохируулна (нэг буюу хэд хэдэн салбарын
 * segment-тэйгээр). `scope=date` бол зөвхөн тухайн өдөрт
 * (`EmployeeScheduleException`), `scope=weekday` бол тухайн гараг бүрт
 * давтагдах байнгын дүрэм (`EmployeeWorkSchedule`) болгож бичнэ. Бизнес
 * логик `lib/employee-schedule-commands.ts`-д (P6-B1); энд зөвхөн эрх,
 * audit, revalidatePath.
 */
export async function upsertEmployeeShiftAction(
  userId: string,
  _prev: EmployeeScheduleActionState,
  formData: FormData,
): Promise<EmployeeScheduleActionState> {
  let auth;
  try {
    auth = await authorize(userId);
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Алдаа" };
  }

  const result = await upsertEmployeeShiftCommand(prisma, {
    tenantId: auth.actor.tenantId,
    userId,
    scope: s(formData, "scope"),
    isWorking: formData.get("isWorking") === "on",
    segmentsJson: s(formData, "segmentsJson"),
    date: s(formData, "date"),
    weekday: s(formData, "weekday"),
  });

  if (!result.ok) {
    return { ok: false, message: result.message, fieldErrors: "fieldErrors" in result ? result.fieldErrors : undefined };
  }

  const summary =
    result.scope === "date"
      ? `${auth.target.lastName} ${auth.target.firstName} — ажлын хувиар, тусгай өдөр (${result.date})`
      : `${auth.target.lastName} ${auth.target.firstName} — ажлын хувиар, ${result.weekday} гараг`;
  await logAudit({
    tenantId: auth.actor.tenantId,
    userId: auth.actor.id,
    entity: "User",
    entityId: userId,
    action: "UPDATE",
    summary,
  });

  revalidatePath("/dashboard/employees/schedule");
  return { ok: true, message: result.message };
}

/** Override мөрийг арилгаж, платформын анхны утга (үндсэн салбарын хуваарь) руу буцаана. */
export async function resetEmployeeShiftAction(formData: FormData): Promise<void> {
  const userId = s(formData, "userId");
  const scope = s(formData, "scope");
  if (!userId) return;
  let auth;
  try {
    auth = await authorize(userId);
  } catch {
    return;
  }

  const result = await resetEmployeeShiftCommand(prisma, {
    userId,
    scope,
    date: s(formData, "date"),
    weekday: s(formData, "weekday"),
  });
  if (!result.ok) return;

  await logAudit({
    tenantId: auth.actor.tenantId,
    userId: auth.actor.id,
    entity: "User",
    entityId: userId,
    action: "DELETE",
    summary: `${auth.target.lastName} ${auth.target.firstName} — ажлын хувиарын override арилгав`,
  });

  revalidatePath("/dashboard/employees/schedule");
}

/**
 * Олон (ажилтан × өдөр) нүдэнд НЭГ зэрэг ижил хувиар (салбар(ууд)/цаг/
 * амарна эсэх) тохируулна — grid дээр хэд хэдэн нүд сонгоод "Тохируулах"
 * дарахад дуудагдана (харах: schedule-grid.tsx BulkShiftEditor).
 */
export async function bulkUpsertEmployeeShiftAction(
  _prev: EmployeeScheduleActionState,
  formData: FormData,
): Promise<EmployeeScheduleActionState> {
  const actor = await requireUser();
  if (!hasPermission(actor, "employees.schedule")) {
    return { ok: false, message: "Танд ажлын хувиар засах эрх байхгүй." };
  }
  // Ганц нүд / reset-тэй (authorize()) ижил: модуль нээлттэй, багц идэвхтэй
  // байхыг шаардана — эс бөгөөс багцаас гадуур модулийг bulk-аар ашиглах
  // цоорхой үлдэнэ.
  try {
    await assertModuleEnabled(actor.tenantId, "enable_staff_schedule");
    await assertActiveSubscription(actor.tenantId);
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Алдаа" };
  }

  const scope = s(formData, "scope");
  const result = await bulkUpsertEmployeeShiftCommand(prisma, {
    tenantId: actor.tenantId,
    scope,
    isWorking: formData.get("isWorking") === "on",
    segmentsJson: s(formData, "segmentsJson"),
    targetsJson: s(formData, "targetsJson"),
  });

  if (!result.ok) {
    return { ok: false, message: result.message, fieldErrors: "fieldErrors" in result ? result.fieldErrors : undefined };
  }

  if (result.applied > 0) {
    await logAudit({
      tenantId: actor.tenantId,
      userId: actor.id,
      entity: "User",
      entityId: actor.id,
      action: "UPDATE",
      summary: `Ажлын хувиар багцаар тохируулав (${result.applied} ${scope === "date" ? "өдөр/ажилтан" : "гараг/ажилтан"})`,
    });
  }

  revalidatePath("/dashboard/employees/schedule");
  return { ok: true, message: `${result.applied} байршил шинэчлэгдлээ.` };
}
