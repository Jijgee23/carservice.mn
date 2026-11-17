"use client";

import { useActionState, useMemo, useState } from "react";
import {
  saveTenantServiceKeysAction,
  type ServiceKeysState,
} from "@/app/_actions/tenant-service-keys";
import { Btn } from "@/app/_components/landing-ops-ui";

type Choice = { id: string; name: string; description: string | null };

/**
 * «Танайх ямар үйлчилгээ үзүүлдэг вэ?» — системийн үйлчилгээний төрлүүдээс
 * олныг сонгоно (дор хаяж 1). Gate dialog болон Тохиргоо хуудсанд хоёуланд нь.
 */
export function ServiceKeysPicker({
  keys,
  initialSelected,
  submitLabel = "Хадгалах",
}: {
  keys: Choice[];
  initialSelected: string[];
  submitLabel?: string;
}) {
  const [state, formAction, pending] = useActionState<ServiceKeysState, FormData>(
    saveTenantServiceKeysAction,
    null,
  );
  const [selected, setSelected] = useState<Set<string>>(() => new Set(initialSelected));
  const [query, setQuery] = useState("");
  const visible = useMemo(() => {
    const q = query.trim().toLocaleLowerCase();
    return q ? keys.filter((k) => k.name.toLocaleLowerCase().includes(q)) : keys;
  }, [keys, query]);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <form action={formAction} className="flex flex-col gap-4">
      {keys.length > 8 ? (
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Үйлчилгээ хайх…"
          className="auth-input h-10"
          aria-label="Үйлчилгээ хайх"
        />
      ) : null}

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {visible.map((k) => {
          const on = selected.has(k.id);
          return (
            <label
              key={k.id}
              className={`flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2.5 transition-colors ${
                on
                  ? "border-[var(--oc-accent)] bg-[var(--oc-accent)]/10"
                  : "border-[var(--oc-line)] hover:border-[var(--oc-muted4)]"
              }`}
            >
              <input
                type="checkbox"
                name="serviceKeyIds"
                value={k.id}
                checked={on}
                onChange={() => toggle(k.id)}
                className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--oc-accent)]"
              />
              <span className="min-w-0">
                <span className="block text-sm font-medium text-[var(--oc-ink)]">{k.name}</span>
                {k.description ? (
                  <span className="block text-xs text-[var(--oc-muted3)]">{k.description}</span>
                ) : null}
              </span>
            </label>
          );
        })}
      </div>
      {/* Хайлтаар нуугдсан сонголтууд ч илгээгдэнэ. */}
      {[...selected]
        .filter((id) => !visible.some((k) => k.id === id))
        .map((id) => (
          <input key={id} type="hidden" name="serviceKeyIds" value={id} />
        ))}

      {state?.message ? (
        <p
          role={state.ok ? "status" : "alert"}
          className={`text-sm ${state.ok ? "text-emerald-500" : "text-red-400"}`}
        >
          {state.message}
        </p>
      ) : null}

      <div className="flex items-center justify-between gap-3">
        <span className="text-xs text-[var(--oc-muted3)]">{selected.size} сонгосон</span>
        <Btn type="submit" disabled={pending || selected.size === 0}>
          {pending ? "Хадгалж байна..." : submitLabel}
        </Btn>
      </div>
    </form>
  );
}
