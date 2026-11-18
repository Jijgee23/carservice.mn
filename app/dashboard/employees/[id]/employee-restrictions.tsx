"use client";

import { toggleEmployeeRestrictionAction } from "@/app/_actions/employee-restrictions";
import { PermissionSwitchList, type PermissionSwitchGroup } from "@/app/_components/permission-switch-list";

/**
 * Ажилтны ХЯЗГААРЛАЛТ: ролиос (байгууллагын тохиргооны дараах) зарим эрхийг энэ ажилтнаас хасна.
 * Эрх бүр нэг switch — унтраахад шууд хасагдана. Эрх НЭМЭХ боломжгүй: зөвхөн одоо байгаа эрхүүд.
 */
export function EmployeeRestrictions({
  employeeId,
  groups,
  initialDenied,
}: {
  employeeId: string;
  groups: { group: string; items: { code: string; label: string }[] }[];
  initialDenied: string[];
}) {
  const denied = new Set(initialDenied);
  const switchGroups: PermissionSwitchGroup[] = groups.map((g) => ({
    group: g.group,
    items: g.items.map((i) => ({ code: i.code, label: i.label, on: !denied.has(i.code) })),
  }));

  return (
    <div className="rounded-[10px] border border-[var(--oc-line)] bg-[var(--oc-panel)] p-5">
      <div className="flex items-start justify-between gap-3 mb-2">
        <h2 className="font-semibold text-[var(--oc-ink)]">Эрхийн хязгаарлалт</h2>
        <span className="font-plex-mono text-[11px] text-[var(--oc-muted3)] shrink-0">
          {initialDenied.length > 0 ? `${initialDenied.length} хассан` : "Хязгаарлаагүй"}
        </span>
      </div>
      <p className="text-xs text-[var(--oc-muted3)] mb-3">
        Эрх бүрийг switch-ээр унтраахад энэ ажилтнаас шууд хасагдана. Эрх нэмэх боломжгүй.
      </p>
      <details>
        <summary className="cursor-pointer text-sm text-[var(--oc-accent)] hover:text-[var(--oc-accent-hi)] select-none min-h-11 flex items-center">
          Эрхүүдийг харах / өөрчлөх
        </summary>
        <div className="mt-2 max-h-[32rem] overflow-y-auto pr-1">
          <PermissionSwitchList
            groups={switchGroups}
            onToggle={(code, on) => toggleEmployeeRestrictionAction(employeeId, code, on)}
          />
        </div>
      </details>
    </div>
  );
}
