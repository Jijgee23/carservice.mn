// «Улсын дугаар бичээд л» засварын хуудас үүсгэх урсгалын сервер тал.
//
//  1. lookupPlateForOrder — дугаараар: энэ tenant-ийн бүртгэл → глобал Vehicle →
//     HUR. Эзэмшигчийн PII (HUR-ын утас/регистр) browser-д гарахгүй.
//  2. resolvePlateIntake — бүртгэлгүй дугаарт: утсаар үйлчлүүлэгч (байвал
//     дахин ашиглах) → машин (per-owner мөр) → tenant холбоос. Бүх алхам
//     idempotent тул захиалга алдаа өгөөд дахин илгээхэд давхар мөр үүсэхгүй.
//
// Шинэ загвар/багана байхгүй — одоогийн каноник командуудыг дуудна.

import { formatPhone } from "@/lib/phone";
import { customerDisplay } from "@/lib/customers";
import {
  CustomerCommandError,
  createCustomerCommand,
} from "@/lib/customers/customer-commands";
import { findTenantCustomerIdByPhone } from "@/lib/hur-lookup";
import { HurService } from "@/lib/hur_service";
import { prisma } from "@/lib/prisma";
import { consumeRateLimit } from "@/lib/rate-limit";
import { normalizePlate } from "@/lib/vehicle-plate";
import { vehicleOwnerIsOrganization } from "@/lib/vehicles/owner-kind";
import {
  VehicleCommandError,
  createVehicleCommand,
} from "@/lib/vehicles/vehicle-commands";
import type {
  PlateIntakeInput,
  PlateLookupResult,
  PlateLookupVehicle,
  TenantPlateMatch,
} from "@/lib/orders/plate-intake";

type Actor = { id: string; tenantId: string };

const TENANT_MATCH_LIMIT = 10;

export async function lookupPlateForOrder(
  actor: Actor,
  rawPlate: string,
): Promise<PlateLookupResult> {
  const plate = normalizePlate(rawPlate);

  // 1) Энэ tenant-д бүртгэлтэй (эзэмшигчтэй) машин — эзэн тус бүрт тусдаа мөр.
  const links = await prisma.tenantVehicle.findMany({
    where: {
      tenantId: actor.tenantId,
      isActive: true,
      customerId: { not: null },
      vehicle: { plate },
    },
    orderBy: { updatedAt: "desc" },
    take: TENANT_MATCH_LIMIT,
    select: {
      vehicleId: true,
      customerId: true,
      isPostpaid: true,
      customer: {
        select: { fullName: true, phone: true, isOrganization: true, orgName: true },
      },
      vehicle: {
        select: {
          make: true,
          model: true,
          year: true,
          vin: true,
          fuelType: true,
          wheelPosition: true,
          ownerRegnum: true,
        },
      },
    },
  });
  const matches: TenantPlateMatch[] = links.flatMap((l) =>
    l.customerId && l.customer
      ? [
          {
            vehicleId: l.vehicleId,
            customerId: l.customerId,
            customerName: customerDisplay(l.customer).primary,
            customerPhone: formatPhone(l.customer.phone),
            isPostpaid: l.isPostpaid,
            ownerIsOrganization: vehicleOwnerIsOrganization(l.customer, l.vehicle.ownerRegnum),
            vehicle: toLookupVehicle(l.vehicle),
          },
        ]
      : [],
  );
  if (matches.length > 0) return { kind: "tenant", plate, matches };

  // 2) Өөр газар бүртгэлтэй (глобал) — техник шинж ижил тул HUR дуудахгүй.
  const existing = await prisma.vehicle.findFirst({
    where: { plate },
    orderBy: { updatedAt: "desc" },
    select: { make: true, model: true, year: true, vin: true, fuelType: true, wheelPosition: true },
  });
  if (existing) {
    return { kind: "known", plate, source: "global", vehicle: toLookupVehicle(existing) };
  }

  // 3) HUR — /api/hur/lookup-тай ижил "hur:<userId>" bucket/хязгаар.
  if (!consumeRateLimit(`hur:${actor.id}`, { limit: 20, windowMs: 60_000 }).ok) {
    return { kind: "notFound", plate, reason: "rate_limited" };
  }
  try {
    const hur = await HurService.getVehicle(plate);
    if (!hur.make && !hur.model) return { kind: "notFound", plate, reason: "not_found" };
    return { kind: "known", plate, source: "hur", vehicle: toLookupVehicle(hur) };
  } catch (e) {
    console.error("[plate-intake] HUR lookup", e);
    return { kind: "notFound", plate, reason: "hur_error" };
  }
}

