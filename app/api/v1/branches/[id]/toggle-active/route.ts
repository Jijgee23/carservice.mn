import { jsonError, jsonOk, requireApiUser, requirePermission } from "@/lib/api";
import { toggleBranchActive } from "@/lib/branches-commands";
import { requireActiveSubscriptionApi } from "@/lib/subscription-server";

/**
 * POST /api/v1/branches/[id]/toggle-active — салбарын идэвхтэй/идэвхгүй
 * төлөвийг сэлгэнэ (вэбийн toggleBranchActiveAction).
 *
 * Эрх: `branches.edit`; идэвхтэй багц шаардана (403 SUBSCRIPTION_EXPIRED).
 * Body: шаардлагагүй.
 * 200: { branch: { id, isActive } } — шинэ төлөв.
 * Алдаа: 404 NOT_FOUND, 409 PRIMARY_LOCKED (идэвхтэй үндсэн салбарыг
 * идэвхгүй болгох оролдлого).
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireApiUser(req);
  if (auth.response) return auth.response;
  const denied = requirePermission(auth.user, "branches.edit");
  if (denied) return denied;
  const locked = await requireActiveSubscriptionApi(auth.user);
  if (locked) return locked;
  const { id } = await ctx.params;

  const result = await toggleBranchActive(auth.user, id);
  if (!result.ok) {
    if (result.code === "NOT_FOUND") return jsonError(404, "Салбар олдсонгүй.", { code: "NOT_FOUND" });
    return jsonError(409, result.message, { code: "PRIMARY_LOCKED" });
  }
  return jsonOk({ branch: { id, isActive: result.isActive } });
}
