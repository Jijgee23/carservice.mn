import "server-only";

import { cache } from "react";
import { NextResponse } from "next/server";
import type { Plan } from "@/app/generated/prisma/enums";
import { DEFAULT_PLAN_LIMITS, MODULE_LIMIT_CODES, type PlanModuleCode } from "@/lib/plan-limits";
import {
  API_MODULE_PATHS,
  MODULE_DISABLED_CODE,
  ModuleDisabledError,
  firstDisabledModule,
  moduleDisabledMessage,
} from "@/lib/plan-modules";
import { prisma } from "@/lib/prisma";

/**
 * Тухайн багцад нээлттэй модулиуд: super admin-ий PlanLimit override, байхгүй
 * бол DEFAULT_PLAN_LIMITS. PlanLimit нь тенантын хүснэгт биш (RLS-гүй).
 */
export const getEnabledModules = cache(
  async (plan: Plan): Promise<Set<PlanModuleCode>> => {
    const overrides = await prisma.planLimit.findMany({
      where: { plan, code: { in: [...MODULE_LIMIT_CODES] } },
      select: { code: true, boolValue: true },
    });
    const overrideMap = new Map(overrides.map((o) => [o.code, o.boolValue]));
    const enabled = new Set<PlanModuleCode>();
    for (const code of MODULE_LIMIT_CODES) {
      const ov = overrideMap.get(code);
      const on = ov != null ? ov : DEFAULT_PLAN_LIMITS[plan][code].boolValue === true;
      if (on) enabled.add(code);
    }
    return enabled;
  },
);

const getTenantPlan = cache(async (tenantId: string): Promise<Plan> => {
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { plan: true },
  });
  if (!tenant) throw new Error("Тенант олдсонгүй.");
  return tenant.plan;
});

export async function getTenantModules(tenantId: string): Promise<Set<PlanModuleCode>> {
  return getEnabledModules(await getTenantPlan(tenantId));
}

export async function isModuleEnabled(
  tenantId: string,
  code: PlanModuleCode,
): Promise<boolean> {
  return (await getTenantModules(tenantId)).has(code);
}

/** Server action / shared command-д: модуль хаалттай бол ModuleDisabledError шиднэ. */
export async function assertModuleEnabled(
  tenantId: string,
  code: PlanModuleCode,
): Promise<void> {
  if (!(await isModuleEnabled(tenantId, code))) throw new ModuleDisabledError(code);
}

export function moduleDisabledResponse(code: PlanModuleCode): NextResponse {
  // lib/api-ийн jsonError-той ижил хэлбэр (lib/api энэ файлыг импортлодог тул
  // давхар импорт үүсгэхгүйн тулд шууд бүтээнэ).
  return NextResponse.json(
    { error: moduleDisabledMessage(code), code: MODULE_DISABLED_CODE, module: code },
    { status: 403 },
  );
}

/** Dashboard-ийн route.ts (экспорт г.м.)-д: модулиудын аль нэг хаалттай бол 403, эс бөгөөс null. */
export async function moduleGateForPlan(
  plan: Plan,
  codes: PlanModuleCode[],
): Promise<NextResponse | null> {
  const enabled = await getEnabledModules(plan);
  const missing = codes.find((c) => !enabled.has(c));
  return missing ? moduleDisabledResponse(missing) : null;
}

/** /api/v1 route: замд шаардлагатай модуль хаалттай бол 403 Response, эс бөгөөс null. */
export async function moduleGateForApiPath(
  pathname: string,
  plan: Plan,
): Promise<NextResponse | null> {
  if (!API_MODULE_PATHS.some(([prefix]) => pathname === prefix || pathname.startsWith(`${prefix}/`))) {
    return null;
  }
  const disabled = firstDisabledModule(pathname, API_MODULE_PATHS, await getEnabledModules(plan));
  return disabled ? moduleDisabledResponse(disabled) : null;
}
