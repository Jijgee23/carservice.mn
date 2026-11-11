import { jsonError, jsonOk, requireApiUser, requirePermission } from "@/lib/api";
import { requireActiveSubscriptionApi } from "@/lib/subscription-server";
import { PlateIntakeError, registerVehicleFromPlate } from "@/lib/orders/plate-intake-server";

/**
 * POST /api/v1/vehicles/from-plate  { plate, customerId?, make?, model? }
 *
 * Засварын хуудасны машины хайлтаас «+ дугаар — машин бүртгэх» — вебийн
 * registerVehicleFromPlateAction-ийн мобайл хувилбар (ижил
 * `registerVehicleFromPlate`): мэдээллийг дугаараар татаж (эсвэл гараар өгсөн
 * марк/загвараар) бүртгэнэ. customerId өгвөл түүний машин болно, үгүй бол
 * эзэмшигчгүй бүртгэгдэж POST /api/v1/orders сонгосон үйлчлүүлэгчид холбоно.
 *
 * → 201 { vehicle } | 200 { needsDetails: true, reason } (мэдээлэл олдсонгүй —
 *   марк/загвартай дахин илгээнэ)
 */
export async function POST(req: Request) {
  const auth = await requireApiUser(req);
  if (auth.response) return auth.response;
  const denied = requirePermission(auth.user, "vehicles.create");
  if (denied) return denied;
  const locked = await requireActiveSubscriptionApi(auth.user);
  if (locked) return locked;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError(400, "JSON body шаардлагатай.");
  }
  if (!body || typeof body !== "object") return jsonError(400, "Body буруу.");

  const { plate, customerId, make, model } = body as Record<string, unknown>;
  if (typeof plate !== "string" || !plate.trim()) {
    return jsonError(422, "Хүсэлт буруу.", {
      fieldErrors: { plate: "Улсын дугаар шаардлагатай." },
    });
  }

  try {
    const value = await registerVehicleFromPlate(auth.user, {
      plate,
      customerId: typeof customerId === "string" && customerId.trim() ? customerId.trim() : null,
      make: typeof make === "string" ? make : undefined,
      model: typeof model === "string" ? model : undefined,
    });
    if ("needsDetails" in value) return jsonOk(value);
    return jsonOk(value, { status: 201 });
  } catch (e) {
    if (e instanceof PlateIntakeError) {
      return jsonError(422, e.message, e.fieldErrors ? { fieldErrors: e.fieldErrors } : undefined);
    }
    throw e;
  }
}
