"use client";

// Нэвтэрсний дараа сонгосон "ажиллах салбар"-ыг dashboard дотроос гарахгүйгээр
// солих боломж. Өмнө нь зөвхөн уншигдах баннер байсан бөгөөд өөр салбар руу
// шилжихийн тулд гарч дахин нэвтрэх шаардлагатай байсан (харах:
// app/_actions/auth.ts chooseBranchAction-ийн комент, app/page/choose-branch/).
// chooseBranchAction өөрөө дахин сонгуулахыг хориглодоггүй тул энд шууд дахин
// ашиглав — зөвхөн /page/choose-branch-ийн "аль хэдийн сонгосон бол дахин
// сонгуулахгүй" гэсэн хуудасны redirect л саад байсан.
import { useActionState, useEffect, useRef, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { type ChooseBranchState, chooseBranchAction } from "@/app/_actions/auth";
import { ALL_BRANCHES } from "@/lib/auth/session";

export type BranchSwitchOption = { id: string; name: string };

/** Ийм тооноос олон сонголттой бол цэсэнд хайлт гарна. */
const SEARCH_THRESHOLD = 6;

function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const letters = words.length > 1 ? words[0][0] + words[1][0] : (words[0] ?? "?").slice(0, 2);
  return letters.toUpperCase();
}

function PinIcon({ className = "" }: { className?: string }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" />
      <circle cx="12" cy="10" r="3" />
    </svg>
  );
}

function GridIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
    </svg>
  );
}

function LockIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="4" y="11" width="16" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </svg>
  );
}

