"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import {
  deleteTenantQPay,
  saveTenantQPay,
  setTenantQPayEnabled,
  TENANT_QPAY_NOT_CONFIGURED_MESSAGE,
} from "@/lib/tenant-qpay-settings";

// Бизнес логик нь lib/tenant-qpay-settings.ts-д — мобайл staff API
// (app/api/v1/tenant/qpay/**) мөн адил функцуудыг дуудна.

export type TenantQPayActionState = {
  ok: boolean;
  message?: string;
  fieldErrors?: Record<string, string>;
} | null;

function s(fd: FormData, key: string): string {
  const v = fd.get(key);
  return typeof v === "string" ? v.trim() : "";
}

async function authorizeOwner() {
  const user = await requireUser();
  if (!user.isOwner) {
    throw new Error("Зөвхөн админ QPay тохиргоог удирдана.");
  }
  return user;
}

/**
 * Tenant-н QPay credentials-ийг хадгална. Password шинээр оруулсан үед л
 * шинэчилнэ (хоосон үлдээвэл хуучин үлдэнэ).
 */
export async function saveTenantQPayAction(
  _prev: TenantQPayActionState,
  formData: FormData,
): Promise<TenantQPayActionState> {
  let user;
  try {
    user = await authorizeOwner();
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Алдаа" };
  }

  const result = await saveTenantQPay(user, {
    username: s(formData, "username"),
    password: s(formData, "password"),
    invoiceCode: s(formData, "invoiceCode"),
    callbackUrl: s(formData, "callbackUrl"),
    enabled: formData.get("enabled") !== "off",
  });
  if (!result.ok) {
    return result.code === "VALIDATION"
      ? { ok: false, fieldErrors: result.fieldErrors }
      : { ok: false, message: result.message };
  }

  revalidatePath("/dashboard/payment_methods");
  return { ok: true, message: "Хадгалагдлаа." };
}

export async function deleteTenantQPayAction(): Promise<void> {
  const user = await authorizeOwner();
  const { deleted } = await deleteTenantQPay(user);
  if (!deleted) throw new Error(TENANT_QPAY_NOT_CONFIGURED_MESSAGE);
  revalidatePath("/dashboard/payment_methods");
}

/** «Төлбөрийн аргууд» хүснэгтийн QPay мөрийн идэвхтэй/идэвхгүй switch. Тохиргоо байхгүй бол өөрчлөхгүй. */
export async function setTenantQPayEnabledAction(enabled: boolean): Promise<TenantQPayActionState> {
  let user;
  try {
    user = await authorizeOwner();
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Алдаа" };
  }
  const result = await setTenantQPayEnabled(user, enabled);
  if (!result.ok) return { ok: false, message: result.message };
  revalidatePath("/dashboard/payment_methods");
  return { ok: true };
}
