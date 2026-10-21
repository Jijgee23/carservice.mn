// Shared branch-day-availability assembly. Both the public/anonymous booking
// path (`lib/public-availability.ts`'s `resolvePublicAvailability`) and the
// staff-authenticated slot route (`app/api/v1/appointments/slots/route.ts`)
// need the exact same sequence once a branch row has been fetched under
// their OWN auth/scope rules: validate the requested categories against the
// branch, resolve the effective schedule for the date, resolve each
// category's duration, resolve already-taken capacity intervals, and run
// the pure `buildDaySlots` math.
//
// This module owns exactly that shared middle — it is NOT the auth/bypass
// boundary and it is NOT the plan-feature gate. Those stay at the two call
// sites, which is what P2's own correction (TENANT_MOBILE_SLICES.md, "Wave 2
// spec corrections") requires: the public path runs under
// `setBypassContext()` and gates on `ONLINE_BOOKING`; the staff path runs
// under `requireApiUser`/`requirePermission` and must never depend on that
// plan gate. Both fetch and authorize the branch themselves, then hand the
// already-fetched row here.
import { BOOKABLE_CATEGORY_WHERE } from "@/lib/categories";
import type { EffectiveScheduleSource, ScheduleException, ScheduleRule, ScheduleSeason } from "@/lib/branch-effective-schedule";
import { resolveEffectiveSchedule } from "@/lib/branch-effective-schedule";
import {
  buildDaySlots,
  DEFAULT_SLOT_CAPACITY,
  DEFAULT_SLOT_MINUTES,
  type DayAvailability,
} from "@/lib/appointment-slots";
import { resolveCategoryDurations, resolveTakenCapacityIntervals } from "@/lib/category-duration";
import type { prisma as prismaSingleton } from "@/lib/prisma";

type PrismaLike = typeof prismaSingleton;

export type DayAvailabilityBranch = {
  id: string;
  tenantId: string;
  slotMinutes: number | null;
  slotCapacity: number | null;
  openTime: string | null;
  closeTime: string | null;
  schedules: ScheduleRule[];
  scheduleExceptions?: ScheduleException[];
  scheduleSeasons?: ScheduleSeason[];
};

export type BranchDayAvailabilityResult =
  | {
      ok: true;
      availability: DayAvailability & {
        scheduleSource: EffectiveScheduleSource;
        scheduleLabel: string | null;
        durationMinutes: number;
      };
    }
  | { ok: false; reason: "invalid_category" };

/**
 * Validate `categoryIds` against the branch (tenant-scoped, active,
 * branch-assigned-or-global — same rule `reserveAppointmentInTransaction`
 * enforces), then compute the day's slot availability. Pure aside from the
 * two read-only queries category duration and taken-capacity resolution need.
 */
export async function computeBranchDayAvailability(
  prisma: PrismaLike,
  input: {
    branch: DayAvailabilityBranch;
    dateStr: string;
    dayStart: Date;
    dayEnd: Date;
    categoryIds: string[];
    now?: Date;
  },
): Promise<BranchDayAvailabilityResult> {
  const { branch, dateStr, dayStart, dayEnd } = input;
  const categoryIds = [...new Set(input.categoryIds.filter(Boolean))];

  if (categoryIds.length) {
    const eligible = await prisma.category.findMany({
      where: {
        id: { in: categoryIds },
        tenantId: branch.tenantId,
        isActive: true,
        OR: [{ branches: { some: { id: branch.id } } }, { branches: { none: {} } }],
        AND: [BOOKABLE_CATEGORY_WHERE],
      },
      select: { id: true },
    });
    if (eligible.length !== categoryIds.length) {
      return { ok: false, reason: "invalid_category" };
    }
  }

  const schedule = resolveEffectiveSchedule({ dateStr, branch });
  const slotMin = branch.slotMinutes ?? DEFAULT_SLOT_MINUTES;
  const { totalMinutes } = categoryIds.length
    ? await resolveCategoryDurations(prisma, categoryIds)
    : { totalMinutes: 0 };
  const appointmentMinutes = totalMinutes > 0 ? totalMinutes : slotMin;

  const capacityIntervals = schedule.open
    ? await resolveTakenCapacityIntervals(prisma, branch.id, dayStart, dayEnd, slotMin)
    : [];
  const taken = capacityIntervals.map((interval) => ({
    start: new Date(interval.startMs),
    durationMinutes: Math.max(1, Math.ceil((interval.endMs - interval.startMs) / 60000)),
  }));

  const availability = buildDaySlots({
    dateStr,
    open: schedule.open,
    openTime: schedule.openTime,
    closeTime: schedule.closeTime,
    slotMinutes: slotMin,
    capacity: branch.slotCapacity ?? DEFAULT_SLOT_CAPACITY,
    taken,
    now: input.now ?? new Date(),
    appointmentMinutes,
  });

  return {
    ok: true,
    availability: {
      ...availability,
      scheduleSource: schedule.source,
      scheduleLabel: schedule.label,
      durationMinutes: appointmentMinutes,
    },
  };
}
