import { Prisma } from "@/app/generated/prisma/client";
import { jsonError, jsonOk, requireApiUser, requirePermission } from "@/lib/api";
import { logAudit } from "@/lib/audit";
import { requireActiveSubscriptionApi } from "@/lib/subscription-server";
import { buildMeta, getApiPageInfo } from "@/lib/pagination";
import { prisma } from "@/lib/prisma";
import { serviceRefFieldErrors } from "@/lib/services/service-commands";

const SERVICE_SELECT = {
  id: true,
  type: true,
  name: true,
  code: true,
  price: true,
  costPrice: true,
  stock: true,
  description: true,
  isActive: true,
  durationValue: true,
  // PATCH replaces the whole record, so edit forms must read this back —
  // without it every mobile edit wiped the service reminder interval.
  reminderIntervalMonths: true,
  unit: { select: { id: true, name: true, code: true } },
  durationUnit: { select: { id: true, name: true, code: true } },
  category: { select: { id: true, name: true } },
  createdAt: true,
} satisfies Prisma.ServiceSelect;

export async function GET(req: Request) {
  const auth = await requireApiUser(req);
  if (auth.response) return auth.response;
  const denied = requirePermission(auth.user, "services.view");
  if (denied) return denied;

  const url = new URL(req.url);
  const type = url.searchParams.get("type")?.trim() || undefined;
  const q = url.searchParams.get("q")?.trim() || undefined;
  const onlyActive = url.searchParams.get("isActive") !== "false";
  const { page, pageSize, skip, take } = getApiPageInfo(url.searchParams);

  const where: Prisma.ServiceWhereInput = {
    tenantId: auth.user.tenantId,
    ...(type && { type: type as any }),
    ...(onlyActive && { isActive: true }),
    ...(q && {
      OR: [
        { name: { contains: q, mode: "insensitive" } },
        { code: { contains: q, mode: "insensitive" } },
        { description: { contains: q, mode: "insensitive" } },
      ],
    }),
  };

  const [services, total] = await Promise.all([
    prisma.service.findMany({
      where,
      orderBy: [{ type: "asc" }, { name: "asc" }],
      skip,
      take,
      select: SERVICE_SELECT,
    }),
    prisma.service.count({ where }),
  ]);

  return jsonOk({ services, pagination: buildMeta(total, page, pageSize) });
}

const KINDS = ["LABOR", "GOODS", "DIAGNOSTIC"] as const;

const INVALID = Symbol("invalid");

/** Хоосон бол null; бусад үед 0-ээс их буюу тэнцүү төгсгөлөг тоо (0 нь 0 хэвээр). */
function optionalNonNegative(value: unknown): number | null | typeof INVALID {
  if (value === undefined || value === null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : INVALID;
}

// POST /api/v1/services
export async function POST(req: Request) {
  const auth = await requireApiUser(req);
  if (auth.response) return auth.response;
  const denied = requirePermission(auth.user, "services.create");
  if (denied) return denied;
  const locked = await requireActiveSubscriptionApi(auth.user);
  if (locked) return locked;

  const body = await req.json().catch(() => null);
  if (!body) return jsonError(400, "Буруу өгөгдөл");

  const {
    type, name, code, price, costPrice, stock, description, isActive,
    unitId, categoryId, durationValue, durationUnitId,
  } = body as Record<string, unknown>;

  if (!type || !(KINDS as readonly string[]).includes(type as string))
    return jsonError(400, "Төрөл буруу байна (LABOR | GOODS | DIAGNOSTIC)");
  if (!name || typeof name !== "string" || !name.trim())
    return jsonError(400, "Нэр заавал шаардлагатай");

  const priceNum = Number(price);
  if (!Number.isFinite(priceNum) || priceNum < 0)
    return jsonError(400, "Үнэ буруу байна");
  const costPriceNum = optionalNonNegative(costPrice);
  const stockNum = optionalNonNegative(stock);
  const durationNum = optionalNonNegative(durationValue);
  if (costPriceNum === INVALID) return jsonError(400, "Өртөг буруу байна");
  if (stockNum === INVALID) return jsonError(400, "Үлдэгдэл буруу байна");
  if (durationNum === INVALID) return jsonError(400, "Хугацаа буруу байна");

  const refs = {
    unitId: typeof unitId === "string" && unitId ? unitId : null,
    categoryId: typeof categoryId === "string" && categoryId ? categoryId : null,
    durationUnitId: typeof durationUnitId === "string" && durationUnitId ? durationUnitId : null,
  };
  const refErrors = await serviceRefFieldErrors(auth.user.tenantId, refs, type as "LABOR" | "GOODS" | "DIAGNOSTIC");
  if (Object.keys(refErrors).length > 0) {
    return jsonError(400, Object.values(refErrors)[0], { fieldErrors: refErrors });
  }

  let service;
  try {
    service = await prisma.service.create({
      data: {
        type: type as (typeof KINDS)[number],
        name: (name as string).trim(),
        code: typeof code === "string" && code.trim() ? code.trim().toUpperCase() : null,
        price: priceNum,
        costPrice: costPriceNum,
        stock: stockNum,
        description: typeof description === "string" && description.trim() ? description.trim() : null,
        isActive: isActive !== false,
        unitId: refs.unitId,
        categoryId: refs.categoryId,
        durationValue: durationNum,
        durationUnitId: refs.durationUnitId,
        tenantId: auth.user.tenantId,
      },
      select: SERVICE_SELECT,
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return jsonError(409, "Ийм кодтой бүртгэл аль хэдийн байна.", { fieldErrors: { code: "Код давхардаж байна." } });
    }
    throw e;
  }

  await logAudit({
    tenantId: auth.user.tenantId,
    userId: auth.user.id,
    entity: "Service",
    entityId: service.id,
    action: "CREATE",
    summary: service.name,
    after: { name: service.name, type: service.type, price: service.price.toString() },
  });

  return jsonOk({ service });
}
