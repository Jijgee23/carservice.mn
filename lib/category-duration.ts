import { bookingDateKey, bookingDayBounds } from "@/lib/booking-time";
import { peakOccupancy } from "@/lib/schedule-capacity";
import { DEFAULT_SLOT_CAPACITY, DEFAULT_SLOT_MINUTES } from "@/lib/appointment-slots";
import { resolveOrderIntervals, type OrderTimeBookingLike } from "@/lib/schedule-order-interval";
import { isPendingAppointmentPaymentExpired } from "@/lib/appointment-payment-status";
// Concrete read shapes accept both the RLS-extended client and a real transaction
// without casting away Prisma's generic extension types.
type PrismaTransactionClient = {
  category: { findMany(args: {
    where: { id: { in: string[] } }; select: { id: true; durationMinutes: true };
  }): Promise<{ id: string; durationMinutes: number | null }[]> };
  branch: { findUnique(args: {
    where: { id: string }; select: { slotMinutes: true; slotCapacity: true };
  }): Promise<{ slotMinutes: number | null; slotCapacity: number | null } | null> };
  appointment: { findMany(args: {
    where: { branchId: string; status: { in: ("PENDING" | "CONFIRMED")[] }; requestedAt: { gte: Date; lt: Date } };
    select: {
      requestedAt: true; estimatedDurationMinutes: true; categoryId: true; serviceOrderId: true;
      categories: { select: { categoryId: true } };
      status: true; createdAt: true; feeAmount: true; feeUnderpaidAmount: true;
      payment: { select: { status: true } };
      serviceOrder: { select: { status: true } };
    };
  }): Promise<TakenAppointmentCandidateRow[]> };
  serviceOrder?: { findMany(args: {
    where: {
      branchId: string;
      OR: Array<
        | {
            status: { in: ("SCHEDULED" | "IN_PROGRESS")[] };
            OR: Array<{ scheduledAt: { lt: Date } } | { scheduledAt: null }>;
          }
        // D-076: also matches orders otherwise out of scope (e.g. COMPLETED)
        // that still have an open follow-up booking.
        | { id: { in: string[] } }
      >;
    };
    select: {
      status: true;
      scheduledAt: true;
      startedAt: true;
      estimatedDurationMinutes: true;
      expectedFinishAt: true;
      occupiesCapacity: true;
      id: true;
    };
  }): Promise<TakenOrderRow[]> };
  orderTimeBooking?: { findMany(args: {
    where: { orderId: { in: string[] } } | { branchId: string; closedAt: null };
    select: { orderId: true; kind: true; startAt: true; endAt: true; closedAt: true } | { orderId: true };
    distinct?: ["orderId"];
  }): Promise<{ orderId: string; kind?: "SCHEDULED" | "ACTIVE"; startAt?: Date; endAt?: Date | null; closedAt?: Date | null }[]> };
};

// Ангилалд хугацаа тохируулаагүй үеийн эцсийн fallback (минут). Slot-ийн
// анхдагч урттай санаатай нийцүүлэв — шатлал:
//   Category.durationMinutes             (tenant-ийн default)
//     ?? DEFAULT_CATEGORY_DURATION_MINUTES (платформын fallback)
export const DEFAULT_CATEGORY_DURATION_MINUTES = DEFAULT_SLOT_MINUTES;

// Онлайн захиалгын нэг ангиллын хугацааны хил (минут). Дээд хязгаар нь нэг
// ажлын өдрийн бодит хамгийн урт (12 цаг) — үүнээс урт ажил slot үүсгэдэггүй
// (олон өдөрт үргэлжлэх захиалгыг онлайн флоу дэмждэггүй; ажилтан гараар товлоно).
export const MIN_CATEGORY_DURATION_MINUTES = 5;
export const MAX_CATEGORY_DURATION_MINUTES = 12 * 60; // 720

/** Минутыг цаг+минут болгон задлана (UI-ийн input-д). */
export function splitMinutes(total: number): { hours: number; minutes: number } {
  return { hours: Math.floor(total / 60), minutes: total % 60 };
}

/** Минутыг "X ц Y мин" хэлбэрээр (0 бол алгасна). */
export function formatDuration(total: number): string {
  const { hours, minutes } = splitMinutes(total);
  if (hours && minutes) return `${hours} ц ${minutes} мин`;
  if (hours) return `${hours} ц`;
  return `${minutes} мин`;
}

