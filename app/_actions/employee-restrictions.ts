"use server";

import { revalidatePath } from "next/cache";
import { logAudit } from "@/lib/audit";
import { requireUser } from "@/lib/auth";
import { canEdit } from "@/lib/auth/roles";
import { saveEmployeeRestrictions } from "@/lib/employees/restrictions";
import { prisma } from "@/lib/prisma";
import { assertActiveSubscription } from "@/lib/subscription-server";

export type EmployeeRestrictionState = { ok: boolean; message?: string } | null;

/**
 * Ажилтны эрхийг хязгаарлана (ролиос зарим эрхийг хасна, нэмэхгүй). Эрх: employees.edit.
 * Логик lib/employees/restrictions.ts (мобайл PUT /api/v1/employees/[id]/restrictions-тэй нэг).
 */
export async function saveEmployeeRestrictionsAction(
  employeeId: string,
  _prev: EmployeeRestrictionState,
  formData: FormData,
): Promise<EmployeeRestrictionState> {
  const me = await requireUser();
  if (!canEdit(me, "employees")) {
    return { ok: false, message: "Танд ажилтны эрхийг өөрчлөх эрх байхгүй." };
  }
  try {
    await assertActiveSubscription(me.tenantId);
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Багцын хугацаа дууссан." };
  }

  const denied = formData.getAll("denied").filter((v): v is string => typeof v === "string");
  const r = await saveEmployeeRestrictions(prisma, me, employeeId, denied);
  if (!r.ok) return { ok: false, message: r.error };

  await logAudit({
    tenantId: me.tenantId,
    userId: me.id,
    entity: "User",
    entityId: employeeId,
    action: "UPDATE",
    summary: r.summary,
    before: r.before,
    after: r.after,
  });

  revalidatePath("/dashboard/employees");
  revalidatePath(`/dashboard/employees/${employeeId}`);
  return { ok: true, message: "Хадгалагдлаа." };
}
