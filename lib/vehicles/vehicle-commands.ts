// P3-B2 (rewritten for vehicle-per-owner, D-152/D-153) — нэг канон Vehicle
// create/update/delete команд. Гурван хуулбар (`app/_actions/vehicles.ts`,
// `app/_actions/quick-create.ts` машины хэсэг, `app/api/v1/vehicles/route.ts`
// POST) урьд нь тус бүрдээ validate/claim логикийг давхар бичдэг байсан бөгөөд
// аль хэдийн зөрсөн байсан (9 divergence, доор тэмдэглэсэн). `lib/vehicles.ts`
// дэх `resolveVehicleForOwner`/`ownerFromCustomer`/`ensureTenantVehicle`-ийг
// ӨӨРЧЛӨЛГҮЙ дахин ашиглана — эдгээр нь энэ модулийн суурь. Загвар:
// `lib/customers/customer-commands.ts` (P3-B1). Typed input/output — FormData,
// NextResponse, redirect, revalidatePath байхгүй. Эрх (permission) шалгалт
// болон subscription gate дуудагч талд үлдэнэ.
//
// Зөвшөөрөгдсөн ХОЁРХОН зан төлөвийн өөрчлөлт (TENANT_MOBILE_SLICES.md
// P3-B2):
//  1. Divergence 9 засагдсан: бүх зам link-ийн БОДИТ эзнийг буцаана (сонгосон
//     customerId-г биш) — `ensureTenantVehicle` эзнийг хэзээ ч дарж бичдэггүй
//     тул хүсэлтээр ирсэн customerId нь link-ийн бодит эзэнтэй зөрөх боломжтой.
//  2. Divergence 5 нэгдсэн: claim (resolve+ensure) логик нэг л газар байна;
//     хуучин хоёр гар аргаар (`app/_actions/vehicles.ts`,
//     `app/api/v1/vehicles/route.ts` POST) upsert хийж байсан нь устсан.
//
// `MAX_VEHICLES` нь 2026-09-22-ны шийдвэрээр (D-154, D-151-ийг орлоно) БҮХ
// зам дээр шалгагдана — түг байхгүй, команд өөрөө үргэлж шалгана.
//
// Үлдсэн зөрүү (1,3,4,6,7,8 — mandatory customerId, year upper bound,
// давхардлыг татгалзах, audit хэлбэр/цаг, mileage/wheelPosition талбарын
// байгаа эсэх, алдааны төрөл) КАЛЛЕР бүрээр ТУГААР хадгалагдана. Тэдгээрийг
// нэгтгэх нь амьд веб урсгалын зан төлөвийг өөрчлөх тул зориудаар хийгээгүй —
// `TENANT_MOBILE_SLICES.md` P3-B2-ыг үзнэ үү.

import { logAudit } from "@/lib/audit";
import { normalizeWheelPosition } from "@/lib/hur_service";
import { resolveOwnerRegnumForNewVehicle } from "@/lib/hur-lookup";
import { PLAN_LIMIT_CODES } from "@/lib/plan-limits";
import { enforceCountLimit } from "@/lib/plan-limits-server";
import { prisma } from "@/lib/prisma";
import type { PrismaTransactionClient } from "@/lib/prisma";
import {
  ensureTenantVehicle,
  isValidVin,
  normalizePlate,
  normalizeVin,
  ownerFromCustomer,
  resolveVehicleForOwner,
} from "@/lib/vehicles";
import { isNoPlate } from "@/lib/vehicle-plate";

export type VehicleCommandActor = {
  id: string;
  tenantId: string;
};

export class VehicleCommandError extends Error {
  constructor(
    message: string,
    public readonly status = 422,
    public readonly code = "VEHICLE_COMMAND_REJECTED",
    public readonly fieldErrors?: Record<string, string>,
  ) {
    super(message);
    this.name = "VehicleCommandError";
  }
}

/** Тоон талбар — FormData-аас (string), JSON body-оос (number|string) ирж болно. */
type NumericInput = number | string | null | undefined;