export type DurationParse =
  | { ok: true; minutes: number | null }
  | { ok: false; error: string };

/**
 * Цаг+минут input-аас нийт минутыг гаргана — pure. Хоёул хоосон бол `null`
 * (тохируулаагүй / цэвэрлэх). Буруу/хязгаараас гадуур бол алдаа буцаана.
 */
export function parseDurationInput(
  hoursRaw: string,
  minutesRaw: string,
): DurationParse {
  const h = hoursRaw.trim();
  const m = minutesRaw.trim();
  if (!h && !m) return { ok: true, minutes: null };

  const hn = h ? Number(h) : 0;
  const mn = m ? Number(m) : 0;
  if (
    !Number.isInteger(hn) ||
    !Number.isInteger(mn) ||
    hn < 0 ||
    mn < 0 ||
    mn > 59
  ) {
    return { ok: false, error: "Цаг ба минутыг зөв оруулна уу (минут 0–59)." };
  }

  const total = hn * 60 + mn;
  if (
    total < MIN_CATEGORY_DURATION_MINUTES ||
    total > MAX_CATEGORY_DURATION_MINUTES
  ) {
    return {
      ok: false,
      error: `Хугацаа ${MIN_CATEGORY_DURATION_MINUTES} мин – ${MAX_CATEGORY_DURATION_MINUTES / 60} цагийн хооронд байна.`,
    };
  }
  return { ok: true, minutes: total };
}

/**
 * Нэг ангиллын effective хугацааг шийднэ — pure. `categoryDefault` null байж
 * болно (тохируулаагүй).
 */
export function resolveCategoryDurationMinutes(opts: {
  categoryDefault: number | null | undefined;
}): number {
  return opts.categoryDefault ?? DEFAULT_CATEGORY_DURATION_MINUTES;
}

export type ResolvedCategoryDuration = {
  categoryId: string;
  minutes: number;
  source: "tenant" | "default";
};

/**
 * Өгөгдсөн ангилалуудын effective хугацааг DB-ээс уншиж шийднэ (зөвхөн
 * `Category.durationMinutes`).
 *
 * Буцаах: ангилал тус бүрийн шийдэгдсэн хугацаа (эх сурвалжтай) + нийлбэр.
 * Санал болгосон ангилал бүрийн категори олдоно гэж үзнэ (endpoint талд
 * tenant/branch-д харьяалагдахыг тусдаа шалгах ёстой).
 */
export async function resolveCategoryDurations(
  client: PrismaTransactionClient,
  categoryIds: string[],
): Promise<{ perCategory: ResolvedCategoryDuration[]; totalMinutes: number }> {
  const uniqueIds = [...new Set(categoryIds)];
  if (uniqueIds.length === 0) return { perCategory: [], totalMinutes: 0 };

  const categories = await client.category.findMany({
    where: { id: { in: uniqueIds } },
    select: { id: true, durationMinutes: true },
  });

  const defaultById = new Map(categories.map((c) => [c.id, c.durationMinutes]));

  const perCategory: ResolvedCategoryDuration[] = uniqueIds.map((id) => {
    const categoryDefault = defaultById.get(id) ?? null;
    const minutes = resolveCategoryDurationMinutes({ categoryDefault });
    const source = categoryDefault != null ? "tenant" : "default";
    return { categoryId: id, minutes, source };
  });

  const totalMinutes = perCategory.reduce((sum, c) => sum + c.minutes, 0);
  return { perCategory, totalMinutes };
}

/** Аль хэдийн авсан нэг захиалгын минимум мэдээлэл — хугацааг шийдэхэд хэрэгтэй. */
export type TakenAppointmentRow = {
  estimatedDurationMinutes?: number | null;
  requestedAt: Date;
  serviceOrderId?: string | null;
  categoryId: string | null;
  categories: { categoryId: string }[];
};

/** A linked order in a settled end state no longer occupies anything (D-110). */
function isTerminalOrderStatus(status: string | null | undefined): boolean {
  return status === "COMPLETED" || status === "CANCELLED";
}

/**
 * TakenAppointmentRow plus the fields needed to detect an expired unpaid hold
 * and a linked order that has already finished or been cancelled.
 */
