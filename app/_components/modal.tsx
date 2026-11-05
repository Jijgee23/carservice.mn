"use client";

import { useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";

/**
 * Ерөнхий зориулалттай, дундаа байрлах modal — confirm-dialog.tsx-ийн
 * баталгаажуулах alertdialog-той ижил дүрслэлийн хэл (portal, backdrop blur,
 * rounded card), гэхдээ дурын (форм зэрэг) агуулга даана, өргөн тохируулж
 * болно. `document.body`-руу portal хийдэг тул dashboard-ийн `.landing-ops`
 * wrapper-ийн гадна гарна — тэнд тодорхойлогдсон `--oc-*` CSS хувьсагчид энд
 * байхгүй болохоос сэргийлж дахин тодорхойлно (харах: qpay-drawer.tsx).
 */
export function Modal({
  open,
  onClose,
  title,
  children,
  widthClassName = "max-w-lg",
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  widthClassName?: string;
}) {
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, onClose]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div className="landing-ops">
      <button
        type="button"
        tabIndex={-1}
        aria-label="Хаах"
        onClick={onClose}
        className="fixed inset-0 z-[100] cursor-default bg-black/60 backdrop-blur-sm"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`fixed left-1/2 top-1/2 z-[110] w-[min(92vw,100%)] ${widthClassName} max-h-[85vh] -translate-x-1/2 -translate-y-1/2 flex flex-col rounded-2xl border border-[var(--oc-line)] bg-[var(--oc-panel)] shadow-2xl`}
      >
        <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-[var(--oc-line)] shrink-0">
          <h2 className="font-semibold text-[var(--oc-ink)]">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Хаах"
            className="w-8 h-8 shrink-0 flex items-center justify-center rounded-lg text-[var(--oc-muted3)] hover:text-[var(--oc-ink)] hover:bg-[var(--oc-panel2)] transition-colors"
          >
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
              <path d="M18 6 6 18" />
              <path d="m6 6 12 12" />
            </svg>
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-5">{children}</div>
      </div>
    </div>,
    document.body,
  );
}
