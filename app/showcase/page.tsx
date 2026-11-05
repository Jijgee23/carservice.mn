import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Bento Showcase",
  description:
    "Дашбордын дизайн загвар — bento сүлжээ, бараан горим, неон өнгөт онцлол.",
};

/**
 * Standalone bento-grid dashboard showcase.
 *
 * Loy-оос хамааралгүй (auth шаардахгүй) бие даасан хуудас — зөвхөн дизайн
 * демо. Төслийн design token-уудыг (.glass / .gradient-text / .card-hover,
 * violet+blue неон өнгө) дахин ашиглана. Гадны dependency байхгүй, бүх icon
 * нь inline SVG. Server component тул JS bundle нэмэхгүй.
 */
export default function ShowcasePage() {
  return (
    <div className="relative min-h-screen overflow-hidden">
      {/* Бараан неон backdrop — fixed, нэг л удаа paint хийгдэнэ */}
      <div aria-hidden className="fixed inset-0 -z-10 bg-[var(--bg-primary)]">
        <div
          className="absolute inset-0"
          style={{
            backgroundImage:
              "radial-gradient(48rem 36rem at 12% -4%, rgba(231,76,60,0.20), transparent 58%)," +
              "radial-gradient(44rem 38rem at 100% 0%, rgba(59,130,246,0.14), transparent 55%)," +
              "radial-gradient(40rem 40rem at 88% 100%, rgba(16,185,129,0.10), transparent 60%)",
          }}
        />
        {/* нарийн торон overlay */}
        <div
          className="absolute inset-0 opacity-[0.18]"
          style={{
            backgroundImage:
              "linear-gradient(rgba(255,255,255,0.04) 1px, transparent 1px)," +
              "linear-gradient(90deg, rgba(255,255,255,0.04) 1px, transparent 1px)",
            backgroundSize: "48px 48px",
            maskImage:
              "radial-gradient(70% 60% at 50% 30%, black, transparent 100%)",
          }}
        />
      </div>

      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8 lg:py-12">
        {/* Толгой */}
        <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-xs text-white/60">
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-400" />
              </span>
              Шууд хяналт · 2026 Q2
            </div>
            <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
              <span className="gradient-text">Carservice</span> хяналтын самбар
            </h1>
            <p className="mt-1.5 text-sm text-white/45">
              Bento сүлжээ · бараан горим · неон онцлол
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button className="rounded-xl border border-white/10 bg-white/[0.04] px-4 py-2 text-sm text-white/70 transition-colors hover:border-white/20 hover:text-white">
              Тайлан
            </button>
            <button className="glow-btn rounded-xl bg-gradient-to-r from-violet-600 to-indigo-500 px-4 py-2 text-sm font-medium text-white transition-transform hover:scale-[1.03]">
              + Шинэ засварын хуудас
            </button>
          </div>
        </header>

        {/* 1 · KPI зурвас — дээд талын 4 тэнцүү нүд */}
        <div className="grid grid-cols-2 gap-4 sm:gap-5 lg:grid-cols-4">
          <StatCell
            label="Идэвхтэй засварын хуудас"
            value="42"
            accent="violet"
            delta="+6"
            spark={[8, 10, 7, 12, 14, 11, 16]}
          />
          <StatCell
            label="Дууссан / өнөөдөр"
            value="128"
            accent="emerald"
            delta="+12%"
            spark={[20, 22, 19, 26, 30, 28, 34]}
          />
          <StatCell
            label="Шинэ үйлчлүүлэгч"
            value="37"
            accent="blue"
            delta="+9"
            spark={[4, 6, 5, 9, 8, 11, 13]}
          />
          <StatCell
            label="Дундаж үнэлгээ"
            value="4.8"
            accent="amber"
            delta="★★★★★"
            spark={[40, 42, 44, 43, 46, 47, 48]}
          />
        </div>

        {/* 2 · Орлого (2/3) + сарын зорилт (1/3) — ижил өндөр */}
        <div className="mt-4 grid items-stretch gap-4 sm:mt-5 sm:gap-5 lg:grid-cols-3">
          <Cell className="flex flex-col lg:col-span-2">
            <div className="flex items-start justify-between">
              <div>
                <div className="text-xs uppercase tracking-wider text-white/40">
                  Нийт орлого · энэ сар
                </div>
                <div className="mt-2 text-4xl font-bold tracking-tight gradient-text sm:text-5xl">
                  ₮84.2 сая
                </div>
              </div>
              <Badge up>+18.4%</Badge>
            </div>
            <div className="mt-auto pt-6">
              <AreaChart />
              <div className="mt-3 flex justify-between text-[11px] text-white/30">
                {["1-р", "8-р", "15-р", "22-р", "29-р"].map((d) => (
                  <span key={d}>{d}</span>
                ))}
              </div>
            </div>
          </Cell>

          <Cell className="flex flex-col">
            <h2 className="mb-1 text-sm font-semibold">Сарын зорилт</h2>
            <div className="flex flex-1 items-center justify-center py-2">
              <Radial pct={76} />
            </div>
            <div className="mt-auto space-y-2 border-t border-white/[0.06] pt-3 text-sm">
              <div className="flex justify-between">
                <span className="text-white/40">Биелэлт</span>
                <span className="tabular-nums text-white/80">₮76M / ₮100M</span>
              </div>
              <div className="flex justify-between">
                <span className="text-white/40">Өдрийн дундаж</span>
                <span className="tabular-nums text-emerald-300">₮3.4M</span>
              </div>
            </div>
          </Cell>
        </div>

        {/* 3 · Салбарын ачаалал (1/2) + сүүлийн үйл явдал (1/2) */}
        <div className="mt-4 grid items-stretch gap-4 sm:mt-5 sm:gap-5 lg:grid-cols-2">
          <Cell className="flex flex-col">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-sm font-semibold">Салбарын ачаалал</h2>
              <span className="text-xs text-white/40">6 салбар</span>
            </div>
            <div className="flex flex-1 flex-col justify-between gap-3">
              <BranchBar name="Сансар" pct={92} tone="violet" />
              <BranchBar name="Зайсан" pct={74} tone="blue" />
              <BranchBar name="Баянзүрх" pct={61} tone="emerald" />
              <BranchBar name="Хан-Уул" pct={38} tone="amber" />
            </div>
          </Cell>

          <Cell className="flex flex-col">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-sm font-semibold">Сүүлийн үйл явдал</h2>
              <span className="cursor-pointer text-xs text-violet-300 hover:text-violet-200 light:text-violet-700 light:hover:text-violet-800">
                Бүгд →
              </span>
            </div>
            <ul className="flex flex-1 flex-col justify-between gap-3">
              <Activity
                tone="emerald"
                title="Засварын хуудас #2041 дууслаа"
                meta="Сансар салбар · 14 минутын өмнө"
                amount="₮245,000"
              />
              <Activity
                tone="violet"
                title="Шинэ оношилгоо эхэллээ"
                meta="Toyota Prius 30 · 32 минутын өмнө"
              />
              <Activity
                tone="blue"
                title="Төлбөр баталгаажлаа (QPay)"
                meta="Засварын хуудас #2039 · 1 цагийн өмнө"
                amount="₮512,000"
              />
              <Activity
                tone="amber"
                title="Хойшлогдсон"
                meta="Засварын хуудас #2037 · 2 цагийн өмнө"
              />
            </ul>
          </Cell>
        </div>

        {/* 4 · Үйлчилгээ (1/3) + 2 мини KPI — ижил өндөр */}
        <div className="mt-4 grid items-stretch gap-4 sm:mt-5 sm:gap-5 lg:grid-cols-3">
          <Cell className="flex flex-col">
            <h2 className="mb-3 text-sm font-semibold">Үйлчилгээ</h2>
            <ul className="flex flex-1 flex-col justify-between gap-2.5 text-sm">
              <ServiceRow dot="violet" name="Оношилгоо" n={48} />
              <ServiceRow dot="blue" name="Тосны солилт" n={36} />
              <ServiceRow dot="emerald" name="Дугуй" n={29} />
              <ServiceRow dot="amber" name="Цахилгаан" n={17} />
            </ul>
          </Cell>
          <MiniCell label="Дундаж хүлээлт" value="23 мин" tone="blue" />
          <MiniCell label="Давтан үйлчлүүлэгч" value="64%" tone="emerald" />
        </div>

        <footer className="mt-10 text-center text-xs text-white/25">
          Дизайн демо · carservice.mn — bento dashboard showcase
        </footer>
      </div>
    </div>
  );
}

