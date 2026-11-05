// Хэрэглэгчийн (consumer) хуудсуудын нийтлэг UI — Midnight + Alizarin
// (--oc-*) token-ууд дээр. Server/client хоёуланд ашиглаж болно (hook-гүй).
import Link from "next/link";
import type { ReactNode } from "react";

export function BackLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      className="group inline-flex items-center gap-1.5 self-start text-sm text-[var(--oc-muted3)] hover:text-[var(--oc-ink)] transition-colors"
    >
      <span aria-hidden className="transition-transform group-hover:-translate-x-0.5">←</span>
      {children}
    </Link>
  );
}

export function PlaceLogo({ name, logoUrl, className = "w-16 h-16 rounded-2xl text-2xl" }: { name: string; logoUrl: string | null; className?: string }) {
  if (logoUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={logoUrl} alt="" className={`${className} object-contain bg-[#fff] border border-[var(--oc-line)] shrink-0`} />
    );
  }
  return (
    <div
      className={`${className} shrink-0 flex items-center justify-center font-bold bg-[var(--oc-accent)]/10 text-[var(--oc-accent)] border border-[var(--oc-accent)]/20`}
    >
      {name.slice(0, 1).toUpperCase()}
    </div>
  );
}

/** Газар/салбарын толгой карт: лого, нэр, дэд мөр, badge-ууд. */
export function PlaceHeader({
  name,
  logoUrl,
  title,
  subtitle,
  eyebrow,
  badges,
  aside,
}: {
  name: string;
  logoUrl: string | null;
  title: string;
  subtitle?: ReactNode;
  eyebrow?: ReactNode;
  badges?: ReactNode;
  aside?: ReactNode;
}) {
  return (
    <div className="relative overflow-hidden rounded-2xl border border-[var(--oc-line)] bg-[var(--oc-panel)] p-5 sm:p-6">
      <div
        aria-hidden
        className="pointer-events-none absolute -right-16 -top-20 h-56 w-56 rounded-full bg-[var(--oc-accent)]/10 blur-2xl"
      />
      <div className="relative flex flex-col gap-4 sm:flex-row sm:items-center">
        <PlaceLogo name={name} logoUrl={logoUrl} />
        <div className="min-w-0 flex-1">
          {eyebrow ? (
            <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--oc-accent)] truncate">
              {eyebrow}
            </div>
          ) : null}
          <h1 className="mt-0.5 text-2xl sm:text-[1.7rem] font-bold leading-tight text-[var(--oc-ink)]">{title}</h1>
          {subtitle ? <p className="mt-1 text-sm text-[var(--oc-muted)]">{subtitle}</p> : null}
          {badges ? <div className="mt-2.5 flex flex-wrap items-center gap-2">{badges}</div> : null}
        </div>
        {aside ? <div className="shrink-0">{aside}</div> : null}
      </div>
    </div>
  );
}

export function Panel({
  title,
  description,
  children,
  className = "",
}: {
  title?: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`rounded-2xl border border-[var(--oc-line)] bg-[var(--oc-panel)] p-5 sm:p-6 ${className}`}>
      {title ? (
        <header className="mb-4">
          <h2 className="text-base font-semibold text-[var(--oc-ink)]">{title}</h2>
          {description ? <p className="mt-0.5 text-xs text-[var(--oc-muted3)]">{description}</p> : null}
        </header>
      ) : null}
      {children}
    </section>
  );
}

export function OpenStatusBadge({ open, hours, note }: { open: boolean; hours?: string | null; note?: string | null }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-1 text-xs font-medium ${
        open
          ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/30 light:bg-emerald-50 light:text-emerald-700 light:border-emerald-300"
          : "bg-[var(--oc-panel2)] text-[var(--oc-muted)] border-[var(--oc-line)]"
      }`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${open ? "bg-emerald-400" : "bg-[var(--oc-muted4)]"}`} />
      {open ? "Нээлттэй" : "Хаалттай"}
      {hours ? <span className="opacity-75 tabular-nums">· {hours}</span> : null}
      {note ? <span className="opacity-75">· {note}</span> : null}
    </span>
  );
}

export function RatingPill({ rating, count }: { rating: number | null; count: number }) {
  if (rating == null || count === 0) return null;
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-[var(--oc-line)] bg-[var(--oc-panel2)] px-2.5 py-1 text-xs">
      <span className="text-amber-400">★</span>
      <span className="font-semibold tabular-nums text-[var(--oc-ink)]">{rating.toFixed(1)}</span>
      <span className="text-[var(--oc-muted3)]">({count})</span>
    </span>
  );
}

