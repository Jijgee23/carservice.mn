// Нэгдсэн сангийн (CatalogItem) мөрийг тенантын ажил/сэлбэг (Service) болгон
// автоматаар холбоно — засварын хуудсанд сангаас шууд сонгоход (шинэ тенант
// «Үйлчилгээ» хэсэгт урьдчилан юу ч бүртгээгүй ч ажил, сэлбэг нэмж чадна).
//
// Дүрэм:
//  - Аль хэдийн холбосон бол тэр Service-ийг буцаана (идэвхгүй бол алдаа —
//    эзэн санаатай идэвхгүй болгосон байж болно).
//  - Нэр/код/баркод/үнэ/тайлбар сангаас; нэгжийг тенантын нэгжтэй НЭРЭЭР
//    тааруулна (олдохгүй бол сэлбэг → «ширхэг», ажил → «удаа», эсвэл эхний нэгж).
//  - Ангилал: сангийн системийн ангилал тухайн төрөлд тохирвол, үгүй бол хоосон.
//  - Сэлбэгийн үлдэгдэл `null` (хөтлөхгүй) — эс бөгөөс 0 үлдэгдэлтэй тул
//    засварын хуудсанд нэмэх боломжгүй. Тенант дараа нь «Үйлчилгээ»-ээс тохируулна.

import { Prisma } from "@/app/generated/prisma/client";
import { logAudit } from "@/lib/audit";
import { CATALOG_ITEM_NOT_FOUND } from "@/lib/catalog/catalog-commands";
import { prisma } from "@/lib/prisma";

export type AdoptCatalogResult =
  | { ok: true; serviceId: string; created: boolean }
  | { ok: false; message: string };

const SERVICE_INACTIVE =
  "Энэ ажил/сэлбэг идэвхгүй болсон байна. «Үйлчилгээ» хэсгээс идэвхжүүлнэ үү.";

const FALLBACK_UNIT: Record<"LABOR" | "GOODS", string> = { LABOR: "удаа", GOODS: "ширхэг" };

const unitKey = (name: string) => name.trim().toLowerCase();

export async function adoptCatalogItemForTenant(
  actor: { id: string; tenantId: string },
  catalogItemId: string,
): Promise<AdoptCatalogResult> {
  const { tenantId } = actor;

  const linked = await prisma.service.findFirst({
    where: { tenantId, catalogItemId },
    select: { id: true, isActive: true },
  });
  if (linked) {
    return linked.isActive
      ? { ok: true, serviceId: linked.id, created: false }
      : { ok: false, message: SERVICE_INACTIVE };
  }

  const item = await prisma.catalogItem.findFirst({
    where: { id: catalogItemId, isActive: true, type: { in: ["LABOR", "GOODS"] } },
    select: {
      id: true,
      type: true,
      name: true,
      code: true,
      barcode: true,
      unitName: true,
      durationValue: true,
      durationUnitName: true,
      categoryId: true,
      price: true,
      description: true,
    },
  });
  if (!item || (item.type !== "LABOR" && item.type !== "GOODS")) {
    return { ok: false, message: CATALOG_ITEM_NOT_FOUND };
  }
  const type = item.type;

  // Тенант ижил кодтой мөрийг өөрөө бүртгэсэн бол ([tenantId,type,code] unique)
  // шинээр үүсгэхгүй — тэрийг ашиглана.
  if (item.code) {
    const sameCode = await prisma.service.findFirst({
      where: { tenantId, type, code: item.code },
      select: { id: true, isActive: true },
    });
    if (sameCode) {
      return sameCode.isActive
        ? { ok: true, serviceId: sameCode.id, created: false }
        : { ok: false, message: SERVICE_INACTIVE };
    }
  }

  const [units, category] = await Promise.all([
    prisma.unit.findMany({ where: { tenantId }, orderBy: { createdAt: "asc" }, select: { id: true, name: true } }),
    item.categoryId
      ? prisma.category.findFirst({
          where: {
            id: item.categoryId,
            tenantId: null,
            OR: [{ kind: type }, { kind: null }],
          },
          select: { id: true },
        })
      : Promise.resolve(null),
  ]);
  const byName = new Map(units.map((u) => [unitKey(u.name), u.id]));
  const unitId =
    byName.get(unitKey(item.unitName)) ?? byName.get(FALLBACK_UNIT[type]) ?? units[0]?.id ?? null;
  if (!unitId) {
    return { ok: false, message: "Хэмжих нэгж бүртгэгдээгүй байна. «Үйлчилгээ» → нэгж хэсгээс нэмнэ үү." };
  }
  // Ажлын хугацаа: нэгж нь тенантад олдвол л хадгална (хоёулаа эсвэл аль нь ч биш).
  const durationUnitId =
    type === "LABOR" && item.durationValue && item.durationUnitName
      ? (byName.get(unitKey(item.durationUnitName)) ?? null)
      : null;

  let created: { id: string };
  try {
    created = await prisma.service.create({
      data: {
        tenantId,
        type,
        name: item.name,
        code: item.code,
        barcode: type === "GOODS" ? item.barcode : null,
        unitId,
        price: item.price,
        costPrice: null,
        stock: null,
        durationValue: durationUnitId ? item.durationValue : null,
        durationUnitId,
        description: item.description,
        isActive: true,
        categoryId: category?.id ?? null,
        catalogItemId: item.id,
      },
      select: { id: true },
    });
  } catch (e) {
    // Зэрэг хоёр хүсэлт нэг мөрийг холбох гэвэл — нөгөөгийнх нь үүсгэснийг ашиглана.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      const again = await prisma.service.findFirst({
        where: { tenantId, OR: [{ catalogItemId: item.id }, ...(item.code ? [{ type, code: item.code }] : [])] },
        select: { id: true, isActive: true },
      });
      if (again?.isActive) return { ok: true, serviceId: again.id, created: false };
      if (again) return { ok: false, message: SERVICE_INACTIVE };
    }
    throw e;
  }

  await logAudit({
    tenantId,
    userId: actor.id,
    entity: "Service",
    entityId: created.id,
    action: "CREATE",
    summary: `[${type}] ${item.name}${item.code ? ` · ${item.code}` : ""} · нэгдсэн сангаас (засварын хуудас)`,
    after: { type, name: item.name, code: item.code, price: item.price.toString(), catalogItemId: item.id },
  });
  return { ok: true, serviceId: created.id, created: true };
}
