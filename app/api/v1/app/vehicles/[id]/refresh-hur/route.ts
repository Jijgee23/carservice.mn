import { jsonError, jsonOk } from "@/lib/api";
import { getApiAccountFromRequest } from "@/lib/auth/account-api-token";
import { prisma } from "@/lib/prisma";
import { refreshVehicleFieldsFromHur } from "@/lib/vehicle-hur-refresh";
import { isNoPlate } from "@/lib/vehicle-plate";

// POST /api/v1/app/vehicles/[id]/refresh-hur — миний машины мэдээллийг
// HUR-аас гар аргаар дахин татах (auth). `id` = AccountVehicle link id
// (GET /vehicles-ийн адил).
export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const account = await getApiAccountFromRequest(req);
  if (!account) return jsonError(401, "Нэвтрэх шаардлагатай.");

  const { id } = await ctx.params;
  const link = await prisma.accountVehicle.findFirst({
    where: { id, accountId: account.id },
    select: { vehicle: { select: { id: true, plate: true } } },
  });
  if (!link) return jsonError(404, "Машин олдсонгүй.");
  if (isNoPlate(link.vehicle.plate)) {
    return jsonError(422, "Улсын дугааргүй машиныг ХУР-аас шинэчлэх боломжгүй.", { code: "NO_PLATE" });
  }

  const result = await refreshVehicleFieldsFromHur(link.vehicle.id, link.vehicle.plate);
  if (!result.ok) {
    return jsonError(502, result.message);
  }

  // GET /vehicles-тэй яг ижил хэлбэр — мобайлын domain DTO дахин ашиглана.
  return jsonOk({ vehicle: { id, ...result.vehicle } });
}
