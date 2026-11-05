import type { ReactNode } from "react";
import { ModuleGate } from "@/app/dashboard/_components/module-gate";
import { DiagnosticsTabs } from "./tabs";

export default function DiagnosticsLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <ModuleGate modules="enable_diagnostics">
      <div className="flex-1 flex flex-col min-h-0">
        <DiagnosticsTabs />
        <div className="flex-1 flex flex-col min-h-0">{children}</div>
      </div>
    </ModuleGate>
  );
}