export type VehicleCommandInput = {
  plate: string;
  vin?: string | null;
  make: string;
  model: string;
  year?: NumericInput;
  mileage?: NumericInput;
  fuelType?: string | null;
  /** Түүхий утга — команд дотор `normalizeWheelPosition`-оор нормчилно. */
  wheelPosition?: string | null;
  colorName?: string | null;
  capacity?: NumericInput;
  purpose?: string | null;
  ownerRegnum?: string | null;
  customerId?: string | null;
  isPostpaid?: boolean;
};

export type NormalizedVehicleData = {
  plate: string;
  vin: string | null;
  make: string;
  model: string;
  year: number | null;
  mileage: number | null;
  fuelType: string | null;
  wheelPosition: string | null;
  colorName: string | null;
  capacity: number | null;
  purpose: string | null;
  ownerRegnum: string | null;
  customerId: string | null;
  isPostpaid: boolean;
};

export type VehicleRecord = {
  id: string;
  plate: string;
  vin: string | null;
  make: string;
  model: string;
  year: number | null;
  mileage: number | null;
  fuelType: string | null;
  wheelPosition: string | null;
  colorName: string | null;
  capacity: number | null;
  purpose: string | null;
  ownerRegnum: string | null;
  /** Link-ийн БОДИТ эзэн — хүсэлтээр ирсэн customerId-оос ялгаатай байж болно. */
  customerId: string | null;
  isPostpaid: boolean;
};

export type ValidateVehicleOptions = {
  /**
   * Засахад: хадгалагдсан VIN. Илгээсэн VIN үүнтэй (нормчилсны дараа) ижил бол
   * форматын шалгалтыг алгасна — хуучин/HUR-аас ирсэн (15/16 тэмдэгт, I/O/Q,
   * 2 зураастай) VIN-тэй машиныг бусад талбарыг засахад түгжихгүй. Create-д
   * заахгүй (үргэлж шалгана).
   */
  existingVin?: string | null;
  /**
   * Он дээд хязгаар (2100) шалгах эсэх. Хуучин гурван хуулбар зөрсөн байсан:
   * dashboard action болон quick-create 1900–2100 хооронд шалгадаг байсан,
   * `POST /api/v1/vehicles` зөвхөн доод хязгаарыг (>=1900) шалгадаг байсан,
   * дээд хязгааргүй. Divergence 3 — нэгтгэхгүйгээр каллер бүрээр хадгална.
   * Анхны утга нь `true` (хатуу зам).
   */
  enforceYearUpperBound?: boolean;
  /**
   * `customerId` заавал эсэх. Divergence 1 — зөвхөн quick-create-д заавал
   * (машиныг үргэлж тодорхой Customer-т холбож бүртгэдэг учир). Dashboard
   * action болон API route-д сонголт.
   */
  requireCustomerId?: boolean;
};

function toTrimmedString(v: string | null | undefined): string {
  return (v ?? "").trim();
}

function parseIntField(
  raw: NumericInput,
  fieldErrors: Record<string, string>,
  key: string,
  label: string,
  bounds: { min?: number; max?: number },
): number | null {
  const str =
    typeof raw === "number"
      ? String(raw)
      : typeof raw === "string"
        ? raw.trim()
        : "";
  if (!str) return null;
  const cleaned = str.replace(/\s+/g, "");
  const n = Number.parseInt(cleaned, 10);
  if (!Number.isFinite(n)) {
    fieldErrors[key] = label;
    return null;
  }
  if (bounds.min !== undefined && n < bounds.min) {
    fieldErrors[key] = label;
    return null;
  }
  if (bounds.max !== undefined && n > bounds.max) {
    fieldErrors[key] = label;
    return null;
  }
  return n;
}

/**
 * Гурван оролтын нийтлэг validate/normalise дүрэм: улсын дугаар/марк/модел
 * заавал, он/гүйлт/багтаамж тоон хязгаартай, жолооны хүрдний тал зөвхөн
 * "Зүүн"/"Баруун" байж болно (нормчилсны дараа). Латин↔кирилл дугаарын
 * хөрвүүлэлт болон бусад канончилол `lib/vehicles.ts:normalizePlate`-д
 * үлдэнэ — устгах/шинэчлэхэд яг адилхан хэрэглэгдэнэ.
 */
