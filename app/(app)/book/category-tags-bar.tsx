"use client";

import type { ServiceKey } from "./category-picker-grid";

/**
 * Сонгосон ажлын төрлүүдийг жижиг tag хэлбэрээр харуулна + нэмэх товч.
 * Tag дээрх × дарахад ШУУД (modal нээлгүйгээр) тухайн категорийг хасна —
 * олон сонголтоос нэгийг хасахад modal нээх шаардлагагүй байхын тулд.
 */
export function CategoryTagsBar({
  serviceKeys,
  selectedIds,
  onRemove,
  onOpenPicker,
}: {
  serviceKeys: ServiceKey[];
  selectedIds: string[];
  onRemove: (id: string) => void;
  onOpenPicker: () => void;
}) {
  const selected = selectedIds
    .map((id) => serviceKeys.find((k) => k.id === id))
    .filter((k): k is ServiceKey => Boolean(k));

  return (
    <div className="flex flex-wrap items-center gap-2">
      {selected.length === 0 ? (
        <span className="text-sm text-[var(--oc-muted3)]">
          Ажлын төрөл сонгоогүй байна.
        </span>
      ) : (
        selected.map((k) => (
          <span
            key={k.id}
            className="inline-flex items-center gap-1.5 rounded-full border border-[var(--oc-accent)]/30 bg-[var(--oc-accent)]/10 pl-3 pr-1.5 py-1 text-xs font-medium text-[var(--oc-ink)]"
          >
            {k.name}
            <button
              type="button"
              onClick={() => onRemove(k.id)}
              aria-label={`${k.name}-г хасах`}
              className="w-4 h-4 shrink-0 flex items-center justify-center rounded-full text-[var(--oc-muted3)] hover:text-[var(--oc-ink)] hover:bg-[var(--oc-panel2)] transition-colors"
            >
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 6 6 18" />
                <path d="m6 6 12 12" />
              </svg>
            </button>
          </span>
        ))
      )}
      <button
        type="button"
        onClick={onOpenPicker}
        // Хайлтын гол алхам — сонголтгүй үед үндсэн (дүүрэн) товч, сонгосны
        // дараа tag-уудтай өрсөлдөхгүй accent outline болно.
        className={
          selected.length === 0
            ? "inline-flex items-center gap-1.5 rounded-full bg-[var(--oc-accent)] px-4 py-2 text-sm font-semibold text-[var(--oc-on-accent)] shadow-sm hover:bg-[var(--oc-accent-hi)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--oc-accent)]/50"
            : "inline-flex items-center gap-1.5 rounded-full border border-[var(--oc-accent)]/50 bg-[var(--oc-accent)]/10 px-3.5 py-1.5 text-sm font-medium text-[var(--oc-accent)] hover:bg-[var(--oc-accent)]/20 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--oc-accent)]/50"
        }
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 5v14M5 12h14" />
        </svg>
        Ажлын төрөл нэмэх
      </button>
    </div>
  );
}
