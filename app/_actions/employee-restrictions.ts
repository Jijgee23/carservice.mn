"use server";

import { revalidatePath } from "next/cache";
import { logAudit } from "@/lib/audit";
import { requireUser } from "@/lib/auth";
import { canEdit } from "@/lib/auth/roles";
import { toggleEmployeeRestriction } from "@/lib/employees/restrictions";
import { prisma } from "@/lib/prisma";
import { assertActiveSubscription } from "@/lib/subscription-server";

/**
 * Ажилтны НЭГ эрхийг шууд асаах/унтраана (switch): allowed=false → энэ ажилтнаас хасна, true → сэргээнэ.
 * Эрх: employees.edit + идэвхтэй захиалга. Логик lib/employees/restrictions.ts
 * (мобайл PUT /api/v1/employees/[id]/restrictions-тэй нэг guard).
 */
export async function toggleEmployeeRestrictionAction(
  employeeId: string,
  code: string,
  allowed: boolean,
): Promise<{ ok: boolean; message?: string }> {
  const me = await requireUser();
  if (!canEdit(me, "employees")) {
    return { ok: false, message: "Танд ажилтны эрхийг өөрчлөх эрх байхгүй." };
  }
  try {
    await assertActiveSubscription(me.tenantId);
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Багцын хугацаа дууссан." };
  }

  const r = await toggleEmployeeRestriction(prisma, me, employeeId, code, allowed);
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
  revalidatePath(`/dashboard/employees/${employeeId}`);
  return { ok: true };
}
