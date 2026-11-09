// Засварын хуудсыг «улсын дугаар бичээд л» үүсгэх урсгалын нийтлэг төрөл,
// FormData задлагч. Client/server аль алинд ашиглагдана — prisma импортлохгүй.
// Сервер тал: lib/orders/plate-intake-server.ts.

import { normalizePhone } from "@/lib/phone";
import { isNoPlate, normalizePlate } from "@/lib/vehicle-plate";

/** Lookup-аас ирэх машины техникийн мэдээлэл (эзэмшигчийн PII-гүй). */
export type PlateLookupVehicle = {
  make: string;
  model: string;
  year: number | null;
  vin: string | null;
  fuelType: string | null;
  wheelPosition: string | null;
};

/** Энэ tenant-д тухайн дугаартай бүртгэлтэй машин (эзэмшигч тус бүрт нэг мөр). */
export type TenantPlateMatch = {
  vehicleId: string;
  customerId: string;
  customerName: string;
  /** Tenant-ийн өөрийн үйлчлүүлэгч тул ажилтанд бүтнээр харагдана (жагсаалттай адил). */
  customerPhone: string;
  isPostpaid: boolean;
  ownerIsOrganization: boolean;
  vehicle: PlateLookupVehicle;
};

export type PlateLookupResult =
  | { kind: "tenant"; plate: string; matches: TenantPlateMatch[] }
  | { kind: "known"; plate: string; source: "global" | "hur"; vehicle: PlateLookupVehicle }
  | { kind: "notFound"; plate: string; reason: "not_found" | "hur_error" | "rate_limited" };

/** Бүртгэлгүй дугаараар шинэ үйлчлүүлэгч/машин бүртгэх оролт. */
export type PlateIntakeInput = {
  plate: string;
  phone: string;
  fullName: string;
  vehicle: PlateLookupVehicle;
  /** Машины мэдээлэл lookup-аас ирсэн — эзэмшигчийн регистрийг сервер шийднэ. */
  fromLookup: boolean;
};

function str(fd: FormData, key: string): string {
  const v = fd.get(key);
  return typeof v === "string" ? v.trim() : "";
}

/**
 * `intakeMode=plate` бөгөөд бүртгэлтэй машин сонгоогүй үеийн талбаруудыг
 * задлана. Алдааны түлхүүр нь маягтын талбарын нэртэй ижил
 * (plate / phone / make / model).
 */
export function parsePlateIntakeForm(fd: FormData): {
  input: PlateIntakeInput;
  errors: Record<string, string>;
} {
  const plate = normalizePlate(str(fd, "plate"));
  const phone = normalizePhone(str(fd, "phone")) ?? "";
  const yearNum = Number.parseInt(str(fd, "year"), 10);
  const input: PlateIntakeInput = {
    plate,
    phone,
    fullName: str(fd, "fullName"),
    vehicle: {
      make: str(fd, "make"),
      model: str(fd, "model"),
      year: Number.isFinite(yearNum) ? yearNum : null,
      vin: str(fd, "vin") || null,
      fuelType: str(fd, "fuelType") || null,
      wheelPosition: str(fd, "wheelPosition") || null,
    },
    fromLookup: str(fd, "fromLookup") === "1",
  };

  const errors: Record<string, string> = {};
  if (!plate || isNoPlate(plate)) errors.plate = "Улсын дугаараа оруулна уу.";
  if (!str(fd, "phone")) errors.phone = "Үйлчлүүлэгчийн утсыг оруулна уу.";
  else if (!phone) errors.phone = "Утасны дугаар 8 оронтой тоо байх ёстой.";
  if (!input.vehicle.make) errors.make = "Маркаа оруулна уу.";
  if (!input.vehicle.model) errors.model = "Загвараа оруулна уу.";
  return { input, errors };
}
