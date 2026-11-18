"use client";

import { useActionState, useState } from "react";
import { saveEmployeeRestrictionsAction, type EmployeeRestrictionState } from "@/app/_actions/employee-restrictions";
import { Btn } from "@/app/_components/landing-ops-ui";

type Item = { code: string; label: string };
type Group = { group: string; items: Item[] };

/**
 * Ажилтны ХЯЗГААРЛАЛТ: ролиос (байгууллагын тохиргооны дараах) зарим эрхийг энэ ажилтнаас хасна.
 * Асаалттай = эрхтэй, унтраавал хасна. Эрх НЭМЭХ боломжгүй — зөвхөн одоо байгаа эрхүүд харагдана.
 */
export function EmployeeRestrictions({
  employeeId,
  groups,
  initialDenied,
}: {
  employeeId: string;
  groups: Group[];
  initialDenied: string[];
}) {
  const [state, formAction, pending] = useActionState<EmployeeRestrictionState, FormData>(
    saveEmployeeRestrictionsAction.bind(null, employeeId),
    null,
  );
  const [denied, setDenied] = useState<Set<string>>(() => new Set(initialDenied));
  const [dirty, setDirty] = useState(false);

  function toggle(code: string) {
    setDirty(true);
    setDenied((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  }

  return (
    <form action={formAction} className="rounded-[10px] border border-[var(--oc-line)] bg-[var(--oc-panel)] p-5">
      {Array.from(denied).map((code) => (
        <input key={code} type="hidden" name="denied" value={code} />
      ))}

      <div className="flex items-start justify-between gap-3 mb-2">
        <h2 className="font-semibold text-[var(--oc-ink)]">Эрхийн хязгаарлалт</h2>
        <span className="font-plex-mono text-[11px] text-[var(--oc-muted3)] shrink-0">
          {denied.size > 0 ? `${denied.size} хассан` : "Хязгаарлаагүй"}
        </span>
      </div>
      <p className="text-xs text-[var(--oc-muted3)] mb-3">
        Энэ ажилтнаас ролийн зарим эрхийг хасна. Эрх нэмэх боломжгүй.
      </p>

      <details className="group">
        <summary className="cursor-pointer text-sm text-[var(--oc-accent)] hover:text-[var(--oc-accent-hi)] select-none min-h-11 flex items-center">
          Эрхүүдийг харах / өөрчлөх
        </summary>
        <div className="mt-2 flex flex-col gap-4 max-h-[28rem] overflow-y-auto pr-1">
          {groups.map((g) => (
            <div key={g.group}>
              <div className="font-plex-mono text-[10px] uppercase tracking-[0.08em] text-[var(--oc-muted4)] font-medium mb-1.5">
                {g.group}
              </div>
              <ul className="flex flex-col gap-1">
                {g.items.map((i) => {
                  const allowed = !denied.has(i.code);
                  return (
                    <li key={i.code}>
                      <label className="flex items-center gap-2.5 min-h-9 cursor-pointer text-[13px]">
                        <input
                          type="checkbox"
                          checked={allowed}
                          onChange={() => toggle(i.code)}
                          className="accent-[var(--oc-accent)] w-4 h-4"
                        />
                        <span className={allowed ? "text-[var(--oc-ink2)]" : "text-[var(--oc-muted3)] line-through"}>
                          {i.label}
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      </details>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Btn type="submit" disabled={pending || !dirty}>
          {pending ? "…" : "Хадгалах"}
        </Btn>
        <button
          type="button"
          onClick={() => {
            setDirty(true);
            setDenied(new Set());
          }}
          className="text-xs text-[var(--oc-muted3)] hover:text-[var(--oc-ink2)] transition-colors"
        >
          Бүгдийг сэргээх
        </button>
        {state?.message ? (
          <span role="status" className={`text-xs ${state.ok ? "text-[var(--oc-ok)]" : "text-red-400 light:text-red-600"}`}>
            {state.message}
          </span>
        ) : null}
      </div>
    </form>
  );
}
