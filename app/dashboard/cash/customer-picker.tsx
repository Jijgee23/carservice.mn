"use client";

import { useEffect, useRef, useState } from "react";
import { searchCashCustomersAction } from "@/app/_actions/cash";

type Option = { id: string; name: string };

/** Async, debounced, tenant-scoped customer picker (server-side search, max ~20 rows). Emits a hidden `customerId` field. */
export function CustomerPicker({ id, name = "customerId" }: { id: string; name?: string }) {
  const [selected, setSelected] = useState<Option | null>(null);
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState<Option[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);

  useEffect(() => {
    if (!open || selected) return;
    const mine = ++seq.current;
    const timer = setTimeout(
      async () => {
        setLoading(true);
        try {
          const res = await searchCashCustomersAction(q);
          if (mine !== seq.current) return;
          if (res.ok) {
            setResults(res.customers);
            setError(null);
          } else {
            setResults([]);
            setError(res.message);
          }
        } catch {
          if (mine !== seq.current) return;
          setResults([]);
          setError("Хайлт амжилтгүй.");
        } finally {
          if (mine === seq.current) setLoading(false);
        }
      },
      q ? 250 : 0,
    );
    return () => clearTimeout(timer);
  }, [q, open, selected]);

  return (
    <div className="relative">
      <input type="hidden" name={name} value={selected?.id ?? ""} />
      {selected ? (
        <div id={id} className="compact-input w-full flex items-center justify-between gap-2">
          <span className="truncate">{selected.name}</span>
          <button
            type="button"
            onClick={() => {
              setSelected(null);
              setQ("");
            }}
            className="shrink-0 text-xs text-[var(--oc-accent)] hover:text-[var(--oc-accent-hi)]"
          >
            Солих
          </button>
        </div>
      ) : (
        <>
          <input
            id={id}
            type="search"
            value={q}
            maxLength={100}
            autoComplete="off"
            placeholder="Нэр, утас эсвэл регистрээр хайх (заавал биш)"
            onChange={(e) => setQ(e.target.value)}
            onFocus={() => setOpen(true)}
            onBlur={() => setTimeout(() => setOpen(false), 150)}
            className="compact-input w-full"
          />
          {open ? (
            <div className="absolute z-20 mt-1 w-full max-h-56 overflow-auto rounded-lg border border-[var(--oc-line)] bg-[var(--oc-panel)] shadow-lg">
              {error ? (
                <p className="px-3 py-2 text-xs text-red-400 light:text-red-600">{error}</p>
              ) : loading && results.length === 0 ? (
                <p className="px-3 py-2 text-xs text-[var(--oc-muted3)]">Хайж байна...</p>
              ) : results.length === 0 ? (
                <p className="px-3 py-2 text-xs text-[var(--oc-muted3)]">Харилцагч олдсонгүй.</p>
              ) : (
                <ul role="listbox">
                  {results.map((c) => (
                    <li key={c.id} role="option" aria-selected={false}>
                      <button
                        type="button"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => {
                          setSelected(c);
                          setOpen(false);
                        }}
                        className="w-full px-3 py-2 text-left text-sm text-[var(--oc-ink)] hover:bg-white/[0.06]"
                      >
                        {c.name}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
