"use client";

import { useCallback, useEffect, useState } from "react";
import { Modal } from "@/app/_components/modal";
import { formatMileageKm } from "@/lib/orders/order-intake";

// Хүлээн авах бүртгэл (intake) — үйлчлүүлэгчид зөвхөн унших. Хуудсыг уртасгахгүйн
// тулд товч хураангуй + modal-д бүрэн харагдана. Staff-ийн intake-record.tsx-тэй
// ижил загвар, гэхдээ бүртгэсэн ажилтны нэрийг харуулахгүй.

type Props = {
  notes: string | null;
  photos: { id: string; url: string }[];
  signatureUrl: string | null;
  mileageKm: number | null;
  // Огноог server дээр UB цагаар форматлана (hydration зөрөхгүй).
  recordedAtLabel: string;
};

export function OrderIntakeView(props: Props) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const { notes, photos, signatureUrl, mileageKm } = props;

  const summary = [
    mileageKm !== null ? formatMileageKm(mileageKm) : null,
    notes ? "тэмдэглэл" : null,
    photos.length > 0 ? `${photos.length} зураг` : null,
    signatureUrl ? "гарын үсэг" : null,
  ].filter(Boolean);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="w-full flex items-center justify-between gap-3 rounded-[10px] border border-[var(--oc-line)] bg-[var(--oc-panel)] px-4 py-3 text-left hover:bg-[var(--oc-panel2)] transition-colors"
      >
        <span className="min-w-0">
          <span className="block text-sm font-semibold text-[var(--oc-ink2)]">Хүлээн авах</span>
          <span className="block truncate text-xs text-[var(--oc-muted3)]">
            {summary.join(" · ") || "хоосон"}
          </span>
        </span>
        <span className="shrink-0 text-xs text-[var(--oc-muted2)]">Харах →</span>
      </button>

      <Modal open={open} onClose={close} title="Хүлээн авах" widthClassName="max-w-3xl">
        <IntakeDetails {...props} />
      </Modal>
    </>
  );
}

function IntakeDetails({ notes, photos, signatureUrl, mileageKm, recordedAtLabel }: Props) {
  const [viewing, setViewing] = useState<number | null>(null);

  // Томруулсан зураг дээр ←/→ товчоор шилжинэ.
  useEffect(() => {
    if (viewing === null) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "ArrowRight") setViewing((i) => (i === null ? i : (i + 1) % photos.length));
      if (e.key === "ArrowLeft") setViewing((i) => (i === null ? i : (i - 1 + photos.length) % photos.length));
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [viewing, photos.length]);

  if (viewing !== null && photos[viewing]) {
    const photo = photos[viewing];
    return (
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between text-xs text-[var(--oc-muted2)]">
          <button type="button" onClick={() => setViewing(null)} className="underline">
            ← Бүх зураг
          </button>
          <span>
            {viewing + 1}/{photos.length}
          </span>
        </div>
        <div className="relative flex items-center justify-center rounded-md bg-black/40">
          {/* eslint-disable-next-line @next/next/no-img-element -- /uploads нь runtime файл */}
          <img src={photo.url} alt={`Хүлээн авах зураг ${viewing + 1}`} className="max-h-[65vh] max-w-full w-auto object-contain" />
          {photos.length > 1 ? (
            <>
              <button
                type="button"
                onClick={() => setViewing((viewing - 1 + photos.length) % photos.length)}
                aria-label="Өмнөх зураг"
                className="absolute left-2 rounded-full bg-black/60 px-3 py-2 text-[#fff] hover:bg-black/80"
              >
                ‹
              </button>
              <button
                type="button"
                onClick={() => setViewing((viewing + 1) % photos.length)}
                aria-label="Дараагийн зураг"
                className="absolute right-2 rounded-full bg-black/60 px-3 py-2 text-[#fff] hover:bg-black/80"
              >
                ›
              </button>
            </>
          ) : null}
        </div>
        <a href={photo.url} target="_blank" rel="noreferrer" className="self-end text-xs text-[var(--oc-muted2)] underline">
          Эх зургийг нээх
        </a>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-md bg-[var(--oc-panel2)] px-3 py-2 text-xs text-[var(--oc-muted2)]">
        <span>Бүртгэсэн: {recordedAtLabel}</span>
        <span>Үүсгэсний дараа засагдахгүй</span>
      </div>

      {mileageKm !== null ? (
        <p className="text-sm text-[var(--oc-ink2)]">Гүйлт: {formatMileageKm(mileageKm)}</p>
      ) : null}

      <section>
        <h3 className="mb-1.5 text-xs font-medium text-[var(--oc-muted3)]">Тэмдэглэл</h3>
        {notes ? (
          <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-[var(--oc-ink2)]">{notes}</p>
        ) : (
          <p className="text-sm text-[var(--oc-muted3)]">—</p>
        )}
      </section>

      <section>
        <h3 className="mb-1.5 text-xs font-medium text-[var(--oc-muted3)]">Зураг ({photos.length})</h3>
        {photos.length > 0 ? (
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
            {photos.map((p, i) => (
              <button
                key={p.id}
                type="button"
                onClick={() => setViewing(i)}
                aria-label={`Зураг ${i + 1} томруулах`}
                className="block overflow-hidden rounded-md border border-[var(--oc-line)] hover:opacity-90"
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- /uploads нь runtime файл */}
                <img src={p.url} alt={`Хүлээн авах зураг ${i + 1}`} className="aspect-square w-full object-cover" />
              </button>
            ))}
          </div>
        ) : (
          <p className="text-sm text-[var(--oc-muted3)]">—</p>
        )}
      </section>

      <section>
        <h3 className="mb-1.5 text-xs font-medium text-[var(--oc-muted3)]">Үйлчлүүлэгчийн гарын үсэг</h3>
        {signatureUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- /uploads нь runtime файл
          <img
            src={signatureUrl}
            alt="Үйлчлүүлэгчийн гарын үсэг"
            className="h-24 max-w-full rounded-md border border-[var(--oc-line)] bg-white"
          />
        ) : (
          <p className="text-sm text-[var(--oc-muted3)]">Гарын үсэг аваагүй.</p>
        )}
      </section>
    </div>
  );
}
