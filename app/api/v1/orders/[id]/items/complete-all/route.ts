import { jsonError, jsonOk, requireApiUser, requirePermission } from "@/lib/api";
import { resolveWorkingBranch } from "@/lib/auth/api-branch";
import { OrderCommandError } from "@/lib/orders/order-commands";
import { completeAllOrderItemsCommand } from "@/lib/orders/order-item-commands";
import { requireActiveSubscriptionApi } from "@/lib/subscription-server";

/**
 * POST /api/v1/orders/[id]/items/complete-all — засварын хуудасны дуусаагүй бүх
 * ажил/оношилгоог «Дууссан» болгоно (веб completeAllOrderItemsAction-тэй ижил).
 * Бөглөгдөөгүй оношилгоо алгасагдана; засварын хуудасны төлөв өөрчлөгдөхгүй.
 *
 * Эрх: orders.itemStatus (+ идэвхтэй багц, ажлын салбарын scope).
 * Хариу: `{ completed, skippedDiagnostics }`.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireApiUser(req);
  if (auth.response) return auth.response;
  const denied = requirePermission(auth.user, "orders.itemStatus");
  if (denied) return denied;
  const locked = await requireActiveSubscriptionApi(auth.user);
  if (locked) return locked;
  const scopeResult = await resolveWorkingBranch(req, auth.user);
  if (scopeResult.response) return scopeResult.response;
  const { id } = await ctx.params;
  try {
    const result = await completeAllOrderItemsCommand({ actor: auth.user, orderId: id, scope: scopeResult.branchId });
    return jsonOk(result);
  } catch (error) {
    if (error instanceof OrderCommandError) return jsonError(error.status, error.message, { code: error.code, fieldErrors: error.fieldErrors });
    console.error("[orders/items/complete-all] command failed", error instanceof Error ? { name: error.name } : { name: "UnknownError" });
    return jsonError(500, "Үйлдлийг гүйцэтгэх боломжгүй байна.");
  }
}
