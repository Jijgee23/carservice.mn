import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import { Brand } from "./brand";

const HIGHLIGHTS = [
  "Засварын хуудас, машины түүх — нэг дороос",
  "Онлайн цаг захиалга, SMS сануулга",
  "Бодит цагийн тайлан, нөөц хяналт",
];

function BrandPanel() {
  return (
    <aside
      className="relative hidden lg:flex flex-col justify-between overflow-hidden p-12 text-white"
      // Панел үргэлж бараан дэвсгэртэй (theme-ээс үл хамааран). Гэвч бүх
      // text/bg/border-white/x utility нь `--color-white`-г ашигладаг тул
      // light theme-д тэр var бараан болж эргэдэг (globals.css) — үүнийг
      // энд локалаар түрж, panel дотор үргэлж цагаан хэвээр байлгана.
      style={{ "--color-white": "#ffffff" } as CSSProperties}
    >
      {/* Гүн дэвсгэр + цөөн, тод байрлалтай туяа — цэвэрхэн, шуугиангүй */}
      <div className="absolute inset-0 bg-gradient-to-br from-violet-800 via-indigo-900 to-[#0a0a12]" />
      <div className="absolute -top-32 -left-20 w-[28rem] h-[28rem] bg-violet-500/25 rounded-full blur-[110px]" />
      <div className="absolute bottom-[-4rem] right-[-4rem] w-96 h-96 bg-blue-500/15 rounded-full blur-[100px]" />

      <Link href="/" className="relative flex items-center gap-2.5">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/brand/mark.svg"
          alt="carservice"
          className="w-9 h-9 object-contain"
        />
        <span className="font-bold text-xl tracking-tight">carservice</span>
      </Link>

      <div className="relative max-w-sm">
        {/* Итгэл төрүүлэх мэдээллийг (100+ сервис) дээр гарган тодруулав */}
        <div className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/[0.06] px-3 py-1.5 text-xs font-medium text-white/70">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75 animate-ping" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
          </span>
          100+ сервис төв ашиглаж байна
        </div>

        <h2 className="mt-5 text-4xl font-bold leading-[1.08] tracking-tight">
          Сервисээ <span className="gradient-text">ухаалгаар</span> удирдаарай
        </h2>
        <p className="mt-3.5 text-white/65 leading-relaxed">
          Засварын хуудас, цаг товлолт, тайлан — авто үйлчилгээний бүх ажиллагаа нэг дороос.
        </p>

        <ul className="mt-7 space-y-3.5">
          {HIGHLIGHTS.map((h) => (
            <li key={h} className="flex items-center gap-3">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-violet-400/20 ring-1 ring-violet-400/30">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="text-violet-200">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              </span>
              <span className="text-sm font-medium text-white/90">{h}</span>
            </li>
          ))}
        </ul>

        {/* Бүтээгдэхүүний мини mockup — хоосон зайг дүүргэж, системийн
            мэдрэмжийг өгөх зорилготой чимэглэл (дэлгэц уншигчид үл хамаарна) */}
        <div
          aria-hidden
          className="mt-8 rounded-2xl border border-white/15 bg-white/[0.07] backdrop-blur p-4 shadow-2xl shadow-black/30"
        >
          <div className="flex items-center justify-between text-xs mb-3">
            <span className="font-semibold text-white/80">Өнөөдрийн засварын хуудсууд</span>
            <span className="flex items-center gap-1.5 text-emerald-300">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
              3 идэвхтэй
            </span>
          </div>
          <div className="space-y-2">
            {[
              {
                plate: "1234 УБА",
                job: "Тосны солилт",
                status: "Дууссан",
                pill: "bg-green-400/20 text-green-200",
              },
              {
                plate: "5678 УНМ",
                job: "Тоормосны наклад",
                status: "Явцтай",
                pill: "bg-[#dc7f4f]/20 text-[#f3d3bd]",
              },
              {
                plate: "9012 УВД",
                job: "Оношилгоо",
                status: "Хүлээгдэж буй",
                pill: "bg-white/15 text-white/70",
              },
            ].map((o) => (
              <div
                key={o.plate}
                className="flex items-center gap-3 rounded-xl bg-white/[0.06] px-3 py-2"
              >
                <span className="font-mono text-xs text-white/80">{o.plate}</span>
                <span className="text-xs text-white/60 flex-1 truncate">{o.job}</span>
                <span className={`text-[10px] px-2 py-0.5 rounded-full ${o.pill}`}>
                  {o.status}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <p className="relative text-sm text-white/45">
        Автосервис бизнесийн ухаалаг хамтрагч.
      </p>
    </aside>
  );
}

function FormPanel({
  title,
  subtitle,
  footer,
  children,
  wide,
}: {
  title: string;
  subtitle?: string;
  footer?: ReactNode;
  children: ReactNode;
  wide: boolean;
}) {
  return (
    <main className="relative flex flex-col">
      {/* Зөөлөн гэрэлт дэвсгэр */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        {/* Зүүн брэнд панелийн ягаанаас формын бараан руу зөөлөн шилжилт */}
        <div className="hidden lg:block absolute inset-y-0 left-0 w-1/2 bg-gradient-to-r from-violet-800/[0.14] to-transparent" />
        <div className="absolute -top-20 right-0 w-80 h-80 bg-violet-600/12 rounded-full blur-3xl" />
        <div className="absolute bottom-0 left-1/4 w-72 h-72 bg-blue-600/10 rounded-full blur-3xl" />
      </div>

      <header className="relative z-10 flex items-center justify-between px-6 py-4">
        <Link href="/" className="lg:hidden">
          <Brand />
        </Link>
        <span className="hidden lg:block" />
        <Link
          href="/"
          className="text-sm text-white/70 hover:text-white transition-colors"
        >
          ← Нүүр
        </Link>
      </header>

      <div className="relative z-10 flex-1 flex items-center justify-center px-4 py-10 sm:py-12">
        <div className={`w-full ${wide ? "max-w-2xl" : "max-w-md"}`}>
          <div className="mb-7 text-center">
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">
              {title}
            </h1>
            {subtitle ? (
              <p className="mt-2 text-white/50 text-sm">{subtitle}</p>
            ) : null}
          </div>

          <div className="rounded-2xl border border-white/[0.1] bg-white/[0.04] backdrop-blur-xl p-6 sm:p-8 shadow-[0_8px_40px_rgba(0,0,0,0.35)]">
            {children}
          </div>

          {footer ? (
            <p className="mt-6 text-center text-sm text-white/45">{footer}</p>
          ) : null}
        </div>
      </div>
    </main>
  );
}

export function AuthShell({
  title,
  subtitle,
  footer,
  children,
  wide = false,
}: {
  title: string;
  subtitle?: string;
  footer?: ReactNode;
  children: ReactNode;
  wide?: boolean;
}) {
  // Өргөн (signup) — төвлөрсөн. Бусад (login/forgot) — зүүн талд өнгөт панелтай.
  if (wide) {
    return (
      <div className="min-h-screen flex flex-col bg-[var(--bg-primary)]">
        <FormPanel title={title} subtitle={subtitle} footer={footer} wide>
          {children}
        </FormPanel>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[var(--bg-primary)] lg:grid lg:grid-cols-2">
      <BrandPanel />
      <FormPanel title={title} subtitle={subtitle} footer={footer} wide={false}>
        {children}
      </FormPanel>
    </div>
  );
}

export function Field({
  label,
  htmlFor,
  hint,
  error,
  children,
  className = "",
  required,
}: {
  label: ReactNode;
  required?: boolean;
  htmlFor?: string;
  hint?: string;
  error?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      <label htmlFor={htmlFor} className="text-sm font-medium text-white/70">
        {label}
        {required ? <span className="text-red-400" aria-hidden> *</span> : null}
      </label>
      {children}
      {error ? (
        <p className="text-red-400 text-xs light:text-red-600">{error}</p>
      ) : hint ? (
        <p className="text-xs text-white/45">{hint}</p>
      ) : null}
    </div>
  );
}

export function SubmitButton({
  pending,
  children,
}: {
  pending?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="submit"
      disabled={pending}
      className="mt-1 w-full bg-violet-600 hover:bg-violet-500 disabled:opacity-60 disabled:cursor-not-allowed transition-all py-3 rounded-xl font-semibold text-sm flex items-center justify-center gap-2"
    >
      {pending ? <Spinner /> : children}
    </button>
  );
}

export function FormError({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <div className="flex items-start gap-2.5 bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3">
      <svg
        className="w-4 h-4 text-red-400 light:text-red-600 mt-0.5 shrink-0"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth="2"
      >
        <circle cx="12" cy="12" r="10" />
        <line x1="12" y1="8" x2="12" y2="12" />
        <line x1="12" y1="16" x2="12.01" y2="16" />
      </svg>
      <p className="text-red-400 text-sm light:text-red-600">{message}</p>
    </div>
  );
}

export function Spinner() {
  return (
    <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8v8z"
      />
    </svg>
  );
}
