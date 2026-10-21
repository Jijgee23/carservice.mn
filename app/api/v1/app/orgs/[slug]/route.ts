import { BOOKABLE_CATEGORY_WHERE } from "@/lib/categories";
import { enforceRateLimit, jsonError, jsonOk, PUBLIC_CATALOG_RATE_LIMIT } from "@/lib/api";
import { resolveCategoryDurationMinutes } from "@/lib/category-duration";
import { PLAN_LIMIT_CODES } from "@/lib/plan-limits";
import { plansWithFeature } from "@/lib/plan-limits-server";
import { prisma } from "@/lib/prisma";
import { setBypassContext } from "@/lib/tenant-context";
import { branchScheduleDisplaySelect } from "@/lib/branch-effective-schedule-server";

// GET /api/v1/app/orgs/[slug] — байгууллагын дэлгэрэнгүй + салбарууд (нийтэд).
// Booking v2: салбар бүрд санал болгох ангилалуудыг шийдэгдсэн хугацаатай нь
// (category default ?? 30) хавсаргана.
export async function GET(
  req: Request,
  ctx: { params: Promise<{ slug: string }> },
) {
  const limited = enforceRateLimit(req, "public-catalog", PUBLIC_CATALOG_RATE_LIMIT);
  if (limited) return limited;
  // Нийтэд нээлттэй, slug-аар Tenant олохоос өмнө tenant тодорхойгүй тул bypass.
  setBypassContext();
  const { slug } = await ctx.params;
  const allowedPlans = await plansWithFeature(PLAN_LIMIT_CODES.ONLINE_BOOKING);
  const org = await prisma.tenant.findFirst({
    where: {
      slug,
      acceptsOnlineBooking: true,
      suspended: false,
      isTest: false,
      plan: { in: allowedPlans },
    },
    select: {
      slug: true,
      name: true,
      logoUrl: true,
      phone1: true,
      branches: {
        orderBy: { isPrimary: "desc" },
        select: {
          id: true,
          name: true,
          city: true,
          district: true,
          khoroo: true,
          address: true,
          latitude: true,
          longitude: true,
          ...branchScheduleDisplaySelect(),
        },
      },
      // Онлайн захиалгад санал болгох идэвхтэй ангилалууд. `branches` хоосон бол
      // тухайн ангилал БҮХ салбарт хамаарна (categories.ts-ийн дүрэмтэй нийцтэй).
      categories: {
        where: { isActive: true, ...BOOKABLE_CATEGORY_WHERE }, // зөвхөн ажил үйлчилгээний ангилал
        orderBy: { name: "asc" },
        select: {
          id: true,
          name: true,
          durationMinutes: true,
          systemServiceKeyId: true,
          branches: { select: { id: true } },
        },
      },
    },
  });
  if (!org) return jsonError(404, "Байгууллага олдсонгүй.");

  const { categories, branches, ...orgRest } = org;

  // Салбар бүрд: тухайн салбарт хамаарах ангилалуудыг шийдэгдсэн хугацаатай нь.
  const branchesWithCategories = branches.map((b) => {
    const offered = categories.filter(
      (c) => c.branches.length === 0 || c.branches.some((cb) => cb.id === b.id),
    );
    return {
      ...b,
      categories: offered.map((c) => ({
        id: c.id,
        name: c.name,
        systemServiceKeyId: c.systemServiceKeyId,
        durationMinutes: resolveCategoryDurationMinutes({
          categoryDefault: c.durationMinutes,
        }),
      })),
    };
  });

  return jsonOk({ org: { ...orgRest, branches: branchesWithCategories } });
}
