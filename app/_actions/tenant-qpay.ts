"use server";

import { revalidatePath } from "next/cache";
import { logAudit } from "@/lib/audit";
import { requireUser } from "@/lib/auth";
import { encryptSecret } from "@/lib/crypto";
import { prisma } from "@/lib/prisma";

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

  const username = s(formData, "username");
  const password = s(formData, "password");
  const invoiceCode = s(formData, "invoiceCode");
  const callbackUrl = s(formData, "callbackUrl");
  const enabled = formData.get("enabled") !== "off";

  const fieldErrors: Record<string, string> = {};
  if (!username) fieldErrors.username = "Username оруулна уу.";
  if (!invoiceCode) fieldErrors.invoiceCode = "Invoice code оруулна уу.";

  const existing = await prisma.tenantQPaySettings.findUnique({
    where: { tenantId: user.tenantId },
  });

  if (!existing && !password) {
    fieldErrors.password = "Анх удаа тохируулахад password шаардлагатай.";
  }

  if (Object.keys(fieldErrors).length > 0) {
    return { ok: false, fieldErrors };
  }

  try {
    await prisma.tenantQPaySettings.upsert({
      where: { tenantId: user.tenantId },
      create: {
        tenantId: user.tenantId,
        username,
        password: encryptSecret(password),
        invoiceCode,
        callbackUrl: callbackUrl || null,
        enabled,
      },
      update: {
        username,
        invoiceCode,
        callbackUrl: callbackUrl || null,
        enabled,
        // Password хоосон ирвэл хуучныг үлдээнэ
        ...(password ? { password: encryptSecret(password) } : {}),
        // Token cache-г шинэчилсэн үед арилгана
        accessToken: null,
        refreshToken: null,
        tokenExpiresAt: null,
        refreshTokenExpiresAt: null,
      },
    });
  } catch (e) {
    return {
      ok: false,
      message: e instanceof Error ? e.message : "Хадгалахад алдаа.",
    };
  }

  await logAudit({
    tenantId: user.tenantId,
    userId: user.id,
    entity: "Tenant",
    entityId: user.tenantId,
    action: "UPDATE",
    summary: existing ? "QPay тохиргоо шинэчлэв" : "QPay тохиргоо нэмэв",
    after: { username, invoiceCode, enabled },
  });

  revalidatePath("/dashboard/payment_methods");
  return { ok: true, message: "Хадгалагдлаа." };
}

export async function deleteTenantQPayAction(): Promise<void> {
  const user = await authorizeOwner();
  await prisma.tenantQPaySettings.delete({
    where: { tenantId: user.tenantId },
  });
  await logAudit({
    tenantId: user.tenantId,
    userId: user.id,
    entity: "Tenant",
    entityId: user.tenantId,
    action: "DELETE",
    summary: "QPay тохиргоо устгав",
  });
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
  const existing = await prisma.tenantQPaySettings.findUnique({
    where: { tenantId: user.tenantId },
    select: { enabled: true },
  });
  if (!existing) return { ok: false, message: "QPay тохиргоо хийгдээгүй байна." };
  if (existing.enabled !== enabled) {
    await prisma.tenantQPaySettings.update({ where: { tenantId: user.tenantId }, data: { enabled } });
    await logAudit({
      tenantId: user.tenantId,
      userId: user.id,
      entity: "Tenant",
      entityId: user.tenantId,
      action: "UPDATE",
      summary: enabled ? "QPay идэвхжүүлэв" : "QPay идэвхгүй болгов",
      before: { enabled: existing.enabled },
      after: { enabled },
    });
  }
  revalidatePath("/dashboard/payment_methods");
  return { ok: true };
}
