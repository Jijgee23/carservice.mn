import { jsonError, jsonOk, requireApiUser, requirePermission } from "@/lib/api";
import { ReviewError, replyToReview } from "@/lib/reviews";

/**
 * PUT /api/v1/reviews/[id]/reply  { reply } — үнэлгээнд нийтэд харагдах хариу
 * бичих/засах (веб replyReviewAction-тэй ижил). Хоосон `reply` → хариуг устгана.
 *
 * Эрх: customers.edit. 404 REVIEW_NOT_FOUND, 422 REPLY_TOO_LONG.
 */
export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireApiUser(req);
  if (auth.response) return auth.response;
  const denied = requirePermission(auth.user, "customers.edit");
  if (denied) return denied;
  const { id } = await params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError(400, "Body нь JSON байх ёстой.");
  }
  const reply = (body as { reply?: unknown } | null)?.reply;
  if (reply !== null && reply !== undefined && typeof reply !== "string") {
    return jsonError(400, "reply нь текст байна.", { code: "VALIDATION", fieldErrors: { reply: "Текст оруулна уу." } });
  }

  try {
    await replyToReview({ tenantId: auth.user.tenantId, userId: auth.user.id, reviewId: id, reply: reply ?? "" });
  } catch (e) {
    if (e instanceof ReviewError) return jsonError(e.status, e.message, { code: e.code });
    throw e;
  }
  const text = (reply ?? "").trim();
  return jsonOk({ ok: true, reply: text || null, message: text ? "Хариу хадгалагдлаа." : "Хариу устгагдлаа." });
}