export function validateVehicleInput(
  input: VehicleCommandInput,
  options: ValidateVehicleOptions = {},
): {
  data: NormalizedVehicleData;
  fieldErrors: Record<string, string>;
} {
  const fieldErrors: Record<string, string> = {};

  const plate = toTrimmedString(input.plate).toUpperCase();
  const vin = toTrimmedString(input.vin).toUpperCase();
  const make = toTrimmedString(input.make);
  const model = toTrimmedString(input.model);
  const fuelType = toTrimmedString(input.fuelType);
  const colorName = toTrimmedString(input.colorName);
  const purpose = toTrimmedString(input.purpose);
  const ownerRegnum = toTrimmedString(input.ownerRegnum);
  const customerId = toTrimmedString(input.customerId);
  const wheelPosition = normalizeWheelPosition(toTrimmedString(input.wheelPosition) || null);

  if (!plate) fieldErrors.plate = "Улсын дугаар оруулна уу.";
  // Дугааргүй машиныг зөвхөн VIN-ээр ялгана.
  if (isNoPlate(plate) && !vin) {
    fieldErrors.vin = "Улсын дугааргүй машинд арлын дугаар (VIN) заавал.";
  } else if (
    vin &&
    normalizeVin(vin) !== normalizeVin(options.existingVin) &&
    !isValidVin(vin)
  ) {
    fieldErrors.vin = "VIN 17 тэмдэгт эсвэл Япон рамын дугаар (9–14 тэмдэгт) байна.";
  }
  if (!make) fieldErrors.make = "Маркаа оруулна уу.";
  if (!model) fieldErrors.model = "Моделоо оруулна уу.";
  if (options.requireCustomerId && !customerId) {
    fieldErrors.customerId = "Үйлчлүүлэгч сонгох эсвэл нэмэх ёстой.";
  }

  const year = parseIntField(input.year, fieldErrors, "year", "Жил буруу.", {
    min: 1900,
    max: options.enforceYearUpperBound === false ? undefined : 2100,
  });
  const mileage = parseIntField(input.mileage, fieldErrors, "mileage", "Гүйлт буруу.", {
    min: 0,
  });
  const capacity = parseIntField(input.capacity, fieldErrors, "capacity", "Моторын хэмжээ буруу.", {
    min: 0,
  });

  if (wheelPosition && wheelPosition !== "Зүүн" && wheelPosition !== "Баруун") {
    fieldErrors.wheelPosition = "Жолооны хүрдний талыг буруу сонгосон.";
  }

  return {
    data: {
      plate,
      vin: vin || null,
      make,
      model,
      year,
      mileage,
      fuelType: fuelType || null,
      wheelPosition: wheelPosition || null,
      colorName: colorName || null,
      capacity,
      purpose: purpose || null,
      ownerRegnum: ownerRegnum || null,
      customerId: customerId || null,
      isPostpaid: input.isPostpaid ?? false,
    },
    fieldErrors,
  };
}

/**
 * Энэ tenant-д тухайн машинтай холбоотой засварын хуудас/оношилгоо байгаа
 * эсэх. Устгах болон эзэн солихыг хориглох нэг ижил шалгуур
 * (`app/_actions/vehicles.ts`-с шилжсэн, зан төлөв өөрчлөгдөөгүй).
 */
function isMaskedValue(v: string | null | undefined): boolean {
  return !!v && /[•*]/.test(v);
}

async function vehicleHasHistory(tenantId: string, vehicleId: string): Promise<boolean> {
  const [orderCount, reportCount] = await Promise.all([
    prisma.serviceOrder.count({ where: { tenantId, vehicleId } }),
    prisma.diagnosticReport.count({ where: { tenantId, vehicleId } }),
  ]);
  return orderCount > 0 || reportCount > 0;
}

async function loadVehicleRecord(
  client: PrismaTransactionClient,
  vehicleId: string,
  linkId: string,
): Promise<VehicleRecord> {
  const [vehicle, link] = await Promise.all([
    client.vehicle.findUniqueOrThrow({
      where: { id: vehicleId },
      select: {
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
      },
    }),
    client.tenantVehicle.findUniqueOrThrow({
      where: { id: linkId },
      select: { customerId: true, isPostpaid: true },
    }),
  ]);
  return { ...vehicle, customerId: link.customerId, isPostpaid: link.isPostpaid };
}

