import type { CreditBreakdown } from "@/lib/credit-score";

/**
 * Credit score-ын харагдац (тенантын тохиргоо, super admin-ий тенантын хуудас).
 * Server component — breakdown нь Tenant.creditBreakdown (lib/credit-score.ts).
 */
export function CreditScoreCard({
  score,
  breakdown,
  updatedAt,
  threshold,
  blocked,
}: {
  score: number | null;
  breakdown: CreditBreakdown | null;
  updatedAt: Date | null;
  threshold: number;
  blocked: "hidden" | "suspended" | null;
}) {
  if (score == null || !breakdown) {
    return <p className="text-sm text-[var(--oc-muted3)]">Оноо хараахан тооцогдоогүй байна (өдөрт нэг удаа шинэчлэгдэнэ).</p>;
  }
  const tone = score < threshold ? "text-red-400 light:text-red-700" : score < threshold + 15 ? "text-[var(--oc-warn)]" : "text-[var(--oc-ok)]";
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-4">
        <div className={`font-plex-mono text-4xl font-semibold ${tone}`}>{score}</div>
        <div className="pb-1 text-xs text-[var(--oc-muted3)]">
          / 100 · блоклох босго {threshold}
          {updatedAt ? ` · ${updatedAt.toLocaleDateString("mn-MN")}-нд шинэчлэгдсэн` : ""}
        </div>
      </div>
      {blocked ? (
        <p className="rounded-lg border border-red-500/30 bg-red-500/[0.08] px-3 py-2 text-sm text-red-300 light:text-red-700">
          {blocked === "hidden"
            ? "Credit score бага тул үйлчлүүлэгчийн апп, онлайн захиалгаас түр нуугдсан байна."
            : "Credit score бага тул систем түр зогсоогдсон байна."}{" "}
          Оноо сэргэхэд автоматаар нээгдэнэ.
        </p>
      ) : score < threshold + 15 ? (
        <p className="text-xs text-[var(--oc-warn)]">
          Оноо босгод ойртож байна — {threshold}-аас доош орвол автоматаар блоклогдоно.
        </p>
      ) : null}
      <ul className="grid gap-2 sm:grid-cols-2">
        {breakdown.components.map((c) => (
          <li key={c.key} className="rounded-lg border border-[var(--oc-line)] px-3 py-2">
            <div className="flex items-center justify-between gap-2 text-sm">
              <span className="text-[var(--oc-ink2)]">{c.label}</span>
              <span className="font-plex-mono text-xs text-[var(--oc-muted2)]">{c.detail}</span>
            </div>
            <div className="mt-1.5 h-1.5 rounded-full bg-[var(--oc-panel2)]">
              <div className="h-1.5 rounded-full bg-[var(--oc-accent)]" style={{ width: `${Math.round(c.value * 100)}%` }} />
            </div>
          </li>
        ))}
      </ul>
      {breakdown.adjustment ? (
        <p className="text-xs text-[var(--oc-muted3)]">
          Системийн админы залруулга: {breakdown.adjustment > 0 ? "+" : ""}
          {breakdown.adjustment}
        </p>
      ) : null}
    </div>
  );
}
