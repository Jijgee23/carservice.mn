// Сэлбэг барааны тооллого (StockCount) — mobile staff API. Вэбийн
// `app/dashboard/services/stock-counts` (жагсаалт) болон
// `startStockCountAction`-ийн (app/_actions/stock-counts.ts) нимгэн адаптер:
// бүх логик `lib/stock-counts.ts`-д, энд давхардуулахгүй.
//
// Модулийн хаалт (`enable_inventory`) `requireApiUser` доторх
// API_MODULE_PATHS ("/api/v1/stock-counts")-аар хийгдэнэ.

import { jsonError, jsonOk, requireApiUser, requirePermission } from "@/lib/api";
import { canEdit } from "@/lib/auth/roles";
import { prisma } from "@/lib/prisma";
import {
  STOCK_COUNT_STATUS_LABEL,
  StockCountError,
  listStockCounts,
  personName,
  startStockCount,
  stockCountLabel,
} from "@/lib/stock-counts";
import { requireActiveSubscriptionApi } from "@/lib/subscription-server";

/** StockCountError → `{ error, code, fieldErrors?, draftId? }` (lib-ийн status-аар: 403/404/409/422). */
function stockCountErrorResponse(e: StockCountError) {
  return jsonError(e.status, e.message, {
    code: e.code,
    ...(e.fieldErrors ? { fieldErrors: e.fieldErrors } : {}),
    ...(e.draftId ? { draftId: e.draftId } : {}),
  });
}

/**
 * GET /api/v1/stock-counts?page=1 — permission: services.view
 * Тооллогын түүх (30/хуудас, дугаараар буурахаар) + нээлттэй DRAFT.
 * `canStart` = services.edit эрхтэй бөгөөд нээлттэй тооллого байхгүй; энэ үед
 * эхлүүлэх цонхны ангиллын сонголт (`categories`, идэвхтэй барааны тоотой)
 * хамт ирнэ — вэбийн хуудастай адил.
 * 200: { stockCounts, page, total, totalPages, draft, canStart, categories }
 */
export async function GET(req: Request) {
  const auth = await requireApiUser(req);
  if (auth.response) return auth.response;
  const denied = requirePermission(auth.user, "services.view");
  if (denied) return denied;

  const user = auth.user;
  const raw = new URL(req.url).searchParams.get("page");
  const page = Math.max(1, Number.parseInt(raw ?? "1", 10) || 1);
  const mayCount = canEdit(user, "services");

  const [{ rows, total, totalPages, draft }, categories] = await Promise.all([
    listStockCounts(user.tenantId, page),
    mayCount
      ? prisma.category.findMany({
          where: {
            OR: [{ tenantId: user.tenantId }, { tenantId: null }],
            // Системийн ангилалд бусад тенантын бараа ч холбогдсон байж болох тул тенантаар шүүнэ.
            services: { some: { type: "GOODS", isActive: true, tenantId: user.tenantId } },
          },
          orderBy: { name: "asc" },
          select: { id: true, name: true, _count: { select: { services: { where: { type: "GOODS", isActive: true, tenantId: user.tenantId } } } } },
        })
      : Promise.resolve([]),
  ]);

  return jsonOk({
    stockCounts: rows.map((r) => ({
      id: r.id,
      number: r.number,
      label: stockCountLabel(r.number),
      status: r.status,
      statusLabel: STOCK_COUNT_STATUS_LABEL[r.status],
      note: r.note,
      categoryName: r.categoryName,
      createdAt: r.createdAt,
      completedAt: r.completedAt,
      cancelledAt: r.cancelledAt,
      lineCount: r.lineCount,
      countedCount: r.countedCount,
      diffCount: r.diffCount,
      shortageValue: r.shortageValue.toString(),
      surplusValue: r.surplusValue.toString(),
      createdBy: personName(r.createdBy),
      completedBy: r.completedBy ? personName(r.completedBy) : null,
    })),
    page,
    total,
    totalPages,
    draft: draft ? { id: draft.id, number: draft.number, label: stockCountLabel(draft.number) } : null,
    canStart: mayCount && !draft,
    categories: categories.map((c) => ({ id: c.id, name: c.name, goodsCount: c._count.services })),
  });
}

/**
 * POST /api/v1/stock-counts — permission: services.edit (lib дотор шалгана)
 * Body: `{ categoryId?: string | null, note?: string | null }` — categoryId
 * хоосон бол бүх идэвхтэй бараа. `startStockCountAction`-тай ижил.
 * 201: { stockCount: { id, number, label } }
 * Алдаа: 409 STOCK_COUNT_DRAFT_EXISTS (+ `draftId` — вэб тийшээ redirect
 * хийдэг тул клиент тэр тооллогыг нээнэ), 422 STOCK_COUNT_INVALID
 * (fieldErrors.categoryId) / STOCK_COUNT_EMPTY, 403.
 */
export async function POST(req: Request) {
  const auth = await requireApiUser(req);
  if (auth.response) return auth.response;
  const denied = requirePermission(auth.user, "services.edit");
  if (denied) return denied;
  const locked = await requireActiveSubscriptionApi(auth.user);
  if (locked) return locked;

  // Body заавал биш (бүх барааг тоолох бол хоосон байж болно).
  const text = await req.text();
  let body: unknown = {};
  if (text.trim()) {
    try {
      body = JSON.parse(text);
    } catch {
      return jsonError(400, "JSON body буруу.");
    }
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) return jsonError(400, "Body буруу.");
  const { categoryId, note } = body as Record<string, unknown>;

  const fieldErrors: Record<string, string> = {};
  if (categoryId != null && typeof categoryId !== "string") fieldErrors.categoryId = "Ангилал буруу.";
  if (note != null && typeof note !== "string") fieldErrors.note = "Тэмдэглэл текст байх ёстой.";
  if (Object.keys(fieldErrors).length > 0) {
    return jsonError(400, "Өгөгдөл буруу байна.", { code: "VALIDATION", fieldErrors });
  }

  try {
    const count = await startStockCount({
      actor: auth.user,
      categoryId: (categoryId as string | null | undefined) || null,
      note: (note as string | null | undefined) || null,
    });
    return jsonOk({ stockCount: { id: count.id, number: count.number, label: stockCountLabel(count.number) } }, { status: 201 });
  } catch (e) {
    if (e instanceof StockCountError) return stockCountErrorResponse(e);
    throw e;
  }
}
