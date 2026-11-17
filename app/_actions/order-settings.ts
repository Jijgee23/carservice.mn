"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { updateOrderSettings } from "@/lib/orders/order-settings-server";

// Засварын хуудасны тохиргоо — зөвхөн tenant-admin. Шалгалт + бичилт нь
// lib/orders/order-settings-server.ts-д (mobile PATCH /api/v1/tenant/order-settings ч адил).

export type OrderSettingsActionState = {
  ok: boolean;
  message?: string;
  fieldErrors?: Record<string, string>;
} | null;

export async function updateOrderSettingsAction(
  _prev: OrderSettingsActionState,
  formData: FormData,
): Promise<OrderSettingsActionState> {
  const user = await requireUser();
  if (!user.isOwner) return { ok: false, message: "Зөвхөн админ тохиргоог өөрчилнө." };

  let input: unknown;
  try {
    input = JSON.parse(String(formData.get("settings") ?? ""));
  } catch {
    return { ok: false, message: "Хүсэлт буруу." };
  }
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, message: "Хүсэлт буруу." };
  }

  const result = await updateOrderSettings(
    { tenantId: user.tenantId, userId: user.id },
    input as Record<string, unknown>,
  );
  if (!result.ok) {
    return { ok: false, message: "Оруулсан мэдээлэл буруу.", fieldErrors: result.fieldErrors };
  }

  revalidatePath("/dashboard/settings/orders");
  revalidatePath("/dashboard/orders", "layout");
  return { ok: true, message: "Хадгалагдлаа." };
}
