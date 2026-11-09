// Тооллого цуцлах — `cancelStockCountAction`-ийн адаптер. Үлдэгдэл өөрчлөгдөхгүй;
// логик `lib/stock-counts.ts`-д.

import { jsonError, jsonOk, requireApiUser, requirePermission } from "@/lib/api";
import { StockCountError, cancelStockCount } from "@/lib/stock-counts";
import { requireActiveSubscriptionApi } from "@/lib/subscription-server";

/**
 * POST /api/v1/stock-counts/[id]/cancel — permission: services.edit (lib дотор ч шалгана)
 * Body: байхгүй.
 * 200: { ok: true, stockCount: { id } }
 * Алдаа: 404 STOCK_COUNT_NOT_FOUND, 409 STOCK_COUNT_NOT_DRAFT, 403.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireApiUser(req);
  if (auth.response) return auth.response;
  const denied = requirePermission(auth.user, "services.edit");
  if (denied) return denied;
  const locked = await requireActiveSubscriptionApi(auth.user);
  if (locked) return locked;

  const { id } = await params;
  try {
    const done = await cancelStockCount({ actor: auth.user, countId: id });
    return jsonOk({ ok: true, stockCount: { id: done.id } });
  } catch (e) {
    if (e instanceof StockCountError) return jsonError(e.status, e.message, { code: e.code });
    throw e;
  }
}
