import Link from "next/link";
import type { OnboardingChecklist } from "@/lib/onboarding-checklist";

/**
 * Шинэ байгууллагын эзэнд «Эхлэх алхмууд». Server component (JS-гүй). Дууссан алхам ✓, дараагийн
 * (эхний дуусаагүй) алхам тодрон «Эхлэх →» холбоостой. Бүгд дууссан бол дуудагч огт зурахгүй.
 */
export function GettingStarted({ checklist }: { checklist: OnboardingChecklist }) {
  const nextKey = checklist.steps.find((s) => !s.done)?.key;
  const pct = Math.round((checklist.doneCount / checklist.total) * 100);
  return (
    <section
      aria-labelledby="getting-started-title"
      className="rounded-[10px] border border-[var(--oc-accent)]/30 bg-[var(--oc-accent)]/[0.06] p-4 sm:p-5"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="getting-started-title" className="font-semibold text-[var(--oc-ink)]">
          Эхлэх алхмууд
        </h2>
        <span className="font-plex-mono text-xs text-[var(--oc-muted3)]">
          {checklist.doneCount}/{checklist.total} дууссан
        </span>
      </div>
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={checklist.total}
        aria-valuenow={checklist.doneCount}
        aria-label="Эхлэх алхмын явц"
        className="mt-3 h-1.5 overflow-hidden rounded-full bg-[var(--oc-line)]"
      >
        <div className="h-full rounded-full bg-[var(--oc-accent)] transition-[width]" style={{ width: `${pct}%` }} />
      </div>
      <ol className="mt-3 flex flex-col gap-2">
        {checklist.steps.map((s) => {
          const isNext = s.key === nextKey;
          return (
            <li key={s.key} className="flex items-start gap-3 min-h-11">
              <span
                aria-hidden="true"
                className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full text-[11px] ${
                  s.done
                    ? "bg-[var(--oc-ok)]/20 text-[var(--oc-ok)]"
                    : "border border-[var(--oc-line2)] text-transparent"
                }`}
              >
                ✓
              </span>
              <div className="min-w-0 flex-1">
                <div className={`text-sm ${s.done ? "text-[var(--oc-muted3)] line-through" : "text-[var(--oc-ink2)]"}`}>
                  {s.label}
                  <span className="sr-only">{s.done ? " — дууссан" : " — дуусаагүй"}</span>
                </div>
                {!s.done ? <div className="text-xs text-[var(--oc-muted3)]">{s.hint}</div> : null}
              </div>
              {isNext ? (
                <Link
                  href={s.href}
                  className="shrink-0 self-center rounded-lg bg-[var(--oc-accent)] px-3 py-1.5 text-xs font-semibold text-[var(--oc-on-accent)] hover:bg-[var(--oc-accent-hi)] transition-colors"
                >
                  Эхлэх →
                </Link>
              ) : null}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
