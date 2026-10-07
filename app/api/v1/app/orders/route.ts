import { Prisma } from "@/app/generated/prisma/client";
import { jsonError, jsonOk } from "@/lib/api";
import { getApiAccountFromRequest } from "@/lib/auth/account-api-token";
import { buildMeta, getApiPageInfo } from "@/lib/pagination";
import { prisma } from "@/lib/prisma";
import { customerOwnershipFilters } from "@/lib/vehicles";
import { bookingDateKey, bookingDayBounds } from "@/lib/booking-time";

// `month` заавал биш, зөвхөн `year`-той хамт нарийвчлал нэмнэ (1-12) —
// хайрцаглах хугацааг [year-month-01, дараагийн сарын 01) болгож бодно.
function yearMonthRange(year: number, month: number | undefined) {
  if (!month) {
    return {
      start: bookingDayBounds(`${year}-01-01`).start,
      end: bookingDayBounds(`${year + 1}-01-01`).start,
    };
  }
  const nextMonth = month === 12 ? 1 : month + 1;
  const nextYear = month === 12 ? year + 1 : year;
  return {
    start: bookingDayBounds(`${year}-${String(month).padStart(2, "0")}-01`).start,
    end: bookingDayBounds(`${nextYear}-${String(nextMonth).padStart(2, "0")}-01`).start,
  };
}

