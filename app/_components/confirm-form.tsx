"use client";

import {
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { unstable_rethrow } from "next/navigation";
import { useOptionalToast } from "@/app/_components/toast";
import type { ConfirmActionResult } from "@/lib/confirm-action";

type ServerAction = (formData: FormData) => ConfirmActionResult | Promise<ConfirmActionResult>;

const FALLBACK_ERROR = "Үйлдэл амжилтгүй боллоо. Дахин оролдоно уу.";

function ConfirmationDialog({
  open,
  title,
  message,
  confirmLabel,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const titleId = useId();
  const messageId = useId();

  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onCancel();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onCancel]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <>
      <button
        type="button"
        tabIndex={-1}
        aria-label="Хаах"
        data-confirm-dialog
        onClick={onCancel}
        className="fixed inset-0 z-[200] cursor-default bg-black/60 backdrop-blur-sm"
      />
      <div
        role="alertdialog"
        data-confirm-dialog
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={messageId}
        className="fixed left-1/2 top-1/2 z-[210] w-[min(92vw,26rem)] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-white/10 bg-[var(--surface)] p-5 shadow-2xl backdrop-blur-xl"
      >
        <div className="flex items-start gap-3">
          <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[var(--oc-warn)]/15 text-[var(--oc-warn)]">
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M10.3 3.7 2.6 17a2 2 0 0 0 1.7 3h15.4a2 2 0 0 0 1.7-3L13.7 3.7a2 2 0 0 0-3.4 0Z" />
              <path d="M12 9v4" />
              <path d="M12 17h.01" />
            </svg>
          </div>
          <div className="min-w-0">
            <h3 id={titleId} className="font-semibold text-[var(--oc-ink)]">
              {title}
            </h3>
            <p id={messageId} className="mt-1 text-sm text-[var(--oc-muted)]">
              {message}
            </p>
          </div>
        </div>
        <div className="mt-5 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg border border-white/10 bg-white/[0.04] px-3.5 py-2 text-sm text-[var(--oc-muted)] transition-colors hover:bg-white/[0.08] hover:text-[var(--oc-ink)]"
          >
            Болих
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="rounded-lg bg-[var(--oc-accent)] px-3.5 py-2 text-sm font-medium text-white transition-colors hover:opacity-90"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </>,
    document.body,
  );
}

/** A server-action form that asks before submitting a high-impact mutation. */
export function ConfirmForm({
  action,
  message,
  children,
  className,
  enabled = true,
  title = "Үйлдлийг баталгаажуулах",
  confirmLabel = "Баталгаажуулах",
  onSubmitConfirmed,
}: {
  action: ServerAction;
  message: string;
  children: ReactNode;
  className?: string;
  enabled?: boolean;
  title?: string;
  confirmLabel?: string;
  onSubmitConfirmed?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const confirmedRef = useRef(false);
  const toast = useOptionalToast();

  // Action-ийн буцаасан `{ error }`-ийг toast-оор харуулна. Санаандгүй throw
  // (production-д мессеж нь нуугддаг) error хуудас руу унахын оронд ерөнхий
  // мессеж болно. redirect/notFound-г Next-д буцааж шиднэ.
  async function run(formData: FormData) {
    let message: string | null = null;
    try {
      const result = await action(formData);
      if (result && typeof result === "object" && result.error) message = result.error;
    } catch (error) {
      unstable_rethrow(error);
      message = FALLBACK_ERROR;
    }
    // Action дууссаны дараа л хаана — submit үед хаавал (жишээ нь row menu)
    // form unmount болж action огт илгээгдэхгүй байсан.
    onSubmitConfirmed?.();
    if (!message) return;
    if (toast) toast.error(message);
    else window.alert(message);
  }

  function close() {
    setOpen(false);
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    if (!enabled || confirmedRef.current) {
      confirmedRef.current = false;
      return;
    }
    event.preventDefault();
    setOpen(true);
  }

  function confirm() {
    confirmedRef.current = true;
    setOpen(false);
    formRef.current?.requestSubmit();
  }

  return (
    <>
      <form ref={formRef} action={run} className={className} onSubmit={onSubmit}>
        {children}
      </form>
      <ConfirmationDialog
        open={open}
        title={title}
        message={message}
        confirmLabel={confirmLabel}
        onCancel={close}
        onConfirm={confirm}
      />
    </>
  );
}

/** A styled confirmation wrapper for client-side callbacks. */
export function ConfirmButton({
  message,
  onConfirm,
  children,
  className,
  disabled,
  title = "Үйлдлийг баталгаажуулах",
  confirmLabel = "Баталгаажуулах",
}: {
  message: string;
  onConfirm: () => void | Promise<void>;
  children: ReactNode;
  className: string;
  disabled?: boolean;
  title?: string;
  confirmLabel?: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={className}
        disabled={disabled}
      >
        {children}
      </button>
      <ConfirmationDialog
        open={open}
        title={title}
        message={message}
        confirmLabel={confirmLabel}
        onCancel={() => setOpen(false)}
        onConfirm={() => {
          setOpen(false);
          void onConfirm();
        }}
      />
    </>
  );
}
