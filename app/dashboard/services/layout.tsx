import type { ReactNode } from "react";
import { requireUser } from "@/lib/auth";
import { MODULE_LIMIT_CODES } from "@/lib/plan-limits";
import { getEnabledModules } from "@/lib/plan-modules-server";
import { ServicesTabs } from "./tabs";

export default async function ServicesLayout({ children }: { children: ReactNode }) {
  const user = await requireUser();
  const enabled = await getEnabledModules(user.tenant.plan);
  const lockedModules = MODULE_LIMIT_CODES.filter((m) => !enabled.has(m));
  return (
    <div className="flex-1 flex flex-col min-h-0">
      <ServicesTabs lockedModules={lockedModules} />
      <div className="flex-1 flex flex-col min-h-0">{children}</div>
    </div>
  );
}
