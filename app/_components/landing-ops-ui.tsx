import Link from "next/link";
import type { ReactNode } from "react";

// "Ops Console" landing дизайны shared primitives (designs/Ops Console ба
// Precision Light/nextjs/components/ui.tsx-ийн Next.js хувилбар). Зөвхөн
// .landing-ops wrapper дотор ашиглагдана — --oc-* CSS хувьсагчид тэндээс ирнэ.

export function Container({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={`mx-auto max-w-[1240px] px-4 sm:px-6 lg:px-8 ${className}`}>{children}</div>;
}

export function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <div className="font-plex-mono text-[12px] uppercase tracking-[0.14em] text-[var(--oc-accent)]">
      {children}
    </div>
  );
}

export function ButtonPrimary({
  href,
  children,
}: {
  href: string;
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      className="rounded-lg bg-[var(--oc-accent)] px-6 py-[15px] text-[15px] font-semibold text-[var(--oc-on-accent)] transition-colors hover:bg-[var(--oc-accent-hi)]"
    >
      {children}
    </Link>
  );
}

export function ButtonGhost({
  href,
  children,
}: {
  href: string;
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      className="rounded-lg border border-[var(--oc-line)] px-6 py-[15px] text-[15px] font-medium text-[var(--oc-ink2)] transition-colors hover:border-[var(--oc-muted4)] hover:bg-[var(--oc-panel2)]"
    >
      {children}
    </Link>
  );
}

export function StatusPill({ children }: { children: ReactNode }) {
  return (
    <div className="inline-flex items-center gap-2 rounded-full border border-[var(--oc-line)] bg-[var(--oc-panel)] px-3 py-1.5">
      <span className="h-1.5 w-1.5 rounded-full bg-[var(--oc-ok)]" />
      <span className="font-plex-mono text-[12.5px] text-[var(--oc-muted)]">
        {children}
      </span>
    </div>
  );
}

// --- Форм primitives (login/forgot/signup/system-login хуваалцдаг) --------

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
      <label htmlFor={htmlFor} className="text-sm font-medium text-[var(--oc-ink2)]">
        {label}
        {required ? <span className="text-red-400" aria-hidden> *</span> : null}
      </label>
      {children}
      {error ? (
        <p className="text-red-400 text-xs light:text-red-600">{error}</p>
      ) : hint ? (
        <p className="text-xs text-[var(--oc-muted3)]">{hint}</p>
      ) : null}
    </div>
  );
}

const SUBMIT_TONE = {
  accent:
    "bg-[var(--oc-accent)] hover:bg-[var(--oc-accent-hi)] text-[var(--oc-on-accent)]",
  danger: "bg-red-600 hover:bg-red-500 text-white",
} as const;

export function SubmitButton({
  pending,
  tone = "accent",
  children,
}: {
  pending?: boolean;
  tone?: keyof typeof SUBMIT_TONE;
  children: ReactNode;
}) {
  return (
    <button
      type="submit"
      disabled={pending}
      className={`mt-1 w-full disabled:opacity-60 disabled:cursor-not-allowed transition-colors py-3 rounded-lg font-semibold text-sm flex items-center justify-center gap-2 ${SUBMIT_TONE[tone]}`}
    >
      {pending ? <Spinner /> : children}
    </button>
  );
}

// --- Dashboard widgets (жагсаалт/дэлгэрэнгүй хуудсууд хуваалцдаг) ----------
// Энэ хэсгийн зорилго: хэмжээ/зай/өнгөний стандарт НЭГ газар байх — өмнө нь
// branches/employees/roles/orders тус бүр өөрийн "StatCell", "+ товч",
// badge/chip-ийг тус тусад нь давхардуулж бичсэн байсан (px-4/5/6,
// text-[10px]/[10.5px]/[11px] гэх мэт жижиг ялгаатай хувилбарууд) — эндээс
// импортолж ашигласнаар шинэ хуудас бүр автоматаар ижил хэмжээтэй гарна.

export function PlusIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

export type BtnVariant = "primary" | "ghost" | "danger";
export type BtnSize = "md" | "sm";

// "md" — header/sticky-bar үйлдэл (Хадгалах/Буцах/Нэмэх), "sm" — мөр/панель
// доторх жижиг үйлдэл (+Мөр нэмэх, Бөглөх, Шалгах). Бүх хуудсанд зөвхөн энэ
// 2 хэмжээ — өөр px/py хослол шинээр зохиохгүй.
/** Export хийсэн шалтгаан: заримдаа `<a>` (жишээ: файл татах endpoint —
 * next/link `Link` биш, ердийн navigation байх ёстой) дээр яг адилхан
 * харагдацтай classNames хэрэгтэй болдог. */
