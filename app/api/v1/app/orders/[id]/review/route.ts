import { jsonError, jsonOk } from "@/lib/api";
import { getApiAccountFromRequest } from "@/lib/auth/account-api-token";
import { ReviewError, submitReview } from "@/lib/reviews";

// POST /api/v1/app/orders/[id]/review — дууссан засварт үнэлгээ өгөх/засах.
// Body: { "rating": 1..5, "comment"?: string }. Нэг засварт нэг үнэлгээ (дахин
// илгээвэл шинэчилнэ). Зөвхөн тухайн засварын үйлчлүүлэгч (Customer.accountId эсвэл утас).
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const account = await getApiAccountFromRequest(req);
  if (!account) return jsonError(401, "Нэвтрэх шаардлагатай.");
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => null)) as { rating?: unknown; comment?: unknown } | null;
  if (!body) return jsonError(400, "Буруу өгөгдөл");
  try {
    const saved = await submitReview({ accountId: account.id, phone: account.phone, orderId: id, rating: body.rating, comment: body.comment });
    return jsonOk({ review: saved });
  } catch (e) {
    if (e instanceof ReviewError) return jsonError(e.status, e.message, { code: e.code });
    throw e;
  }
}
