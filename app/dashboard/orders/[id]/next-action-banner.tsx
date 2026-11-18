import type { NextAction } from "@/lib/orders/next-action";

const TONE: Record<NextAction["tone"], { box: string; dot: string; link: string }> = {
  action: {
    box: "border-[var(--oc-accent)]/35 bg-[var(--oc-accent)]/[0.08]",
    dot: "bg-[var(--oc-accent)]",
    link: "bg-[var(--oc-accent)] text-[var(--oc-on-accent)] hover:bg-[var(--oc-accent-hi)]",
  },
  ready: {
    box: "border-[var(--oc-ok)]/35 bg-[var(--oc-ok)]/[0.08]",
    dot: "bg-[var(--oc-ok)]",
    link: "bg-[var(--oc-ok)] text-[var(--oc-on-accent)] hover:opacity-90",
  },
  waiting: {
    box: "border-[var(--oc-line)] bg-[var(--oc-panel)]",
    dot: "bg-[var(--oc-muted3)]",
    link: "",
  },
  done: {
    box: "border-[var(--oc-ok)]/25 bg-[var(--oc-ok)]/[0.05]",
    dot: "bg-[var(--oc-ok)]",
    link: "",
  },
};

/**
 * «Дараагийн алхам» — хуудасны толгойн доор, одоо хийх ганц зүйлийг тод харуулна. Server component;
 * товч нь тухайн хэсэг рүү (#anchor) үсэргэнэ. Логик: lib/orders/next-action.ts.
 */
export function NextActionBanner({ action }: { action: NextAction }) {
  const t = TONE[action.tone];
  return (
    <div
      role="status"
      aria-label="Дараагийн алхам"
      className={`mb-5 flex flex-wrap items-center gap-3 rounded-[10px] border px-4 py-3 ${t.box}`}
    >
      <span aria-hidden="true" className={`h-2 w-2 shrink-0 rounded-full ${t.dot}`} />
      <div className="min-w-0 flex-1">
        <div className="font-plex-mono text-[10.5px] uppercase tracking-[0.1em] text-[var(--oc-muted3)]">Дараагийн алхам</div>
        <div className="text-sm font-semibold text-[var(--oc-ink)]">{action.title}</div>
        {action.detail ? <div className="text-xs text-[var(--oc-muted2)] mt-0.5">{action.detail}</div> : null}
      </div>
      {action.anchor && t.link ? (
        <a
          href={`#${action.anchor}`}
          className={`inline-flex min-h-9 shrink-0 items-center rounded-lg px-3 text-xs font-semibold transition-colors ${t.link}`}
        >
          Очих →
        </a>
      ) : null}
    </div>
  );
}