export function btnClass(variant: BtnVariant, size: BtnSize, className = ""): string {
  const sizeCls =
    size === "sm" ? "px-3 py-1.5 text-xs rounded-lg" : "px-4 py-2.5 text-sm rounded-lg";
  const variantCls =
    variant === "primary"
      ? "bg-[var(--oc-accent)] hover:bg-[var(--oc-accent-hi)] text-[var(--oc-on-accent)] font-semibold"
      : variant === "danger"
        ? "bg-red-500/15 hover:bg-red-500/25 text-red-400 light:text-red-600 border border-red-500/30 font-medium"
        : "border border-[var(--oc-line)] hover:border-[var(--oc-line2)] hover:bg-[var(--oc-panel2)] text-[var(--oc-ink2)] font-medium";
  return `inline-flex items-center justify-center gap-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap ${sizeCls} ${variantCls} ${className}`;
}

/** `<button>`-ээр render хийгдэх үйлдэл — submit/type=button, `form=` attribute дэмжинэ. */
export function Btn({
  variant = "primary",
  size = "md",
  className = "",
  children,
  ...rest
}: {
  variant?: BtnVariant;
  size?: BtnSize;
  className?: string;
  children: ReactNode;
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button className={btnClass(variant, size, className)} {...rest}>
      {children}
    </button>
  );
}

/** `<Link>`-ээр render хийгдэх навигацийн үйлдэл (← Буцах, Excel татах, Нэмэх). */
export function BtnLink({
  href,
  variant = "primary",
  size = "md",
  className = "",
  children,
}: {
  href: string;
  variant?: BtnVariant;
  size?: BtnSize;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Link href={href} className={btnClass(variant, size, className)}>
      {children}
    </Link>
  );
}

/** Жагсаалтын header-т байдаг "+ Шинэ ... нэмэх" товч — icon+text стандарт хослол. */
export function AddLinkButton({ href, children }: { href: string; children: ReactNode }) {
  return (
    <BtnLink href={href} variant="primary" size="md">
      <PlusIcon />
      {children}
    </BtnLink>
  );
}

/** Жижиг дөрвөлжин "+" товч — inline quick-create (жишээ: захиалгын форм дахь
 * "Шинэ үйлчлүүлэгч/машин нэмэх" toggle). `active` үед "✕" (хаах) харагдана. */
export function SquareAddButton({
  active,
  className = "",
  ...rest
}: {
  active?: boolean;
  className?: string;
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      className={`shrink-0 h-11 w-11 flex items-center justify-center rounded-lg border border-[var(--oc-accent)]/30 bg-[var(--oc-accent)]/10 hover:bg-[var(--oc-accent)]/20 text-[var(--oc-accent)] text-base font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${className}`}
      {...rest}
    >
      {active ? "✕" : "+"}
    </button>
  );
}

export type ChipTone = "accent" | "ok" | "danger" | "warn" | "neutral";

const CHIP_TONE: Record<ChipTone, string> = {
  accent: "bg-[var(--oc-accent)]/15 text-[var(--oc-accent)]",
  ok: "bg-[var(--oc-ok)]/15 text-[var(--oc-ok)]",
  danger: "bg-red-500/15 text-red-400 light:text-red-600",
  warn: "bg-[var(--oc-warn)]/15 text-[var(--oc-warn)]",
  neutral: "bg-[var(--oc-panel2)] text-[var(--oc-muted2)]",
};
const CHIP_BORDER: Record<ChipTone, string> = {
  accent: "border border-[var(--oc-accent)]/30",
  ok: "border border-[var(--oc-ok)]/30",
  danger: "border border-red-500/30",
  warn: "border border-[var(--oc-warn)]/30",
  neutral: "border border-[var(--oc-line)]",
};

/** Checkbox-оор удирдагддаг компакт pill toggle — form мөрөнд бусад талбар
 * (input, товч)-тай ижил өндөртэй (`h-11`) зэрэгцэн зогсохоор зохиогдсон.
 * Сонгогдоход (`has-checked:`) ногоон өнгөөр тодрано. Урт тайлбар текст
 * шаардлагатай бол дуудагч тал `<p>`-ээр мөрнөөс гадна тусад нь харуулна. */
export function ToggleChip({
  name,
  label,
  defaultChecked,
  className = "",
}: {
  name: string;
  label: ReactNode;
  defaultChecked?: boolean;
  className?: string;
}) {
  return (
    <label
      className={`inline-flex h-11 items-center gap-1.5 rounded-xl border border-[var(--input-border)] bg-[var(--input-bg)] px-3.5 text-xs text-[var(--oc-muted3)] whitespace-nowrap cursor-pointer transition-colors has-checked:border-[var(--oc-ok)]/40 has-checked:bg-[var(--oc-ok)]/10 has-checked:text-[var(--oc-ok)] ${className}`}
    >
      <input
        type="checkbox"
        name={name}
        defaultChecked={defaultChecked}
        className="sr-only"
      />
      <span className="w-1.5 h-1.5 rounded-full bg-current shrink-0" />
      {label}
    </label>
  );
}

