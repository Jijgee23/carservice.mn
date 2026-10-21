"use server";

import { BOOKABLE_CATEGORY_WHERE } from "@/lib/categories";
import {
  type Weekday,
  branchStatusNow,
  formatAddress,
} from "@/lib/branches";
import { branchScheduleDisplaySelect } from "@/lib/branch-effective-schedule-server";
import { PLAN_LIMIT_CODES } from "@/lib/plan-limits";
import { plansWithFeature } from "@/lib/plan-limits-server";
import { prisma } from "@/lib/prisma";
import { setBypassContext } from "@/lib/tenant-context";

export type BookingBranchResult = {
  id: string;
  name: string;
  tenantName: string;
  logoUrl: string | null;
  address: string;
  open: boolean;
  hours: string | null;
};

/**
 * Booking v2 нэгтгэсэн хуудас (`app/(app)/book`) — сонгосон ажлын
 * түлхүүрүүдийг (`selectedIds`) БҮГДийг нь гүйцэтгэдэг салбаруудыг олно.
 * `selectedIds` хоосон бол ХООСОН массив буцаана (шүүлтгүй бүх салбарыг
 * ЖАГСААХГҮЙ) — ажлын төрөл сонгуулахыг урамшуулах зорилготой,
 * `booking-flow.tsx` үүнийг "ажлын төрлөө сонгоно уу" гэсэн зөвлөмж болгож
 * харуулна (`/discover`-т очих замтай хамт).
 *
 * `app/(app)/book/page.tsx`-ийн анхны SSR-ээс, мөн клиент талаас сонголт
 * өөрчлөгдөх бүрт (`booking-flow.tsx`) дуудагдана.
 */
const MAX_SELECTED_SERVICE_KEYS = 50;

export async function getBookingBranchResults(
  selectedIds: string[],
): Promise<BookingBranchResult[]> {
  // Нийтэд нээлттэй server action — оролтыг шалгаж, хэмжээг хязгаарлана.
  const ids = Array.isArray(selectedIds)
    ? [...new Set(selectedIds.filter((id): id is string => typeof id === "string" && id.length > 0))]
    : [];
  if (ids.length === 0) return [];
  if (ids.length > MAX_SELECTED_SERVICE_KEYS) return [];
  setBypassContext();

  const allowedPlans = await plansWithFeature(PLAN_LIMIT_CODES.ONLINE_BOOKING);
  const now = new Date();
  const tenants = await prisma.tenant.findMany({
    where: {
      acceptsOnlineBooking: true,
      suspended: false,
      isTest: false, // тест/демо тенант олон нийтэд харагдахгүй (lib/tenant-visibility.ts)
      plan: { in: allowedPlans },
      // Сонгосон үйлчилгээ бүрийн идэвхтэй ангилалтай tenant-уудыг л DB-ээс
      // авна (салбар түвшний шалгалт доор хэвээр) — бүх tenant-ийг ачаалахгүй.
      AND: ids.map((id) => ({ categories: { some: { isActive: true, ...BOOKABLE_CATEGORY_WHERE, systemServiceKeyId: id } } })),
    },
    orderBy: { name: "asc" },
    select: {
      name: true,
      logoUrl: true,
      branches: {
        where: { isActive: true },
        orderBy: { isPrimary: "desc" },
        select: {
          id: true,
          name: true,
          city: true,
          district: true,
          khoroo: true,
          address: true,
          ...branchScheduleDisplaySelect(),
        },
      },
      categories: {
        // Зөвхөн сонгосон түлхүүрүүд хэрэгтэй (доор `every(ids)` л шалгана).
        where: { isActive: true, ...BOOKABLE_CATEGORY_WHERE, systemServiceKeyId: { in: ids } },
        select: {
          systemServiceKeyId: true,
          branches: { select: { id: true } },
        },
      },
    },
  });

  const results: BookingBranchResult[] = [];
  for (const t of tenants) {
    for (const b of t.branches) {
      const branchServiceKeyIds = new Set(
        t.categories
          .filter((c) => c.branches.length === 0 || c.branches.some((x) => x.id === b.id))
          .map((c) => c.systemServiceKeyId),
      );
      const coversAll = ids.every((id) => branchServiceKeyIds.has(id));
      if (!coversAll) continue;
      const status = branchStatusNow(
        {
          openTime: b.openTime,
          closeTime: b.closeTime,
          schedules: b.schedules.map((s) => ({
            weekday: s.weekday as Weekday,
            isOpen: s.isOpen,
            openTime: s.openTime,
            closeTime: s.closeTime,
          })),
          scheduleExceptions: b.scheduleExceptions,
          scheduleSeasons: b.scheduleSeasons,
        },
        now,
      );
      results.push({
        id: b.id,
        name: b.name,
        tenantName: t.name,
        logoUrl: t.logoUrl,
        address: formatAddress(b),
        open: status.open,
        hours: status.hours,
      });
    }
  }
  return results;
}