/* ── Барих блокууд ────────────────────────────────────────────── */

function Cell({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`glass card-hover rounded-2xl p-5 sm:p-6 ${className}`}
    >
      {children}
    </div>
  );
}

const ACCENTS = {
  violet: { text: "text-violet-300", from: "from-violet-500", to: "to-indigo-400", stroke: "#f1948a", bg: "bg-violet-400" },
  blue: { text: "text-sky-300", from: "from-sky-500", to: "to-blue-400", stroke: "#60a5fa", bg: "bg-sky-400" },
  emerald: { text: "text-emerald-300", from: "from-emerald-500", to: "to-teal-400", stroke: "#34d399", bg: "bg-emerald-400" },
  amber: { text: "text-amber-300", from: "from-amber-500", to: "to-orange-400", stroke: "#fbbf24", bg: "bg-amber-400" },
} as const;

type Accent = keyof typeof ACCENTS;

function StatCell({
  label,
  value,
  delta,
  accent,
  spark,
}: {
  label: string;
  value: string;
  delta: string;
  accent: Accent;
  spark: number[];
}) {
  const a = ACCENTS[accent];
  return (
    <Cell className="flex flex-col">
      <div className="flex items-start justify-between gap-2">
        <div className="text-xs text-white/40">{label}</div>
        <span className={`shrink-0 text-[11px] font-medium ${a.text}`}>
          {delta}
        </span>
      </div>
      <div className="mt-1 text-3xl font-bold tabular-nums">{value}</div>
      <div className="mt-auto pt-4">
        <Sparkline data={spark} stroke={a.stroke} />
      </div>
    </Cell>
  );
}