export function BranchSwitcher({
  firstName,
  currentBranch,
  currentIsAll,
  branches,
  allowAllBranches,
  locked = false,
}: {
  firstName: string;
  currentBranch: { id: string; name: string } | null;
  currentIsAll: boolean;
  branches: BranchSwitchOption[];
  allowAllBranches: boolean;
  // Өнөөдрийн ажлын хувиараар тодорхой салбар түгжигдсэн бол (харах:
  // lib/employee-branch-lock.ts) сонголтоор өөр салбар руу шилжих боломжгүй
  // болгож, зөвхөн мэдээллийн баннер хэлбэрээр харуулна.
  locked?: boolean;
}) {
  const pathname = usePathname();
  // Захиалга/машин/үйлчлүүлэгч гэх мэт цор ганц бичлэгийн дэлгэрэнгүй хуудас
  // ("/dashboard/orders/<id>" гэх мэт) нь шинэ салбарт харьяалагдахгүй байж
  // болзошгүй тул (branch-scoped query) 404 үзүүлж болзошгүй — салбар
  // сольсны дараа тухайн хэсгийн жагсаалт руу ("/dashboard/orders") л
  // буцаана. Зөвхөн "/dashboard" эсвэл хэсгийн үндэс мөр бол хэвээр үлдэнэ.
  const segments = pathname.split("/").filter(Boolean);
  const next = segments.length > 2 ? `/${segments.slice(0, 2).join("/")}` : pathname;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [pendingId, setPendingId] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [state, formAction, pending] = useActionState<
    ChooseBranchState,
    FormData
  >(chooseBranchAction, null);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // Нэг салбартай үед «Бүх салбар» тэр салбартай ялгаагүй тул санал болгохгүй.
  const showAll = allowAllBranches && branches.length > 1;
  // Сонгож болох БҮХ сонголтыг (одоогийнхыг оролцуулаад) харуулна — одоогийнхыг
  // цэснээс хасахгүй, харин тэмдэглэгээ (✓) тавьж ялгана.
  const canSwitch = branches.length + (showAll ? 1 : 0) > 1 && !locked;
  const currentName = currentIsAll ? "Бүх салбар" : (currentBranch?.name ?? "—");
  const q = query.trim().toLowerCase();
  const filtered = q ? branches.filter((b) => b.name.toLowerCase().includes(q)) : branches;
  const searchable = branches.length > SEARCH_THRESHOLD;

  const chip = (
    <>
      <span
        className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg ${
          currentIsAll
            ? "bg-violet-500/15 text-violet-300 light:text-violet-700"
            : "bg-[var(--oc-accent)]/15 text-[var(--oc-accent)]"
        }`}
      >
        {currentIsAll ? <GridIcon /> : <PinIcon />}
      </span>
      <span className="flex min-w-0 flex-col text-left leading-tight">
        <span className="flex items-center gap-1.5 font-plex-mono text-[10px] uppercase tracking-[0.1em] text-[var(--oc-muted3)]">
          <span className="relative flex h-1.5 w-1.5" aria-hidden="true">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60 motion-reduce:hidden" />
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-400" />
          </span>
          {currentIsAll ? "Харж буй" : "Ажиллаж буй салбар"}
        </span>
        <span className="truncate text-sm font-semibold text-[var(--oc-ink)]" title={currentName}>
          {currentName}
        </span>
      </span>
    </>
  );

  // Солих боломжгүй (ганцхан eligible салбартай ажилтан, эсвэл өнөөдрийн
  // ажлын хувиараар түгжигдсэн) бол интерактив харагдацгүй, зөвхөн мэдээлэл.
  if (!canSwitch) {
    return (
      <div
        className="flex min-w-0 shrink-0 items-center gap-3 rounded-xl border border-[var(--oc-line)] bg-[var(--oc-panel)] py-1.5 pl-1.5 pr-4"
        title={locked ? "Өнөөдрийн ажлын хувиараар тогтоосон тул өөрчлөх боломжгүй." : `${firstName}, та энэ салбарт ажиллаж байна.`}
      >
        {chip}
        {locked ? (
          <span className="ml-1 inline-flex items-center gap-1 rounded-full bg-white/[0.06] px-2 py-0.5 text-[11px] text-[var(--oc-muted3)] light:bg-black/[0.05]">
            <LockIcon />
            Хувиар
          </span>
        ) : null}
      </div>
    );
  }

  return (
    <div ref={containerRef} className="relative min-w-0 shrink-0">
      <button
        type="button"
        onClick={() => {
          setOpen((o) => !o);
          setQuery("");
        }}
        aria-haspopup="listbox"
        aria-expanded={open}
        title={`${firstName}, ажиллах салбараа солих`}
        className={`group flex w-full min-w-0 items-center gap-3 rounded-xl border bg-[var(--oc-panel)] py-1.5 pl-1.5 pr-3 transition-colors sm:w-auto ${
          open
            ? "border-[var(--oc-accent)]/50 ring-2 ring-[var(--oc-accent)]/15"
            : "border-[var(--oc-line)] hover:border-[var(--oc-line2)] hover:bg-[var(--oc-panel2)]"
        }`}
      >
        {chip}
        <span className="ml-auto grid h-6 w-6 shrink-0 place-items-center rounded-md text-[var(--oc-muted3)] transition-colors group-hover:text-[var(--oc-ink2)]">
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={`transition-transform duration-200 ${open ? "rotate-180" : ""}`}
            aria-hidden="true"
          >
            <path d="m6 9 6 6 6-6" />
          </svg>
        </span>
      </button>

      {open ? (
        <div className="absolute left-0 z-40 mt-2 flex w-72 max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-2xl border border-[var(--oc-line)] bg-[var(--oc-panel)] shadow-[0_24px_60px_-12px_rgba(0,0,0,0.55)]">
          <div className="px-4 pb-2 pt-3.5">
            <div className="text-[15px] font-semibold text-[var(--oc-ink)]">Ажиллах салбар</div>
            <div className="mt-0.5 text-xs text-[var(--oc-muted3)]">Сонгосон салбарын өгөгдөл харагдана.</div>
          </div>
          {searchable ? (
            <div className="px-3 pb-2">
              <input
                type="search"
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Салбар хайх…"
                aria-label="Салбар хайх"
                className="w-full rounded-lg border border-[var(--oc-line)] bg-[var(--oc-panel2)] px-3 py-2 text-sm text-[var(--oc-ink)] outline-none placeholder:text-[var(--oc-muted3)] focus:border-[var(--oc-accent)]/50"
              />
            </div>
          ) : null}
          {state && !state.ok ? (
            <div className="mx-3 mb-2 rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-400 light:text-red-600">
              {state.message}
            </div>
          ) : null}

          <ul role="listbox" aria-label="Салбарууд" className="max-h-72 overflow-y-auto border-t border-[var(--oc-line)] p-1.5">
            {filtered.length === 0 ? (
              <li className="px-3 py-4 text-center text-sm text-[var(--oc-muted3)]">Салбар олдсонгүй.</li>
            ) : (
              filtered.map((b) => (
                <Option
                  key={b.id}
                  value={b.id}
                  name={b.name}
                  icon={<span className="font-plex-mono text-[11px] font-semibold">{initials(b.name)}</span>}
                  current={!currentIsAll && b.id === currentBranch?.id}
                  busy={pending && pendingId === b.id}
                  disabled={pending}
                  next={next}
                  formAction={formAction}
                  onPick={() => setPendingId(b.id)}
                />
              ))
            )}
            {showAll && !q ? (
              <>
                <li role="separator" className="mx-2 my-1.5 border-t border-[var(--oc-line)]" />
                <Option
                  value={ALL_BRANCHES}
                  name="Бүх салбар"
                  hint="Бүх салбарын өгөгдлийг нэгтгэж харна"
                  icon={<GridIcon />}
                  accent
                  current={currentIsAll}
                  busy={pending && pendingId === ALL_BRANCHES}
                  disabled={pending}
                  next={next}
                  formAction={formAction}
                  onPick={() => setPendingId(ALL_BRANCHES)}
                />
              </>
            ) : null}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function Option({
  value,
  name,
  hint,
  icon,
  accent = false,
  current,
  busy,
  disabled,
  next,
  formAction,
  onPick,
}: {
  value: string;
  name: string;
  hint?: string;
  icon: ReactNode;
  accent?: boolean;
  current: boolean;
  busy: boolean;
  disabled: boolean;
  next: string;
  formAction: (fd: FormData) => void;
  onPick: () => void;
}) {
  const iconClass = current
    ? "bg-[var(--oc-accent)] text-[var(--oc-on-accent)]"
    : accent
      ? "bg-violet-500/15 text-violet-300 light:text-violet-700"
      : "bg-white/[0.06] text-[var(--oc-ink2)] light:bg-black/[0.05]";
  const body = (
    <>
      <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg ${iconClass}`}>{icon}</span>
      <span className="min-w-0 flex-1">
        <span className={`block truncate text-sm ${current ? "font-semibold text-[var(--oc-ink)]" : "text-[var(--oc-ink2)]"}`}>
          {name}
        </span>
        {hint ? <span className="block truncate text-[11px] text-[var(--oc-muted3)]">{hint}</span> : null}
      </span>
      {busy ? (
        <span
          className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-[var(--oc-accent)] border-t-transparent"
          aria-label="Солиж байна"
        />
      ) : current ? (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-[var(--oc-accent)]" aria-hidden="true">
          <path d="M20 6 9 17l-5-5" />
        </svg>
      ) : null}
    </>
  );

  if (current) {
    return (
      <li role="option" aria-selected="true" className="flex items-center gap-3 rounded-xl bg-[var(--oc-accent)]/[0.08] px-2 py-2">
        {body}
      </li>
    );
  }
  return (
    <li role="option" aria-selected="false">
      <form action={formAction} onSubmit={onPick}>
        <input type="hidden" name="branchId" value={value} />
        <input type="hidden" name="next" value={next} />
        <button
          type="submit"
          disabled={disabled}
          className="flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left transition-colors hover:bg-[var(--oc-panel2)] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {body}
        </button>
      </form>
    </li>
  );
}
