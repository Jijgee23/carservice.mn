import Link from "next/link";
import type { ReactNode } from "react";
import { Brand } from "./brand";
import { Eyebrow, StatusPill } from "./landing-ops-ui";

// "Ажлын консол" — бизнес/ажилтны auth хуудсуудын (login/forgot) зүүн
// декоратив панел (designs/tenant_login.png лавлагаа). Бодит өгөгдөл биш,
// зөвхөн системийн мэдрэмж өгөх зорилготой чимэглэл.
const STATS = [
  { label: "Өнөөдрийн засварын хуудас", value: "24" },
  { label: "Ашиглалттай талбай", value: "6/8" },
  { label: "Дундаж хугацаа", value: "41", unit: "мин" },
];

type JobStatus = "Дууссан" | "Явцтай" | "Хүлээгдэж" | "Товлосон";

const JOBS: {
  plate: string;
  job: string;
  master: string;
  status: JobStatus;
}[] = [
  { plate: "1234 УБА", job: "Тосны солилт · 5W-30", master: "Б. Мөнхбат", status: "Дууссан" },
  { plate: "5678 УНМ", job: "Тормосны наклад · урд", master: "Д. Ганзориг", status: "Явцтай" },
  { plate: "9012 УВД", job: "Компьютер оношилго", master: "Ц. Энхжин", status: "Хүлээгдэж" },
  { plate: "3344 УАЕ", job: "Дугуй сэлгэлт · баланс", master: "Б. Мөнхбат", status: "Товлосон" },
];

const STATUS_STYLE: Record<JobStatus, string> = {
  Дууссан: "bg-[var(--oc-ok)]/10 text-[var(--oc-ok)]",
  Явцтай: "bg-[var(--oc-accent)]/15 text-[var(--oc-accent)]",
  Хүлээгдэж: "bg-white/[0.06] text-[var(--oc-muted)]",
  Товлосон: "bg-white/[0.06] text-[var(--oc-muted)]",
};

