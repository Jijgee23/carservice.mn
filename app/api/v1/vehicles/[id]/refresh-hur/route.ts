import { jsonError, jsonOk, requireApiUser, requirePermission } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { requireActiveSubscriptionApi } from "@/lib/subscription-server";
import { refreshVehicleFieldsFromHur } from "@/lib/vehicle-hur-refresh";

// POST /api/v1/vehicles/[id]/refresh-hur — first staff-side HUR refresh
// (P3-B4). `lib/vehicle-hur-refresh.ts` is reused unchanged; its doc comment
// states ownership checking is the caller's responsibility. The account/
// mobile route (`app/api/v1/app/vehicles/[id]/refresh-hur/route.ts`) proves
// ownership via an AccountVehicle link scoped to the caller's account. This
// route proves it the tenant-staff way: a TenantVehicle link scoped to the
// caller's tenantId. `id` is the Vehicle id (see the sibling
// `app/api/v1/vehicles/[id]/route.ts` for why, and the 404-not-403 rule that
// applies identically here).
//
// KNOWN CROSS-TENANT LEAK (flagged, not fixed here — out of this route's
// owned scope and `refreshVehicleFieldsFromHur` is explicitly not to be
// forked/modified by this slice): `refreshVehicleFieldsFromHur` returns
// `serviceCount`/`diagnosisCount` counted with an UNSCOPED Prisma `_count`
// (`serviceOrders`/`diagnosticReports` on the global Vehicle row, across ALL
// tenants that share it). Returning those numbers verbatim to a tenant client
// would disclose how much work other tenants have done on this vehicle. This
// route deliberately DROPS both fields from its response rather than
// replacing them with a tenant-scoped recount, because no caller here needs
// them (the record refresh only updates make/model/year/vin/fuelType/
// wheelPosition/colorName/capacity/purpose) and adding two extra scoped
// count queries just to discard the result would be needless work. The
// existing account/mobile route
// (`app/api/v1/app/vehicles/[id]/refresh-hur/route.ts`) passes these same
// counts through, and that is NOT the same problem: its caller owns the
// registration, so "this car's history across the shops it visited" is their
// own data. The distinction is the caller, not the number — so do not
// "fix" the account route by analogy with this one.
export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const auth = await requireApiUser(req);
  if (auth.response) return auth.response;
  const denied = requirePermission(auth.user, "vehicles.edit");
  if (denied) return denied;
  const locked = await requireActiveSubscriptionApi(auth.user);
  if (locked) return locked;

  const { id } = await ctx.params;

  const link = await prisma.tenantVehicle.findUnique({
    where: { tenantId_vehicleId: { tenantId: auth.user.tenantId, vehicleId: id } },
    select: { vehicle: { select: { id: true, plate: true } } },
  });
  if (!link) return jsonError(404, "Машин олдсонгүй.");

  const result = await refreshVehicleFieldsFromHur(link.vehicle.id, link.vehicle.plate);
  if (!result.ok) {
    // Upstream HUR failure is an expected outcome, not a crash path — the
    // helper never wrote to the row in this branch, so stored fields are
    // untouched. Surface it as a clean 502 the client can translate, not a
    // 500.
    return jsonError(502, result.message);
  }

  // Strip the unscoped cross-tenant serviceCount/diagnosisCount — see the
  // file header comment.
  const { serviceCount: _serviceCount, diagnosisCount: _diagnosisCount, ...vehicle } =
    result.vehicle;
  void _serviceCount;
  void _diagnosisCount;

  return jsonOk({ vehicle });
}