/** Жижиг badge/pill — төлөв (Идэвхтэй/Хугацаа дууссан), үүрэг (Админ), тэмдэг
 * (Үндсэн) зэрэгт ашиглана. Хэмжээ ганцхан — хуудас бүр өөр px/text-size
 * зохиохгүй. `bordered` — pill дэвсгэр сул hue дээр тодрохгүй үед (жишээ:
 * жагсаалтын хүснэгтэд) хүрээ нэмнэ. */
export function Chip({
  tone = "neutral",
  bordered = false,
  className = "",
  children,
}: {
  tone?: ChipTone;
  bordered?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span
      className={`inline-flex items-center font-plex-mono text-[11px] px-2.5 py-1 rounded-full whitespace-nowrap ${CHIP_TONE[tone]} ${bordered ? CHIP_BORDER[tone] : ""} ${className}`}
    >
      {children}
    </span>
  );
}

/** Богино тэмдэглэгээ mono текст доор жагсаах жижиг tag (жишээ: role-ийн
 * сонгосон эрхийн жагсаалт) — `Chip`-ээс жижиг, үргэлж хүрээтэй. */
export function TagChip({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center font-plex-mono text-[10px] px-2 py-0.5 rounded-full bg-[var(--oc-panel2)] text-[var(--oc-muted2)] border border-[var(--oc-line)] whitespace-nowrap">
      {children}
    </span>
  );
}

// Segmented tab pill — статус/шүүлтүүрийн mono товчлуур мөр (жагсаалтын
// header, item-kind таб гэх мэт). `TabLink` (URL-аар шүүдэг) болон
// `TabButton` (client state-аар шүүдэг) ижил харагдацтай.
function tabPillClass(active: boolean): string {
  return `text-xs px-3 py-1.5 rounded-lg font-medium transition-colors whitespace-nowrap ${active
    ? "bg-[var(--oc-accent)] text-[var(--oc-on-accent)]"
    : "text-[var(--oc-muted2)] hover:text-[var(--oc-ink2)] hover:bg-white/[0.05]"
    }`;
}

export function TabLink({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: ReactNode;
}) {
  return (
    <Link href={href} className={tabPillClass(active)}>
      {children}
    </Link>
  );
}

export function TabButton({
  active,
  onClick,
  disabled,
  children,
}: {
  active: boolean;
  onClick: () => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`${tabPillClass(active)} disabled:opacity-40 disabled:cursor-not-allowed`}
    >
      {children}
    </button>
  );
}

// Hairline-grid stat карт мөр (branches/employees/roles жагсаалтын
// header-ийн доор) — 3 хуудсанд ЯГ ижил бүтэцтэй "StatCell" функц тус
// тусдаа давхардуулж бичигдсэн байсныг эндээс нэгтгэсэн.
const STAT_COLS: Record<3 | 4 | 5 | 6, string> = {
  3: "sm:grid-cols-3",
  4: "sm:grid-cols-4",
  5: "sm:grid-cols-3 lg:grid-cols-5",
  6: "sm:grid-cols-3 lg:grid-cols-6",
};

export function StatGrid({ cols = 4, children }: { cols?: 3 | 4 | 5 | 6; children: ReactNode }) {
  return (
    <div
      className={`grid grid-cols-2 gap-px overflow-hidden rounded-[10px] border border-[var(--oc-line)] bg-[var(--oc-line)] ${STAT_COLS[cols]} mb-6`}
    >
      {children}
    </div>
  );
}

export function StatCell({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "ok" | "accent" | "warn";
}) {
  const valueClass =
    tone === "ok"
      ? "text-[var(--oc-ok)]"
      : tone === "accent"
        ? "text-[var(--oc-accent)]"
        : tone === "warn"
          ? "text-red-400 light:text-red-600"
          : "text-[var(--oc-ink)]";
  return (
    <div className="bg-[var(--oc-panel)] p-4">
      <div className="font-plex-mono text-[10.5px] uppercase tracking-[0.1em] text-[var(--oc-muted3)]">
        {label}
      </div>
      <div className={`font-plex-mono text-2xl font-semibold mt-1 tabular-nums ${valueClass}`}>
        {value.toLocaleString("mn-MN")}
      </div>
    </div>
  );
}

export function FormError({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <div className="flex items-start gap-2.5 bg-red-500/10 border border-red-500/20 rounded-[10px] px-4 py-3">
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

function Spinner() {
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
