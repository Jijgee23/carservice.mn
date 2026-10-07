"use client";

import { useEffect, useRef, type KeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Btn } from "@/app/_components/landing-ops-ui";

/**
 * Дундаа байрлах dialog shell — Modal-той ижил дүрслэл, гэхдээ Esc-ийг өөрийн
 * элементээс барьж stopPropagation хийдэг тул өөр modal дотор давхарлахад
 * (жишээ нь форм modal дээрх POS баталгаажуулалт) зөвхөн дээд талын нь хаагдана.
 */
export function DialogShell({
  open,
  onClose,
  label,
  children,
  className = "",
}: {
  open: boolean;
  onClose: () => void;
  label: string;
  children: ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    ref.current?.focus();
    return () => {
      document.body.style.overflow = prevOverflow;
    };
  }, [open]);

  if (!open || typeof document === "undefined") return null;

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === "Escape") {
      // A confirm dialog opened from inside this modal handles its own Esc.
      if ((e.target as HTMLElement).closest?.("[data-confirm-dialog]")) return;
      e.stopPropagation();
      onClose();
    }
  }

  return createPortal(
    <div className="landing-ops">
      <button
        type="button"
        tabIndex={-1}
        aria-label="Хаах"
        onClick={onClose}
        className="fixed inset-0 z-[120] cursor-default bg-black/60 backdrop-blur-sm"
      />
      <div
        ref={ref}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        onKeyDown={onKeyDown}
        className={`fixed left-1/2 top-1/2 z-[130] -translate-x-1/2 -translate-y-1/2 flex flex-col rounded-2xl border border-[var(--oc-line)] bg-[var(--oc-panel)] shadow-2xl outline-none ${className}`}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}

/**
 * Туршилтын POS терминал. Бодит POS интеграци хийгдэх үед зөвхөн энэ
 * компонентийн дотоод хэсгийг солино (props хэвээр): `onSuccess` нь амжилттай
 * гүйлгээний дараа дуудагдана, `onCancel` нь юу ч бүртгэхгүй.
 */
export function PosSimulator({
  bankName,
  amount,
  pending = false,
  error,
  onSuccess,
  onCancel,
}: {
  bankName: string;
  /** Форматласан дүн, "₮"-гүй (жишээ "150,000"). */
  amount: string;
  pending?: boolean;
  error?: string | null;
  onSuccess: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-xl border border-[var(--oc-line)] bg-black/40 px-4 py-6 text-center flex flex-col items-center gap-3">
        <span className="rounded-full border border-amber-400/50 bg-amber-400/10 px-2.5 py-0.5 text-[10px] font-plex-mono uppercase tracking-[0.1em] text-amber-300 light:text-amber-700">
          Туршилтын POS
        </span>
        <div className="text-sm font-semibold text-[var(--oc-ink)]">{bankName} POS</div>
        <div className="font-plex-mono text-2xl font-semibold tabular-nums text-[var(--oc-ink)]">{amount}₮</div>
        <div className="flex items-center gap-2 text-sm text-[var(--oc-muted2)]">
          <span className="flex gap-1" aria-hidden>
            <span className="h-1.5 w-1.5 rounded-full bg-[var(--oc-accent)] animate-pulse" />
            <span className="h-1.5 w-1.5 rounded-full bg-[var(--oc-accent)] animate-pulse [animation-delay:200ms]" />
            <span className="h-1.5 w-1.5 rounded-full bg-[var(--oc-accent)] animate-pulse [animation-delay:400ms]" />
          </span>
          Картаа уншуулна уу
        </div>
      </div>
      {error ? <p className="text-xs text-red-400 light:text-red-600">{error}</p> : null}
      <div className="flex gap-2">
        <Btn type="button" size="md" className="flex-1" disabled={pending} onClick={onSuccess}>
          {pending ? "Бүртгэж..." : "Амжилттай"}
        </Btn>
        <Btn type="button" variant="ghost" size="md" className="flex-1" disabled={pending} onClick={onCancel}>
          Цуцлах
        </Btn>
      </div>
    </div>
  );
}

/** Форм дотроос (picker горим) CARD сонгосон үед submit-ийн өмнө гарах POS баталгаажуулалт. */
export function PosSimulatorModal({
  open,
  bankName,
  amount,
  onSuccess,
  onCancel,
}: {
  open: boolean;
  bankName: string;
  amount: string;
  onSuccess: () => void;
  onCancel: () => void;
}) {
  return (
    <DialogShell open={open} onClose={onCancel} label="POS" className="w-[min(92vw,26rem)] p-5">
      <PosSimulator bankName={bankName} amount={amount} onSuccess={onSuccess} onCancel={onCancel} />
    </DialogShell>
  );
}