function todayLabel(): string {
  const d = new Date();
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function ConsolePanel() {
  return (
    <aside className="relative hidden lg:flex flex-col overflow-hidden bg-oc-grid border-r border-[var(--oc-line2)]">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(900px_520px_at_10%_0%,rgba(34,211,238,0.12),transparent_70%)]" />

      <div className="relative flex items-center justify-between px-8 py-5 border-b border-[var(--oc-line2)]">
        <div className="flex items-center gap-3">
          <Brand />
          <span className="hidden xl:inline font-plex-mono text-[11px] uppercase tracking-[0.14em] text-[var(--oc-muted3)] border-l border-[var(--oc-line)] pl-3">
            Business · Service ops
          </span>
        </div>
        <StatusPill>Систем хэвийн · 99.98%</StatusPill>
      </div>

      <div className="relative flex-1 overflow-y-auto px-8 py-9">
        <Eyebrow>Засварын газрын консол</Eyebrow>
        <h1 className="mt-4 text-[34px] xl:text-[40px] font-semibold leading-[1.1] tracking-[-0.03em] text-[var(--oc-ink)] text-balance">
          Засварын хуудас, талбай, мастер — <span className="text-[var(--oc-muted)]">нэг консолоос.</span>
        </h1>
        <p className="mt-4 max-w-md text-[15px] leading-relaxed text-[var(--oc-muted)]">
          Цаг товлолт, ажлын урсгал, сэлбэгийн нөөц, орлогын тайлан. Салбар бүрийн ачаалал
          бодит цагт. 100+ сервис төв ажиллуулж байна.
        </p>

        <div className="mt-8 grid grid-cols-3 gap-px overflow-hidden rounded-[10px] border border-[var(--oc-line)] bg-[var(--oc-line)]">
          {STATS.map((s) => (
            <div key={s.label} className="bg-[var(--oc-panel)] px-4 py-4">
              <div className="font-plex-mono text-[10.5px] uppercase tracking-[0.1em] text-[var(--oc-muted3)]">
                {s.label}
              </div>
              <div className="mt-2 font-plex-mono text-2xl font-semibold text-[var(--oc-ink)]">
                {s.value}
                {s.unit ? (
                  <span className="ml-1 text-xs font-normal text-[var(--oc-muted3)]">{s.unit}</span>
                ) : null}
              </div>
            </div>
          ))}
        </div>

        <div className="mt-6 overflow-hidden rounded-[10px] border border-[var(--oc-line)] bg-[var(--oc-panel)]">
          <div className="flex items-center justify-between border-b border-[var(--oc-line)] px-5 py-3.5">
            <span className="text-[13.5px] font-semibold text-[var(--oc-ink2)]">
              Ажлын урсгал — {todayLabel()}
            </span>
            <span className="font-plex-mono text-[11px] text-[var(--oc-muted3)]">
              live · 3 идэвхтэй
            </span>
          </div>
          <div className="divide-y divide-[var(--oc-line)]">
            {JOBS.map((j) => (
              <div key={j.plate} className="flex items-center gap-4 px-5 py-3 text-[13px]">
                <span className="font-plex-mono text-[var(--oc-ink2)] shrink-0 w-[86px]">
                  {j.plate}
                </span>
                <span className="text-[var(--oc-muted2)] flex-1 truncate">{j.job}</span>
                <span className="hidden xl:inline text-[var(--oc-muted3)] shrink-0">
                  {j.master}
                </span>
                <span
                  className={`shrink-0 rounded px-2 py-0.5 font-plex-mono text-[11px] ${STATUS_STYLE[j.status]}`}
                >
                  {j.status}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </aside>
  );
}

function ShellFooter() {
  return (
    <footer className="border-t border-[var(--oc-line2)] px-6 sm:px-10 py-4 flex flex-wrap items-center justify-between gap-3 font-plex-mono text-[11.5px] text-[var(--oc-muted3)]">
      <span>© {new Date().getFullYear()} carservice.mn · Автосервис бизнесийн платформ</span>
      <span className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <Link href="/terms" className="hover:text-[var(--oc-accent-hi)] transition-colors">
          Нөхцөл
        </Link>
        <Link href="/privacy" className="hover:text-[var(--oc-accent-hi)] transition-colors">
          Нууцлал
        </Link>
        <Link href="/page/guide" className="hover:text-[var(--oc-accent-hi)] transition-colors">
          Тусламж
        </Link>
        <Link href="/login" className="text-[var(--oc-accent)] hover:text-[var(--oc-accent-hi)] transition-colors">
          Жолооч бол → энд
        </Link>
      </span>
    </footer>
  );
}

/** Нарийн (login/forgot) — зүүн талд ConsolePanel-тэй хоёр баганат байршил. */
export function TenantAuthShell({
  title,
  subtitle,
  notice,
  children,
}: {
  title: string;
  subtitle?: string;
  /** "Шинэ байгууллага" мэт бага зэргийн callout — заавал биш. */
  notice?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="landing-ops min-h-screen flex flex-col bg-[var(--oc-carbon)]">
      <div className="flex-1 lg:grid lg:grid-cols-[1fr_520px]">
        <ConsolePanel />

        <main className="relative flex flex-col">
          <header className="flex items-center justify-between px-6 sm:px-10 py-5">
            <Link href="/" className="lg:hidden">
              <Brand />
            </Link>
            <span className="hidden lg:block font-plex-mono text-[11px] uppercase tracking-[0.14em] text-[var(--oc-muted3)]">
              Бизнес хандалт
            </span>
            <Link
              href="/"
              className="text-[13px] text-[var(--oc-muted2)] hover:text-[var(--oc-accent-hi)] transition-colors"
            >
              ← Нүүр
            </Link>
          </header>

          <div className="flex-1 flex items-center px-6 sm:px-10 py-8">
            <div className="w-full max-w-[420px] mx-auto lg:mx-0">
              <h2 className="text-2xl sm:text-3xl font-semibold tracking-[-0.02em] text-[var(--oc-ink)]">
                {title}
              </h2>
              {subtitle ? (
                <p className="mt-2.5 text-[14.5px] leading-relaxed text-[var(--oc-muted)]">
                  {subtitle}
                </p>
              ) : null}

              <div className="mt-7">{children}</div>

              {notice ? (
                <div className="mt-8 rounded-[10px] border border-[var(--oc-line)] bg-[var(--oc-panel)] px-5 py-4">
                  <p className="text-[13.5px] leading-relaxed text-[var(--oc-muted2)]">{notice}</p>
                </div>
              ) : null}
            </div>
          </div>

          <ShellFooter />
        </main>
      </div>
    </div>
  );
}

/** Өргөн (signup) — консол панелгүй, төвлөрсөн нэг баганат байршил. */
export function TenantAuthShellWide({
  title,
  subtitle,
  footer,
  children,
}: {
  title: string;
  subtitle?: string;
  footer?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="landing-ops min-h-screen flex flex-col bg-[var(--oc-carbon)] bg-oc-grid">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(1100px_600px_at_50%_-10%,rgba(34,211,238,0.08),transparent_70%)]" />

      <header className="relative flex items-center justify-between px-6 sm:px-10 py-5">
        <Link href="/">
          <Brand />
        </Link>
        <Link
          href="/"
          className="text-[13px] text-[var(--oc-muted2)] hover:text-[var(--oc-accent-hi)] transition-colors"
        >
          ← Нүүр
        </Link>
      </header>

      <div className="relative flex-1 flex items-start justify-center px-4 py-8 sm:py-10">
        <div className="w-full max-w-2xl">
          <div className="mb-6 text-center">
            <h2 className="text-2xl sm:text-3xl font-semibold tracking-[-0.02em] text-[var(--oc-ink)]">
              {title}
            </h2>
            {subtitle ? (
              <p className="mt-2 text-[14.5px] text-[var(--oc-muted)]">{subtitle}</p>
            ) : null}
          </div>

          <div className="rounded-[10px] border border-[var(--oc-line)] bg-[var(--oc-panel)] p-6 sm:p-8">
            {children}
          </div>

          {footer ? (
            <p className="mt-6 text-center text-sm text-[var(--oc-muted2)]">{footer}</p>
          ) : null}
        </div>
      </div>

      <ShellFooter />
    </div>
  );
}
