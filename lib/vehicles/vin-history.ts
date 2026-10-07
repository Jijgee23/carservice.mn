// Phase 3 — VIN history: other Vehicle rows sharing this vehicle's VIN
// (e.g. re-registered under a new plate/owner). `Vehicle` is global, so
// everything tenant-visible is scoped through this tenant's TenantVehicle
// link; rows not linked to the tenant are only COUNTED (no PII).

import { prisma } from "@/lib/prisma";
import { normalizeVin } from "@/lib/vehicles";

export type VinHistoryRecord = {
  vehicleId: string;
  plate: string;
  make: string;
  model: string;
  year: number | null;
  ownerName: string | null;
  orderCount: number;
  lastOrderAt: string | null;
  createdAt: string;
};

export type VinHistory = {
  vin: string | null;
  records: VinHistoryRecord[];
  otherTenantRecords: number;
};

export type VinHistoryRow = {
  id: string;
  plate: string;
  make: string;
  model: string;
  year: number | null;
  /** This tenant's link, or undefined when the row belongs to other tenants only. */
  link?: {
    createdAt: Date;
    customer: { fullName: string; orgName: string | null; isOrganization: boolean } | null;
  };
};

export type VinOrderStat = { vehicleId: string; count: number; lastAt: Date | null };

/** Pure shaping: rows (+ per-vehicle order stats) -> contract response. */
export function shapeVinHistory(
  vin: string | null,
  rows: VinHistoryRow[],
  stats: VinOrderStat[],
): VinHistory {
  if (!vin) return { vin: null, records: [], otherTenantRecords: 0 };
  const statBy = new Map(stats.map((s) => [s.vehicleId, s]));
  const records: VinHistoryRecord[] = [];
  let otherTenantRecords = 0;
  for (const r of rows) {
    if (!r.link) {
      otherTenantRecords += 1;
      continue;
    }
    const c = r.link.customer;
    const s = statBy.get(r.id);
    records.push({
      vehicleId: r.id,
      plate: r.plate,
      make: r.make,
      model: r.model,
      year: r.year,
      ownerName: c ? (c.isOrganization && c.orgName ? c.orgName : c.fullName) : null,
      orderCount: s?.count ?? 0,
      lastOrderAt: s?.lastAt ? s.lastAt.toISOString() : null,
      createdAt: r.link.createdAt.toISOString(),
    });
  }
  records.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return { vin, records, otherTenantRecords };
}

/** Returns null when the vehicle is not linked to the tenant (caller -> 404). */
export async function getVinHistory(
  tenantId: string,
  vehicleId: string,
): Promise<VinHistory | null> {
  const own = await prisma.tenantVehicle.findUnique({
    where: { tenantId_vehicleId: { tenantId, vehicleId } },
    select: { vehicle: { select: { vin: true } } },
  });
  if (!own) return null;
  const vin = normalizeVin(own.vehicle.vin);
  if (!vin) return shapeVinHistory(null, [], []);

  const vehicles = await prisma.vehicle.findMany({
    where: { vin: { equals: vin, mode: "insensitive" }, id: { not: vehicleId } },
    select: {
      id: true,
      plate: true,
      make: true,
      model: true,
      year: true,
      tenantLinks: {
        where: { tenantId },
        select: {
          createdAt: true,
          customer: {
            select: { fullName: true, orgName: true, isOrganization: true },
          },
        },
      },
    },
  });
  const rows: VinHistoryRow[] = vehicles.map((v) => ({
    id: v.id,
    plate: v.plate,
    make: v.make,
    model: v.model,
    year: v.year,
    link: v.tenantLinks[0],
  }));
  const ownIds = rows.filter((r) => r.link).map((r) => r.id);
  const grouped = ownIds.length
    ? await prisma.serviceOrder.groupBy({
        by: ["vehicleId"],
        where: { tenantId, vehicleId: { in: ownIds }, status: { not: "CANCELLED" } },
        _count: { _all: true },
        _max: { createdAt: true },
      })
    : [];
  return shapeVinHistory(
    vin,
    rows,
    grouped.map((g) => ({
      vehicleId: g.vehicleId,
      count: g._count._all,
      lastAt: g._max.createdAt,
    })),
  );
}
