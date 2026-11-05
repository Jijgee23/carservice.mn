import type { ReactNode } from "react";
import { ModuleGate } from "@/app/dashboard/_components/module-gate";

// Багцын модулийн хаалт (lib/plan-modules.ts DASHBOARD_MODULE_PATHS-тай нийцнэ).
export default function AuditModuleLayout({ children }: { children: ReactNode }) {
  return <ModuleGate modules="enable_audit">{children}</ModuleGate>;
}