type TakenAppointmentCandidateRow = TakenAppointmentRow & {
  status: string;
  createdAt: Date;
  feeAmount: unknown;
  feeUnderpaidAmount: unknown;
  payment: { status: string } | null;
  serviceOrder?: { status: string } | null;
};

type TakenOrderRow = {
  id: string;
  status: string;
  scheduledAt: Date | null;
  startedAt: Date | null;
  estimatedDurationMinutes: number | null;
  expectedFinishAt: Date | null;
  occupiesCapacity: boolean | null;
};

/**
 * Аль хэдийн авсан (PENDING/CONFIRMED) захиалгуудын ЖИНХЭНЭ эзэлж буй
 * хугацааны интервал (эхлэх цаг + өөрийнх нь нийт үргэлжлэх хугацаа) —
 * `resolveCategoryDurations`-ыг нэг л удаа (бүх захиалгын бүх
 * ангиллын id-г нэгтгэж) дуудна. Ангилалгүй захиалга (хуучин өгөгдөл эсвэл
 * ямар ч ангилал сонгоогүй) `fallbackMinutes`-ийг (ихэвчлэн салбарын slot
 * урт) авна.
 */
export async function resolveTakenAppointmentIntervals(
  client: PrismaTransactionClient,
  appointments: TakenAppointmentRow[],
  fallbackMinutes: number,
): Promise<{ start: Date; durationMinutes: number }[]> {
  const categoryIdsOf = (a: TakenAppointmentRow) =>
    a.categories.length
      ? a.categories.map((c) => c.categoryId)
      : a.categoryId
        ? [a.categoryId]
        : [];
  const allCategoryIds = [
    ...new Set(appointments.flatMap(categoryIdsOf)),
  ];
  const { perCategory } = allCategoryIds.length
    ? await resolveCategoryDurations(client, allCategoryIds)
    : { perCategory: [] };
  const minutesById = new Map(perCategory.map((c) => [c.categoryId, c.minutes]));

  return appointments.map((a) => {
    const ids = categoryIdsOf(a);
    const total = ids.reduce((sum, id) => sum + (minutesById.get(id) ?? 0), 0);
    return {
      start: a.requestedAt,
      durationMinutes: a.estimatedDurationMinutes != null &&
        Number.isInteger(a.estimatedDurationMinutes) && a.estimatedDurationMinutes > 0
        ? a.estimatedDurationMinutes
        : total > 0 ? total : fallbackMinutes,
    };
  });
}

/**
 * Resolve every capacity-consuming interval in one business-day window.
 * Appointments linked to an active order are counted through the order only,
 * preventing the same vehicle/job from consuming capacity twice.
 */
/**
 * An in-progress order with no finish estimate is treated as still on the lift — but only for this many days after
 * it started. Older ones are almost always jobs nobody closed (prod 2026-10-15: June–September IN_PROGRESS orders
 * blocked every online-booking slot of a capacity-1 branch, forever). The staff calendar still shows them with its
 * «missing-estimate / unknown-occupancy» warnings until someone completes or cancels them.
 */
export const UNKNOWN_END_OCCUPANCY_DAYS = 7;

