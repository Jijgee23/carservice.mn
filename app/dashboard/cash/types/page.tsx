import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { hasPermission } from "@/lib/auth/roles";
import { listCashTypes, serializeCashType } from "@/lib/cash/types";
import { TypesManager } from "./types-manager";

export const metadata = {
  title: "Кассын ангилал",
};

export default async function CashTypesPage() {
  const user = await requireUser();
  if (!hasPermission(user, "cash.manage")) redirect("/dashboard");
  const rows = await listCashTypes({ actor: user, includeInactive: true });
  const types = rows.map(serializeCashType).map((t) => ({
    id: t.id,
    direction: t.direction as "INCOME" | "EXPENSE",
    name: t.name,
    isSystem: t.isSystem,
    isActive: t.isActive,
  }));

  return (
    <div className="p-4 sm:p-6 max-w-full flex-1 flex flex-col min-h-0 w-full">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-[var(--oc-ink)]">Кассын ангилал</h1>
        <p className="text-sm text-[var(--oc-muted3)] mt-1">
          Орлого, зарлагын ангилал. Системийн ангилал автомат бичлэгт ашиглагддаг тул засах, идэвхгүй болгох боломжгүй.
        </p>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
        <TypesManager direction="INCOME" title="Орлогын ангилал" types={types.filter((t) => t.direction === "INCOME")} />
        <TypesManager direction="EXPENSE" title="Зарлагын ангилал" types={types.filter((t) => t.direction === "EXPENSE")} />
      </div>
    </div>
  );
}
