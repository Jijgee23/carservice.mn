import type { Prisma } from "@/app/generated/prisma/client";
import { normalizePhone } from "@/lib/phone";
import { prisma } from "@/lib/prisma";
import type { PrismaTransactionClient } from "@/lib/prisma";
import { isNoPlate, normalizePlate } from "@/lib/vehicle-plate";

type Client = PrismaTransactionClient;

/**
 * Утсаар тааруулах нөхцөл — DB-д хадгалагдсан дугаар өөр форматтай (+976…)
 * байж болзошгүй тул яг тэнцүү ЭСВЭЛ төгсгөл тохирохыг хоёуланг нь шалгана
 * (lib/appointments.ts resolveCustomerForAccount-тай ижил зарчим).
 * Хоосон/хүчингүй утас → null (endsWith:"" бүхэнд таарах тул ХЭЗЭЭ Ч үүсгэхгүй).
 */
function phoneMatch(phone: string | null | undefined): Prisma.StringFilter[] | null {
  const canon = normalizePhone(phone);
  if (!canon) return null;
  return [{ equals: canon }, { endsWith: canon }];
}

/**
 * Account-ийн БАТАЛГААЖСАН эзэмшлийн машины ID-үүд (cross-tenant) —
 * үйлчилгээ/оношилгооны түүх бүтээхэд ашиглана. `AccountVehicle` өөрөө
 * claim хийдэг тул эзэмшлийн нотолгоо БОЛОХГҮЙ (харах: prisma/schema.prisma
 * AccountVehicle) — зөвхөн TenantVehicle дэх Customer.accountId холбоос
 * эсвэл утасны тохирлыг эзэмшил гэж үзнэ.
 */
export async function ownedVehicleIdsForAccount(
  accountId: string,
  phone: string,
): Promise<string[]> {
  const links = await prisma.tenantVehicle.findMany({
    where: { OR: customerOwnershipFilters(accountId, phone) },
    select: { vehicleId: true },
    distinct: ["vehicleId"],
  });
  return links.map((l) => l.vehicleId);
}

/**
 * "Энэ Customer энэ account-ийнх" гэх OR нөхцөлүүд — `customer` relation-тай
 * дурын модель (TenantVehicle, ServiceOrder, DiagnosticReport, Appointment)
 * дээр ашиглана. Засварын түүх зөвхөн эзэнд харагдах дүрэм: захиалга/тайлан
 * нь account-той холбоотой (accountId эсвэл утас) Customer-ийнх байх ёстой.
 * Ингэснээр хуучин (миграцаар салгаагүй) олон эзэнтэй Vehicle мөр дээр ч өөр
 * эзний захиалга харагдахгүй.
 */
export function customerOwnershipFilters(
  accountId: string,
  phone: string | null | undefined,
): { customer: Prisma.CustomerWhereInput }[] {
  const or: { customer: Prisma.CustomerWhereInput }[] = [
    { customer: { accountId } },
  ];
  const pm = phoneMatch(phone);
  if (pm) or.push(...pm.map((phone) => ({ customer: { phone } })));
  return or;
}

// Vehicle-д бичигдэх машины бие даасан/тогтмол шинж (харьяалал биш).
export type VehicleAttrs = {
  make: string;
  model: string;
  year?: number | null;
  vin?: string | null;
  fuelType?: string | null;
  wheelPosition?: string | null;
  colorName?: string | null;
  capacity?: number | null;
  purpose?: string | null;
  ownerRegnum?: string | null;
  mileage?: number | null;
};

// normalizePlate нь prisma-гүй `lib/vehicle-plate.ts`-д (pure query builder-ууд
// ашиглана); энд дахин экспортолно.
export { normalizePlate };

/**
 * Global Vehicle бичлэгийг HUR lookup-ийн хариутай ижил (PublicHurVehicle)
 * хэлбэрт хөрвүүлнэ. Шинэ машин бүртгэхэд дугаараар нь системд аль хэдийн
 * бүртгэлтэй бол HUR дуудалгүйгээр талбаруудыг үүгээр бөглөнө.
 */
