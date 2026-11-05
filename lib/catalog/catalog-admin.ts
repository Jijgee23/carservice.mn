import "server-only";

import { Prisma } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import type { CatalogType, CatalogValues } from "./catalog-input";
import { normalizeCatalogName } from "./normalize";

export type SystemCategoryRef = { id: string; name: string };

/** Тухайн төрөлд сонгож болох системийн идэвхтэй ангиллууд (bypass context). */
export async function loadSystemCategories(type: CatalogType): Promise<SystemCategoryRef[]> {
  // `return await` — Node 22 дээр await-гүй буцаавал RLS context алдагдана.
  return await prisma.category.findMany({
    where: { tenantId: null, isActive: true, OR: [{ kind: type }, { kind: null }] },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });
}

/** Ангиллыг id эсвэл нэрээр (том/жижиг үсэг үл хамаарна) тааруулна. */
export function matchSystemCategory(categories: readonly SystemCategoryRef[], raw: string | null): string | null | undefined {
  if (!raw) return null;
  const key = raw.trim().toLowerCase();
  const hit = categories.find((c) => c.id === raw || c.name.trim().toLowerCase() === key);
  return hit ? hit.id : undefined; // undefined = олдсонгүй
}

export type CatalogCreateOutcome =
  | { ok: true; id: string }
  | { ok: false; reason: "exists"; existing: { id: string; name: string; code: string | null } }
  | { ok: false; reason: "category" };

function duplicateWhere(v: CatalogValues): Prisma.CatalogItemWhereInput {
  // resolveCatalogItem-тэй ижил дүрэм: кодтой бол кодоор, кодгүй бол нэрээр.
  return v.code
    ? { type: v.type, codeKey: v.code }
    : { type: v.type, codeKey: null, nameKey: normalizeCatalogName(v.name) };
}

/** Super admin (bypass) — санд шинэ мөр нэмнэ; давхардвал байгаа мөрийг буцаана. */
export async function createCatalogItemAdmin(
  values: CatalogValues,
  categories: readonly SystemCategoryRef[],
): Promise<CatalogCreateOutcome> {
  const categoryId = values.type === "GOODS" ? matchSystemCategory(categories, values.category) : null;
  if (categoryId === undefined) return { ok: false, reason: "category" };

  const where = duplicateWhere(values);
  const existing =
    (values.barcode
      ? await prisma.catalogItem.findFirst({ where: { barcode: values.barcode }, select: { id: true, name: true, code: true } })
      : null) ?? (await prisma.catalogItem.findFirst({ where, select: { id: true, name: true, code: true } }));
  if (existing) return { ok: false, reason: "exists", existing };

  try {
    const created = await prisma.catalogItem.create({
      data: {
        type: values.type,
        name: values.name,
        nameKey: normalizeCatalogName(values.name),
        code: values.code,
        codeKey: values.code,
        barcode: values.barcode,
        unitName: values.unitName,
        price: new Prisma.Decimal(values.price),
        categoryId,
        durationValue: values.durationValue ? new Prisma.Decimal(values.durationValue) : null,
        durationUnitName: values.durationUnitName,
        description: values.description,
      },
      select: { id: true },
    });
    return { ok: true, id: created.id };
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      const raced =
        (values.barcode
          ? await prisma.catalogItem.findFirst({ where: { barcode: values.barcode }, select: { id: true, name: true, code: true } })
          : null) ?? (await prisma.catalogItem.findFirst({ where, select: { id: true, name: true, code: true } }));
      if (raced) return { ok: false, reason: "exists", existing: raced };
    }
    throw e;
  }
}
