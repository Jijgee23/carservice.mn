import { jsonError, jsonOk, requireApiUser, requirePermission } from "@/lib/api";
import { vehicleOwnerIsOrganization } from "@/lib/vehicles/owner-kind";
import { prisma } from "@/lib/prisma";
import {
  VehicleCommandError,
  deleteVehicleCommand,
  updateVehicleCommand,
} from "@/lib/vehicles/vehicle-commands";

// P3-B4: staff GET/PATCH/DELETE over a single vehicle, scoped through the
// TenantVehicle join (never the global Vehicle row directly — Vehicle has no
// tenantId; a row is one owner's registration and is shared cross-tenant).
// `id` here is the Vehicle id, matching `GET /api/v1/vehicles`'s
// `vehicle.id` and this repo's other `[id]` routes (e.g. appointments,
// orders), not the TenantVehicle link id.
//
// 404-not-403 is deliberate everywhere below: a vehicle that exists but has
// no TenantVehicle link for this tenant must look identical, from the
// client's perspective, to a vehicle that does not exist at all. A 403 would
// confirm the row exists and leak another tenant's data (see
// TENANT_MOBILE_SLICES.md P3-B4 and the Phase 3 invariants).

const VEHICLE_SELECT = {
  id: true,
  plate: true,
  vin: true,
  make: true,
  model: true,
  year: true,
  mileage: true,
  fuelType: true,
  wheelPosition: true,
  colorName: true,
  capacity: true,
  purpose: true,
  ownerRegnum: true,
} as const;

async function loadTenantVehicle(tenantId: string, vehicleId: string) {
  const link = await prisma.tenantVehicle.findUnique({
    where: { tenantId_vehicleId: { tenantId, vehicleId } },
    select: {
      customerId: true,
      isPostpaid: true,
      customer: {
        select: { id: true, fullName: true, phone: true, isOrganization: true, orgName: true },
      },
      vehicle: { select: VEHICLE_SELECT },
    },
  });
  if (!link) return null;
  return {
    ...link.vehicle,
    ownerIsOrganization: vehicleOwnerIsOrganization(link.customer, link.vehicle.ownerRegnum),
    customerId: link.customerId,
    customer: link.customer,
    isPostpaid: link.isPostpaid,
  };
}

function commandErrorResponse(error: unknown) {
  if (error instanceof VehicleCommandError) {
    // The command's own 404 ("VEHICLE_NOT_FOUND" — no TenantVehicle link for
    // this tenant/vehicleId) is already the correct not-403 shape; forward it
    // as-is rather than re-coding it.
    return jsonError(
      error.status,
      error.message,
      error.fieldErrors ? { code: error.code, fieldErrors: error.fieldErrors } : { code: error.code },
    );
  }
  throw error;
}

// GET /api/v1/vehicles/[id] — permission: vehicles.view
export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const auth = await requireApiUser(req);
  if (auth.response) return auth.response;
  const denied = requirePermission(auth.user, "vehicles.view");
  if (denied) return denied;

  const { id } = await ctx.params;
  const vehicle = await loadTenantVehicle(auth.user.tenantId, id);
  if (!vehicle) return jsonError(404, "Машин олдсонгүй.");

  return jsonOk({ vehicle });
}

// PATCH /api/v1/vehicles/[id] — permission: vehicles.edit
// Body: same shape as VehicleCommandInput (plate/vin/make/model/year/mileage/
// fuelType/wheelPosition/colorName/capacity/purpose/ownerRegnum/customerId/
// isPostpaid). Delegates entirely to `updateVehicleCommand` (P3-B2) — this
// route does not duplicate validation, plate handling or owner-change
// blocking.
export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const auth = await requireApiUser(req);
  if (auth.response) return auth.response;
  const denied = requirePermission(auth.user, "vehicles.edit");
  if (denied) return denied;

  const { id } = await ctx.params;

  // Confirm tenant linkage before invoking the command, so an
  // unlinked-vehicle PATCH returns 404 uniformly even though
  // updateVehicleCommand would also reject it with VEHICLE_NOT_FOUND (belt
  // and suspenders — keeps this route's contract independent of the
  // command's internal error shape).
  const existing = await prisma.tenantVehicle.findUnique({
    where: { tenantId_vehicleId: { tenantId: auth.user.tenantId, vehicleId: id } },
    select: { id: true },
  });
  if (!existing) return jsonError(404, "Машин олдсонгүй.");

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError(400, "JSON body шаардлагатай.");
  }
  if (!body || typeof body !== "object") return jsonError(400, "Body буруу.");

  const {
    plate,
    vin,
    make,
    model,
    year,
    mileage,
    fuelType,
    wheelPosition,
    colorName,
    capacity,
    purpose,
    ownerRegnum,
    customerId,
    isPostpaid,
  } = body as Record<string, unknown>;

  let record;
  try {
    record = await updateVehicleCommand({
      actor: auth.user,
      vehicleId: id,
      data: {
        plate: typeof plate === "string" ? plate : "",
        vin: typeof vin === "string" ? vin : null,
        make: typeof make === "string" ? make : "",
        model: typeof model === "string" ? model : "",
        year: typeof year === "number" || typeof year === "string" ? year : null,
        mileage: typeof mileage === "number" || typeof mileage === "string" ? mileage : null,
        fuelType: typeof fuelType === "string" ? fuelType : null,
        wheelPosition: typeof wheelPosition === "string" ? wheelPosition : null,
        colorName: typeof colorName === "string" ? colorName : null,
        capacity: typeof capacity === "number" || typeof capacity === "string" ? capacity : null,
        purpose: typeof purpose === "string" ? purpose : null,
        ownerRegnum: typeof ownerRegnum === "string" ? ownerRegnum : null,
        customerId: typeof customerId === "string" ? customerId : null,
        isPostpaid: typeof isPostpaid === "boolean" ? isPostpaid : undefined,
      },
    });
  } catch (e) {
    return commandErrorResponse(e);
  }

  return jsonOk({ vehicle: record });
}

// DELETE /api/v1/vehicles/[id] — permission: vehicles.delete
// Delegates to `deleteVehicleCommand` (P3-B2), which removes only this
// tenant's TenantVehicle link; the global Vehicle row and other tenants'
// links/history are untouched.
export async function DELETE(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const auth = await requireApiUser(req);
  if (auth.response) return auth.response;
  const denied = requirePermission(auth.user, "vehicles.delete");
  if (denied) return denied;

  const { id } = await ctx.params;

  const existing = await prisma.tenantVehicle.findUnique({
    where: { tenantId_vehicleId: { tenantId: auth.user.tenantId, vehicleId: id } },
    select: { id: true },
  });
  if (!existing) return jsonError(404, "Машин олдсонгүй.");

  let result;
  try {
    result = await deleteVehicleCommand({ actor: auth.user, vehicleId: id });
  } catch (e) {
    return commandErrorResponse(e);
  }

  return jsonOk({ vehicle: result });
}
