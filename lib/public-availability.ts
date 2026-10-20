// S15-S16 (WEB_SCHEDULING_ASSESSMENT_2026-09-10.md): shared public-availability
// service. Consolidates what the mobile API route
// (app/api/v1/app/branches/[branchId]/availability/route.ts) and the public
// web action (getBranchDaySlots, app/_actions/appointments.ts) used to
// duplicate independently, so both get the SAME boundary checks:
//   - date validated (bookingDayBounds) BEFORE any Prisma call — the actual
//     S16 fix. branchScheduleForDateSelect(dateStr) itself calls
//     bookingDayBounds purely for its throwing side effect; calling it after
//     the branch fetch (as both callers previously did) let an impossible
//     date like 2030-02-30 throw uncaught during findUnique, before the
//     route's own try/catch could turn it into a 400.
//   - branch fetched with isActive: true (previously missing — reservation
//     creation already rejects inactive branches, public availability did
//     not).
//   - tenant.suspended / tenant.acceptsOnlineBooking / ONLINE_BOOKING plan
//     feature all checked consistently (getBranchDaySlots was missing all
//     three; the API route had them).
//   - requested categoryIds deduped, then re-validated against tenantId +
//     isActive + branch-assigned-or-global, exactly like
//     reserveAppointmentInTransaction (lib/appointment-reservations.ts) does
//     for the authenticated booking path. An unknown/foreign id is now a
//     hard rejection, not a silent DEFAULT_CATEGORY_DURATION_MINUTES
//     fallback (previously resolveCategoryDurations queried
//     `category.findMany({ where: { id: { in: uniqueIds } } })` with no
//     tenant/branch scoping at all).
//
// This service is PUBLIC/ANONYMOUS on purpose (both callers use
// setBypassContext()). It must never be used for the staff schedule preview
// (app/_actions/schedule-preview.ts's getBranchDaySchedulePreview) — that
// path is authenticated, permission-checked, and must not depend on the
// online-booking plan gate. See that file's own doc comment.

import { bookingDayBounds } from "@/lib/booking-time";
import { branchScheduleForDateSelect } from "@/lib/branch-effective-schedule-server";
import type { DayAvailability } from "@/lib/appointment-slots";
import { computeBranchDayAvailability } from "@/lib/appointments/day-availability";
import { PLAN_LIMIT_CODES } from "@/lib/plan-limits";
import { isFeatureEnabled } from "@/lib/plan-limits-server";
import { prisma } from "@/lib/prisma";

export type PublicAvailabilityInput = {
  branchId: string;
  dateStr: string; // YYYY-MM-DD
  categoryIds?: string[];
};

export type PublicAvailabilityResult =
  | { ok: true; availability: DayAvailability }
  | { ok: false; reason: "invalid_date"; message: string }
  | { ok: false; reason: "not_found"; message: string }
  | { ok: false; reason: "not_available"; message: string }
  | { ok: false; reason: "invalid_category"; message: string };

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Resolve a public/anonymous branch's day availability. Order matters: date
 * validity is settled before any Prisma call runs (S16), then branch/tenant
 * eligibility, then category eligibility, and only then slot computation.
 */
export async function resolvePublicAvailability(
  input: PublicAvailabilityInput,
): Promise<PublicAvailabilityResult> {
  const { branchId, dateStr } = input;
  const categoryIds = [...new Set((input.categoryIds ?? []).filter(Boolean))];

  if (!branchId || !DATE_RE.test(dateStr)) {
    return { ok: false, reason: "invalid_date", message: "date (YYYY-MM-DD) шаардлагатай." };
  }
  let bounds: { start: Date; end: Date };
  try {
    bounds = bookingDayBounds(dateStr);
  } catch {
    return { ok: false, reason: "invalid_date", message: "Буруу өдөр." };
  }

  // Safe to call now — the date has already been validated above, so its
  // internal bookingDayBounds(dateStr) call cannot throw.
  const branch = await prisma.branch.findFirst({
    where: { id: branchId, isActive: true },
    select: {
      id: true,
      tenantId: true,
      slotMinutes: true,
      slotCapacity: true,
      tenant: { select: { acceptsOnlineBooking: true, suspended: true, isTest: true } },
      ...branchScheduleForDateSelect(dateStr),
    },
  });
  if (!branch) {
    return { ok: false, reason: "not_found", message: "Салбар олдсонгүй." };
  }
  if (
    branch.tenant.suspended ||
    branch.tenant.isTest ||
    !branch.tenant.acceptsOnlineBooking ||
    !(await isFeatureEnabled(branch.tenantId, PLAN_LIMIT_CODES.ONLINE_BOOKING))
  ) {
    return {
      ok: false,
      reason: "not_available",
      message: "Энэ байгууллага онлайн цаг захиалга хүлээн авахгүй.",
    };
  }

  const result = await computeBranchDayAvailability(prisma, {
    branch,
    dateStr,
    dayStart: bounds.start,
    dayEnd: bounds.end,
    categoryIds,
  });
  if (!result.ok) {
    return {
      ok: false,
      reason: "invalid_category",
      message: "Үйлчилгээний ангиллаа дахин сонгоно уу.",
    };
  }

  return { ok: true, availability: result.availability };
}
