"use client";

import { useActionState, useState } from "react";
import { saveTenantRoleOverrideAction, type RoleOverrideState } from "@/app/_actions/tenant-role-overrides";
import { Btn } from "@/app/_components/landing-ops-ui";

type Item = { code: string; label: string; inRole: boolean; on: boolean };

/**
 * Нэг ролийн «өөрчилж болох» эрхүүд. Асаалттай = энэ ролийн ажилтнууд тэр эрхтэй.
 * Ролийн анхдагчтай харьцуулж add/remove-ийг hidden input-аар илгээнэ (сервер дахин шалгана).
 */
export function RoleOverrideCard({
  roleId,
  name,
  description,
  lockedCount,
  items,
}: {
  roleId: string;
  name: string;
  description: string | null;
  lockedCount: number;
  items: Item[];
}) {
  const [state, formAction, pending] = useActionState<RoleOverrideState, FormData>(
    saveTenantRoleOverrideAction.bind(null, roleId),
    null,
  );
  const [on, setOn] = useState<Set<string>>(() => new Set(items.filter((i) => i.on).map((i) => i.code)));
  const [dirty, setDirty] = useState(false);

  function toggle(code: string) {
    setDirty(true);
    setOn((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  }

  function resetToDefault() {
    setDirty(true);
    setOn(new Set(items.filter((i) => i.inRole).map((i) => i.code)));
  }

  const add = items.filter((i) => !i.inRole && on.has(i.code)).map((i) => i.code);
  const remove = items.filter((i) => i.inRole && !on.has(i.code)).map((i) => i.code);

  return (
    <form action={formAction} className="rounded-[10px] border border-[var(--oc-line)] bg-[var(--oc-panel)] p-5 sm:p-6">
      {add.map((c) => (
        <input key={`a-${c}`} type="hidden" name="add" value={c} />
      ))}
      {remove.map((c) => (
        <input key={`r-${c}`} type="hidden" name="remove" value={c} />
      ))}

      <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
        <div className="min-w-0">
          <h2 className="font-semibold text-[var(--oc-ink)]">{name}</h2>
          {description ? <p className="text-xs text-[var(--oc-muted3)] mt-0.5">{description}</p> : null}
        </div>
        <span className="font-plex-mono text-[11px] text-[var(--oc-muted3)] shrink-0">
          {add.length + remove.length > 0 ? `${add.length} нэмсэн · ${remove.length} хассан` : "Анхдагч"}
          {lockedCount > 0 ? ` · ${lockedCount} түгжигдсэн` : ""}
        </span>
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        {items.map((i) => {
          const checked = on.has(i.code);
          return (
            <label
              key={i.code}
              className={`flex items-start gap-3 rounded-lg border p-3 min-h-11 cursor-pointer transition-colors ${
                checked
                  ? "border-[var(--oc-accent)] bg-[var(--oc-accent)]/[0.08]"
                  : "border-[var(--oc-line)] bg-[var(--oc-panel2)] hover:border-[var(--oc-line2)]"
              }`}
            >
              <input
                type="checkbox"
                checked={checked}
                onChange={() => toggle(i.code)}
                className="mt-0.5 accent-[var(--oc-accent)]"
              />
              <span className="min-w-0 flex-1">
                <span className="block text-sm text-[var(--oc-ink2)]">{i.label}</span>
                <span className="block text-xs text-[var(--oc-muted3)]">
                  {i.inRole ? "Ролийн анхдагч эрх" : "Ролид анхдагчаар байхгүй"}
                </span>
              </span>
            </label>
          );
        })}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Btn type="submit" disabled={pending || !dirty}>
          {pending ? "…" : "Хадгалах"}
        </Btn>
        <button
          type="button"
          onClick={resetToDefault}
          className="text-xs text-[var(--oc-muted3)] hover:text-[var(--oc-ink2)] transition-colors"
        >
          Анхдагч руу буцаах
        </button>
        {state?.message ? (
          <span
            role="status"
            className={`text-xs ${state.ok ? "text-[var(--oc-ok)]" : "text-red-400 light:text-red-600"}`}
          >
            {state.message}
          </span>
        ) : null}
      </div>
    </form>
  );
}