export async function createVehicleCommand(input: {
  actor: VehicleCommandActor;
  data: VehicleCommandInput;
  /**
   * Энэ tenant-д ижил дугаартай машин ЯГ энэ Customer-т (эсвэл эзэн
   * сонгоогүй бол эзэнгүй) аль хэдийн бүртгэлтэй бол татгалзах эсэх. Зөвхөн
   * dashboard-ын бүрэн create action үүнийг хийдэг байсан (D-151).
   */
  rejectDuplicate?: boolean;
  /** Он дээд хязгаарыг шалгах эсэх (Divergence 3, `validateVehicleInput`-руу дамжина). */
  enforceYearUpperBound?: boolean;
  /** `customerId` заавал эсэх (Divergence 1, `validateVehicleInput`-руу дамжина). */
  requireCustomerId?: boolean;
  /** Audit summary-д нэмэх тэмдэглэгээ (quick-create-ыг ялгахад). */
  auditSummarySuffix?: string;
  /**
   * Машиныг HUR/global lookup-аас бөглөж байгаа бол `true`. Регистр browser-д
   * огт гардаггүй (QA #17) тул оролтод `ownerRegnum` ирээгүй үед сервер талд
   * шийднэ (global Vehicle.ownerRegnum байвал HUR дуудахгүй).
   */
  resolveOwnerRegnum?: boolean;
}): Promise<VehicleRecord> {
  const { actor } = input;
  const { data, fieldErrors } = validateVehicleInput(input.data, {
    enforceYearUpperBound: input.enforceYearUpperBound,
    requireCustomerId: input.requireCustomerId,
  });
  if (Object.keys(fieldErrors).length > 0) {
    throw new VehicleCommandError("Хүсэлт буруу.", 422, "VALIDATION_FAILED", fieldErrors);
  }

  let orgRegnumKey: string | null = null;
  if (data.customerId) {
    const customer = await prisma.customer.findFirst({
      where: { id: data.customerId, tenantId: actor.tenantId },
      select: { id: true, isOrganization: true, orgRegnum: true },
    });
    if (!customer) {
      throw new VehicleCommandError("Хүсэлт буруу.", 422, "VALIDATION_FAILED", {
        customerId: "Үйлчлүүлэгч олдсонгүй.",
      });
    }
    if (customer.isOrganization && customer.orgRegnum) orgRegnumKey = customer.orgRegnum;
  }

  // `MAX_VEHICLES` — БҮХ entry point дээр шалгана (D-154, 2026-09-22
  // хэрэглэгчийн шийдвэр; D-151-ийг орлоно). Хязгаарын тойрч гарах зам
  // зориудаар хаагдсан тул түг байхгүй.
  const limit = await enforceCountLimit(
    actor.tenantId,
    PLAN_LIMIT_CODES.MAX_VEHICLES,
    () => prisma.tenantVehicle.count({ where: { tenantId: actor.tenantId } }),
  );
  if (!limit.allowed) {
    throw new VehicleCommandError(
      limit.message ?? "Машины хязгаарт хүрсэн байна.",
      422,
      "PLAN_LIMIT_REACHED",
    );
  }

  const canonPlate = normalizePlate(data.plate);

  if (input.rejectDuplicate) {
    // Дугааргүй машинууд бүгд ижил тэмдэгтэй тул давхардлыг VIN-ээр шалгана.
    const noPlate = isNoPlate(canonPlate);
    const duplicate = await prisma.tenantVehicle.findFirst({
      where: {
        tenantId: actor.tenantId,
        // Байгууллага: эзний түлхүүр = orgRegnum (ижил регистртэй өөр холбоо
        // барих хүн ч ижил эзэн); хүн: яг энэ customerId. resolveVehicleForOwner-той ижил.
        ...(orgRegnumKey
          ? { customer: { isOrganization: true, orgRegnum: orgRegnumKey } }
          : { customerId: data.customerId }),
        vehicle: noPlate ? { plate: canonPlate, vin: data.vin } : { plate: canonPlate },
      },
      select: { id: true },
    });
    if (duplicate) {
      throw new VehicleCommandError(
        "Хүсэлт буруу.",
        422,
        "VEHICLE_DUPLICATE",
        noPlate
          ? { vin: "Энэ арлын дугаартай (VIN) дугааргүй машин аль хэдийн бүртгэлтэй байна." }
          : {
              plate: data.customerId
                ? "Энэ үйлчлүүлэгчид ийм дугаартай машин аль хэдийн бүртгэлтэй байна."
                : "Энэ улсын дугаартай эзэнгүй машин аль хэдийн бүртгэлтэй байна.",
            },
      );
    }
  }

  const { customerId, isPostpaid, ...attrs } = data;

  // Lookup-аас үүсгэсэн, регистр ирээгүй бол сервер талд шийднэ. Маскалсан
  // утга хэзээ ч хадгалахгүй.
  if (isMaskedValue(attrs.ownerRegnum)) attrs.ownerRegnum = null;
  if (input.resolveOwnerRegnum && !attrs.ownerRegnum && !isNoPlate(canonPlate)) {
    try {
      attrs.ownerRegnum = await resolveOwnerRegnumForNewVehicle(canonPlate, actor.id);
    } catch {
      // HUR унасан бол машиныг регистргүй үүсгэнэ — create-ийг хаахгүй.
    }
  }

    const record = await prisma.$transaction(async (tx) => {
    const owner = await ownerFromCustomer(tx, actor.tenantId, customerId);
    const vehicle = await resolveVehicleForOwner(tx, { ...attrs, owner });
    const link = await ensureTenantVehicle(tx, {
      tenantId: actor.tenantId,
      vehicleId: vehicle.id,
      customerId,
    });
    if (vehicle.plateChanged) {
      // Глобал мөрийн өөрчлөлт — транзакцийн дотор аудит бичнэ.
      await logAudit(
        {
          tenantId: actor.tenantId,
          userId: actor.id,
          entity: "Vehicle",
          entityId: link.id,
          action: "UPDATE",
          summary: `Дугаар солигдсон (VIN-ээр ижил машин): ${vehicle.plateChanged.from} → ${vehicle.plateChanged.to}`,
          before: { plate: vehicle.plateChanged.from },
          after: { plate: vehicle.plateChanged.to },
        },
        tx,
      );
    }
    if (isPostpaid) {
      await tx.tenantVehicle.update({ where: { id: link.id }, data: { isPostpaid } });
    }
    return loadVehicleRecord(tx, vehicle.id, link.id);
  });

  await logAudit({
    tenantId: actor.tenantId,
    userId: actor.id,
    entity: "Vehicle",
    entityId: record.id,
    action: "CREATE",
    summary: input.auditSummarySuffix
      ? `${data.plate} · ${data.make} ${data.model} ${input.auditSummarySuffix}`
      : `${data.plate} · ${data.make} ${data.model}`,
    after: { ...data, customerId: record.customerId },
  });

  return record;
}