export function vehicleToLookupInfo(v: {
  plate: string;
  make: string;
  model: string;
  year: number | null;
  vin: string | null;
  fuelType: string | null;
  wheelPosition: string | null;
  colorName: string | null;
  capacity: number | null;
  purpose: string | null;
}) {
  return {
    plate: v.plate,
    make: v.make,
    model: v.model,
    year: v.year,
    vin: v.vin,
    color: v.colorName,
    country: null,
    fuelType: v.fuelType,
    capacity: v.capacity,
    className: null,
    importDate: null,
    wheelPosition: v.wheelPosition,
    purpose: v.purpose,
  };
}

export function normalizeVin(v: string | null | undefined): string | null {
  const t = (v ?? "").trim().toUpperCase();
  return t || null;
}

/** 17 тэмдэгт ISO VIN (I/O/Q-гүй) эсвэл Япон рамын дугаар (нэг зураастай, зураасгүй 9–14 тэмдэгт). */
export function isValidVin(v: string): boolean {
  const t = v.trim().toUpperCase();
  if (/^[A-HJ-NPR-Z0-9]{17}$/.test(t)) return true;
  if (!/^[A-Z0-9]+(-[A-Z0-9]+)?$/.test(t)) return false;
  const len = t.replace(/-/g, "").length;
  return len >= 9 && len <= 14;
}

// Олдсон машины хоосон талбарыг шинэ мэдээллээр баяжуулна (байгаа утгыг
// дарж бичихгүй); mileage-г илүү ихээр шинэчилнэ. plate-г ХӨНДӨХГҮЙ (дугаар
// солих ганц зам нь resolveVehicleForOwner-ийн VIN-ээр олдсон тохиолдол).
function enrichData(
  existing: {
    vin: string | null;
    year: number | null;
    fuelType: string | null;
    wheelPosition: string | null;
    colorName: string | null;
    capacity: number | null;
    purpose: string | null;
    ownerRegnum: string | null;
    mileage: number | null;
  },
  vin: string | null,
  attrs: VehicleAttrs,
): Prisma.VehicleUpdateInput {
  const pick = <T>(cur: T | null, next: T | null | undefined): T | null =>
    cur ?? next ?? null;
  const mileage =
    attrs.mileage != null
      ? Math.max(existing.mileage ?? 0, attrs.mileage)
      : existing.mileage;
  return {
    vin: existing.vin ?? vin,
    year: pick(existing.year, attrs.year),
    fuelType: pick(existing.fuelType, attrs.fuelType),
    wheelPosition: pick(existing.wheelPosition, attrs.wheelPosition),
    colorName: pick(existing.colorName, attrs.colorName),
    capacity: pick(existing.capacity, attrs.capacity),
    purpose: pick(existing.purpose, attrs.purpose),
    ownerRegnum: pick(existing.ownerRegnum, attrs.ownerRegnum),
    mileage,
  };
}

/**
 * Машины эзэмшигч — Vehicle мөрийг "хэнийх" гэж тааруулах түлхүүрүүд.
 *  - tenantId + customerId: ажилтан tenant-ийнхаа Customer-т бүртгэж байна.
 *  - accountId / phone: хэрэглэгчийн app account, эсвэл Customer-ийн
 *    account холбоос/утас (cross-tenant ижил эзнийг таних).
 */
export type VehicleOwner = {
  tenantId?: string | null;
  customerId?: string | null;
  accountId?: string | null;
  phone?: string | null;
  /** Байгууллага Customer-ийн 7 оронтой регистр — байвал утасны оронд эзний түлхүүр болно. */
  orgRegnum?: string | null;
};

