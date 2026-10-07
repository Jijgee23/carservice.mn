import { Prisma } from "@/app/generated/prisma/client";
import { jsonError, jsonOk } from "@/lib/api";
import { getApiAccountFromRequest } from "@/lib/auth/account-api-token";
import { prisma } from "@/lib/prisma";
import { customerOwnershipFilters, resolveVehicleForOwner } from "@/lib/vehicles";

// GET /api/v1/app/vehicles — миний машинууд (auth).
export async function GET(req: Request) {
  const account = await getApiAccountFromRequest(req);
  if (!account) return jsonError(401, "Нэвтрэх шаардлагатай.");

  // Тоолуур зөвхөн энэ эзний (account/утсаар холбоотой Customer) захиалга —
  // хуучин олон эзэнтэй мөр дээр өмнөх эзний ажил тоологдохгүй.
  const owned = customerOwnershipFilters(account.id, account.phone);
  const links = await prisma.accountVehicle.findMany({
    where: { accountId: account.id },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      vehicle: {
        select: {
          plate: true,
          make: true,
          model: true,
          year: true,
          vin: true,
          fuelType: true,
          wheelPosition: true,
          colorName: true,
          capacity: true,
          purpose: true,
          _count: {
            select: {
              serviceOrders: { where: { status: "COMPLETED", isInternal: false, OR: owned } },
              diagnosticReports: { where: { OR: owned } },
            },
          },
        },
      },
    },
  });
  // HUR-ийн техникийн талбаруудыг хамт буцаана — мобайлын дэлгэрэнгүй
  // дэлгэц offline cache-ээс ч бүрэн мэдээлэл харуулах боломжтой.
  const vehicles = links.map((l) => ({
    id: l.id,
    plate: l.vehicle.plate,
    make: l.vehicle.make,
    model: l.vehicle.model,
    year: l.vehicle.year,
    vin: l.vehicle.vin,
    fuelType: l.vehicle.fuelType,
    wheelPosition: l.vehicle.wheelPosition,
    colorName: l.vehicle.colorName,
    capacity: l.vehicle.capacity,
    purpose: l.vehicle.purpose,
    serviceCount: l.vehicle._count.serviceOrders,
    diagnosisCount: l.vehicle._count.diagnosticReports,
  }));
  return jsonOk({ vehicles });
}

// POST /api/v1/app/vehicles — машин нэмэх (auth). { plate, make, model, year?, vin? }
export async function POST(req: Request) {
  const account = await getApiAccountFromRequest(req);
  if (!account) return jsonError(401, "Нэвтрэх шаардлагатай.");

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError(400, "JSON body шаардлагатай.");
  }
  const b = body as {
    plate?: unknown;
    make?: unknown;
    model?: unknown;
    year?: unknown;
    vin?: unknown;
    fuelType?: unknown;
    wheelPosition?: unknown;
    colorName?: unknown;
    capacity?: unknown;
    purpose?: unknown;
  };
  const plate = typeof b.plate === "string" ? b.plate.trim() : "";
  const make = typeof b.make === "string" ? b.make.trim() : "";
  const model = typeof b.model === "string" ? b.model.trim() : "";
  const vin = typeof b.vin === "string" ? b.vin.trim() : "";
  const fuelType = typeof b.fuelType === "string" ? b.fuelType.trim() : "";
  const wheelPosition =
    typeof b.wheelPosition === "string" ? b.wheelPosition.trim() : "";
  const colorName = typeof b.colorName === "string" ? b.colorName.trim() : "";
  const purpose = typeof b.purpose === "string" ? b.purpose.trim() : "";
  let capacity: number | null = null;
  if (b.capacity != null && b.capacity !== "") {
    const n = Number.parseInt(String(b.capacity), 10);
    if (!Number.isFinite(n) || n <= 0 || n > 100_000) {
      return jsonError(400, "capacity буруу.");
    }
    capacity = n;
  }
  if (!plate || !make || !model) {
    return jsonError(400, "plate, make, model шаардлагатай.");
  }
  let year: number | null = null;
  if (b.year != null && b.year !== "") {
    const n = Number.parseInt(String(b.year), 10);
    if (!Number.isFinite(n) || n < 1950 || n > 2100) {
      return jsonError(400, "year буруу.");
    }
    year = n;
  }

  try {
    const vehicle = await prisma.$transaction(async (tx) => {
      // Vehicle = эзэмшигчийн бүртгэл: энэ account (эсвэл утсаар нь холбогдсон
      // tenant Customer)-ийн мөрийг тааруулна; өөр эзний ижил дугаартай мөр
      // байвал шинээр үүсгэнэ — өмнөх эзний түүх энд харагдахгүй.
      const v = await resolveVehicleForOwner(tx, {
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
      if (v.plateChanged) {
        // AuditLog tenant-д хамаарах тул account замд бүтэцтэй серверийн лог.
        console.info("[vehicle] plate changed via account re-registration", {
          vehicleId: v.id,
          accountId: account.id,
          from: v.plateChanged.from,
          to: v.plateChanged.to,
        });
      }
      const link = await tx.accountVehicle.create({
        data: { accountId: account.id, vehicleId: v.id },
        select: { id: true },
      });
      const full = await tx.vehicle.findUniqueOrThrow({
        where: { id: v.id },
        select: {
          plate: true,
          make: true,
          model: true,
          year: true,
          vin: true,
          fuelType: true,
          wheelPosition: true,
          colorName: true,
          capacity: true,
          purpose: true,
          _count: {
            select: {
              serviceOrders: { where: { status: "COMPLETED", isInternal: false } },
              diagnosticReports: true,
            },
          },
        },
      });
      return {
        id: link.id,
        plate: full.plate,
        make: full.make,
        model: full.model,
        year: full.year,
        vin: full.vin,
        fuelType: full.fuelType,
        wheelPosition: full.wheelPosition,
        colorName: full.colorName,
        capacity: full.capacity,
        purpose: full.purpose,
        serviceCount: full._count.serviceOrders,
        diagnosisCount: full._count.diagnosticReports,
      };
    });
    return jsonOk({ vehicle }, { status: 201 });
  } catch (e) {
    // plate unique биш болсон тул P2002 зөвхөн AccountVehicle давхардалд буудна.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return jsonError(409, "Энэ машин таны жагсаалтад аль хэдийн байна.");
    }
    return jsonError(500, "Машин нэмэхэд алдаа гарлаа.");
  }
}
