"use client";

import { useCallback, useEffect, useState } from "react";

// Олон нийтийн хуудасны зургийн цуглуулга: жижиг thumbnail grid + дарахад томруулж харах (←/→/Esc).
export function PhotoGallery({ photos, label }: { photos: Array<{ id: string; url: string }>; label: string }) {
  const [open, setOpen] = useState<number | null>(null);
  const count = photos.length;

  const close = useCallback(() => setOpen(null), []);
  const step = useCallback((d: number) => setOpen((i) => (i === null ? i : (i + d + count) % count)), [count]);

  useEffect(() => {
    if (open === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
      else if (e.key === "ArrowRight") step(1);
      else if (e.key === "ArrowLeft") step(-1);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, close, step]);

  if (count === 0) return null;
  const [first, ...rest] = photos;

  return (
    <>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <button
          type="button"
          onClick={() => setOpen(0)}
          aria-label={`${label}: зураг 1-ийг томруулах`}
          className="col-span-2 row-span-2 aspect-[4/3] sm:aspect-auto sm:h-full overflow-hidden rounded-xl border border-[var(--oc-line)] bg-[var(--oc-panel2)]"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={first.url} alt={`${label} — 1`} className="w-full h-full object-cover" />
        </button>
        {rest.slice(0, 4).map((p, i) => (
          <button
            key={p.id}
            type="button"
            onClick={() => setOpen(i + 1)}
            aria-label={`${label}: зураг ${i + 2}-ийг томруулах`}
            className="relative aspect-[4/3] overflow-hidden rounded-xl border border-[var(--oc-line)] bg-[var(--oc-panel2)]"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={p.url} alt={`${label} — ${i + 2}`} loading="lazy" className="w-full h-full object-cover" />
            {i === 3 && count > 5 ? (
              <span className="absolute inset-0 flex items-center justify-center bg-black/55 text-white text-sm font-medium">
                +{count - 5}
              </span>
            ) : null}
          </button>
        ))}
      </div>

      {open !== null ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`${label} — зураг ${open + 1}/${count}`}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4"
          onClick={close}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={photos[open].url}
            alt={`${label} — ${open + 1}`}
            className="max-h-[88vh] max-w-full rounded-lg object-contain"
            onClick={(e) => e.stopPropagation()}
          />
          <button type="button" onClick={close} aria-label="Хаах" className="absolute top-4 right-4 text-white text-3xl leading-none">
            ×
          </button>
          {count > 1 ? (
            <>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  step(-1);
                }}
                aria-label="Өмнөх"
                className="absolute left-3 top-1/2 -translate-y-1/2 text-white text-4xl px-2"
              >
                ‹
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  step(1);
                }}
                aria-label="Дараах"
                className="absolute right-3 top-1/2 -translate-y-1/2 text-white text-4xl px-2"
              >
                ›
              </button>
              <span className="absolute bottom-4 left-1/2 -translate-x-1/2 text-white/80 text-xs">
                {open + 1} / {count}
              </span>
            </>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
