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
import { isTenantBookable, PUBLIC_TENANT_WHERE } from "@/lib/tenant-visibility";

export type BookingBranchResult = {
  id: string;
  name: string;
  tenantName: string;
  logoUrl: string | null;
  address: string;
  open: boolean;
  hours: string | null;
  /** Онлайн цаг захиалга авдаг эсэх — false бол «Дэлгэрэнгүй» + утас. */
  bookable: boolean;
  phone: string | null;
  /** Картын холбоос: захиалга (ангилалтай бол /book/branch, үгүй бол /org) эсвэл дэлгэрэнгүй. */
  href: string;
};

/**
 * Booking v2 нэгтгэсэн хуудас (`app/(app)/book`) — сонгосон ажлын
 * түлхүүрүүдийг (`selectedIds`) БҮГДийг нь гүйцэтгэдэг салбаруудыг олно.
 * Олон нийтэд харагдах БҮХ газар (онлайн захиалга авдаггүй ч) — ажлыг
 * байгууллагын сонгосон үйлчилгээ (Tenant.serviceKeys, бүх салбарт) эсвэл
 * ангиллын холбоос (Category.systemServiceKeyId, салбараар) гүйцэтгэнэ.
 * Захиалга авдаг (bookable) газар эхэнд.
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

  const allowedPlans = await plansWithFeature(PLAN_LIMIT_CODES.ENABLE_APPOINTMENTS);
  const now = new Date();
  const tenants = await prisma.tenant.findMany({
    where: {
      ...PUBLIC_TENANT_WHERE,
      branches: { some: { isActive: true } },
      // Сонгосон үйлчилгээ бүрийг (байгууллагын сонголт эсвэл ангилал) хийдэг
      // tenant-уудыг л DB-ээс авна (салбар түвшний шалгалт доор).
      AND: ids.map((id) => ({
        OR: [
          { serviceKeys: { some: { id } } },
          { categories: { some: { isActive: true, ...BOOKABLE_CATEGORY_WHERE, systemServiceKeyId: id } } },
        ],
      })),
    },
    orderBy: { name: "asc" },
    select: {
      slug: true,
      name: true,
      logoUrl: true,
      phone1: true,
      acceptsOnlineBooking: true,
      plan: true,
      serviceKeys: { where: { id: { in: ids } }, select: { id: true } },
      branches: {
        where: { isActive: true },
        orderBy: { isPrimary: "desc" },
        select: {
          id: true,
          name: true,
          phone: true,
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

  const keysParam = ids.map(encodeURIComponent).join(",");
  const results: BookingBranchResult[] = [];
  for (const t of tenants) {
    const bookable = isTenantBookable(t, allowedPlans);
    const tenantKeyIds = new Set(t.serviceKeys.map((k) => k.id));
    for (const b of t.branches) {
      const categoryKeyIds = new Set(
        t.categories
          .filter((c) => c.branches.length === 0 || c.branches.some((x) => x.id === b.id))
          .map((c) => c.systemServiceKeyId),
      );
      const coversAll = ids.every((id) => tenantKeyIds.has(id) || categoryKeyIds.has(id));
      if (!coversAll) continue;
      // Ангиллаар бүрэн таарвал /book/branch (ангилал урьдчилан сонгогдоно);
      // зөвхөн байгууллагын сонголтоор бол /org (ажлаа чөлөөтэй сонгоно).
      const categoriesCoverAll = ids.every((id) => categoryKeyIds.has(id));
      const href = !bookable
        ? `/org/${t.slug}/branch/${encodeURIComponent(b.id)}`
        : categoriesCoverAll
          ? `/book/branch/${encodeURIComponent(b.id)}?keys=${keysParam}`
          : `/org/${t.slug}?branch=${encodeURIComponent(b.id)}`;
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
        bookable,
        phone: b.phone ?? t.phone1 ?? null,
        href,
      });
    }
  }
  // Захиалга авдаг газар эхэнд (тогтвортой эрэмбэ — дотроо нэрээр).
  return results.sort((a, b) => Number(b.bookable) - Number(a.bookable));
}
