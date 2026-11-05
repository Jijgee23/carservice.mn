// Зөвхөн server-аас дуудах (Prisma-тай) багцын модулийн helper-ууд.
// Client component-аас ЭНЭ ФАЙЛЫГ ИМПОРТЛОХ ХЭРЭГГҮЙ — `lib/plan-limits.ts`
// дотроос тогтмол өгөгдлийг авна. Тоон хязгаар байхгүй (багц модулиар ялгардаг).

import type { Plan } from "@/app/generated/prisma/enums";
import { DEFAULT_PLAN_LIMITS, type PlanLimitCode } from "./plan-limits";
import { prisma } from "./prisma";

const ALL_PLANS: Plan[] = ["FREE", "BUSINESS", "ENTERPRISE"];

/**
 * Тенантын багцад тухайн модуль (BOOLEAN код) нээлттэй эсэх — super admin-ий
 * PlanLimit override, байхгүй бол DEFAULT_PLAN_LIMITS.
 */
export async function isFeatureEnabled(
  tenantId: string,
  code: PlanLimitCode,
): Promise<boolean> {
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { plan: true },
  });
  if (!tenant) throw new Error("Тенант олдсонгүй.");

  const limit = await prisma.planLimit.findUnique({
    where: { plan_code: { plan: tenant.plan, code } },
    select: { boolValue: true },
  });
  if (limit && limit.boolValue != null) return limit.boolValue === true;
  return DEFAULT_PLAN_LIMITS[tenant.plan][code].boolValue === true;
}

/**
 * Тухайн BOOLEAN feature идэвхтэй байгаа бүх plan-уудыг буцаана (override +
 * default). Каталог гэх мэт олон тенантыг нэг where-ээр шүүхэд:
 *   where: { plan: { in: await plansWithFeature("online_booking") } }
 */
export async function plansWithFeature(code: PlanLimitCode): Promise<Plan[]> {
  const overrides = await prisma.planLimit.findMany({
    where: { code },
    select: { plan: true, boolValue: true },
  });
  const overrideMap = new Map(overrides.map((o) => [o.plan, o.boolValue]));
  return ALL_PLANS.filter((p) => {
    const ov = overrideMap.get(p);
    if (ov != null) return ov === true;
    return DEFAULT_PLAN_LIMITS[p][code].boolValue === true;
  });
}
