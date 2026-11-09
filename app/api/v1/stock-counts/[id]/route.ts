// Нэг тооллого — дэлгэрэнгүй (мөрүүдтэй) ба тоолсон тоо хадгалах. Вэбийн
// `app/dashboard/services/stock-counts/[id]` хуудас болон
// `saveStockCountLinesAction`-ийн адаптер; логик `lib/stock-counts.ts`-д.

import { jsonError, jsonOk, requireApiUser, requirePermission } from "@/lib/api";
import { canEdit } from "@/lib/auth/roles";
import {
  STOCK_COUNT_STATUS_LABEL,
  StockCountError,
  getStockCount,
  personName,
  saveStockCountLines,
  stockCountLabel,
} from "@/lib/stock-counts";
import { requireActiveSubscriptionApi } from "@/lib/subscription-server";

type Ctx = { params: Promise<{ id: string }> };

/** StockCountError → `{ error, code, fieldErrors? }` (lib-ийн status-аар: 403/404/409/422). */
function stockCountErrorResponse(e: StockCountError) {
  return jsonError(e.status, e.message, {
    code: e.code,
    ...(e.fieldErrors ? { fieldErrors: e.fieldErrors } : {}),
    ...(e.draftId ? { draftId: e.draftId } : {}),
  });
}

/**
 * `{ lines: [{ lineId, countedQty }] }`-г шалгана. countedQty: string | number
 * | null ("" / null = тоолоогүй) — тооны форматыг lib-ийн `parseCountedQty`
 * шалгаж, алдааг мөрийн id-аар буцаана.
 */
function parseLines(body: unknown):
  | { ok: true; entries: Array<{ lineId: string; countedQty: string | number | null }> }
  | { ok: false; message: string; fieldErrors: Record<string, string> } {
  const lines = body && typeof body === "object" ? (body as Record<string, unknown>).lines : undefined;
  if (!Array.isArray(lines)) return { ok: false, message: "`lines` массив шаардлагатай.", fieldErrors: { lines: "Массив байх ёстой." } };
  const entries: Array<{ lineId: string; countedQty: string | number | null }> = [];
  const fieldErrors: Record<string, string> = {};
  lines.forEach((l, i) => {
    const r = l && typeof l === "object" ? (l as Record<string, unknown>) : null;
    const lineId = r && typeof r.lineId === "string" ? r.lineId.trim() : "";
    const q = r?.countedQty;
    if (!lineId) {
      fieldErrors[`lines.${i}.lineId`] = "Мөрийн id шаардлагатай.";
      return;
    }
    if (q !== undefined && q !== null && typeof q !== "string" && typeof q !== "number") {
      fieldErrors[lineId] = "Тоо эсвэл null байх ёстой.";
      return;
    }
    entries.push({ lineId, countedQty: q ?? null });
  });
  if (Object.keys(fieldErrors).length > 0) return { ok: false, message: "Зарим мөр буруу байна.", fieldErrors };
  return { ok: true, entries };
}

/**
 * GET /api/v1/stock-counts/[id] — permission: services.view
 * 200: { stockCount: { id, number, label, status, statusLabel, note,
 *   categoryName, createdAt, completedAt, cancelledAt, lineCount,
 *   countedCount, diffCount, shortageValue, surplusValue, createdBy,
 *   completedBy, editable, lines: [{ id, serviceId, name, code, unit,
 *   costPrice, systemQty, countedQty, difference }] } }
 * `editable` = DRAFT ба services.edit (вэбийн хуудастай адил). Decimal-ууд string.
 * Алдаа: 404.
 */
export async function GET(req: Request, { params }: Ctx) {
  const auth = await requireApiUser(req);
  if (auth.response) return auth.response;
  const denied = requirePermission(auth.user, "services.view");
  if (denied) return denied;

  const { id } = await params;
  const count = await getStockCount(auth.user.tenantId, id);
  if (!count) return jsonError(404, "Тооллого олдсонгүй.", { code: "STOCK_COUNT_NOT_FOUND" });

  const s = (v: { toString(): string } | null) => (v == null ? null : v.toString());
  return jsonOk({
    stockCount: {
      id: count.id,
      number: count.number,
      label: stockCountLabel(count.number),
      status: count.status,
      statusLabel: STOCK_COUNT_STATUS_LABEL[count.status],
      note: count.note,
      categoryName: count.categoryName,
      createdAt: count.createdAt,
      completedAt: count.completedAt,
      cancelledAt: count.cancelledAt,
      lineCount: count.lineCount,
      countedCount: count.countedCount,
      diffCount: count.diffCount,
      shortageValue: count.shortageValue.toString(),
      surplusValue: count.surplusValue.toString(),
      createdBy: personName(count.createdBy),
      completedBy: count.completedBy ? personName(count.completedBy) : null,
      editable: count.status === "DRAFT" && canEdit(auth.user, "services"),
      lines: count.lines.map((l) => ({
        id: l.id,
        serviceId: l.serviceId,
        name: l.name,
        code: l.code,
        unit: l.unit,
        costPrice: s(l.costPrice),
        systemQty: l.systemQty.toString(),
        countedQty: s(l.countedQty),
        difference: s(l.difference),
      })),
    },
  });
}

/**
 * PATCH /api/v1/stock-counts/[id] — permission: services.edit (lib дотор ч шалгана)
 * Body: `{ lines: [{ lineId: string, countedQty: string | number | null }] }`
 * — зөвхөн өөрчлөгдсөн мөрүүд; null / "" = тоолоогүй болгоно.
 * `saveStockCountLinesAction`-тай ижил.
 * 200: { ok: true, saved, message }
 * Алдаа: 400 VALIDATION (body бүтэц), 422 STOCK_COUNT_INVALID (fieldErrors
 * мөрийн id-аар), 404, 409 STOCK_COUNT_NOT_DRAFT, 403.
 */
export async function PATCH(req: Request, { params }: Ctx) {
  const auth = await requireApiUser(req);
  if (auth.response) return auth.response;
  const denied = requirePermission(auth.user, "services.edit");
  if (denied) return denied;
  const locked = await requireActiveSubscriptionApi(auth.user);
  if (locked) return locked;

  const { id } = await params;
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") return jsonError(400, "JSON body шаардлагатай.");
  const parsed = parseLines(body);
  if (!parsed.ok) return jsonError(400, parsed.message, { code: "VALIDATION", fieldErrors: parsed.fieldErrors });

  try {
    const { saved } = await saveStockCountLines({ actor: auth.user, countId: id, entries: parsed.entries });
    return jsonOk({ ok: true, saved, message: `${saved} мөр хадгалагдлаа.` });
  } catch (e) {
    if (e instanceof StockCountError) return stockCountErrorResponse(e);
    throw e;
  }
}
