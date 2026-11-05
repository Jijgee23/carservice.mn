// Ажил / сэлбэг үүсгэх (server). Дүрэм: lib/services/service-create-rules.ts.
// Вэб форм (createServiceAction), мобайл API (POST /api/v1/services) болон
// Excel импорт (importServices) бүгд энэ замаар бичнэ — үүсгэх, кодын давхцал
// (P2002), нэгдсэн сантай холбох, audit нэг газар.

import { categoriesForKindWhere } from "@/lib/categories";
import { Prisma } from "@/app/generated/prisma/client";
import { logAudit } from "@/lib/audit";
import { CATALOG_ALREADY_LINKED, isCatalogKind, resolveCatalogItem } from "@/lib/catalog/catalog-commands";
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

export type CatalogLinkResult =
  | { ok: true; name: string; code: string | null; barcode: string | null; catalogItemId: string | null; created: boolean }
  | { ok: false; message: string };

/**
 * Шинэ ажил/сэлбэгийг нэгдсэн сантай холбоно (createServiceCommand болон
 * мобайл POST /api/v1/services хоёулаа). DIAGNOSTIC бол сан хамаарахгүй —
 * оруулсан нэр/код хэвээр. Тенант тухайн сангийн мөрийг аль хэдийн холбосон
 * бол алдаа.
 */
export async function linkServiceToCatalog(
  tenantId: string,
  input: {
    type: ServiceCreateValues["type"];
    catalogItemId: string | null;
    name: string;
    code: string | null;
    barcode: string | null;
    unitId: string | null;
    durationUnitId: string | null;
    durationValue: Prisma.Decimal | null;
    categoryId: string | null;
    price: Prisma.Decimal;
    description: string | null;
  },
): Promise<CatalogLinkResult> {
  if (!isCatalogKind(input.type)) {
    return { ok: true, name: input.name, code: input.code, barcode: input.barcode, catalogItemId: null, created: false };
  }
  const [unit, durationUnit, category] = await Promise.all([
    input.unitId ? prisma.unit.findFirst({ where: { id: input.unitId, tenantId }, select: { name: true } }) : null,
    input.durationUnitId
      ? prisma.unit.findFirst({ where: { id: input.durationUnitId, tenantId }, select: { name: true } })
      : null,
    input.categoryId ? prisma.category.findFirst({ where: { id: input.categoryId }, select: { tenantId: true } }) : null,
  ]);
  const resolved = await resolveCatalogItem(prisma, {
    type: input.type,
    catalogItemId: input.catalogItemId,
    name: input.name,
    code: input.code,
    barcode: input.barcode,
    unitName: unit?.name ?? "",
    durationValue: input.durationValue,
    durationUnitName: durationUnit?.name ?? null,
    // Сан зөвхөн системийн ангиллыг хадгална (тенантын ангилал бусдад хамаагүй).
    systemCategoryId: category && category.tenantId === null ? input.categoryId : null,
    price: input.price,
    description: input.description,
    tenantId,
  });
  if (!resolved.ok) return { ok: false, message: resolved.message };
  const linked = await prisma.service.findFirst({
    where: { tenantId, catalogItemId: resolved.item.id },
    select: { id: true },
  });
  if (linked) return { ok: false, message: CATALOG_ALREADY_LINKED };
  return {
    ok: true,
    name: resolved.item.name,
    code: resolved.item.code,
    // Сангийн баркод давуу; санд байхгүй бол тенантын оруулсан утга.
    barcode: resolved.item.barcode ?? input.barcode,
    catalogItemId: resolved.item.id,
    created: resolved.item.created,
  };
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

  // Ажил/сэлбэг → нэгдсэн сан: сонгосон мөр, эсвэл код/нэрээр таарах мөр,
  // эсвэл санд шинээр нэмнэ. Нэр/код нь сангийнх болно (тенант засахгүй).
  const link = await linkServiceToCatalog(actor.tenantId, {
    type: values.type,
    catalogItemId: values.catalogItemId,
    name: values.name,
    code: values.code,
    barcode: values.barcode,
    unitId: values.unitId,
    durationUnitId: values.durationUnitId,
    durationValue: dec(values.durationValue),
    categoryId: values.categoryId,
    price,
    description: values.description,
  });
  if (!link.ok) return { ok: false, fieldErrors: { name: link.message } };
  const { name, code, barcode, catalogItemId, created: catalogCreated } = link;

  let created: { id: string };
  try {
    created = await prisma.service.create({
      data: {
        tenantId: actor.tenantId,
        type: values.type,
        name,
        code,
        barcode,
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
        catalogItemId,
      },
      select: { id: true },
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      const target = String((e.meta as { target?: unknown } | undefined)?.target ?? "");
      if (target.includes("catalogItemId")) return { ok: false, fieldErrors: { name: CATALOG_ALREADY_LINKED } };
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
    summary: `[${values.type}] ${name}${code ? ` · ${code}` : ""}${catalogCreated ? " · нэгдсэн санд нэмэв" : ""}${opts.auditSuffix ?? ""}`,
    after: {
      type: values.type,
      name,
      code,
      price: price.toString(),
      stock: dec(values.stock)?.toString() ?? null,
      catalogItemId,
    },
  });
  return { ok: true, id: created.id };
}