export async function updateVehicleCommand(input: {
  actor: VehicleCommandActor;
  vehicleId: string;
  data: VehicleCommandInput;
  enforceYearUpperBound?: boolean;
}): Promise<VehicleRecord> {
  const { actor, vehicleId } = input;
  // VIN-ийн форматыг зөвхөн өөрчилсөн үед шалгана (хуучин VIN-тэй машин засагдана).
  const storedLink = await prisma.tenantVehicle.findUnique({
    where: { tenantId_vehicleId: { tenantId: actor.tenantId, vehicleId } },
    select: { vehicle: { select: { vin: true } } },
  });
  const stored = storedLink?.vehicle ?? null;
  const { data, fieldErrors } = validateVehicleInput(input.data, {
    enforceYearUpperBound: input.enforceYearUpperBound,
    existingVin: stored?.vin ?? null,
  });
  if (Object.keys(fieldErrors).length > 0) {
    throw new VehicleCommandError("Хүсэлт буруу.", 422, "VALIDATION_FAILED", fieldErrors);
  }

  // Улсын дугаар бүртгэсний дараа ХӨДӨЛШГҮЙ — оролтын plate-г үл тооно.
  // Ганц үл хамаарах зүйл: дугааргүй (NO_PLATE) машинд дараа нь жинхэнэ
  // дугаар НЭГ удаа оноож болно (доор).
  const { customerId, isPostpaid, plate: inputPlate, ...attrs } = data;

  const link = await prisma.tenantVehicle.findUnique({
    where: { tenantId_vehicleId: { tenantId: actor.tenantId, vehicleId } },
    select: { id: true, customerId: true },
  });
  if (!link) {
    throw new VehicleCommandError("Машин олдсонгүй.", 404, "VEHICLE_NOT_FOUND");
  }

  if (customerId) {
    const customer = await prisma.customer.findFirst({
      where: { id: customerId, tenantId: actor.tenantId },
      select: { id: true },
    });
    if (!customer) {
      throw new VehicleCommandError("Хүсэлт буруу.", 422, "VALIDATION_FAILED", {
        customerId: "Үйлчлүүлэгч олдсонгүй.",
      });
    }
  }

  // Эзэн солих = засварын түүх өөр хүнд шилжих. Түүхтэй бол хориглоно.
  if (customerId !== link.customerId && (await vehicleHasHistory(actor.tenantId, vehicleId))) {
    throw new VehicleCommandError(
      "Хүсэлт буруу.",
      422,
      "VEHICLE_OWNER_CHANGE_BLOCKED",
      {
        customerId:
          "Засварын түүхтэй машины эзнийг солих боломжгүй — шинэ эзэн бол машиныг шинээр бүртгэнэ.",
      },
    );
  }

  const current = await prisma.vehicle.findUnique({ where: { id: vehicleId }, select: { plate: true } });
  const assignPlate =
    current != null && isNoPlate(current.plate) && inputPlate && !isNoPlate(inputPlate)
      ? normalizePlate(inputPlate)
      : null;
  // Дугааргүй хэвээр бол VIN-гүй болгохгүй (validateVehicleInput-ийн дүрэм —
  // оролтын plate биш, хадгалагдсан plate-ээр шалгана).
  if (current && isNoPlate(current.plate) && !assignPlate && !attrs.vin) {
    throw new VehicleCommandError("Хүсэлт буруу.", 422, "VALIDATION_FAILED", {
      vin: "Улсын дугааргүй машинд арлын дугаар (VIN) заавал.",
    });
  }

  const record = await prisma.$transaction(async (tx) => {
    await tx.vehicle.update({
      where: { id: vehicleId },
      data: { ...attrs, ...(assignPlate ? { plate: assignPlate } : {}) },
    });
    await tx.tenantVehicle.update({
      where: { id: link.id },
      data: { customerId, isPostpaid },
    });
    return loadVehicleRecord(tx, vehicleId, link.id);
  });

  await logAudit({
    tenantId: actor.tenantId,
    userId: actor.id,
    entity: "Vehicle",
    entityId: vehicleId,
    action: "UPDATE",
    summary: `${data.plate} · ${data.make} ${data.model}`,
    after: { ...data, customerId: record.customerId },
  });

  return record;
}

