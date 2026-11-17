"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { saveTenantServiceKeys } from "@/lib/tenant-service-keys";

export type ServiceKeysState = { ok: boolean; message?: string } | null;

/**
 * Эзэн байгууллагын үзүүлдэг үйлчилгээний төрлүүдийг хадгална (Tenant.serviceKeys)
 * ба serviceKeysConfirmedAt тавина — dashboard-ын заавал сонгох dialog хаагдана.
 * Логик lib/tenant-service-keys.ts (mobile PUT /api/v1/tenant/service-keys-тэй нэг).
 */
export async function saveTenantServiceKeysAction(
  _prev: ServiceKeysState,
  formData: FormData,
): Promise<ServiceKeysState> {
  const user = await requireUser();
  if (!user.isOwner) return { ok: false, message: "Зөвхөн байгууллагын эзэн өөрчилнө." };

  const result = await saveTenantServiceKeys(
    { tenantId: user.tenantId, userId: user.id },
    formData.getAll("serviceKeyIds"),
  );
  if (!result.ok) return { ok: false, message: result.message };

  revalidatePath("/dashboard", "layout");
  revalidatePath("/book");
  revalidatePath("/discover");
  return { ok: true, message: "Хадгалагдлаа." };
}
