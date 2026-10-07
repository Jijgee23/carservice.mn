"use server";

import { revalidatePath } from "next/cache";
import { Prisma } from "@/app/generated/prisma/client";
import { requireAccount } from "@/lib/auth/account";
import { prisma } from "@/lib/prisma";
import { refreshVehicleFieldsFromHur } from "@/lib/vehicle-hur-refresh";
import { resolveVehicleForOwner } from "@/lib/vehicles";

export type CreatedAccountVehicle = {
  id: string; // AccountVehicle link id
  vehicleId: string; // global Vehicle id
  plate: string;
  make: string;
  model: string;
};

export type QuickCreateAccountVehicleResult = {
  ok: boolean;
  vehicle?: CreatedAccountVehicle;
  fieldErrors?: Record<string, string>;
  message?: string;
};

/**
 * Хэрэглэгчийн машин нэмэх. Inline form-оос (booking + account) дуудна — үүсгэсэн
 * машиныг буцаах тул form-state биш энгийн async функц.
 */
export async function quickCreateAccountVehicle(input: {
  plate: string;
  make: string;
  model: string;
  year?: string | null;
  vin?: string | null;
  fuelType?: string | null;
  wheelPosition?: string | null;
  colorName?: string | null;
  capacity?: string | null;
  purpose?: string | null;
}): Promise<QuickCreateAccountVehicleResult> {
  const account = await requireAccount();

  const plate = (input.plate ?? "").trim();
  const make = (input.make ?? "").trim();
  const model = (input.model ?? "").trim();
  const yearRaw = (input.year ?? "").toString().trim();
  const vin = (input.vin ?? "").toString().trim();
  const fuelType = (input.fuelType ?? "").toString().trim();
  const wheelPosition = (input.wheelPosition ?? "").toString().trim();
  const colorName = (input.colorName ?? "").toString().trim();
  const purpose = (input.purpose ?? "").toString().trim();
  const capacityRaw = (input.capacity ?? "").toString().trim();

  const fieldErrors: Record<string, string> = {};
  if (!plate) fieldErrors.plate = "Улсын дугаар оруулна уу.";
  if (!make) fieldErrors.make = "Марк оруулна уу.";
  if (!model) fieldErrors.model = "Загвар оруулна уу.";

  let year: number | null = null;
  if (yearRaw) {
    const n = Number.parseInt(yearRaw, 10);
    if (!Number.isFinite(n) || n < 1950 || n > 2100) {
      fieldErrors.year = "Он буруу.";
    } else {
      year = n;
    }
  }

  let capacity: number | null = null;
  if (capacityRaw) {
    const n = Number.parseInt(capacityRaw.replace(/\s+/g, ""), 10);
    if (Number.isFinite(n) && n >= 0) capacity = n;
  }

  if (Object.keys(fieldErrors).length > 0) return { ok: false, fieldErrors };

  try {
    // Энэ эзний Vehicle мөрийг resolve хийж (өөр эзний ижил дугаартай мөр
    // байвал шинээр), account-той нимгэн link үүсгэнэ.
    const v = await prisma.$transaction(async (tx) => {
      const vehicle = await resolveVehicleForOwner(tx, {
        plate,
        vin: vin || null,
        make,
        model,
        year,
        fuelType: fuelType || null,
        wheelPosition: wheelPosition || null,
        colorName: colorName || null,
        capacity,
        purpose: purpose || null,
        owner: { accountId: account.id, phone: account.phone },
      });
      if (vehicle.plateChanged) {
        // AuditLog tenant-д хамаарах тул account замд бүтэцтэй серверийн лог.
        console.info("[vehicle] plate changed via account re-registration", {
          vehicleId: vehicle.id,
          accountId: account.id,
          from: vehicle.plateChanged.from,
          to: vehicle.plateChanged.to,
        });
      }
      const link = await tx.accountVehicle.create({
        data: { accountId: account.id, vehicleId: vehicle.id },
        select: { id: true },
      });
      const full = await tx.vehicle.findUniqueOrThrow({
        where: { id: vehicle.id },
        select: { plate: true, make: true, model: true },
      });
      return { id: link.id, vehicleId: vehicle.id, ...full };
    });
    revalidatePath("/account");
    return { ok: true, vehicle: v };
  } catch (e) {
    // plate unique биш болсон тул P2002 зөвхөн AccountVehicle давхардалд буудна.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return { ok: false, fieldErrors: { plate: "Энэ машин таны жагсаалтад аль хэдийн байна." } };
    }
    return {
      ok: false,
      message: e instanceof Error ? e.message : "Алдаа гарлаа.",
    };
  }
}

export type RefreshVehicleFromHurResult =
  | { ok: true }
  | { ok: false; message: string };

/**
 * Машины дэлгэрэнгүй хуудаснаас (`/account/vehicles/[id]`) гар аргаар
 * HUR-аас дахин татаж, глобал Vehicle-ийн бие даасан шинжийг (марк, загвар,
 * он, VIN, шатахуун, жолооны хүрд, өнгө, багтаамж, зориулалт) шинэчилнэ —
 * `dashboard/vehicles/vehicle-form.tsx`-ийн HUR refresh-тэй ижил өгөгдлийн
 * эх сурвалж, гэхдээ энд ЭЦСИЙН хадгалалт нэг товчинд шууд ордог (тусад нь
 * "Хадгалах" алхамгүй) — хуудсанд өөр редакторлох форм байхгүй тул.
 * Дугаар (plate)-ыг ЗОРИУДЛАН өөрчлөхгүй: энэ бол "мэдээлэл шинэчлэх", "дугаар
 * солих" биш үйлдэл — резолвлогдох машин (== одоогийн дугаараар HUR лүүс
 * татна) яг энэ мөн адил байх ёстой.
 */
export async function refreshVehicleFromHur(
  vehicleId: string,
): Promise<RefreshVehicleFromHurResult> {
  const account = await requireAccount();

  const vehicle = await prisma.vehicle.findFirst({
    where: {
      id: vehicleId,
      OR: [
        { accountLinks: { some: { accountId: account.id } } },
        { tenantLinks: { some: { customer: { accountId: account.id } } } },
        {
          tenantLinks: {
            some: { customer: { phone: { endsWith: account.phone } } },
          },
        },
      ],
    },
    select: { id: true, plate: true },
  });
  if (!vehicle) return { ok: false, message: "Машин олдсонгүй." };

  const result = await refreshVehicleFieldsFromHur(vehicle.id, vehicle.plate);
  if (!result.ok) return result;

  revalidatePath(`/account/vehicles/${vehicleId}`);
  return { ok: true };
}

/** Хэрэглэгч өөрийн машинаа устгах. */
export async function deleteAccountVehicle(formData: FormData): Promise<void> {
  const account = await requireAccount();
  const id = ((formData.get("id") as string) ?? "").trim();
  if (!id) return;
  await prisma.accountVehicle.deleteMany({
    where: { id, accountId: account.id },
  });
  revalidatePath("/account");
}
