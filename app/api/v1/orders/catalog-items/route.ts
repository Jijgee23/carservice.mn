import { Prisma } from "@/app/generated/prisma/client";
import { jsonOk, requireApiUser, requirePermission } from "@/lib/api";
import { normalizeCatalogCode, normalizeCatalogName } from "@/lib/catalog/normalize";
import { buildMeta, getApiPageInfo } from "@/lib/pagination";
import { prisma } from "@/lib/prisma";

const KINDS = ["LABOR", "GOODS"] as const;

/**
 * GET /api/v1/orders/catalog-items?type=LABOR|GOODS&q=
 *
 * Засварын хуудасны «мөр нэмэх» сонгогчид нэгдсэн сангийн (CatalogItem)
 * ажил/сэлбэг — тенант өөртөө хараахан холбоогүйг нь (вэбийн
 * app/dashboard/orders/[id]/page.tsx-тэй ижил). Сонгосныг
 * `POST /api/v1/orders/:id/items`-д `catalogItemId`-аар илгээхэд server
 * тенантын ажил/сэлбэг болгон автоматаар холбоно (lib/services/catalog-adopt.ts).
 * Хайлт нь searchCatalogAction-тэй ижил: нэр (агуулсан), код (эхлэл), баркод.
 */
export async function GET(req: Request) {
  const auth = await requireApiUser(req);
  if (auth.response) return auth.response;
  // Мөр нэмэх эрхтэй ижил (POST /orders/:id/items).
  const denied = requirePermission(auth.user, "orders.edit");
  if (denied && !auth.user.role?.permissions.includes("orders.editOwn")) return denied;

  const url = new URL(req.url);
  const typeParam = url.searchParams.get("type")?.trim().toUpperCase() || undefined;
  const type = (KINDS as readonly string[]).includes(typeParam ?? "")
    ? (typeParam as (typeof KINDS)[number])
    : undefined;
  const q = url.searchParams.get("q")?.trim() || "";
  const { page, pageSize, skip, take } = getApiPageInfo(url.searchParams);

  const nameKey = normalizeCatalogName(q);
  const codeKey = normalizeCatalogCode(q);
  const where: Prisma.CatalogItemWhereInput = {
    isActive: true,
    type: type ?? { in: [...KINDS] },
    services: { none: { tenantId: auth.user.tenantId } },
    ...(q && {
      OR: [
        { nameKey: { contains: nameKey } },
        ...(codeKey ? [{ codeKey: { startsWith: codeKey } }, { barcode: codeKey }] : []),
      ],
    }),
  };

  const [items, total] = await Promise.all([
    prisma.catalogItem.findMany({
      where,
      orderBy: [{ type: "asc" }, { name: "asc" }],
      skip,
      take,
      select: {
        id: true,
        type: true,
        name: true,
        code: true,
        unitName: true,
        price: true,
        description: true,
        category: { select: { id: true, name: true } },
      },
    }),
    prisma.catalogItem.count({ where }),
  ]);

  return jsonOk({
    items: items.map((item) => ({ ...item, price: item.price.toString() })),
    pagination: buildMeta(total, page, pageSize),
  });
}
