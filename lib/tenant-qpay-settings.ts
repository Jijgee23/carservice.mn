import "server-only";

// Тенантын өөрийн QPay merchant тохиргоо (TenantQPaySettings) — хадгалах,
// устгах, идэвхжүүлэх. Вэбийн server action (app/_actions/tenant-qpay.ts) болон
// мобайл staff API (app/api/v1/tenant/qpay/**) хоёулаа ЭНД дуудна. Эрх
// (зөвхөн эзэмшигч) болон revalidatePath-ийг дуудагч өөрөө хийнэ.
//
// Нууц (password, access/refresh token) хэзээ ч клиент рүү буцахгүй —
// `getTenantQPayConfig` нь вэбийн payment_methods хуудастай адил зөвхөн
// `hasPassword` тэмдэг өгнө.
//
// RLS: async helper дотор үргэлж `return await prisma…`.

import { logAudit } from "@/lib/audit";
import { encryptSecret } from "@/lib/crypto";
import { prisma } from "@/lib/prisma";

export type TenantQPayActor = { id: string; tenantId: string };

export type TenantQPayInput = {
  username: string;
  password: string;
  invoiceCode: string;
  callbackUrl: string;
  enabled: boolean;
};

export type TenantQPayConfig = {
  username: string;
  invoiceCode: string;
  callbackUrl: string | null;
  enabled: boolean;
  hasPassword: boolean;
};

export async function getTenantQPayConfig(tenantId: string): Promise<TenantQPayConfig | null> {
  const row = await prisma.tenantQPaySettings.findUnique({
    where: { tenantId },
    select: { username: true, invoiceCode: true, callbackUrl: true, enabled: true, password: true },
  });
  if (!row) return null;
  return {
    username: row.username,
    invoiceCode: row.invoiceCode,
    callbackUrl: row.callbackUrl,
    enabled: row.enabled,
    hasPassword: Boolean(row.password),
  };
}

export type SaveTenantQPayResult =
  | { ok: true; created: boolean }
  | { ok: false; code: "VALIDATION"; fieldErrors: Record<string, string> }
  | { ok: false; code: "ERROR"; message: string };

/**
 * Credentials хадгална. Password шинээр оруулсан үед л шинэчилнэ (хоосон
 * үлдээвэл хуучин үлдэнэ); анх тохируулахад заавал. Бүх утга trim хийгдсэн байна.
 */
export async function saveTenantQPay(
  actor: TenantQPayActor,
  input: TenantQPayInput,
): Promise<SaveTenantQPayResult> {
  const { username, password, invoiceCode, callbackUrl, enabled } = input;

  const fieldErrors: Record<string, string> = {};
  if (!username) fieldErrors.username = "Username оруулна уу.";
  if (!invoiceCode) fieldErrors.invoiceCode = "Invoice code оруулна уу.";

  const existing = await prisma.tenantQPaySettings.findUnique({
    where: { tenantId: actor.tenantId },
  });

  if (!existing && !password) {
    fieldErrors.password = "Анх удаа тохируулахад password шаардлагатай.";
  }

  if (Object.keys(fieldErrors).length > 0) {
    return { ok: false, code: "VALIDATION", fieldErrors };
  }

  try {
    await prisma.tenantQPaySettings.upsert({
      where: { tenantId: actor.tenantId },
      create: {
        tenantId: actor.tenantId,
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
      code: "ERROR",
      message: e instanceof Error ? e.message : "Хадгалахад алдаа.",
    };
  }

  await logAudit({
    tenantId: actor.tenantId,
    userId: actor.id,
    entity: "Tenant",
    entityId: actor.tenantId,
    action: "UPDATE",
    summary: existing ? "QPay тохиргоо шинэчлэв" : "QPay тохиргоо нэмэв",
    after: { username, invoiceCode, enabled },
  });

  return { ok: true, created: !existing };
}

/** Тохиргоог устгана. Байхгүй бол `deleted: false` (юу ч бичихгүй). */
export async function deleteTenantQPay(actor: TenantQPayActor): Promise<{ deleted: boolean }> {
  const existing = await prisma.tenantQPaySettings.findUnique({
    where: { tenantId: actor.tenantId },
    select: { id: true },
  });
  if (!existing) return { deleted: false };
  await prisma.tenantQPaySettings.delete({
    where: { tenantId: actor.tenantId },
  });
  await logAudit({
    tenantId: actor.tenantId,
    userId: actor.id,
    entity: "Tenant",
    entityId: actor.tenantId,
    action: "DELETE",
    summary: "QPay тохиргоо устгав",
  });
  return { deleted: true };
}

export const TENANT_QPAY_NOT_CONFIGURED_MESSAGE = "QPay тохиргоо хийгдээгүй байна.";

/** Идэвхтэй/идэвхгүй switch. Тохиргоо байхгүй бол өөрчлөхгүй. */
export async function setTenantQPayEnabled(
  actor: TenantQPayActor,
  enabled: boolean,
): Promise<{ ok: true } | { ok: false; code: "NOT_CONFIGURED"; message: string }> {
  const existing = await prisma.tenantQPaySettings.findUnique({
    where: { tenantId: actor.tenantId },
    select: { enabled: true },
  });
  if (!existing) return { ok: false, code: "NOT_CONFIGURED", message: TENANT_QPAY_NOT_CONFIGURED_MESSAGE };
  if (existing.enabled !== enabled) {
    await prisma.tenantQPaySettings.update({ where: { tenantId: actor.tenantId }, data: { enabled } });
    await logAudit({
      tenantId: actor.tenantId,
      userId: actor.id,
      entity: "Tenant",
      entityId: actor.tenantId,
      action: "UPDATE",
      summary: enabled ? "QPay идэвхжүүлэв" : "QPay идэвхгүй болгов",
      before: { enabled: existing.enabled },
      after: { enabled },
    });
  }
  return { ok: true };
}
