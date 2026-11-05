"use server";

import { requireUser } from "@/lib/auth";
import { canCreate } from "@/lib/auth/roles";
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
      services: { none: { tenantId: user.tenantId } },
    },
    orderBy: [{ services: { _count: "desc" } }, { name: "asc" }],
    take: 10,
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
