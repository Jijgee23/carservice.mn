"use client";

// Нэвтэрсний дараа сонгосон "ажиллах салбар"-ыг dashboard дотроос гарахгүйгээр
// солих боломж. Өмнө нь зөвхөн уншигдах баннер байсан бөгөөд өөр салбар руу
// шилжихийн тулд гарч дахин нэвтрэх шаардлагатай байсан (харах:
// app/_actions/auth.ts chooseBranchAction-ийн комент, app/page/choose-branch/).
// chooseBranchAction өөрөө дахин сонгуулахыг хориглодоггүй тул энд шууд дахин
// ашиглав — зөвхөн /page/choose-branch-ийн "аль хэдийн сонгосон бол дахин
// сонгуулахгүй" гэсэн хуудасны redirect л саад байсан.
import { useActionState, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { type ChooseBranchState, chooseBranchAction } from "@/app/_actions/auth";
import { ALL_BRANCHES } from "@/lib/auth/session";

export type BranchSwitchOption = { id: string; name: string };

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

  // Сонгож болох БҮХ сонголтыг (одоогийн сонголтыг оролцуулаад) харуулна —
  // одоогийнхыг цэснээс ХАСАХГҮЙ, харин тэмдэглэгээ (✓) тавьж ялгана (owner
  // өөрийн байгаа хэдэн салбар + "Бүх салбар"-аас алийг нь ч дарж сонгож
  // болно; олон салбарт ажилладаг ажилтанд адилхан зарчим).
  type Option =
    | { kind: "all"; isCurrent: boolean }
    | { kind: "branch"; id: string; name: string; isCurrent: boolean };
  const options: Option[] = [
    ...branches.map(
      (b): Option => ({
        kind: "branch",
        id: b.id,
        name: b.name,
        isCurrent: !currentIsAll && b.id === currentBranch?.id,
      }),
    ),
    // Нэг салбартай үед «Бүх салбар» тэр салбартай ялгаагүй тул санал болгохгүй.
    ...(allowAllBranches && branches.length > 1
      ? [{ kind: "all", isCurrent: currentIsAll } as Option]
      : []),
  ];
  const canSwitch = options.length > 1 && !locked;

  const label = (
    <>
      {firstName}, та өнөөдөр{" "}
      <span className="font-semibold text-[var(--oc-accent)]">
        {currentIsAll ? "БҮХ САЛБАРЫГ" : (currentBranch?.name ?? "—")}
      </span>{" "}
      {currentIsAll ? "хараад байна." : "салбарт ажиллаж байна."}
      {locked ? (
        <span
          className="ml-1.5 text-[var(--oc-muted3)]"
          title="Өнөөдрийн ажлын хувиараар тогтоосон тул өөрчлөх боломжгүй."
        >
          🔒
        </span>
      ) : null}
    </>
  );

  // Солих боломжгүй (ганцхан eligible салбартай ажилтан, эсвэл өнөөдрийн
  // ажлын хувиараар түгжигдсэн) бол интерактив харагдацгүй, зөвхөн
  // мэдээллийн баннер хэвээр.
  if (!canSwitch) {
    return (
      <div className="shrink-0 flex items-center gap-1 rounded-[10px] border border-[var(--oc-accent)]/25 bg-[var(--oc-accent)]/[0.06] px-4 py-2.5 text-sm text-[var(--oc-ink2)]">
        {label}
      </div>
    );
  }

  return (
    <div ref={containerRef} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex items-center gap-2 rounded-[10px] border border-[var(--oc-accent)]/25 bg-[var(--oc-accent)]/[0.06] hover:border-[var(--oc-accent)]/40 hover:bg-[var(--oc-accent)]/[0.09] transition-colors px-4 py-2.5 text-sm text-[var(--oc-ink2)]"
      >
        {label}
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={`shrink-0 text-[var(--oc-accent)] transition-transform ${open ? "rotate-180" : ""}`}
          aria-hidden="true"
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>

      {open ? (
        <div className="absolute left-0 z-20 mt-1.5 w-64 max-w-[85vw] rounded-[10px] border border-[var(--oc-line)] bg-[var(--oc-panel)] shadow-xl p-1.5 flex flex-col gap-0.5">
          <div className="px-2.5 py-1 font-plex-mono text-[10px] uppercase tracking-[0.08em] text-[var(--oc-muted3)]">
            Ажиллах салбар солих
          </div>
          {state && !state.ok ? (
            <div className="mx-1 mb-1 rounded-lg bg-red-500/10 px-2.5 py-1.5 text-xs text-red-400 light:text-red-600">
              {state.message}
            </div>
          ) : null}
          {options.map((opt) => {
            const key = opt.kind === "all" ? ALL_BRANCHES : opt.id;
            const name = opt.kind === "all" ? "Бүх салбар" : opt.name;
            const accentText = opt.kind === "all" || opt.isCurrent;

            if (opt.isCurrent) {
              return (
                <div
                  key={key}
                  className={`w-full flex items-center justify-between gap-2 px-2.5 py-2 rounded-lg text-sm font-medium ${
                    accentText
                      ? "text-[var(--oc-accent)] bg-[var(--oc-accent)]/10"
                      : "text-[var(--oc-ink2)] bg-[var(--oc-panel2)]"
                  }`}
                >
                  {name}
                  <svg
                    width="15"
                    height="15"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="shrink-0"
                    aria-hidden="true"
                  >
                    <path d="M20 6 9 17l-5-5" />
                  </svg>
                </div>
              );
            }

            return (
              <form key={key} action={formAction}>
                <input
                  type="hidden"
                  name="branchId"
                  value={opt.kind === "all" ? ALL_BRANCHES : opt.id}
                />
                <input type="hidden" name="next" value={next} />
                <button
                  type="submit"
                  disabled={pending}
                  className={`w-full text-left px-2.5 py-2 rounded-lg text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                    accentText
                      ? "font-medium text-[var(--oc-accent)] hover:bg-[var(--oc-accent)]/10"
                      : "text-[var(--oc-ink2)] hover:bg-[var(--oc-panel2)]"
                  }`}
                >
                  {name}
                </button>
              </form>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