function toLookupVehicle(v: {
  make: string | null;
  model: string | null;
  year: number | null;
  vin: string | null;
  fuelType: string | null;
  wheelPosition: string | null;
}): PlateLookupVehicle {
  return {
    make: v.make ?? "",
    model: v.model ?? "",
    year: v.year,
    vin: v.vin,
    fuelType: v.fuelType,
    wheelPosition: v.wheelPosition,
  };
}

export class PlateIntakeError extends Error {
  constructor(
    message: string,
    public readonly fieldErrors?: Record<string, string>,
  ) {
    super(message);
    this.name = "PlateIntakeError";
  }
}

const INTAKE_AUDIT_SUFFIX = "(засварын хуудаснаас дугаараар)";

/**
 * Бүртгэлгүй дугаарыг tenant-д харьяалуулна: утсаар үйлчлүүлэгч → машин →
 * TenantVehicle. `createVehicleCommand` дотроо `resolveVehicleForOwner`
 * (ижил эзэн + дугаар бол хуучин мөр) болон `ensureTenantVehicle` (upsert)
 * хийдэг тул давтан дуудахад шинэ мөр үүсэхгүй.
 */
export async function resolvePlateIntake(
  actor: Actor,
  input: PlateIntakeInput,
  options: { canCreateCustomer: boolean },
): Promise<{ customerId: string; vehicleId: string; createdCustomer: boolean }> {
  let customerId = await findTenantCustomerIdByPhone(actor.tenantId, input.phone);
  let createdCustomer = false;
  if (!customerId) {
    if (!options.canCreateCustomer) {
      throw new PlateIntakeError("Танд үйлчлүүлэгч үүсгэх эрх байхгүй.", {
        phone: "Энэ утастай үйлчлүүлэгч бүртгэлгүй байна.",
      });
    }
    try {
      const res = await createCustomerCommand({
        actor,
        data: { fullName: input.fullName, phone: input.phone },
        auditSummarySuffix: INTAKE_AUDIT_SUFFIX,
      });
      customerId = res.customer.id;
      createdCustomer = res.outcome !== "existing";
    } catch (e) {
      if (e instanceof CustomerCommandError) {
        throw new PlateIntakeError(e.message, pickFields(e.fieldErrors, { fullName: "fullName", phone: "phone" }));
      }
      throw e;
    }
  }

  try {
    const record = await createVehicleCommand({
      actor,
      data: {
        plate: input.plate,
        vin: input.vehicle.vin,
        make: input.vehicle.make,
        model: input.vehicle.model,
        year: input.vehicle.year,
        fuelType: input.vehicle.fuelType,
        wheelPosition: input.vehicle.wheelPosition,
        customerId,
      },
      rejectDuplicate: false,
      requireCustomerId: true,
      resolveOwnerRegnum: input.fromLookup,
      auditSummarySuffix: INTAKE_AUDIT_SUFFIX,
    });
    // Link-ийн БОДИТ эзэн (ensureTenantVehicle байгаа эзнийг дарж бичдэггүй).
    return { customerId: record.customerId ?? customerId, vehicleId: record.id, createdCustomer };
  } catch (e) {
    if (e instanceof VehicleCommandError) {
      throw new PlateIntakeError(
        e.message,
        pickFields(e.fieldErrors, { plate: "plate", vin: "plate", make: "make", model: "model", year: "make" }),
      );
    }
    throw e;
  }
}

/** Командын fieldErrors-ийг маягтын талбарын нэр рүү буулгана. */
function pickFields(
  errors: Record<string, string> | undefined,
  map: Record<string, string>,
): Record<string, string> | undefined {
  if (!errors) return undefined;
  const out: Record<string, string> = {};
  for (const [key, msg] of Object.entries(errors)) {
    const target = map[key];
    if (target && !out[target]) out[target] = msg;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}
