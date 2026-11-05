import Link from "next/link";

/**
 * Жагсаалтын хуудаслалт — server component. Одоогийн идэвхтэй шүүлтүүрүүдийг
 * (`params`) хадгалж, `pageParam` (default `page`)-ийг л солино.
 *
 * `totalPages <= 1` үед юу ч render хийхгүй.
 */
const ACTIVE_PAGE_TONE = {
  accent:
    "bg-[var(--oc-accent)]/20 text-[var(--oc-accent)] border border-[var(--oc-accent)]/30",
  danger: "bg-red-500/20 text-red-400 light:text-red-600 border border-red-500/30",
} as const;

export function Pagination({
  page,
  totalPages,
  total,
  params = {},
  pageParam = "page",
  className,
  tone = "accent",
}: {
  page: number;
  totalPages: number;
  total?: number;
  params?: Record<string, string | number | null | undefined>;
  pageParam?: string;
  className?: string;
  tone?: keyof typeof ACTIVE_PAGE_TONE;
}) {
  if (totalPages <= 1) return null;

  const makeHref = (p: number) => {
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (k === pageParam) continue;
      if (v !== undefined && v !== null && v !== "") sp.set(k, String(v));
    }
    if (p > 1) sp.set(pageParam, String(p));
    const qs = sp.toString();
    return qs ? `?${qs}` : "?";
  };

  // Идэвхтэй хуудасны эргэн тойронд цонх — эхэн/төгсгөлийг үргэлж харуулна.
  const windowSize = 1;
  const pages: (number | "…")[] = [];
  for (let p = 1; p <= totalPages; p++) {
    if (
      p === 1 ||
      p === totalPages ||
      (p >= page - windowSize && p <= page + windowSize)
    ) {
      pages.push(p);
    } else if (pages[pages.length - 1] !== "…") {
      pages.push("…");
    }
  }

  return (
    <div
      className={`px-5 py-3 border-t border-[var(--oc-line2)] flex items-center justify-between gap-3 text-xs ${className ?? ""}`}
    >
      <span className="text-[var(--oc-muted3)] whitespace-nowrap">
        {typeof total === "number" ? (
          <>
            Нийт {total.toLocaleString("mn-MN")} · {page}/{totalPages} хуудас
          </>
        ) : (
          <>
            {page} / {totalPages} хуудас
          </>
        )}
      </span>

      <div className="flex items-center gap-1">
        {page > 1 ? (
          <Link
            href={makeHref(page - 1)}
            scroll={false}
            className="text-[var(--oc-muted)] hover:text-[var(--oc-ink)] px-2.5 py-1 rounded-md hover:bg-[var(--oc-panel2)] transition-colors"
          >
            ← Өмнөх
          </Link>
        ) : (
          <span className="text-[var(--oc-muted4)] px-2.5 py-1">← Өмнөх</span>
        )}

        <div className="hidden sm:flex items-center gap-1">
          {pages.map((p, i) =>
            p === "…" ? (
              <span key={`gap-${i}`} className="text-[var(--oc-muted4)] px-1.5">
                …
              </span>
            ) : p === page ? (
              <span
                key={p}
                className={`min-w-[1.75rem] text-center px-2 py-1 rounded-md ${ACTIVE_PAGE_TONE[tone]}`}
              >
                {p}
              </span>
            ) : (
              <Link
                key={p}
                href={makeHref(p)}
                scroll={false}
                className="min-w-[1.75rem] text-center px-2 py-1 rounded-md text-[var(--oc-muted)] hover:text-[var(--oc-ink)] hover:bg-[var(--oc-panel2)] transition-colors"
              >
                {p}
              </Link>
            ),
          )}
        </div>

        {page < totalPages ? (
          <Link
            href={makeHref(page + 1)}
            scroll={false}
            className="text-[var(--oc-muted)] hover:text-[var(--oc-ink)] px-2.5 py-1 rounded-md hover:bg-[var(--oc-panel2)] transition-colors"
          >
            Дараах →
          </Link>
        ) : (
          <span className="text-[var(--oc-muted4)] px-2.5 py-1">Дараах →</span>
        )}
      </div>
    </div>
  );
}
