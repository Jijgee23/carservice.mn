import Link from "next/link";
import type { ReactNode } from "react";
import { Brand } from "./brand";
import { Eyebrow, StatusPill } from "./landing-ops-ui";

// "Driver консол" — жолооч/хэрэглэгчийн нэвтрэлтийн (/login) зүүн декоратив
// панел (TenantAuthShell-ийн ConsolePanel-той адил зарчим). Бодит өгөгдөл биш,
// зөвхөн системийн мэдрэмж өгөх зорилготой чимэглэл.
const STATS = [
  { label: "Бүртгэлтэй машин", value: "2" },
  { label: "Дараагийн цаг", value: "2", unit: "хоног" },
  { label: "Идэвхтэй сануулга", value: "1" },
];

type AppointmentStatus = "Баталгаажсан" | "Хүлээгдэж" | "Товлосон";

const APPOINTMENTS: {
  garage: string;
  service: string;
  date: string;
  status: AppointmentStatus;
}[] = [
  { garage: "AutoCare Töv", service: "Тосны солилт · 5W-30", date: "Да, 09:00", status: "Баталгаажсан" },
  { garage: "Инфосистемс сервис", service: "Дугуй сэлгэлт · баланс", date: "Мя, 14:30", status: "Товлосон" },
  { garage: "Найман жин авто", service: "Компьютер оношилго", date: "Ля, 11:00", status: "Хүлээгдэж" },
];

const STATUS_STYLE: Record<AppointmentStatus, string> = {
  Баталгаажсан: "bg-[var(--oc-ok)]/10 text-[var(--oc-ok)]",
  Хүлээгдэж: "bg-[var(--oc-accent)]/15 text-[var(--oc-accent)]",
  Товлосон: "bg-white/[0.06] text-[var(--oc-muted)]",
};

function DriverPanel() {
  return (
    <aside className="relative hidden lg:flex flex-col overflow-hidden bg-oc-grid border-r border-[var(--oc-line2)]">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(900px_520px_at_10%_0%,rgba(231,76,60,0.06),transparent_70%)]" />

      <div className="relative flex items-center justify-between px-8 py-5 border-b border-[var(--oc-line2)]">
        <div className="flex items-center gap-3">
          <Brand />
          <span className="hidden xl:inline font-plex-mono text-[11px] uppercase tracking-[0.14em] text-[var(--oc-muted3)] border-l border-[var(--oc-line)] pl-3">
            Driver · Цаг захиалга
          </span>
        </div>
        <StatusPill>Систем хэвийн · 99.98%</StatusPill>
      </div>

      <div className="relative flex-1 overflow-y-auto px-8 py-9">
        <Eyebrow>Жолоочийн апп</Eyebrow>
        <h1 className="mt-4 text-[34px] xl:text-[40px] font-semibold leading-[1.1] tracking-[-0.03em] text-[var(--oc-ink)] text-balance">
          Цагаа хайж, захиалж, хянаарай — <span className="text-[var(--oc-muted)]">нэг апп-аас.</span>
        </h1>
        <p className="mt-4 max-w-md text-[15px] leading-relaxed text-[var(--oc-muted)]">
          Ойролцоох сервис хайх, цаг захиалах, машины түүхээ хянах — 100+ сервис
          төвтэй нэг дороос холбогдоно.
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
              Миний захиалгууд — Ойрын
            </span>
            <span className="font-plex-mono text-[11px] text-[var(--oc-muted3)]">
              live · 1 идэвхтэй
            </span>
          </div>
          <div className="divide-y divide-[var(--oc-line)]">
            {APPOINTMENTS.map((a) => (
              <div key={a.garage + a.service} className="flex items-center gap-4 px-5 py-3 text-[13px]">
                <span className="text-[var(--oc-ink2)] flex-1 truncate">
                  {a.garage}
                  <span className="hidden xl:inline text-[var(--oc-muted3)]"> · {a.service}</span>
                </span>
                <span className="font-plex-mono text-[var(--oc-muted3)] shrink-0">{a.date}</span>
                <span
                  className={`shrink-0 rounded px-2 py-0.5 font-plex-mono text-[11px] ${STATUS_STYLE[a.status]}`}
                >
                  {a.status}
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
      <span>© {new Date().getFullYear()} carservice.mn · Авто үйлчилгээний цаг захиалга</span>
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
        <Link href="/page/login" className="text-[var(--oc-accent)] hover:text-[var(--oc-accent-hi)] transition-colors">
          Бизнес эрхлэгч бол → энд
        </Link>
      </span>
    </footer>
  );
}

/** Жолооч/хэрэглэгчийн нэвтрэлтийн (/login) shell — зүүн талд DriverPanel-тэй хоёр баганат байршил. */
export function ConsumerAuthShell({
  title,
  subtitle,
  notice,
  children,
}: {
  title: string;
  subtitle?: string;
  notice?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="landing-ops min-h-screen flex flex-col bg-[var(--oc-carbon)]">
      <div className="flex-1 lg:grid lg:grid-cols-[1fr_520px]">
        <DriverPanel />

        <main className="relative flex flex-col">
          <header className="flex items-center justify-between px-6 sm:px-10 py-5">
            <Link href="/discover" className="lg:hidden">
              <Brand />
            </Link>
            <span className="hidden lg:block font-plex-mono text-[11px] uppercase tracking-[0.14em] text-[var(--oc-muted3)]">
              Хэрэглэгчийн хандалт
            </span>
            <Link
              href="/discover"
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
