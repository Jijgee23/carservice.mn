import type { PublicReview } from "@/lib/reviews-public";

/** Нийтийн хуудасны үнэлгээний жагсаалт (байгууллага/салбар). */
export function PublicReviews({
  rating,
  count,
  reviews,
}: {
  rating: number | null;
  count: number;
  reviews: PublicReview[];
}) {
  if (count === 0) return null;
  return (
    <section className="rounded-2xl border border-[var(--oc-line)] bg-[var(--oc-panel)] p-5 sm:p-6">
      <div className="mb-4 flex items-center gap-3">
        <div className="flex h-12 w-12 shrink-0 flex-col items-center justify-center rounded-xl bg-amber-400/15">
          <span className="text-lg font-bold leading-none tabular-nums text-[var(--oc-ink)]">{rating?.toFixed(1)}</span>
        </div>
        <div>
          <h2 className="text-base font-semibold text-[var(--oc-ink)]">Үйлчлүүлэгчдийн үнэлгээ</h2>
          <div className="text-xs text-[var(--oc-muted3)]">
            <Stars value={Math.round(rating ?? 0)} /> <span className="ml-1">{count} үнэлгээ</span>
          </div>
        </div>
      </div>
      <ul className="flex flex-col divide-y divide-[var(--oc-line2)]">
        {reviews.map((r) => (
          <li key={r.id} className="py-3.5 first:pt-0 last:pb-0">
            <div className="flex items-center justify-between gap-3 text-sm">
              <span className="flex items-center gap-2 min-w-0">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--oc-panel2)] text-xs font-semibold text-[var(--oc-muted)]">
                  {r.reviewer.slice(0, 1).toUpperCase()}
                </span>
                <span className="truncate font-medium text-[var(--oc-ink2)]">{r.reviewer}</span>
                {r.verified ? (
                  <span className="shrink-0 rounded-full bg-emerald-500/10 px-1.5 py-px text-[10px] font-semibold text-emerald-400 light:text-emerald-700">
                    ✓ Үйлчлүүлсэн
                  </span>
                ) : null}
                <Stars value={r.rating} />
              </span>
              <span className="shrink-0 text-xs text-[var(--oc-muted3)]">{r.createdAt.toLocaleDateString("mn-MN")}</span>
            </div>
            {r.comment ? <p className="mt-2 whitespace-pre-wrap text-sm text-[var(--oc-ink2)]">{r.comment}</p> : null}
            {r.reply ? (
              <div className="mt-2.5 rounded-xl border-l-2 border-[var(--oc-accent)] bg-[var(--oc-panel2)] px-3 py-2.5 text-sm">
                <div className="mb-1 text-xs font-semibold text-[var(--oc-muted)]">Засварын газрын хариу</div>
                <p className="whitespace-pre-wrap text-[var(--oc-ink2)]">{r.reply}</p>
              </div>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

function Stars({ value }: { value: number }) {
  return (
    <span className="whitespace-nowrap text-xs" aria-label={`${value} од`}>
      <span className="text-amber-400">{"★".repeat(value)}</span>
      <span className="text-[var(--oc-line)]">{"★".repeat(Math.max(0, 5 - value))}</span>
    </span>
  );
}
