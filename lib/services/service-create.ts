// Ажил / сэлбэг үүсгэх (server). Дүрэм: lib/services/service-create-rules.ts.
// Вэб форм (createServiceAction) болон Excel импорт (importServices) хоёулаа
// энэ замаар бичнэ — үүсгэх, кодын давхцал (P2002), audit нэг газар.

import { categoriesForKindWhere } from "@/lib/categories";
import { Prisma } from "@/app/generated/prisma/client";
import { logAudit } from "@/lib/audit";
import { parseNonNegativeDecimal } from "@/lib/decimal-input";
import { prisma } from "@/lib/prisma";
import type { ServiceCreateValues, ServiceRefs } from "./service-create-rules";

export const SERVICE_CODE_TAKEN_MESSAGE = "Энэ код тухайн төрөлд бүртгэгдсэн байна.";

/**
 * Тенантын нэгж + тухайн төрөлд сонгож болох ангиллын id (өөрийн + системийн,
 * төрөл таарсан эсвэл «бүх төрөлд»). Төрөл тодорхойгүй бол ангилал хоосон.
 */
export async function loadServiceRefs(tenantId: string, type: string): Promise<NonNullable<ServiceRefs>> {
  const kind = type === "LABOR" || type === "GOODS" || type === "DIAGNOSTIC" ? type : null;
  const [units, categories] = await Promise.all([
    prisma.unit.findMany({ where: { tenantId }, select: { id: true } }),
    kind
      ? prisma.category.findMany({ where: categoriesForKindWhere(tenantId, kind), select: { id: true } })
      : Promise.resolve([] as { id: string }[]),
  ]);
  return { unitIds: new Set(units.map((u) => u.id)), categoryIds: new Set(categories.map((c) => c.id)) };
}

export type CreateServiceResult =
  | { ok: true; id: string }
  | { ok: false; fieldErrors?: Record<string, string>; message?: string };

export async function createServiceCommand(
  actor: { id: string; tenantId: string },
  values: ServiceCreateValues,
  opts: { auditSuffix?: string } = {},
): Promise<CreateServiceResult> {
  // Вэб формын бусад тоон утгатай нэг parser (дүрэм нь normalizeDecimalString-тэй ижил).
  const dec = (v: string | null) => (v === null ? null : parseNonNegativeDecimal(v));
  const price = parseNonNegativeDecimal(values.price);
  if (!price) return { ok: false, fieldErrors: { price: "Үнэ буруу." } };
  let created: { id: string };
  try {
    created = await prisma.service.create({
      data: {
        tenantId: actor.tenantId,
        type: values.type,
        name: values.name,
        code: values.code,
        unitId: values.unitId,
        price,
        costPrice: dec(values.costPrice),
        stock: dec(values.stock),
        durationValue: dec(values.durationValue),
        durationUnitId: values.durationUnitId,
        reminderIntervalMonths: values.reminderIntervalMonths,
        description: values.description,
        isActive: values.isActive,
        categoryId: values.categoryId,
      },
      select: { id: true },
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return { ok: false, fieldErrors: { code: SERVICE_CODE_TAKEN_MESSAGE } };
    }
    return { ok: false, message: e instanceof Error ? e.message : "Үүсгэх явцад алдаа гарлаа." };
  }

  await logAudit({
    tenantId: actor.tenantId,
    userId: actor.id,
    entity: "Service",
    entityId: created.id,
    action: "CREATE",
    summary: `[${values.type}] ${values.name}${values.code ? ` · ${values.code}` : ""}${opts.auditSuffix ?? ""}`,
    after: {
      type: values.type,
      name: values.name,
      code: values.code,
      price: price.toString(),
      stock: dec(values.stock)?.toString() ?? null,
    },
  });
  return { ok: true, id: created.id };
}
