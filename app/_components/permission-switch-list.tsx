"use client";

import { useRef, useState } from "react";

export type PermissionSwitchItem = {
  code: string;
  label: string;
  /** Нэмэлт тайлбар (жишээ нь «Ролийн анхдагч эрх»). */
  hint?: string;
  on: boolean;
  /** true бол өөрчлөх боломжгүй (түгжигдсэн) — switch идэвхгүй. */
  locked?: boolean;
  lockedHint?: string;
};

export type PermissionSwitchGroup = { group: string; items: PermissionSwitchItem[] };

export type ToggleResult = { ok: boolean; message?: string };

/**
 * Эрх тус бүрийн switch. Эргүүлэхэд ШУУД серверт хадгалагдана (optimistic: эхлээд солигдож, алдаа
 * гарвал буцаж, шалтгааныг үзүүлнэ). Нэг эрхийн хүсэлт дуустал тэр switch идэвхгүй (давхар дарахаас
 * сэргийлнэ), бусад нь чөлөөтэй. Хайлт + бүлэг: олон эрхтэй (40+) жагсаалтыг уншихад хялбар.
 */
export function PermissionSwitchList({
  groups,
  onToggle,
  searchable = true,
}: {
  groups: PermissionSwitchGroup[];
  /** (code, on) → серверт хадгална. */
  onToggle: (code: string, on: boolean) => Promise<ToggleResult>;
  searchable?: boolean;
}) {
  const [state, setState] = useState<Record<string, boolean>>(() => {
    const m: Record<string, boolean> = {};
    for (const g of groups) for (const i of g.items) m[i.code] = i.on;
    return m;
  });
  const [pending, setPending] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const inFlight = useRef<Set<string>>(new Set());

  async function toggle(code: string) {
    if (inFlight.current.has(code)) return;
    inFlight.current.add(code);
    const next = !state[code];
    setError(null);
    setState((s) => ({ ...s, [code]: next }));
    setPending((p) => new Set(p).add(code));
    try {
      const r = await onToggle(code, next);
      if (!r.ok) {
        setState((s) => ({ ...s, [code]: !next }));
        setError(r.message ?? "Хадгалах үед алдаа гарлаа.");
      }
    } catch {
      setState((s) => ({ ...s, [code]: !next }));
      setError("Холболтын алдаа. Дахин оролдоно уу.");
    } finally {
      inFlight.current.delete(code);
      setPending((p) => {
        const n = new Set(p);
        n.delete(code);
        return n;
      });
    }
  }

  const q = query.trim().toLocaleLowerCase();
  const visible = groups
    .map((g) => ({ ...g, items: q ? g.items.filter((i) => i.label.toLocaleLowerCase().includes(q)) : g.items }))
    .filter((g) => g.items.length > 0);

  return (
    <div className="flex flex-col gap-4">
      {searchable ? (
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Эрх хайх…"
          aria-label="Эрх хайх"
          className="auth-input h-10 max-w-sm"
        />
      ) : null}

      <div role="status" aria-live="polite" className="min-h-4 text-xs text-red-400 light:text-red-600">
        {error}
      </div>

      {visible.length === 0 ? (
        <p className="text-sm text-[var(--oc-muted3)]">Хайлтад тохирох эрх олдсонгүй.</p>
      ) : null}

      {visible.map((g) => (
        <section key={g.group} className="rounded-[10px] border border-[var(--oc-line)] bg-[var(--oc-panel)]">
          <h3 className="px-4 pt-3 pb-1 font-plex-mono text-[10px] uppercase tracking-[0.08em] text-[var(--oc-muted4)] font-medium">
            {g.group}
          </h3>
          <ul className="divide-y divide-[var(--oc-line)]">
            {g.items.map((i) => {
              const on = state[i.code];
              const busy = pending.has(i.code);
              const disabled = Boolean(i.locked) || busy;
              return (
                <li key={i.code} className="flex items-center gap-3 px-4 py-2.5 min-h-12">
                  <div className="min-w-0 flex-1">
                    <div className={`text-sm ${i.locked ? "text-[var(--oc-muted3)]" : "text-[var(--oc-ink2)]"}`}>{i.label}</div>
                    {i.locked && i.lockedHint ? (
                      <div className="text-xs text-[var(--oc-muted3)]">🔒 {i.lockedHint}</div>
                    ) : i.hint ? (
                      <div className="text-xs text-[var(--oc-muted3)]">{i.hint}</div>
                    ) : null}
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={on}
                    aria-label={i.label}
                    disabled={disabled}
                    onClick={() => toggle(i.code)}
                    className={`relative h-6 w-11 shrink-0 rounded-full border transition-colors disabled:cursor-not-allowed ${
                      on
                        ? "border-[var(--oc-accent)] bg-[var(--oc-accent)]"
                        : "border-[var(--oc-line2)] bg-[var(--oc-panel2)]"
                    } ${disabled ? "opacity-60" : "hover:border-[var(--oc-accent-hi)]"}`}
                  >
                    <span
                      className={`absolute top-0.5 left-0.5 h-4.5 w-4.5 rounded-full bg-white shadow transition-transform ${
                        on ? "translate-x-5" : "translate-x-0"
                      }`}
                      style={{ height: 18, width: 18 }}
                    />
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
