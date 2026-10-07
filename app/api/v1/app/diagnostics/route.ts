import { Prisma } from "@/app/generated/prisma/client";
import { jsonError, jsonOk } from "@/lib/api";
import { getApiAccountFromRequest } from "@/lib/auth/account-api-token";
import { buildMeta, getApiPageInfo } from "@/lib/pagination";
import { prisma } from "@/lib/prisma";
import { customerOwnershipFilters } from "@/lib/vehicles";
import { bookingDateKey, bookingDayBounds } from "@/lib/booking-time";

// GET /api/v1/app/diagnostics — миний оношилгооны тайлангуудын жагсаалт (auth,
// бүх байгууллага дамнасан) — тухайн засварын хуудасны дотор нуугдаад байсныг
// дербан "миний оношилгоонууд" харагдацад зориулав. Товч мэдээлэл л буцаана —
// бүрэн бөглөлтийг [id] дуудлагаас авна (харах: order-уудын ижил зарчим).
export async function GET(req: Request) {
  const account = await getApiAccountFromRequest(req);
  if (!account) return jsonError(401, "Нэвтрэх шаардлагатай.");

  const url = new URL(req.url);
  const vehicleIdFilter = url.searchParams.get("vehicleId")?.trim() || undefined;
  const { page, pageSize, skip, take } = getApiPageInfo(url.searchParams);
  const q = url.searchParams.get("q")?.trim() || undefined;
  const severityRaw = url.searchParams.get("severity")?.trim().toUpperCase();
  const severity = severityRaw || undefined;
  if (severity && !["GOOD", "WARN", "BAD"].includes(severity)) {
    return jsonError(400, "Оношилгооны төлөв буруу байна.");
  }
  const yearRaw = url.searchParams.get("year")?.trim();
  const year = yearRaw ? Number(yearRaw) : undefined;
  if (
    yearRaw &&
    (!/^\d{4}$/.test(yearRaw) ||
      year == null ||
      !Number.isInteger(year) ||
      year < 2000 ||
      year > 2100)
  ) {
    return jsonError(400, "Он буруу байна.");
  }

  // Түүх зөвхөн эзэнд: тайлангийн Customer нь энэ account-той (accountId эсвэл
  // утсаар) холбоотой байх ёстой. Машин-аар (vehicleId) нэмж багтаахгүй —
  // ижил машины өмнөх эзний тайлан харагдахгүй. vehicleId шүүлт нь өөрийн
  // тайлан дотроо л ажиллана.
  const owned = customerOwnershipFilters(account.id, account.phone);

  const where: Prisma.DiagnosticReportWhereInput = { OR: owned };
  if (vehicleIdFilter) where.vehicleId = vehicleIdFilter;
  if (severity) where.maxSeverity = severity as "GOOD" | "WARN" | "BAD";
  if (year) {
    const bounds = bookingDayBounds(`${year}-01-01`);
    const nextBounds = bookingDayBounds(`${year + 1}-01-01`);
    where.createdAt = {
      gte: bounds.start,
      lt: nextBounds.start,
    };
  }
  if (q) {
    where.AND = [
      {
        OR: [
          { template: { name: { contains: q, mode: "insensitive" } } },
          { vehicle: { plate: { contains: q, mode: "insensitive" } } },
          { vehicle: { make: { contains: q, mode: "insensitive" } } },
          { vehicle: { model: { contains: q, mode: "insensitive" } } },
          { branch: { name: { contains: q, mode: "insensitive" } } },
          { order: { number: { contains: q } } },
        ],
      },
    ];
  }

  const facetRows = await prisma.diagnosticReport.findMany({
    where: { OR: owned },
    select: { createdAt: true },
  });
  const availableYears = [...new Set(facetRows.map((r) => Number(bookingDateKey(r.createdAt).slice(0, 4))))].sort(
    (a, b) => b - a,
  );

  const [reports, total] = await Promise.all([
    prisma.diagnosticReport.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take,
      select: {
        id: true,
        mileageAtReport: true,
        maxSeverity: true,
        createdAt: true,
        template: { select: { name: true, type: true } },
        vehicle: { select: { plate: true, make: true, model: true, year: true } },
        branch: { select: { name: true } },
        order: { select: { id: true, number: true, isInternal: true } },
      },
    }),
    prisma.diagnosticReport.count({ where }),
  ]);

  const shaped = reports.map((r) => ({
    id: r.id,
    type: r.template.type,
    templateName: r.template.name,
    mileageAtReport: r.mileageAtReport,
    severity: r.maxSeverity,
    createdAt: r.createdAt,
    vehicle: r.vehicle,
    branch: r.branch,
    // Дотоод засварын захиалгыг үйлчлүүлэгчид ил гаргахгүй (тайлан өөрөө үлдэнэ).
    order: r.order && !r.order.isInternal ? { id: r.order.id, number: r.order.number } : null,
  }));

  return jsonOk({
    reports: shaped,
    pagination: buildMeta(total, page, pageSize),
    availableYears,
  });
}
