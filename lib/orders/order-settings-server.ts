// DB тал: TenantOrderSettings унших/хадгалах (RLS: tenant context-д).
// Цэвэр дүрэм/шалгалт нь lib/orders/order-settings.ts-д.

import type { Prisma } from "@/app/generated/prisma/client";
import { logAudit } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import {
  normalizeOrderSettings,
  validateOrderSettings,
  type OrderSettings,
  type OrderSettingsInput,
} from "./order-settings";

// Prisma-ийн extension-тэй client ба transaction client хоёуланд нийцэх
// minimal хэлбэр (lib/employees/types.ts-ийн тайлбартай ижил шалтгаан).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Args = any;
type SettingsDb = {
  tenantOrderSettings: {
    findUnique(args: Args): Promise<Args>;
    upsert(args: Args): Promise<Args>;
  };
};

/** Tenant-ийн засварын хуудасны тохиргоо (мөргүй бол анхдагч). */
export async function getOrderSettings(
  db: Pick<SettingsDb, "tenantOrderSettings">,
  tenantId: string,
): Promise<OrderSettings> {
  const row = await db.tenantOrderSettings.findUnique({ where: { tenantId } });
  return normalizeOrderSettings(row);
}

/**
 * Шалгагдсан тохиргоог хадгална. «Он оруулах» солигдвол дугаарын тоолуурыг
 * шинэчилнэ: асаахад 1-ээс эхэлнэ, унтраахад хуучин дугааруудаас дахин тооцно
 * (эс бөгөөс оны дараалал хуучин дугаартай давхцаж олон давталт хийнэ).
 * Угтвар/оронгийн тоо солигдоход дараалал үргэлжилнэ.
 */
export async function saveOrderSettings(
  db: SettingsDb,
  tenantId: string,
  value: OrderSettings,
): Promise<void> {
  const prev: { numberIncludeYear: boolean } | null = await db.tenantOrderSettings.findUnique({
    where: { tenantId },
    select: { numberIncludeYear: true },
  });
  const resetSeq = (prev?.numberIncludeYear ?? false) !== value.numberIncludeYear;
  const data = {
    ...value,
    intakeChecklist: value.intakeChecklist as unknown as Prisma.InputJsonValue,
    ...(resetSeq ? { numberNextSeq: null, numberSeqYear: null } : {}),
  };
  await db.tenantOrderSettings.upsert({
    where: { tenantId },
    update: data,
    create: { tenantId, ...data },
  });
}

/**
 * Web action ба mobile API-д нийтлэг: шалгаад хадгалж, audit бичнэ.
 * `input` хэсэгчилсэн байж болно (байхгүй талбар одоогийн утгаараа үлдэнэ).
 */
export async function updateOrderSettings(
  actor: { tenantId: string; userId: string },
  input: OrderSettingsInput,
): Promise<{ ok: true; value: OrderSettings } | { ok: false; fieldErrors: Record<string, string> }> {
  const before = await getOrderSettings(prisma, actor.tenantId);
  const result = validateOrderSettings(input, before);
  if (!result.ok) return result;
  await saveOrderSettings(prisma, actor.tenantId, result.value);
  await logAudit({
    tenantId: actor.tenantId,
    userId: actor.userId,
    entity: "Tenant",
    entityId: actor.tenantId,
    action: "UPDATE",
    summary: "Засварын хуудасны тохиргоо шинэчлэв",
    before: before as unknown as Prisma.InputJsonValue,
    after: result.value as unknown as Prisma.InputJsonValue,
  });
  return result;
}
