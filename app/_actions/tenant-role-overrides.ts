"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { toggleTenantRolePermission } from "@/lib/roles/tenant-overrides";

/**
 * Байгууллагын эзэн нийтийн роль дээрх НЭГ эрхийг шууд асаах/унтраана (switch). Зөвхөн эзэн.
 * Түгжигдсэн/тодорхойгүй эрх → алдаа (сервер дахин шалгана). Логик lib/roles/tenant-overrides.ts
 * (мобайл PUT /api/v1/roles/[id]/override-тэй нэг шалгалт, аудит).
 */
export async function toggleTenantRolePermissionAction(
  roleId: string,
  code: string,
  on: boolean,
): Promise<{ ok: boolean; message?: string }> {
  const user = await requireUser();
  if (!user.isOwner) return { ok: false, message: "Зөвхөн байгууллагын эзэн өөрчилнө." };

  const r = await toggleTenantRolePermission({ tenantId: user.tenantId, userId: user.id }, roleId, code, on);
  if (!r.ok) {
    return { ok: false, message: r.fieldErrors ? Object.values(r.fieldErrors)[0] : r.message };
  }
  // Эрх өөрчлөгдөхөд sidebar, хуудсуудын хандалт бүгд өөрчлөгдөнө.
  revalidatePath("/dashboard", "layout");
  return { ok: true };
}
