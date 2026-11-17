"use server";

import { requireUser } from "@/lib/auth";
import { canCreate, canEdit } from "@/lib/auth/roles";
import { isCatalogKind } from "@/lib/catalog/catalog-commands";
import { normalizeCatalogCode, normalizeCatalogName } from "@/lib/catalog/normalize";
import { prisma } from "@/lib/prisma";

export type CatalogSearchHit = {
  id: string;
  name: string;
  code: string | null;
  barcode: string | null;
  unitName: string;
  durationValue: string | null;
  durationUnitName: string | null;
  price: string;
  categoryId: string | null;
  description: string | null;
};

/**
 * Ажил/сэлбэг бүртгэх формын typeahead — нэгдсэн сангаас нэр эсвэл кодоор
 * (идэвхтэй, 10 хүртэл). Тенант аль хэдийн холбосон мөрүүдийг харуулахгүй.
 */
export async function searchCatalogAction(type: string, q: string): Promise<CatalogSearchHit[]> {
  const user = await requireUser();
  if (!canCreate(user, "services") || !isCatalogKind(type)) return [];
  return searchCatalogForTenant(user.tenantId, type, q, 10);
}

/**
 * Засварын хуудасны «мөр нэмэх»: байгууллагын өөрийн ажил/сэлбэгээс олдоогүй
 * үед нэгдсэн сангаас хайна (засварын хуудас засах эрхтэй хэнд ч —
 * GET /api/v1/orders/catalog-items-тэй ижил). Сонгосныг addOrderItemAction
 * байгууллагын ажил/сэлбэгт ашигласан нэр, үнээр нь нэмнэ.
 */
export async function searchOrderCatalogAction(type: string, q: string): Promise<CatalogSearchHit[]> {
  const user = await requireUser();
  if (!canEdit(user, "orders") || !isCatalogKind(type)) return [];
  return searchCatalogForTenant(user.tenantId, type, q, 20);
}

async function searchCatalogForTenant(
  tenantId: string,
  type: "LABOR" | "GOODS",
  q: string,
  take: number,
): Promise<CatalogSearchHit[]> {
  const query = q.trim();
  if (query.length < 2) return [];

  const nameKey = normalizeCatalogName(query);
  const codeKey = normalizeCatalogCode(query);
  const rows = await prisma.catalogItem.findMany({
    where: {
      type,
      isActive: true,
      OR: [
        { nameKey: { contains: nameKey } },
        ...(codeKey ? [{ codeKey: { startsWith: codeKey } }, { barcode: codeKey }] : []),
      ],
      services: { none: { tenantId } },
    },
    // Нэрээр эрэмбэлнэ. Өмнө нь `services._count`-аар (түгээмэл нь эхэнд)
    // эрэмбэлдэг байсан ч tenant RLS дор зөвхөн өөрийн тенантын холбоос
    // тоологддог, дээрх `none` шүүлтүүр тэдгээрийг хасдаг тул тоо үргэлж 0 —
    // утгагүй байсан. Бүх тенантаар тоолох нь RLS bypass шаардах тул (scoped
    // bypass helper байхгүй, setBypassContext нь хүсэлтийн үлдсэн хэсэгт
    // нөлөөлнө) энд хийхгүй.
    orderBy: [{ name: "asc" }],
    take,
    select: {
      id: true,
      name: true,
      code: true,
      barcode: true,
      unitName: true,
      durationValue: true,
      durationUnitName: true,
      price: true,
      categoryId: true,
      description: true,
    },
  });
  return rows.map((r) => ({
    ...r,
    price: r.price.toString(),
    durationValue: r.durationValue?.toString() ?? null,
  }));
}