/**
 * Эзэмшигчийн дугаараар нь бүртгэлтэй Vehicle мөрийг тааруулах WHERE.
 * Тохирох дараалал (аль нэг нь таарвал хангалттай):
 *  1. Энэ tenant-д яг энэ Customer-т link-тэй.
 *  2. accountId: AccountVehicle эсвэл Customer.accountId тэнцүү.
 *  3. Утас: Account.phone / Customer.phone тохирох — гэхдээ ЗӨВХӨН account
 *     холбоосгүй талд (хоёулаа accountId-тай байгаад зөрвөл өөр хүн).
 * Хоосон/null утгаар нөхцөл ХЭЗЭЭ Ч үүсгэхгүй (`accountId: null` бүх walk-in-д,
 * `endsWith: ""` бүхэнд таарна).
 * Энэ tenant-д ӨӨР (null биш) Customer-т link-тэй мөрийг хасна — тэр мөр өөр
 * эзний бүртгэл; түүн рүү холбовол захиалгын форм "машин сонгосон
 * үйлчлүүлэгчийнх биш" гэж мухардана.
 */
function ownerMatchWhere(
  plate: string | null,
  owner: VehicleOwner,
): Prisma.VehicleWhereInput | null {
  const or: Prisma.VehicleWhereInput[] = [];
  const tenantId = owner.tenantId || null;
  const customerId = owner.customerId || null;
  const accountId = owner.accountId || null;
  const orgRegnum = owner.orgRegnum || null;
  // Байгууллагын эзний түлхүүр = orgRegnum (утас БИШ) — өөр холбоо барих
  // хүнтэй ч ижил регистртэй Customer-ийн машин ижил эзэнд тооцогдоно.
  const pm = orgRegnum ? null : phoneMatch(owner.phone);

  if (orgRegnum) {
    or.push({
      tenantLinks: {
        // Зөвхөн ажиллаж буй tenant-ийн link — orgRegnum дангаараа tenant дамнасан
        // эзэмшил болохгүй.
        some: { ...(tenantId ? { tenantId } : {}), customer: { isOrganization: true, orgRegnum } },
      },
    });
  }
  if (tenantId && customerId) {
    or.push({ tenantLinks: { some: { tenantId, customerId } } });
  }
  if (accountId) {
    or.push({ accountLinks: { some: { accountId } } });
    or.push({ tenantLinks: { some: { customer: { accountId } } } });
  }
  if (pm) {
    for (const phone of pm) {
      // Account-той эзэн: account холбоосгүй Customer-ийг л утсаар тааруулна;
      // account холбоотой Customer-ийг accountId-аар дээр шалгасан.
      or.push({
        tenantLinks: {
          some: {
            customer: accountId ? { phone, accountId: null } : { phone },
          },
        },
      });
      // Account-гүй эзэн (tenant Customer): утас нь тохирсон Account-ийн
      // өөрөө нэмсэн машин. Account-той бол accountId-аар аль хэдийн шалгасан.
      if (!accountId) {
        or.push({ accountLinks: { some: { account: { phone } } } });
      }
    }
  }
  if (or.length === 0) return null;

  const where: Prisma.VehicleWhereInput = plate ? { plate, OR: or } : { OR: or };
  if (tenantId) {
    // Байгууллага: ижил orgRegnum-тай ӨӨР Customer-т link-тэй мөр мөн ижил эзэн.
    const sameOrg: Prisma.TenantVehicleWhereInput[] = orgRegnum
      ? [{ NOT: { customer: { isOrganization: true, orgRegnum } } }]
      : [];
    where.NOT = {
      tenantLinks: {
        some: {
          tenantId,
          customerId: { not: null },
          ...(customerId || sameOrg.length
            ? {
                AND: [
                  ...(customerId ? [{ NOT: { customerId } }] : []),
                  ...sameOrg,
                ],
              }
            : {}),
        },
      },
    };
  }
  return where;
}

