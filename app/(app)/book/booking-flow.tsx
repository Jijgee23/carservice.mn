"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { getBookingBranchResults, type BookingBranchResult } from "@/app/_actions/book";
import { EmptyState } from "@/app/_components/empty-state";
import { OpenStatusBadge, PlaceLogo } from "@/app/(app)/_components/consumer-ui";
import { CategoryPickerModal } from "./category-picker-modal";
import { CategoryTagsBar } from "./category-tags-bar";
import type { ServiceKey } from "./category-picker-grid";

/**
 * Booking v2 нэгтгэсэн хуудас: ажлын төрөл сонгох (tag bar + modal) болон
 * тэдгээрийг гүйцэтгэдэг салбаруудын жагсаалт НЭГ хуудсан дээр, хуудас
 * шилжилтгүйгээр. Сонголт өөрчлөгдөх бүрд `getBookingBranchResults`
 * server action-ыг дуудаж жагсаалтыг дахин татна; URL-ийг (`?keys=`) shallow
 * `router.replace`-ээр хадгалж, шууд линк/refresh хэвээр ажиллана.
 */
export function BookingFlow({
  serviceKeys,
  initialSelectedIds,
  initialResults,
}: {
  serviceKeys: ServiceKey[];
  initialSelectedIds: string[];
  initialResults: BookingBranchResult[];
}) {
  const router = useRouter();
  const [selectedIds, setSelectedIds] = useState<string[]>(initialSelectedIds);
  const [results, setResults] = useState<BookingBranchResult[]>(initialResults);
  const [modalOpen, setModalOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  // Эхний render-ийн `initialResults`-ыг дахин татахгүй байхын тулд (props-оор
  // ирсэн эхний утга аль хэдийн зөв) — зөвхөн ХОЖИМ сонголт өөрчлөгдөхөд л
  // fetch хийнэ.
  const isFirstRender = useRef(true);
  const reqIdRef = useRef(0);

  const applySelection = useCallback(
    (ids: string[]) => {
      setSelectedIds(ids);
      const qs = ids.length > 0 ? `?keys=${ids.map(encodeURIComponent).join(",")}` : "";
      router.replace(`/book${qs}`, { scroll: false });
    },
    [router],
  );

  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    const id = ++reqIdRef.current;
    startTransition(async () => {
      const next = await getBookingBranchResults(selectedIds);
      if (id === reqIdRef.current) setResults(next);
    });
  }, [selectedIds]);

  function removeCategory(id: string) {
    applySelection(selectedIds.filter((x) => x !== id));
  }

  const step = selectedIds.length === 0 ? 1 : 2;
  const quickKeys = serviceKeys.filter((k) => !selectedIds.includes(k.id)).slice(0, 10);

  return (
    <div className="flex flex-col gap-5">
      <div className="relative overflow-hidden rounded-2xl border border-[var(--oc-line)] bg-[var(--oc-panel)] p-5 sm:p-7">
        <div
          aria-hidden
          className="pointer-events-none absolute -right-16 -top-20 h-56 w-56 rounded-full bg-[var(--oc-accent)]/10 blur-2xl"
        />
        <div className="relative flex flex-col gap-5">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--oc-accent)]">
              Онлайн цаг захиалга
            </div>
            <h1 className="mt-1.5 text-2xl sm:text-3xl font-bold text-[var(--oc-ink)]">
              Ямар ажил хийлгэх вэ?
            </h1>
            <p className="mt-2 max-w-2xl text-sm text-[var(--oc-muted)]">
              Ажлын төрлөө сонгоход тэдгээрийг{" "}
              <b className="font-semibold text-[var(--oc-ink2)]">бүгдийг нь</b> гүйцэтгэдэг салбарууд доор
              харагдана.
            </p>
          </div>

          <ol className="flex flex-wrap items-center gap-x-2 gap-y-2 text-xs">
            {["Ажлаа сонгох", "Салбараа сонгох", "Өдөр, цагаа сонгох"].map((label, i) => {
              const n = i + 1;
              const done = n < step;
              const active = n === step;
              return (
                <li key={label} className="flex items-center gap-2">
                  <span
                    className={`flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-bold ${
                      done
                        ? "bg-emerald-500 text-[#fff]"
                        : active
                          ? "bg-[var(--oc-accent)] text-[var(--oc-on-accent)]"
                          : "bg-[var(--oc-panel2)] text-[var(--oc-muted3)] border border-[var(--oc-line)]"
                    }`}
                  >
                    {done ? "✓" : n}
                  </span>
                  <span className={active ? "font-semibold text-[var(--oc-ink)]" : "text-[var(--oc-muted)]"}>
                    {label}
                  </span>
                  {n < 3 ? <span aria-hidden className="mx-1 h-px w-6 bg-[var(--oc-line)]" /> : null}
                </li>
              );
            })}
          </ol>

          <CategoryTagsBar
            serviceKeys={serviceKeys}
            selectedIds={selectedIds}
            onRemove={removeCategory}
            onOpenPicker={() => setModalOpen(true)}
          />

          {quickKeys.length > 0 ? (
            <div className="flex flex-col gap-2 border-t border-[var(--oc-line2)] pt-4">
              <div className="text-[11px] font-medium uppercase tracking-wide text-[var(--oc-muted3)]">
                Түгээмэл ажлууд
              </div>
              <div className="flex flex-wrap gap-2">
                {quickKeys.map((k) => (
                  <button
                    key={k.id}
                    type="button"
                    onClick={() => applySelection([...selectedIds, k.id])}
                    className="inline-flex items-center gap-1 rounded-full border border-[var(--oc-line)] bg-[var(--oc-panel2)] px-3 py-1.5 text-xs font-medium text-[var(--oc-ink2)] hover:border-[var(--oc-accent)]/60 hover:text-[var(--oc-accent)] transition-colors"
                  >
                    <span aria-hidden className="text-[var(--oc-muted3)]">+</span>
                    {k.name}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </div>

      <CategoryPickerModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onApply={applySelection}
        serviceKeys={serviceKeys}
        currentSelected={selectedIds}
      />

      <div className={`transition-opacity ${isPending ? "opacity-50" : ""}`}>
        {selectedIds.length === 0 ? (
          <EmptyState dashed>
            Ажлын төрлөө сонгоход тохирох салбарууд эндээс харагдана.
          </EmptyState>
        ) : results.length === 0 ? (
          <EmptyState>
            Сонгосон ажлуудыг зэрэг гүйцэтгэдэг салбар олдсонгүй. Ажлын
            төрлөөсөө хасаад дахин үзнэ үү.
          </EmptyState>
        ) : (
          <div className="flex flex-col gap-3">
            <div className="text-sm text-[var(--oc-muted)]">
              <b className="font-semibold text-[var(--oc-ink)]">{results.length}</b> салбар тохирлоо
            </div>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {results.map((r) => (
                <Link
                  key={r.id}
                  href={`/book/branch/${r.id}${selectedIds.length > 0 ? `?keys=${selectedIds.map(encodeURIComponent).join(",")}` : ""}`}
                  className="group rounded-2xl border border-[var(--oc-line)] bg-[var(--oc-panel)] p-4 flex flex-col gap-3 shadow-sm hover:shadow-lg hover:border-[var(--oc-accent)]/50 transition-all"
                >
                  <div className="flex items-center gap-3">
                    <PlaceLogo name={r.tenantName} logoUrl={r.logoUrl} className="w-11 h-11 rounded-xl text-base" />
                    <div className="min-w-0 flex-1">
                      <div className="font-semibold text-[var(--oc-ink)] truncate group-hover:text-[var(--oc-accent)] transition-colors">
                        {r.name}
                      </div>
                      <div className="text-xs text-[var(--oc-muted3)] truncate">{r.tenantName}</div>
                    </div>
                  </div>
                  <div className="flex items-start gap-1.5 text-xs text-[var(--oc-muted)]">
                    <svg className="w-3.5 h-3.5 mt-px shrink-0 text-[var(--oc-muted3)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                      <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
                      <circle cx="12" cy="10" r="3" />
                    </svg>
                    <span className="min-w-0 truncate">{r.address}</span>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <OpenStatusBadge open={r.open} hours={r.hours} />
                    <span className="inline-flex items-center gap-1 rounded-lg border border-[var(--oc-accent)]/40 px-3 py-1.5 text-xs font-semibold text-[var(--oc-accent)] transition-colors group-hover:bg-[var(--oc-accent)] group-hover:text-[var(--oc-on-accent)] group-hover:border-[var(--oc-accent)]">
                      Цаг авах <span aria-hidden>→</span>
                    </span>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        )}
      </div>

      <Link
        href="/discover"
        className="inline-flex items-center gap-1.5 self-start text-sm font-medium text-[var(--oc-accent)] hover:text-[var(--oc-accent-hi)] transition-colors"
      >
        Бүх автосервисийг газрын зураг дээр үзэх <span aria-hidden>→</span>
      </Link>
    </div>
  );
}
