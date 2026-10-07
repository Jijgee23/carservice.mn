// GET /api/v1/vehicles/[id]/vin-history — Phase 3. Permission: vehicles.view.
// 404 (never 403) when the vehicle has no TenantVehicle link for this tenant.
import { jsonError, jsonOk, requireApiUser, requirePermission } from "@/lib/api";
import { getVinHistory } from "@/lib/vehicles/vin-history";

export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const auth = await requireApiUser(req);
  if (auth.response) return auth.response;
  const denied = requirePermission(auth.user, "vehicles.view");
  if (denied) return denied;

  const { id } = await ctx.params;
  const result = await getVinHistory(auth.user.tenantId, id);
  if (!result) return jsonError(404, "Машин олдсонгүй.");
  return jsonOk(result);
}