/**
 * Эзэмшигчийн Vehicle мөрийг олж эсвэл шинээр үүсгэнэ.
 *
 *  - Ижил дугаартай, ИЖИЛ эзэнд (ownerMatchWhere) бүртгэлтэй мөр байвал түүнийг
 *    буцааж хоосон талбарыг баяжуулна (plate хөндөхгүй).
 *  - Олдохгүй, эсвэл `owner` байхгүй (эзэнгүй бүртгэл) бол ШИНЭ мөр үүсгэнэ —
 *    ижил дугаартай өөр эзний мөр байсан ч хамаагүй (машин зарагдсан гэж үзнэ;
 *    түүх өмнөх мөрөнд үлдэнэ).
 *
 * Транзакц client дамжуулж дуудах нь зөв — TenantVehicle/AccountVehicle link-тэй
 * нэг атомт үйлдэл болгоно.
 */
export async function resolveVehicleForOwner(
  client: Client,
  input: { plate: string; owner: VehicleOwner | null } & VehicleAttrs,
): Promise<{ id: string; created: boolean; plateChanged?: { from: string; to: string } }> {
  const plate = normalizePlate(input.plate);
  const vin = normalizeVin(input.vin);
  const attrs = input;

  const noPlate = isNoPlate(plate);
  // Дугааргүй машинууд бүгд ижил тэмдэгтэй тул ЗӨВХӨН ижил VIN-тэйг нэг машин
  // гэж үзнэ — эс бөгөөс нэг эзний өөр өөр дугааргүй машин нэгтгэгдэнэ.
  const ownerWhere = input.owner ? ownerMatchWhere(plate, input.owner) : null;
  const where = ownerWhere && noPlate ? (vin ? { ...ownerWhere, vin } : null) : ownerWhere;
  // Option A: хүчинтэй VIN + ижил эзэн → дугаар солигдсон ч ижил машин.
  const vinOwnerWhere =
    vin && isValidVin(vin) && input.owner ? ownerMatchWhere(null, input.owner) : null;
  // Vehicle нь глобал (unique constraint-гүй) тул ижил дугаарын зэрэгцээ
  // "шалгаад үүсгэх" хоёр хүсэлт давхар мөр үүсгэж болно. Advisory xact lock
  // авч цувуулна (дараалал: VIN, дараа нь дугаар) — транзакц дуусахад суллагдана.
  if (vinOwnerWhere) {
    await client.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`vehicle-vin:${vin}`}))`;
  }
  if (where && !noPlate) {
    await client.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`vehicle-plate:${plate}`}))`;
  } else if (where && !vinOwnerWhere) {
    await client.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`vehicle-vin:${vin}`}))`;
  }
  const select = {
    id: true,
    plate: true,
    vin: true,
    year: true,
    fuelType: true,
    wheelPosition: true,
    colorName: true,
    capacity: true,
    purpose: true,
    ownerRegnum: true,
    mileage: true,
  } as const;
  // I3: ижил дугаар+эзний мөр байвал түүнийг дахин ашиглана (давхар дугаартай
  // мөр үүсгэхгүй); VIN-ээр нэрлэн солих нь зөвхөн дугаарын мөр байхгүй үед.
  const byPlate = where
    ? await client.vehicle.findFirst({
        where,
        orderBy: { createdAt: "desc" },
        select,
      })
    : null;
  // C1: глобал Vehicle мөрийг VIN-ээр дахин ашиглах/дугаар солих нь ЗӨВХӨН бусад
  // tenant/account найдаагүй мөрөнд зөвшөөрөгдөнө.
  let byVin: Awaited<ReturnType<typeof client.vehicle.findFirst<{ select: typeof select }>>> = null;
  if (!byPlate && vinOwnerWhere && input.owner) {
    const tenantId = input.owner.tenantId || null;
    const accountId = input.owner.accountId || null;
    const scope: Prisma.VehicleWhereInput[] = [];
    if (tenantId) {
      // `every` нь 0 link дээр хоосон үнэн тул `some` + account link-гүй байхыг
      // нэмж шалгана (customer-app-only мөрийг tenant нэрлэн солиж чадахгүй).
      scope.push({ tenantLinks: { every: { tenantId } } });
      scope.push({ tenantLinks: { some: { tenantId } } });
      scope.push({ accountLinks: { none: {} } });
    } else if (accountId) {
      scope.push({ tenantLinks: { every: { customer: { accountId } } } });
      scope.push({
        OR: [{ tenantLinks: { some: {} } }, { accountLinks: { some: { accountId } } }],
      });
      scope.push({ accountLinks: { every: { accountId } } });
    }
    if (scope.length > 0) {
      byVin = await client.vehicle.findFirst({
        where: { ...vinOwnerWhere, vin, AND: scope },
        orderBy: { createdAt: "desc" },
        select,
      });
    }
  }
  const existing = byPlate ?? byVin;

  if (existing) {
    // Дугаар солигдсон (VIN-ээр олдсон): жинхэнэ шинэ дугаар бол шинэчилнэ.
    // Өмнөх захиалгын дугаар ServiceOrder.plateSnapshot-д хадгалагдсан.
    const plateChanged =
      byVin && !noPlate && existing.plate !== plate
        ? { from: existing.plate, to: plate }
        : undefined;
    await client.vehicle.update({
      where: { id: existing.id },
      data: {
        ...enrichData(existing, vin, attrs),
        ...(plateChanged ? { plate } : {}),
      },
    });
    return { id: existing.id, created: false, ...(plateChanged ? { plateChanged } : {}) };
  }

  const created = await client.vehicle.create({
    data: {
      plate,
      vin,
      make: attrs.make,
      model: attrs.model,
      year: attrs.year ?? null,
      fuelType: attrs.fuelType ?? null,
      wheelPosition: attrs.wheelPosition ?? null,
      colorName: attrs.colorName ?? null,
      capacity: attrs.capacity ?? null,
      purpose: attrs.purpose ?? null,
      ownerRegnum: attrs.ownerRegnum ?? null,
      mileage: attrs.mileage ?? null,
    },
    select: { id: true },
  });
  return { id: created.id, created: true };
}

/**
 * Tenant Customer-ийн эзэмшигч түлхүүрүүдийг уншина (resolveVehicleForOwner-д
 * дамжуулахад). Customer энэ tenant-д байхгүй бол null.
 */
export async function ownerFromCustomer(
  client: Client,
  tenantId: string,
  customerId: string | null | undefined,
): Promise<VehicleOwner | null> {
  if (!customerId) return null;
  const c = await client.customer.findFirst({
    where: { id: customerId, tenantId },
    select: {
      id: true,
      accountId: true,
      phone: true,
      isOrganization: true,
      orgRegnum: true,
    },
  });
  if (!c) return null;
  return {
    tenantId,
    customerId: c.id,
    accountId: c.accountId,
    phone: c.phone,
    orgRegnum: c.isOrganization && c.orgRegnum ? c.orgRegnum : null,
  };
}

/**
 * Tenant ↔ Vehicle link-ийг олж/үүсгэнэ. customerId-г ЗӨВХӨН link-д эзэн
 * байхгүй үед тавина — байгаа эзнийг дарж бичихгүй (эзэн солигдвол засварын
 * түүх шинэ хүнд шилжих ёсгүй; шинэ эзэнд шинэ Vehicle мөр бүртгэнэ).
 * Буцаах `customerId` = link-ийн БОДИТ эзэн (дамжуулснаас өөр байж болно).
 */
export async function ensureTenantVehicle(
  client: Client,
  input: { tenantId: string; vehicleId: string; customerId?: string | null },
): Promise<{ id: string; customerId: string | null }> {
  const { tenantId, vehicleId } = input;
  const customerId = input.customerId ?? null;
  const link = await client.tenantVehicle.upsert({
    where: { tenantId_vehicleId: { tenantId, vehicleId } },
    create: { tenantId, vehicleId, customerId },
    update: {},
    select: { id: true, customerId: true },
  });
  if (customerId && !link.customerId) {
    await client.tenantVehicle.update({
      where: { id: link.id },
      data: { customerId },
    });
    return { id: link.id, customerId };
  }
  return link;
}
