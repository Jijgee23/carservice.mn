import { PageHeader } from "@/app/_components/page-header";
import { requireSuperAdmin } from "@/lib/auth/system";
import { prisma } from "@/lib/prisma";
import { PlanLimitsManager } from "./plan-limits-manager";
import { PlanPriceMatrix } from "./plan-price-matrix";

export const metadata = {
  title: "Багц / Үнэ / Модуль",
};

export default async function SystemPlanPricesPage() {
  await requireSuperAdmin();

  const [limits, prices] = await Promise.all([
    prisma.planLimit.findMany({
      orderBy: [{ plan: "asc" }, { sortOrder: "asc" }],
    }),
    prisma.planPrice.findMany({
      orderBy: [{ plan: "asc" }, { period: "asc" }],
    }),
  ]);

  return (
    <div className="p-6 sm:p-8 max-w-screen flex flex-col gap-6">
      <PageHeader
        title="Багц / Үнэ / Модуль"
        description="SuperAdmin: BUSINESS багцын үнэ болон багц тус бүрийн модулиуд. Тоон хязгаар байхгүй — нүүр хуудасны «юу багтсан» жагсаалт модулиудаас автоматаар гарна."
      />

      <PlanPriceMatrix
        prices={prices.map((p) => ({
          id: p.id,
          plan: p.plan,
          period: p.period,
          amount: p.amount.toString(),
          currency: p.currency,
          isActive: p.isActive,
          notes: p.notes,
        }))}
      />

      <PlanLimitsManager
        limits={limits.map((l) => ({
          id: l.id,
          plan: l.plan,
          code: l.code,
          intValue: l.intValue,
          boolValue: l.boolValue,
          highlighted: l.highlighted,
        }))}
      />
    </div>
  );
}