// GET /api/v1/app/orders — миний үйлчилгээний түүх (auth, бүх байгууллага
// дамнасан). Засварын хуудас бүрт хавсаргасан оношилгооны тайлангийн товч жагсаалт
// (reports) хавсарна — дэлгэрэнгүй бөглөлтийг [id] дуудлагаас авна.
export async function GET(req: Request) {
  const account = await getApiAccountFromRequest(req);
  if (!account) return jsonError(401, "Нэвтрэх шаардлагатай.");

  const url = new URL(req.url);
  const vehicleIdFilter = url.searchParams.get("vehicleId")?.trim() || undefined;
  const { page, pageSize, skip, take } = getApiPageInfo(url.searchParams);
  const q = url.searchParams.get("q")?.trim() || undefined;
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
  // Сар зөвхөн он сонгосны дараах нарийвчлал тул оноос тусад нь утгагүй.
  const monthRaw = url.searchParams.get("month")?.trim();
  const month = monthRaw ? Number(monthRaw) : undefined;
  if (monthRaw) {
    if (!year) return jsonError(400, "Сарын шүүлт хийхийн тулд оноо сонгоно уу.");
    if (!/^\d{1,2}$/.test(monthRaw) || month == null || month < 1 || month > 12) {
      return jsonError(400, "Сар буруу байна.");
    }
  }

  // Түүх зөвхөн эзэнд: захиалгын Customer нь энэ account-той (accountId эсвэл
  // утсаар) холбоотой байх ёстой — account/history веб хуудастай ижил зарчим.
  // Машин-аар (vehicleId) нэмж багтаахгүй: ижил машины өмнөх эзний захиалга
  // харагдахгүй. vehicleId шүүлт нь өөрийн захиалга дотроо л ажиллана.
  const owned = customerOwnershipFilters(account.id, account.phone);

  const where: Prisma.ServiceOrderWhereInput = {
    // Дууссан AND цуцлагдсан ажлыг харуулна (D-085) — SCHEDULED/IN_PROGRESS
    // хараахан идэвхтэй, /api/v1/app/appointments дээр харагдана.
    // Дууссан ч бүрэн төлөгдөөгүй ажил энд биш — /api/v1/app/appointments
    // дээр үлдэнэ; бүрэн төлөгдмөгц энд шилжинэ (веб /account/history-тэй ижил).
    // Дотоод засвар үйлчлүүлэгчид харагдахгүй.
    isInternal: false,
    status: { in: ["COMPLETED", "CANCELLED"] },
    NOT: { status: "COMPLETED", paymentStatus: { not: "PAID" } },
    OR: owned,
  };
  if (vehicleIdFilter) where.vehicleId = vehicleIdFilter;
  if (year) {
    const range = yearMonthRange(year, month);
    where.completedAt = { gte: range.start, lt: range.end };
  }
  if (q) {
    where.AND = [
      {
        OR: [
          { tenant: { name: { contains: q, mode: "insensitive" } } },
          { tenant: { slug: { contains: q, mode: "insensitive" } } },
          { branch: { name: { contains: q, mode: "insensitive" } } },
          { vehicle: { plate: { contains: q, mode: "insensitive" } } },
          { vehicle: { make: { contains: q, mode: "insensitive" } } },
          { vehicle: { model: { contains: q, mode: "insensitive" } } },
          { number: { contains: q } },
        ],
      },
    ];
  }

  const cancelledWhere: Prisma.AppointmentWhereInput = {
    accountId: account.id,
    status: { in: ["CANCELLED", "NO_SHOW", "REJECTED"] },
    serviceOrderId: null,
  };
  if (year) {
    const range = yearMonthRange(year, month);
    cancelledWhere.requestedAt = { gte: range.start, lt: range.end };
  }
  if (q) {
    cancelledWhere.AND = [
      {
        OR: [
          { tenant: { name: { contains: q, mode: "insensitive" } } },
          { tenant: { slug: { contains: q, mode: "insensitive" } } },
          { branch: { name: { contains: q, mode: "insensitive" } } },
          { category: { name: { contains: q, mode: "insensitive" } } },
        ],
      },
    ];
  }

  const facetOrders = await prisma.serviceOrder.findMany({
    where: {
      isInternal: false,
      status: { in: ["COMPLETED", "CANCELLED"] },
      NOT: { status: "COMPLETED", paymentStatus: { not: "PAID" } },
      OR: owned,
    },
    select: { completedAt: true },
  });
  const facetCancelled = await prisma.appointment.findMany({
    where: {
      accountId: account.id,
      status: { in: ["CANCELLED", "NO_SHOW", "REJECTED"] },
      serviceOrderId: null,
    },
    select: { requestedAt: true },
  });
  const availableYears = [
    ...new Set([
      ...facetOrders.flatMap((row) => (row.completedAt ? [Number(bookingDateKey(row.completedAt).slice(0, 4))] : [])),
      ...facetCancelled.map((row) => Number(bookingDateKey(row.requestedAt).slice(0, 4))),
    ]),
  ].sort((a, b) => b - a);

  const [orders, total, cancelledAppointments, cancelledTotal] = await Promise.all([
    prisma.serviceOrder.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take,
      select: {
        id: true,
        number: true,
        status: true,
        paymentStatus: true,
        scheduledAt: true,
        completedAt: true,
        createdAt: true,
        totalAmount: true,
        paidAmount: true,
        tenant: { select: { name: true, slug: true } },
        branch: { select: { name: true } },
        vehicle: {
          select: { plate: true, make: true, model: true, year: true },
        },
        _count: { select: { items: true } },
        reports: {
          orderBy: { createdAt: "desc" },
          select: {
            id: true,
            createdAt: true,
            mileageAtReport: true,
            template: { select: { name: true, type: true } },
          },
        },
      },
    }),
    prisma.serviceOrder.count({ where }),

    // D-085: keep terminal appointments separate from service orders, but
    // apply the same filters and page window so neither list has a hidden cap.
    prisma.appointment.findMany({
      where: cancelledWhere,
      orderBy: { requestedAt: "desc" },
      skip,
      take,
      select: {
        id: true,
        status: true,
        requestedAt: true,
        tenant: { select: { name: true, slug: true } },
        branch: { select: { name: true } },
        category: { select: { name: true } },
      },
    }),
    prisma.appointment.count({ where: cancelledWhere }),
  ]);

  const shaped = orders.map((o) => {
    const { _count, reports, ...rest } = o;
    return {
      ...rest,
      itemCount: _count.items,
      reports: reports.map((r) => ({
        id: r.id,
        type: r.template.type,
        templateName: r.template.name,
        mileageAtReport: r.mileageAtReport,
        createdAt: r.createdAt,
      })),
    };
  });

  return jsonOk({
    orders: shaped,
    pagination: buildMeta(total, page, pageSize),
    cancelledAppointments,
    cancelledPagination: buildMeta(cancelledTotal, page, pageSize),
    availableYears,
  });
}
