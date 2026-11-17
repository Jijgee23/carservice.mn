import "server-only";

import { BOOKABLE_CATEGORY_WHERE } from "@/lib/categories";
import { PLAN_LIMIT_CODES } from "@/lib/plan-limits";
import { plansWithFeature } from "@/lib/plan-limits-server";
import { PUBLIC_TENANT_WHERE } from "@/lib/tenant-visibility";

/**
 * «Ямар ажил хийлгэх вэ?» сонголтод (web /book, mobile /api/v1/app/service-keys)
 * харуулах SystemServiceKey-ийн нөхцөл: тухайн ажлыг ОНЛАЙН ЗАХИАЛГА АВДАГ
 * (acceptsOnlineBooking + багцад «Цаг захиалга», олон нийтэд харагдах) газарт
 * идэвхтэй, захиалж болох ангилал холбогдсон байх. Өмнө нь аль ч газрын
 * ангилал хангалттай байсан тул сонгоход «салбар олдсонгүй» гардаг байв.
 * Байгууллагын өөрийн сонголт (Tenant.serviceKeys) эсвэл ангиллын холбоос.
 *
 * Одоо зөвхөн mobile-д (апп нь онлайн захиалга авдаг газрыг л харуулдаг).
 * Web /book нь бүх идэвхтэй төрлийг харуулж, захиалга авдаггүй газрыг ч
 * «Дэлгэрэнгүй»-тэй гаргана (app/_actions/book.ts).
 */
export async function bookableServiceKeyWhere() {
  const allowedPlans = await plansWithFeature(PLAN_LIMIT_CODES.ENABLE_APPOINTMENTS);
  const bookableTenant = {
    ...PUBLIC_TENANT_WHERE,
    acceptsOnlineBooking: true,
    plan: { in: allowedPlans },
    branches: { some: { isActive: true } },
  };
  return {
    isActive: true,
    OR: [
      { tenants: { some: bookableTenant } },
      { categories: { some: { isActive: true, ...BOOKABLE_CATEGORY_WHERE, tenant: bookableTenant } } },
    ],
  };
}
