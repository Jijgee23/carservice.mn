import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import type { PlanModuleCode } from "@/lib/plan-limits";
import { getEnabledModules } from "@/lib/plan-modules-server";

/**
 * Модулийн хавтасны layout-д: тенантын багцад модуль ороогүй бол хуудас
 * огт байхгүй мэт 404 буцаана (түгжих/upsell дэлгэц харуулахгүй — цэс,
 * холбоосуудаас ч нуугдсан). Хэд хэдэн модуль өгвөл бүгд нээлттэй байх ёстой.
 * Layout нь хавтас руу орох бүрд render хийгддэг тул багц солигдоход дахин
 * шалгагдана.
 */
export async function ModuleGate({
  modules,
  children,
}: {
  modules: PlanModuleCode | PlanModuleCode[];
  children: ReactNode;
}) {
  const user = await requireUser();
  const enabled = await getEnabledModules(user.tenant.plan);
  const missing = (Array.isArray(modules) ? modules : [modules]).some((m) => !enabled.has(m));
  if (missing) notFound();
  return <>{children}</>;
}
