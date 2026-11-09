// «Улсын дугаар бичээд л» засварын хуудас үүсгэх урсгалын сервер тал.
//
//  1. lookupPlateForOrder — дугаараар: энэ tenant-ийн бүртгэл → глобал Vehicle →
//     HUR. Эзэмшигчийн PII (HUR-ын утас/регистр) browser-д гарахгүй.
//  2. registerPlateVehicle — бүртгэлгүй дугаарыг ЭЗЭМШИГЧГҮЙГЭЭР шууд
//     tenant-д бүртгэнэ (TenantVehicle.customerId = null). Ижил дугаартай
//     эзэнгүй бүртгэл байвал түүнийг буцаана — давхар мөр үүсгэхгүй.
//  3. linkPlateCustomer — дараа нь утсаар үйлчлүүлэгчийг олж/үүсгээд эзэнгүй
//     машинд эзэмшигч болгон холбоно (ensureTenantVehicle).
//  4. resolvePlateIntake — машин бүртгэхгүйгээр шууд илгээсэн үеийн fallback
//     (утас → үйлчлүүлэгч → эзэмшигчтэй машин). Бүгд idempotent.
//
// Шинэ загвар/багана байхгүй — одоогийн каноник командуудыг дуудна.

import { logAudit } from "@/lib/audit";
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
import { ensureTenantVehicle } from "@/lib/vehicles";
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
  UnownedPlateVehicle,
} from "@/lib/orders/plate-intake";

type Actor = { id: string; tenantId: string };

const TENANT_MATCH_LIMIT = 10;
const INTAKE_AUDIT_SUFFIX = "(засварын хуудаснаас дугаараар)";

const LINK_SELECT = {
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
} as const;

type LinkRow = {
  vehicleId: string;
  customerId: string | null;
  isPostpaid: boolean;
  customer: { fullName: string; phone: string; isOrganization: boolean; orgName: string | null } | null;
  vehicle: PlateLookupVehicleRow & { ownerRegnum: string | null };
};

type PlateLookupVehicleRow = {
  make: string | null;
  model: string | null;
  year: number | null;
  vin: string | null;
  fuelType: string | null;
  wheelPosition: string | null;
};

function toLookupVehicle(v: PlateLookupVehicleRow): PlateLookupVehicle {
  return {
    make: v.make ?? "",
    model: v.model ?? "",
    year: v.year,
    vin: v.vin,
    fuelType: v.fuelType,
    wheelPosition: v.wheelPosition,
  };
}

function toMatch(l: LinkRow): TenantPlateMatch | null {
  if (!l.customerId || !l.customer) return null;
  return {
    vehicleId: l.vehicleId,
    customerId: l.customerId,
    customerName: customerDisplay(l.customer).primary,
    customerPhone: formatPhone(l.customer.phone),
    isPostpaid: l.isPostpaid,
    ownerIsOrganization: vehicleOwnerIsOrganization(l.customer, l.vehicle.ownerRegnum),
    vehicle: toLookupVehicle(l.vehicle),
  };
}

function toUnowned(l: LinkRow): UnownedPlateVehicle {
  return { vehicleId: l.vehicleId, isPostpaid: l.isPostpaid, vehicle: toLookupVehicle(l.vehicle) };
}

export async function lookupPlateForOrder(
  actor: Actor,
  rawPlate: string,
): Promise<PlateLookupResult> {
  const plate = normalizePlate(rawPlate);

  // 1) Энэ tenant-д бүртгэлтэй машин — эзэн тус бүрт мөр + эзэнгүй бүртгэл.
  const links: LinkRow[] = await prisma.tenantVehicle.findMany({
    where: { tenantId: actor.tenantId, isActive: true, vehicle: { plate } },
    orderBy: { updatedAt: "desc" },
    take: TENANT_MATCH_LIMIT,
    select: LINK_SELECT,
  });
  if (links.length > 0) {
    const matches = links.map(toMatch).filter((m): m is TenantPlateMatch => m !== null);
    const unownedRow = links.find((l) => !l.customerId);
    return { kind: "tenant", plate, matches, unowned: unownedRow ? toUnowned(unownedRow) : null };
  }

  return fetchPlateVehicleData(actor, plate);
}

/**
 * Tenant-ээс гадуурх машины техник мэдээлэл: глобал Vehicle (HUR дуудахгүй) →
 * HUR (/api/hur/lookup-тай ижил "hur:<userId>" bucket/хязгаар).
 */
