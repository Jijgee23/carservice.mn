// Ажил, сэлбэгийн НЭГДСЭН сан (CatalogItem) — server. Тенант ажил/сэлбэг
// бүртгэхэд (вэб форм, мобайл API, Excel импорт — бүгд createServiceCommand)
// энд санг сонгох/таарахыг олох/шинээр нэмэх шийдвэр гарна. CatalogItem нь
// глобал (tenantId-гүй, RLS-гүй) — бусад тенант шууд хардаг.

import { Prisma } from "@/app/generated/prisma/client";
import type { ServiceKind } from "@/app/generated/prisma/enums";
import { cleanCatalogName, normalizeBarcode, normalizeCatalogCode, normalizeCatalogName } from "./normalize";

export const CATALOG_KINDS = ["LABOR", "GOODS"] as const;
export type CatalogKind = (typeof CATALOG_KINDS)[number];

export function isCatalogKind(type: ServiceKind | string): type is CatalogKind {
  return type === "LABOR" || type === "GOODS";
}

export const CATALOG_ITEM_NOT_FOUND = "Нэгдсэн сангаас сонгосон мөр олдсонгүй.";
export const CATALOG_ALREADY_LINKED = "Энэ ажил/сэлбэг танд аль хэдийн бүртгэлтэй байна.";

/** Санг уншиж/бичихэд шаардлагатай хамгийн бага client (prisma эсвэл tx; тестэд fake). */
export type CatalogDb = {
  catalogItem: {
    findFirst(args: {
      where: Prisma.CatalogItemWhereInput;
      select: { id: true; name: true; code: true; barcode: true };
    }): Promise<{ id: string; name: string; code: string | null; barcode: string | null } | null>;
    create(args: {
      data: Prisma.CatalogItemUncheckedCreateInput;
      select: { id: true; name: true; code: true; barcode: true };
    }): Promise<{ id: string; name: string; code: string | null; barcode: string | null }>;
  };
};

export type ResolveCatalogInput = {
  type: CatalogKind;
  /** Тенант сангаас сонгосон бол. */
  catalogItemId: string | null;
  name: string;
  code: string | null;
  /** Баркод (зөвхөн GOODS) — өгсөн бол таарахыг хамгийн түрүүнд баркодоор хайна. */
  barcode: string | null;
  unitName: string;
  durationValue: Prisma.Decimal | null;
  durationUnitName: string | null;
  /** Зөвхөн системийн (tenantId=null) ангилал — дуудагч шийднэ. */
  systemCategoryId: string | null;
  price: Prisma.Decimal;
  description: string | null;
  tenantId: string;
};

export type ResolvedCatalogItem = {
  id: string;
  name: string;
  code: string | null;
  barcode: string | null;
  created: boolean;
};

const SELECT = { id: true, name: true, code: true, barcode: true } as const;

function matchWhere(type: CatalogKind, name: string, code: string | null): Prisma.CatalogItemWhereInput {
  const codeKey = normalizeCatalogCode(code);
  // Кодтой бол кодоор л (өөр кодтой ижил нэр = өөр брэнд), кодгүй бол нэрээр.
  return codeKey
    ? { type, codeKey }
    : { type, codeKey: null, nameKey: normalizeCatalogName(name) };
}

/**
 * 1) Сонгосон мөр (catalogItemId) → тэр; 2) код/нэрээр таарах мөр → холбоно;
 * 3) үгүй бол санд шинээр нэмнэ. Зэрэг нэмэлтийн давхцал (P2002) гарвал
 * таарах мөрийг дахин уншина.
 */
export async function resolveCatalogItem(
  db: CatalogDb,
  input: ResolveCatalogInput,
): Promise<{ ok: true; item: ResolvedCatalogItem } | { ok: false; message: string }> {
  if (input.catalogItemId) {
    const picked = await db.catalogItem.findFirst({
      where: { id: input.catalogItemId, type: input.type, isActive: true },
      select: SELECT,
    });
    if (!picked) return { ok: false, message: CATALOG_ITEM_NOT_FOUND };
    return { ok: true, item: { ...picked, created: false } };
  }

  const name = cleanCatalogName(input.name);
  const barcode = input.type === "GOODS" ? normalizeBarcode(input.barcode) : null;
  if (barcode) {
    const byBarcode = await db.catalogItem.findFirst({ where: { type: input.type, barcode }, select: SELECT });
    if (byBarcode) return { ok: true, item: { ...byBarcode, created: false } };
  }
  const where = matchWhere(input.type, name, input.code);
  const existing = await db.catalogItem.findFirst({ where, select: SELECT });
  if (existing) return { ok: true, item: { ...existing, created: false } };

  const code = normalizeCatalogCode(input.code);
  try {
    const created = await db.catalogItem.create({
      data: {
        type: input.type,
        name,
        nameKey: normalizeCatalogName(name),
        code,
        codeKey: code,
        barcode,
        unitName: input.unitName,
        durationValue: input.durationValue,
        durationUnitName: input.durationUnitName,
        categoryId: input.systemCategoryId,
        price: input.price,
        description: input.description,
        createdByTenantId: input.tenantId,
      },
      select: SELECT,
    });
    return { ok: true, item: { ...created, created: true } };
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      const raced =
        (barcode ? await db.catalogItem.findFirst({ where: { type: input.type, barcode }, select: SELECT }) : null) ??
        (await db.catalogItem.findFirst({ where, select: SELECT }));
      if (raced) return { ok: true, item: { ...raced, created: false } };
    }
    throw e;
  }
}