function MiniCell({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: Accent;
}) {
  const a = ACCENTS[tone];
  return (
    <div className="glass card-hover flex items-center justify-between rounded-2xl p-5">
      <span className="text-sm text-white/50">{label}</span>
      <span className={`text-xl font-bold ${a.text}`}>{value}</span>
    </div>
  );
}

function Badge({ children, up }: { children: React.ReactNode; up?: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium ${up
        ? "bg-emerald-500/15 text-emerald-300"
        : "bg-red-500/15 text-red-300"
        }`}
    >
      <span>{up ? "▲" : "▼"}</span>
      {children}
    </span>
  );
}

function BranchBar({
  name,
  pct,
  tone,
}: {
  name: string;
  pct: number;
  tone: Accent;
}) {
  const a = ACCENTS[tone];
  return (
    <div>
      <div className="mb-1 flex justify-between text-xs">
        <span className="text-white/60">{name}</span>
        <span className="tabular-nums text-white/40">{pct}%</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-white/[0.06]">
        <div
          className={`h-full rounded-full bg-gradient-to-r ${a.from} ${a.to}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function ServiceRow({
  dot,
  name,
  n,
}: {
  dot: Accent;
  name: string;
  n: number;
}) {
  const a = ACCENTS[dot];
  return (
    <li className="flex items-center justify-between">
      <span className="flex items-center gap-2 text-white/70">
        <span className={`h-2 w-2 rounded-full ${a.bg}`} />
        {name}
      </span>
      <span className="tabular-nums text-white/40">{n}</span>
    </li>
  );
}

function Activity({
  tone,
  title,
  meta,
  amount,
}: {
  tone: Accent;
  title: string;
  meta: string;
  amount?: string;
}) {
  const a = ACCENTS[tone];
  return (
    <li className="flex items-center gap-3">
      <span className={`mt-0.5 h-2.5 w-2.5 shrink-0 rounded-full ${a.bg}`} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm text-white/85">{title}</div>
        <div className="truncate text-xs text-white/35">{meta}</div>
      </div>
      {amount ? (
        <span className="shrink-0 text-sm font-medium tabular-nums text-white/70">
          {amount}
        </span>
      ) : null}
    </li>
  );
}

/* ── Inline SVG чартууд ───────────────────────────────────────── */

function Sparkline({ data, stroke }: { data: number[]; stroke: string }) {
  const w = 120;
  const h = 32;
  const max = Math.max(...data);
  const min = Math.min(...data);
  const span = max - min || 1;
  const step = w / (data.length - 1);
  const pts = data.map((v, i) => {
    const x = i * step;
    const y = h - ((v - min) / span) * (h - 4) - 2;
    return `${x},${y}`;
  });
  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      className="h-8 w-full"
      preserveAspectRatio="none"
    >
      <polyline
        points={pts.join(" ")}
        fill="none"
        stroke={stroke}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function AreaChart() {
  const data = [28, 34, 30, 42, 38, 52, 48, 60, 56, 72, 68, 84];
  const w = 480;
  const h = 140;
  const max = Math.max(...data);
  const step = w / (data.length - 1);
  const line = data
    .map((v, i) => `${i * step},${h - (v / max) * (h - 12) - 6}`)
    .join(" ");
  const area = `0,${h} ${line} ${w},${h}`;
  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      className="h-32 w-full sm:h-40"
      preserveAspectRatio="none"
    >
      <defs>
        <linearGradient id="area-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#e74c3c" stopOpacity="0.45" />
          <stop offset="100%" stopColor="#e74c3c" stopOpacity="0" />
        </linearGradient>
        <linearGradient id="area-line" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#f1948a" />
          <stop offset="50%" stopColor="#e74c3c" />
          <stop offset="100%" stopColor="#3b82f6" />
        </linearGradient>
      </defs>
      <polygon points={area} fill="url(#area-fill)" />
      <polyline
        points={line}
        fill="none"
        stroke="url(#area-line)"
        strokeWidth={2.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function Radial({ pct }: { pct: number }) {
  const size = 120;
  const stroke = 10;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const offset = c - (pct / 100) * c;
  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <defs>
          <linearGradient id="radial-grad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#f1948a" />
            <stop offset="100%" stopColor="#3b82f6" />
          </linearGradient>
        </defs>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="rgba(255,255,255,0.08)"
          strokeWidth={stroke}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="url(#radial-grad)"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={offset}
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="text-2xl font-bold tabular-nums">{pct}%</span>
      </div>
    </div>
  );
}