async function fetchPlateVehicleData(
  actor: Actor,
  plate: string,
): Promise<Extract<PlateLookupResult, { kind: "known" | "notFound" }>> {
  const existing = await prisma.vehicle.findFirst({
    where: { plate },
    orderBy: { updatedAt: "desc" },
    select: { make: true, model: true, year: true, vin: true, fuelType: true, wheelPosition: true },
  });
  if (existing) {
    return { kind: "known", plate, source: "global", vehicle: toLookupVehicle(existing) };
  }
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

export type RegisteredListVehicle = {
  id: string;
  plate: string;
  vin: string | null;
  make: string;
  model: string;
  customerId: string | null;
  isPostpaid: boolean;
};

/**
 * Машины жагсаалтын хайлтаас «+ дугаар бүртгэх»: мэдээллийг дугаараар татаж
 * (эсвэл гараар өгсөн марк/загвараар) бүртгэнэ. Үйлчлүүлэгч сонгосон бол түүний
 * машин болж, үгүй бол эзэмшигчгүй бүртгэгдэнэ (хуудас үүсгэхэд холбогдоно).
 * Мэдээлэл олдоогүй, гараар ч өгөөгүй бол `needsDetails`.
 */
export async function registerVehicleFromPlate(
  actor: Actor,
  input: { plate: string; customerId: string | null; make?: string; model?: string },
): Promise<{ vehicle: RegisteredListVehicle } | { needsDetails: true; reason: string }> {
  const plate = normalizePlate(input.plate);
  const make = input.make?.trim() ?? "";
  const model = input.model?.trim() ?? "";

  let vehicle: PlateLookupVehicle;
  let fromLookup = false;
  if (make && model) {
    vehicle = { make, model, year: null, vin: null, fuelType: null, wheelPosition: null };
  } else {
    const data = await fetchPlateVehicleData(actor, plate);
    if (data.kind === "notFound" || !data.vehicle.make || !data.vehicle.model) {
      return {
        needsDetails: true,
        reason: data.kind === "notFound" && data.reason === "rate_limited"
          ? "Хэт олон хайлт хийлээ — маркаа гараар оруулна уу."
          : "Машины мэдээлэл олдсонгүй — марк, загвараа оруулна уу.",
      };
    }
    vehicle = data.vehicle;
    fromLookup = true;
  }

  if (!input.customerId) {
    const unowned = await registerPlateVehicle(actor, { plate, vehicle, fromLookup });
    return {
      vehicle: {
        id: unowned.vehicleId,
        plate,
        vin: unowned.vehicle.vin,
        make: unowned.vehicle.make,
        model: unowned.vehicle.model,
        customerId: null,
        isPostpaid: unowned.isPostpaid,
      },
    };
  }

  try {
    const record = await createVehicleCommand({
      actor,
      data: { plate, ...vehicle, customerId: input.customerId },
      rejectDuplicate: false,
      requireCustomerId: true,
      resolveOwnerRegnum: fromLookup,
      auditSummarySuffix: INTAKE_AUDIT_SUFFIX,
    });
    return {
      vehicle: {
        id: record.id,
        plate: record.plate,
        vin: record.vin,
        make: record.make,
        model: record.model,
        customerId: record.customerId,
        isPostpaid: record.isPostpaid,
      },
    };
  } catch (e) {
    if (e instanceof VehicleCommandError) {
      throw new PlateIntakeError(e.message, pickFields(e.fieldErrors, VEHICLE_FIELD_MAP));
    }
    throw e;
  }
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

const VEHICLE_FIELD_MAP = { plate: "plate", vin: "plate", make: "make", model: "model", year: "make" };

/**
 * Бүртгэлгүй дугаарыг эзэмшигчгүйгээр tenant-д бүртгэнэ. Энэ tenant-д ижил
 * дугаартай эзэнгүй бүртгэл аль хэдийн байвал түүнийг буцаана —
 * resolveVehicleForOwner эзэнгүй үед үргэлж шинэ мөр үүсгэдэг тул заавал
 * эхлээд шалгана.
 */
export async function registerPlateVehicle(
  actor: Actor,
  input: { plate: string; vehicle: PlateLookupVehicle; fromLookup: boolean },
): Promise<UnownedPlateVehicle> {
  const plate = normalizePlate(input.plate);
  const existing: LinkRow | null = await prisma.tenantVehicle.findFirst({
    where: { tenantId: actor.tenantId, isActive: true, customerId: null, vehicle: { plate } },
    orderBy: { updatedAt: "desc" },
    select: LINK_SELECT,
  });
  if (existing) return toUnowned(existing);

  try {
    const record = await createVehicleCommand({
      actor,
      data: {
        plate,
        vin: input.vehicle.vin,
        make: input.vehicle.make,
        model: input.vehicle.model,
        year: input.vehicle.year,
        fuelType: input.vehicle.fuelType,
        wheelPosition: input.vehicle.wheelPosition,
        customerId: null,
      },
      rejectDuplicate: false,
      requireCustomerId: false,
      resolveOwnerRegnum: input.fromLookup,
      auditSummarySuffix: INTAKE_AUDIT_SUFFIX,
    });
    return {
      vehicleId: record.id,
      isPostpaid: record.isPostpaid,
      vehicle: {
        make: record.make,
        model: record.model,
        year: record.year,
        vin: record.vin,
        fuelType: record.fuelType,
        wheelPosition: record.wheelPosition,
      },
    };
  } catch (e) {
    if (e instanceof VehicleCommandError) {
      throw new PlateIntakeError(e.message, pickFields(e.fieldErrors, VEHICLE_FIELD_MAP));
    }
    throw e;
  }
}

/** Утсаар tenant-ийн үйлчлүүлэгчийг олно, байхгүй бол үүсгэнэ. */
export async function findOrCreateCustomerByPhone(
  actor: Actor,
  input: { phone: string; fullName: string },
  canCreateCustomer: boolean,
): Promise<string> {
  const found = await findTenantCustomerIdByPhone(actor.tenantId, input.phone);
  if (found) return found;
  if (!canCreateCustomer) {
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
    return res.customer.id;
  } catch (e) {
    if (e instanceof CustomerCommandError) {
      throw new PlateIntakeError(e.message, pickFields(e.fieldErrors, { fullName: "fullName", phone: "phone" }));
    }
    throw e;
  }
}

/**
 * Энэ tenant-ийн эзэмшигчгүй машинд үйлчлүүлэгчийг эзэмшигч болгон холбоно
 * (audit-тай). Аль хэдийн эзэнтэй бол хөндөхгүй. Буцаах = link-ийн БОДИТ эзэн
 * (машин олдохгүй бол null) — дуудагч өөрийн customerId-тай жишнэ.
 */
export async function attachOwnerToUnownedVehicle(
  actor: Actor,
  vehicleId: string,
  customerId: string,
): Promise<string | null> {
  const link = await prisma.tenantVehicle.findUnique({
    where: { tenantId_vehicleId: { tenantId: actor.tenantId, vehicleId } },
    select: { id: true, customerId: true },
  });
  if (!link) return null;
  if (link.customerId) return link.customerId;
  const customer = await prisma.customer.findFirst({
    where: { id: customerId, tenantId: actor.tenantId },
    select: { id: true },
  });
  if (!customer) return null;

  return prisma.$transaction(async (tx) => {
    const res = await ensureTenantVehicle(tx, { tenantId: actor.tenantId, vehicleId, customerId });
    // Зэрэгцээ хүсэлт өөр эзэн тавьчихсан бол audit бичихгүй.
    if (res.customerId === customerId) {
      await logAudit(
        {
          tenantId: actor.tenantId,
          userId: actor.id,
          entity: "Vehicle",
          entityId: link.id,
          action: "UPDATE",
          summary: `Эзэмшигч холбосон ${INTAKE_AUDIT_SUFFIX}`,
          before: { customerId: null },
          after: { customerId },
        },
        tx,
      );
    }
    return res.customerId;
  });
}

/**
 * Эзэнгүй бүртгэгдсэн машинд утсаар үйлчлүүлэгчийг (олж/үүсгээд) эзэмшигч
 * болгон холбоно. Машин аль хэдийн тэр үйлчлүүлэгчийнх бол юу ч өөрчлөхгүй;
 * өөр хүнийх бол татгалзана (эзэмшигчийг дарж бичихгүй — per-owner загвар).
 */
export async function linkPlateCustomer(
  actor: Actor,
  input: { vehicleId: string; phone: string; fullName: string },
  options: { canCreateCustomer: boolean },
): Promise<TenantPlateMatch> {
  const link = await prisma.tenantVehicle.findUnique({
    where: { tenantId_vehicleId: { tenantId: actor.tenantId, vehicleId: input.vehicleId } },
    select: { id: true, customerId: true },
  });
  if (!link) throw new PlateIntakeError("Машин олдсонгүй.", { plate: "Машин олдсонгүй." });

  const customerId = await findOrCreateCustomerByPhone(actor, input, options.canCreateCustomer);
  const owner = await attachOwnerToUnownedVehicle(actor, input.vehicleId, customerId);
  if (owner !== customerId) {
    throw new PlateIntakeError("Энэ машин өөр үйлчлүүлэгчид бүртгэлтэй байна.", {
      phone: "Энэ машин өөр үйлчлүүлэгчид бүртгэлтэй байна.",
    });
  }

  const row: LinkRow | null = await prisma.tenantVehicle.findUnique({
    where: { id: link.id },
    select: LINK_SELECT,
  });
  const match = row ? toMatch(row) : null;
  if (!match) throw new PlateIntakeError("Эзэмшигч холбож чадсангүй.");
  return match;
}

/**
 * Машин бүртгэхгүйгээр шууд илгээсэн үеийн fallback: утсаар үйлчлүүлэгч →
 * эзэмшигчтэй машин → TenantVehicle. `createVehicleCommand` дотроо
 * `resolveVehicleForOwner` (ижил эзэн + дугаар бол хуучин мөр) болон
 * `ensureTenantVehicle` (upsert) хийдэг тул давтан дуудахад шинэ мөр үүсэхгүй.
 */
export async function resolvePlateIntake(
  actor: Actor,
  input: PlateIntakeInput,
  options: { canCreateCustomer: boolean },
): Promise<{ customerId: string; vehicleId: string }> {
  const customerId = await findOrCreateCustomerByPhone(actor, input, options.canCreateCustomer);
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
    return { customerId: record.customerId ?? customerId, vehicleId: record.id };
  } catch (e) {
    if (e instanceof VehicleCommandError) {
      throw new PlateIntakeError(e.message, pickFields(e.fieldErrors, VEHICLE_FIELD_MAP));
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
