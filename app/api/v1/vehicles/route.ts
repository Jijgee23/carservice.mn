import { jsonError, jsonOk, requireApiUser, requirePermission } from "@/lib/api";
import { requireActiveSubscriptionApi } from "@/lib/subscription-server";
import { buildMeta } from "@/lib/pagination";
import { vehicleOwnerIsOrganization } from "@/lib/vehicles/owner-kind";
import { prisma } from "@/lib/prisma";
import { VehicleCommandError, createVehicleCommand } from "@/lib/vehicles/vehicle-commands";
import {
  buildVehicleListWhere,
  parseVehicleListQuery,
} from "@/lib/vehicles/vehicle-list-query";

export async function GET(req: Request) {
  const auth = await requireApiUser(req);
  if (auth.response) return auth.response;
  const denied = requirePermission(auth.user, "vehicles.view");
  if (denied) return denied;

  const url = new URL(req.url);
  const parsed = parseVehicleListQuery(url.searchParams);
  if (!parsed.ok) return jsonError(400, parsed.message, { field: parsed.field });
  const query = parsed.value;
  const { page, pageSize, skip, take } = query;

  // P3-B6: канон where-builder — `lib/vehicles/vehicle-list-query.ts`.
  // Тенантын хамрах хүрээ TenantVehicle-ээр дамждаг хэвээр (global Vehicle
  // биш). Хайлт нь одоо dashboard-ийн зургаан талбарт (plate/make/model/vin +
  // эзэмшигчийн нэр/утас) тааруулна — өмнө нь энэ route зөвхөн машины
  // талбаруудыг л хайдаг байсан тул энэ нь зориудаар ӨРГӨТГӨСӨН зан төлөв
  // (see this slice's report: search must match the dashboard's rows).
  const where = buildVehicleListWhere(query, { tenantId: auth.user.tenantId });

  const [links, total] = await Promise.all([
    prisma.tenantVehicle.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take,
      select: {
        customerId: true,
        isPostpaid: true,
        customer: {
          select: { id: true, fullName: true, phone: true, isOrganization: true, orgName: true },
        },
        vehicle: {
          select: {
            id: true,
            plate: true,
            vin: true,
            make: true,
            model: true,
            year: true,
            mileage: true,
            ownerRegnum: true,
          },
        },
      },
    }),
    prisma.tenantVehicle.count({ where }),
  ]);

  const vehicles = links.map(({ vehicle: { ownerRegnum, ...v }, ...l }) => ({
    ...v,
    ownerIsOrganization: vehicleOwnerIsOrganization(l.customer, ownerRegnum),
    customerId: l.customerId,
    isPostpaid: l.isPostpaid,
    customer: l.customer,
  }));

  return jsonOk({ vehicles, pagination: buildMeta(total, page, pageSize) });
}

export async function POST(req: Request) {
  const auth = await requireApiUser(req);
  if (auth.response) return auth.response;
  const denied = requirePermission(auth.user, "vehicles.create");
  if (denied) return denied;
  const locked = await requireActiveSubscriptionApi(auth.user);
  if (locked) return locked;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError(400, "JSON body шаардлагатай.");
  }
  if (!body || typeof body !== "object") return jsonError(400, "Body буруу.");

  const { plate, vin, make, model, year, mileage, customerId, fromLookup } = body as Record<
    string,
    unknown
  >;

  // P3-B2: validate/claim логик нь `lib/vehicles/vehicle-commands.ts`-д
  // нэгдсэн. Энэ route зөвхөн эрх/subscription шалгаад, командыг дуудаж,
  // JSON хариу болгон хувиргадаг нимгэн адаптер.
  //  - Divergence 3 хэвээр: он дээд хязгаарыг (2100) шалгахгүй
  //    (`enforceYearUpperBound: false`) — хуучин route зөвхөн доод хязгаарыг
  //    шалгадаг байсан.
  //  - `wheelPosition` энд огт хүлээж авдаггүй — хуучин route-д байгаагүй.
  //  - MAX_VEHICLES одоо энд ч шалгагдана: D-154 (2026-09-22) D-151-ийг
  //    орлуулсан. Давхардал татгалзах (`rejectDuplicate`) хэвээр унтраалттай
  //    — тусдаа divergence, хязгаартай хамаагүй.
  //  - Хуучин "эзэнгүй давхардлыг чимээгүй ашиглах" гар аргыг Divergence 5-ийн
  //    нэгтгэл устгасан: одоо бүх зам `resolveVehicleForOwner`/
  //    `ensureTenantVehicle`-ээр дамжина, тусдаа хайлт байхгүй.
  let record;
  try {
    record = await createVehicleCommand({
      actor: auth.user,
      data: {
        plate: typeof plate === "string" ? plate : "",
        vin: typeof vin === "string" ? vin : null,
        make: typeof make === "string" ? make : "",
        model: typeof model === "string" ? model : "",
        year: typeof year === "number" || typeof year === "string" ? year : null,
        mileage: typeof mileage === "number" || typeof mileage === "string" ? mileage : null,
        customerId: typeof customerId === "string" ? customerId : null,
      },
      rejectDuplicate: false,
      enforceYearUpperBound: false,
      // HUR/global lookup-аас бөглөсөн бол регистрийг сервер талд шийднэ
      // (dashboard action-тай ижил; masked регистрийг команд null болгодог).
      resolveOwnerRegnum: fromLookup === true,
    });
  } catch (e) {
    if (e instanceof VehicleCommandError) {
      return jsonError(e.status, e.message, e.fieldErrors ? { fieldErrors: e.fieldErrors } : undefined);
    }
    throw e;
  }

  return jsonOk(
    {
      vehicle: {
        id: record.id,
        plate: record.plate,
        vin: record.vin,
        make: record.make,
        model: record.model,
        year: record.year,
        mileage: record.mileage,
        customerId: record.customerId,
      },
    },
    { status: 201 },
  );
}