export async function resolveTakenCapacityIntervals(
  client: PrismaTransactionClient,
  branchId: string,
  dayStart: Date,
  dayEnd: Date,
  fallbackMinutes: number,
  excludeAppointmentId?: string,
): Promise<{ startMs: number; endMs: number }[]> {
  const [candidates, followUpOrderIds] = await Promise.all([
    client.appointment.findMany({
      where: {
        branchId,
        status: { in: ["PENDING", "CONFIRMED"] },
        requestedAt: { gte: dayStart, lt: dayEnd },
        ...(excludeAppointmentId ? { id: { not: excludeAppointmentId } } : {}),
      },
      select: {
        requestedAt: true,
        estimatedDurationMinutes: true,
        categoryId: true,
        serviceOrderId: true,
        categories: { select: { categoryId: true } },
        status: true,
        createdAt: true,
        feeAmount: true,
        feeUnderpaidAmount: true,
        payment: { select: { status: true } },
        serviceOrder: { select: { status: true } },
      },
    }),
    // D-076: order ids otherwise out of scope (e.g. COMPLETED) that still
    // have an open follow-up booking — see the identical fetch in
    // findScheduleConflict (app/_actions/orders.ts) and fetchOrderRows
    // (lib/branch-schedule-loader.ts).
    client.orderTimeBooking
      ? client.orderTimeBooking
          .findMany({ where: { branchId, closedAt: null }, select: { orderId: true }, distinct: ["orderId"] })
          .then((rows) => rows.map((r) => r.orderId))
      : Promise.resolve([] as string[]),
  ]);
  const orderCandidates = client.serviceOrder
    ? await client.serviceOrder.findMany({
        where: {
          branchId,
          OR: [
            {
              status: { in: ["SCHEDULED", "IN_PROGRESS"] },
              OR: [{ scheduledAt: { lt: dayEnd } }, { scheduledAt: null }],
            },
            ...(followUpOrderIds.length > 0 ? [{ id: { in: followUpOrderIds } }] : []),
          ],
        },
        select: {
          id: true,
          status: true,
          scheduledAt: true,
          startedAt: true,
          estimatedDurationMinutes: true,
          expectedFinishAt: true,
          occupiesCapacity: true,
        },
      })
    : ([] as TakenOrderRow[]);

  const orderIds = new Set(orderCandidates.map((o) => o.id));
  const liveCandidates = candidates.filter(
    (a) =>
      (!a.serviceOrderId || !orderIds.has(a.serviceOrderId)) &&
      // A booking whose order has finished or been cancelled no longer holds
      // its slot — matching buildBranchSchedule, which drops it from the day
      // view for the same reason (D-110). Without this the appointment is
      // counted on its own the moment the order goes terminal, because a
      // terminal order falls out of `orderCandidates`' status filter and so
      // stops suppressing it: a completed 2.5-hour job kept blocking its slot
      // against new customer bookings for the rest of the day.
      !isTerminalOrderStatus(a.serviceOrder?.status) &&
      !(a.status === "PENDING" && isPendingAppointmentPaymentExpired(a)),
  );
  const appointmentIntervals = await resolveTakenAppointmentIntervals(
    client,
    liveCandidates,
    fallbackMinutes,
  );
  // D-068 read-path swap: resolve from OrderTimeBooking rows when present,
  // matching lib/branch-schedule.ts and findScheduleConflict (orders.ts).
  const orderTimeBookingRows = orderCandidates.length > 0 && client.orderTimeBooking
    ? await client.orderTimeBooking.findMany({
        where: { orderId: { in: orderCandidates.map((o) => o.id) } },
        select: { orderId: true, kind: true, startAt: true, endAt: true, closedAt: true },
      })
    : [];
  const orderBookings = new Map<string, OrderTimeBookingLike[]>();
  for (const row of orderTimeBookingRows) {
    // select always includes kind/startAt/endAt/closedAt for this query, so
    // these are never actually undefined — the type is loosened to also fit
    // the orderId-only followUpOrderIds query above.
    if (row.kind == null || row.startAt == null) continue;
    const entry: OrderTimeBookingLike = { kind: row.kind, startAt: row.startAt, endAt: row.endAt ?? null, closedAt: row.closedAt ?? null };
    const arr = orderBookings.get(row.orderId);
    if (arr) arr.push(entry); else orderBookings.set(row.orderId, [entry]);
  }
  const orderIntervals = orderCandidates.flatMap((o) => {
    const { current, upcoming } = resolveOrderIntervals(o, orderBookings.get(o.id));
    const out: { startMs: number; endMs: number }[] = [];

    // D-076: the order's own current interval only counts under the same
    // gate as orderCanCountForCapacity's second condition (the terminal-
    // status one is redundant here — a terminal order only reaches this
    // list via followUpOrderIds, whose current interval never counts).
    if (!(o.status !== "SCHEDULED" && o.occupiesCapacity === false)) {
      // Corrupt data (a computed end <= start) has no positive evidence of
      // occupancy, same as buildBranchSchedule's "invalid-interval" issue —
      // exclude rather than silently reserving the rest of the day for it.
      if (!current.invalid && current.start) {
        const start = current.start.getTime();
        if (Number.isFinite(start) && start < dayEnd.getTime()) {
          // Missing/unknown estimate: conservatively occupy through end of
          // day, unless this is a scheduled order, where one branch slot is
          // the same bounded estimate used by the calendar and conflict
          // checker — and never beyond UNKNOWN_END_OCCUPANCY_DAYS after the
          // start, so a forgotten in-progress order stops blocking bookings.
          const end = current.end != null && Number.isFinite(current.end.getTime())
            ? current.end.getTime()
            : o.status === "SCHEDULED" && o.scheduledAt != null
              ? start + fallbackMinutes * 60000
              : Math.min(dayEnd.getTime(), start + UNKNOWN_END_OCCUPANCY_DAYS * 86_400_000);
          if (end > dayStart.getTime()) out.push({ startMs: start, endMs: end });
        }
      }
    }

    // A follow-up reservation counts independently — this is the whole
    // point of D-076: a live customer must not be able to double-book a
    // slot a follow-up already claims.
    for (const up of upcoming) {
      if (up.invalid || !up.start) continue;
      const start = up.start.getTime();
      if (!Number.isFinite(start) || start >= dayEnd.getTime()) continue;
      const end = up.end != null && Number.isFinite(up.end.getTime())
        ? up.end.getTime()
        : start + fallbackMinutes * 60000;
      if (end <= dayStart.getTime()) continue;
      out.push({ startMs: start, endMs: end });
    }

    return out;
  });

  return [
    ...appointmentIntervals.map((iv) => ({
      startMs: iv.start.getTime(),
      endMs: iv.start.getTime() + iv.durationMinutes * 60000,
    })),
    ...orderIntervals,
  ];
}