export async function deleteVehicleCommand(input: {
  actor: VehicleCommandActor;
  vehicleId: string;
}): Promise<{ id: string; plate: string | null; make: string | null; model: string | null }> {
  const { actor, vehicleId } = input;

  // Устгах нь зөвхөн ЭНЭ tenant-ийн TenantVehicle link-ийг хасна — global
  // Vehicle болон бусад tenant-ийн link/түүх хадгалагдана.
  const target = await prisma.vehicle.findUnique({
    where: { id: vehicleId },
    select: { plate: true, make: true, model: true },
  });

  if (await vehicleHasHistory(actor.tenantId, vehicleId)) {
    throw new VehicleCommandError(
      "Энэ машинтай холбоотой засварын хуудас байгаа тул устгах боломжгүй.",
      409,
      "VEHICLE_IN_USE",
    );
  }

  const removed = await prisma.tenantVehicle.deleteMany({
    where: { tenantId: actor.tenantId, vehicleId },
  });
  if (removed.count === 0) {
    throw new VehicleCommandError("Машин олдсонгүй.", 404, "VEHICLE_NOT_FOUND");
  }

  await logAudit({
    tenantId: actor.tenantId,
    userId: actor.id,
    entity: "Vehicle",
    entityId: vehicleId,
    action: "DELETE",
    summary: target ? `${target.plate} · ${target.make} ${target.model}` : null,
  });

  return {
    id: vehicleId,
    plate: target?.plate ?? null,
    make: target?.make ?? null,
    model: target?.model ?? null,
  };
}
