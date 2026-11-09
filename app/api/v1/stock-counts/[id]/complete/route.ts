// Тооллого дуусгах — вэбийн «Дуусгах» (`completeStockCountAction`)-тай яг ижил:
// хадгалагдаагүй (pending) мөрүүдийг эхлээд хадгалаад, дараа нь тооллогыг
// хааж зөрүүг үлдэгдэлд хэрэглэнэ. Логик `lib/stock-counts.ts`-д.

import { jsonError, jsonOk, requireApiUser, requirePermission } from "@/lib/api";
import { StockCountError, completeStockCount, saveStockCountLines, stockCountLabel } from "@/lib/stock-counts";
import { requireActiveSubscriptionApi } from "@/lib/subscription-server";

/** StockCountError → `{ error, code, fieldErrors? }` (lib-ийн status-аар: 403/404/409/422). */
function stockCountErrorResponse(e: StockCountError) {
  return jsonError(e.status, e.message, {
    code: e.code,
    ...(e.fieldErrors ? { fieldErrors: e.fieldErrors } : {}),
  });
}

/**
 * POST /api/v1/stock-counts/[id]/complete — permission: services.edit (lib дотор ч шалгана)
 * Body (заавал биш): `{ lines?: [{ lineId: string, countedQty: string | number | null }] }`
 * — хадгалагдаагүй мөрүүд; байвал эхлээд хадгална (PATCH-тай ижил шалгалт).
 * 200: { ok: true, message, stockCount: { id, number, label, lineCount,
 *   countedCount, diffCount, shortageValue, surplusValue } }
 * Алдаа: 400 VALIDATION, 422 STOCK_COUNT_INVALID (fieldErrors мөрийн id-аар) /
 * STOCK_COUNT_NOTHING_COUNTED, 404, 409 STOCK_COUNT_NOT_DRAFT, 403.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireApiUser(req);
  if (auth.response) return auth.response;
  const denied = requirePermission(auth.user, "services.edit");
  if (denied) return denied;
  const locked = await requireActiveSubscriptionApi(auth.user);
  if (locked) return locked;

  const { id } = await params;

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

  const rawLines = (body as Record<string, unknown>).lines;
  const pending: Array<{ lineId: string; countedQty: string | number | null }> = [];
  if (rawLines !== undefined && rawLines !== null) {
    if (!Array.isArray(rawLines)) {
      return jsonError(400, "`lines` массив байх ёстой.", { code: "VALIDATION", fieldErrors: { lines: "Массив байх ёстой." } });
    }
    const fieldErrors: Record<string, string> = {};
    rawLines.forEach((l, i) => {
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
      pending.push({ lineId, countedQty: q ?? null });
    });
    if (Object.keys(fieldErrors).length > 0) {
      return jsonError(400, "Зарим мөр буруу байна.", { code: "VALIDATION", fieldErrors });
    }
  }

  try {
    if (pending.length > 0) await saveStockCountLines({ actor: auth.user, countId: id, entries: pending });
    const done = await completeStockCount({ actor: auth.user, countId: id });
    return jsonOk({
      ok: true,
      message: `Тооллого дууслаа: ${done.diffCount} барааны үлдэгдэл засагдлаа.`,
      stockCount: {
        id: done.id,
        number: done.number,
        label: stockCountLabel(done.number),
        lineCount: done.lineCount,
        countedCount: done.countedCount,
        diffCount: done.diffCount,
        shortageValue: done.shortageValue.toString(),
        surplusValue: done.surplusValue.toString(),
      },
    });
  } catch (e) {
    if (e instanceof StockCountError) return stockCountErrorResponse(e);
    throw e;
  }
}
