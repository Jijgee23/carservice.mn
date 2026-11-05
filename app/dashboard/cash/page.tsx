import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { getEnabledModules } from "@/lib/plan-modules-server";

// «Санхүү» модуль багцад ороогүй бол орлого/зарлагын хуудас байхгүй тул
// үргэлж нээлттэй кассын ээлж рүү.
export default async function CashIndexPage() {
  const user = await requireUser();
  const finance = (await getEnabledModules(user.tenant.plan)).has("enable_finance");
  redirect(finance ? "/dashboard/cash/transactions" : "/dashboard/cash/sessions");
}