/**
 * Сервер тал — тухайн цаг (slot) хараахан дүүрээгүй эсэхийг шалгана
 * (давхар захиалгаас сэргийлнэ). `durationMinutes` — ШИНЭ захиалгын өөрийнх нь
 * нийт үргэлжлэх хугацаа (сонгосон ангиллуудын нийлбэр); өгөгдөөгүй бол
 * салбарын slot урттай тэнцүү гэж үзнэ.
 *
 * Overlap-based: зөвхөн `when`-тэй ижил слот-ийн НАРИЙН цонхонд эхэлсэн
 * захиалгыг биш, харин `[when, when+durationMinutes)`-той ЯМАРЧ цаг хугацаа
 * давхцаж буй (тэдгээрийн ӨӨРИЙНХ нь хугацаагаар) захиалгыг тоолно — эс
 * бөгөөс эрт эхэлсэн урт захиалга дараагийн цагуудыг "сул" мэт үзүүлж,
 * давхар захиалга үүсгэдэг байсан (жишээ: 12:00 + 120 мин захиалгатай ч
 * 12:30 "сул" гэж харагдаж, дахин захиалагдах боломжтой байсан).
 */
export async function isSlotAvailable(
  client: PrismaTransactionClient,
  branchId: string,
  when: Date,
  durationMinutes?: number,
  // Захиалгаа шилжүүлж байгаа Appointment-ийн ӨӨРИЙНХ нь одоогийн байрлалыг
  // "эзэлсэн" гэж тоохгүй байхын тулд (эс бөгөөс өөрийгөө өөртэйгөө
  // мөргөлдсөн мэт үзнэ).
  excludeAppointmentId?: string,
): Promise<boolean> {
  const branch = await client.branch.findUnique({
    where: { id: branchId },
    select: { slotMinutes: true, slotCapacity: true },
  });
  const slotMin = branch?.slotMinutes ?? DEFAULT_SLOT_MINUTES;
  const cap = branch?.slotCapacity ?? DEFAULT_SLOT_CAPACITY;
  const newDuration =
    durationMinutes && durationMinutes > 0 ? durationMinutes : slotMin;
  const newStartMs = when.getTime();
  const newEndMs = newStartMs + newDuration * 60000;

  // Тухайн өдрийн БҮХ идэвхтэй захиалгыг авна (зөвхөн `when`-ий орчмынхыг биш) —
  // эрт эхэлсэн ч урт хугацаатай захиалга хожуу цагтай давхцаж болно.
  const { start: dayStart, end: dayEnd } = bookingDayBounds(bookingDateKey(when));
  const intervals = await resolveTakenCapacityIntervals(
    client,
    branchId,
    dayStart,
    dayEnd,
    slotMin,
    excludeAppointmentId,
  );
  const count = peakOccupancy(intervals, newStartMs, newEndMs);
  return count < cap;
}
