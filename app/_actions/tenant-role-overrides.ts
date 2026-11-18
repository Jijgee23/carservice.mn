"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { saveTenantRoleOverride } from "@/lib/roles/tenant-overrides";

export type RoleOverrideState = { ok: boolean; message?: string; fieldErrors?: Record<string, string> } | null;

const strings = (fd: FormData, key: string) => fd.getAll(key).filter((v): v is string => typeof v === "string");

/**
 * Байгууллагын эзэн нийтийн роль дээр (систем админ зөвшөөрсөн эрхээр) нэмэлт/хасалт хийнэ.
 * Хоосон add+remove = анхдагч руу буцаана. Логик lib/roles/tenant-overrides.ts
 * (мобайл PUT /api/v1/roles/[id]/override-тэй нэг).
 */
export async function saveTenantRoleOverrideAction(
  roleId: string,
  _prev: RoleOverrideState,
  formData: FormData,
): Promise<RoleOverrideState> {
  const user = await requireUser();
  if (!user.isOwner) return { ok: false, message: "Зөвхөн байгууллагын эзэн өөрчилнө." };

  const r = await saveTenantRoleOverride(
    { tenantId: user.tenantId, userId: user.id },
    roleId,
    { add: strings(formData, "add"), remove: strings(formData, "remove") },
  );
  if (!r.ok) return { ok: false, message: r.message, fieldErrors: r.fieldErrors };

  // Эрх өөрчлөгдөхөд sidebar, хуудсуудын хандалт бүгд өөрчлөгдөнө.
  revalidatePath("/dashboard", "layout");
  return { ok: true, message: "Хадгалагдлаа." };
}