export function LoginPrompt() {
  return (
    <div className="flex flex-col items-start gap-4 rounded-xl border border-dashed border-[var(--oc-line)] bg-[var(--oc-panel2)] p-5 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--oc-accent)]/10 text-[var(--oc-accent)]">
          <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <rect x="3" y="11" width="18" height="11" rx="2" />
            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
          </svg>
        </div>
        <div>
          <div className="text-sm font-semibold text-[var(--oc-ink)]">Цаг захиалахын тулд нэвтэрнэ үү</div>
          <div className="text-xs text-[var(--oc-muted3)]">Утасны дугаараараа хэдхэн секундэд нэвтэрнэ.</div>
        </div>
      </div>
      <Link
        href="/login"
        className="inline-flex items-center gap-1.5 rounded-xl bg-[var(--oc-accent)] px-5 py-2.5 text-sm font-semibold text-[var(--oc-on-accent)] hover:bg-[var(--oc-accent-hi)] transition-colors"
      >
        Нэвтрэх / Бүртгүүлэх <span aria-hidden>→</span>
      </Link>
    </div>
  );
}

export function ServiceChips({ services }: { services: string[] }) {
  if (services.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {services.map((s) => (
        <span
          key={s}
          className="rounded-md border border-[var(--oc-line)] bg-[var(--oc-panel2)] px-2 py-0.5 text-xs text-[var(--oc-muted)]"
        >
          {s}
        </span>
      ))}
    </div>
  );
}

export type HeroStat = { label: string; value: ReactNode; tone?: "ok" | "warn" | "accent" };

/** Жагсаалтын хуудасны толгой: eyebrow, гарчиг, тайлбар, статистик, үйлдэл. */
export function PageHero({
  eyebrow,
  title,
  description,
  stats,
  actions,
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  stats?: HeroStat[];
  actions?: ReactNode;
}) {
  const tone = { ok: "text-emerald-400 light:text-emerald-600", warn: "text-[var(--oc-warn)]", accent: "text-[var(--oc-accent)]" };
  return (
    <div className="relative overflow-hidden rounded-2xl border border-[var(--oc-line)] bg-[var(--oc-panel)] p-5 sm:p-6">
      <div
        aria-hidden
        className="pointer-events-none absolute -right-16 -top-20 h-56 w-56 rounded-full bg-[var(--oc-accent)]/10 blur-2xl"
      />
      <div className="relative flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0 max-w-2xl">
          {eyebrow ? (
            <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--oc-accent)]">{eyebrow}</div>
          ) : null}
          <h1 className="mt-1 text-2xl font-bold text-[var(--oc-ink)]">{title}</h1>
          {description ? <p className="mt-1 text-sm text-[var(--oc-muted)]">{description}</p> : null}
          {actions ? <div className="mt-3 flex flex-wrap items-center gap-2">{actions}</div> : null}
        </div>
        {stats && stats.length > 0 ? (
          <dl className="grid auto-cols-fr grid-flow-col gap-2 sm:gap-3">
            {stats.map((s) => (
              <div
                key={s.label}
                className="min-w-[5.5rem] rounded-xl border border-[var(--oc-line)] bg-[var(--oc-panel2)] px-3 py-2.5"
              >
                <dt className="whitespace-nowrap text-[11px] text-[var(--oc-muted3)]">{s.label}</dt>
                <dd className={`mt-0.5 whitespace-nowrap text-xl font-bold tabular-nums ${s.tone ? tone[s.tone] : "text-[var(--oc-ink)]"}`}>
                  {s.value}
                </dd>
              </div>
            ))}
          </dl>
        ) : null}
      </div>
    </div>
  );
}

/** Шүүлтүүрийн мөрийг багтаах самбар. */
export function FilterBar({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-[var(--oc-line)] bg-[var(--oc-panel)] p-3">
      {children}
    </div>
  );
}

const MONTH_SHORT = ["1-р", "2-р", "3-р", "4-р", "5-р", "6-р", "7-р", "8-р", "9-р", "10-р", "11-р", "12-р"];

/** Жагсаалтын мөрийн зүүн талын огнооны дөрвөлжин (өдөр + сар). */
export function DateTile({ date, muted = false }: { date: Date; muted?: boolean }) {
  return (
    <div
      className={`flex h-14 w-14 shrink-0 flex-col items-center justify-center rounded-xl border ${
        muted
          ? "border-[var(--oc-line2)] bg-[var(--oc-panel2)] text-[var(--oc-muted)]"
          : "border-[var(--oc-accent)]/20 bg-[var(--oc-accent)]/10 text-[var(--oc-accent)]"
      }`}
    >
      <span className="text-lg font-bold leading-none tabular-nums">{date.getDate()}</span>
      <span className="mt-1 text-[10px] font-semibold uppercase leading-none">{MONTH_SHORT[date.getMonth()]} сар</span>
    </div>
  );
}

export function SectionTitle({ children, count }: { children: ReactNode; count?: number }) {
  return (
    <h2 className="flex items-center gap-2 text-sm font-semibold text-[var(--oc-ink2)]">
      {children}
      {count != null ? (
        <span className="rounded-full bg-[var(--oc-panel2)] px-2 py-0.5 text-[11px] font-medium tabular-nums text-[var(--oc-muted)]">
          {count}
        </span>
      ) : null}
    </h2>
  );
}

export function Chevron() {
  return (
    <svg className="h-4 w-4 shrink-0 text-[var(--oc-muted4)] transition-transform group-hover:translate-x-0.5 group-hover:text-[var(--oc-accent)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="m9 18 6-6-6-6" />
    </svg>
  );
}
