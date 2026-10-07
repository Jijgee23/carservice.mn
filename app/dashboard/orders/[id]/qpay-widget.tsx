"use client";

import { NO_OPEN_SESSION_REASON, NoOpenSessionNotice } from "../../cash/session-warning";
import { useRouter } from "next/navigation";
import { useActionState, useRef, useState, type FormEvent } from "react";
import {
  cancelOrderQPayPaymentAction,
  checkOrderQPayPaymentAction,
  createOrderQPayInvoiceAction,
  type OrderPaymentActionState,
} from "@/app/_actions/order-payments";
import { ConfirmButton } from "@/app/_components/confirm-form";
import { Btn } from "@/app/_components/landing-ops-ui";
import { QPayBankGrid } from "@/app/_components/qpay-bank-grid";
import { formatPriceInput, formatTugrik, liveFormatPriceInput } from "@/lib/orders";
import type { QPayBankUrl } from "@/lib/qpay-tenant";

export type PendingOrderPayment = {
  id: string;
  qrImage: string | null;
  urls: QPayBankUrl[];
  amount: string;
};

/**
 * Төлбөрийн modal-ийн QPay самбар: тохируулаагүй / QR үүсгэх / QR + шалгах.
 * Дүн нь үлдэгдлээр анхдагчаар бөглөгдөх ба үлдэгдлээс ихгүй байхаар засаж болно.
 */
export function QPayPanel({
  orderId,
  qpayConfigured,
  pending,
  remaining,
  sessionClosed = false,
}: {
  orderId: string;
  qpayConfigured: boolean;
  pending: PendingOrderPayment | null;
  remaining: string;
  /** Branch register closed: creating a new invoice is disabled (check/cancel of a pending one stays). */
  sessionClosed?: boolean;
}) {
  if (!qpayConfigured) {
    return (
      <div className="flex flex-col gap-2 text-xs text-[var(--oc-muted3)]">
        <p>QPay тохируулаагүй байна. QPay-ээр төлбөр авахын тулд тохиргоог хийнэ үү.</p>
        <a
          href="/dashboard/settings/qpay"
          className="text-[var(--oc-accent)] hover:text-[var(--oc-accent-hi)] underline"
        >
          QPay тохиргоо →
        </a>
      </div>
    );
  }

  if (!pending) {
    return <CreateButton orderId={orderId} remaining={remaining} sessionClosed={sessionClosed} />;
  }

  return <QRPanel pending={pending} />;
}

function CreateButton({ orderId, remaining, sessionClosed }: { orderId: string; remaining: string; sessionClosed: boolean }) {
  const [state, formAction, formPending] = useActionState<
    OrderPaymentActionState,
    FormData
  >(createOrderQPayInvoiceAction, null);
  const [amount, setAmount] = useState(formatPriceInput(remaining));
  const [amountError, setAmountError] = useState<string | null>(null);

  function validate(e: FormEvent<HTMLFormElement>) {
    const n = Number(amount.replace(/[\s,]/g, ""));
    if (!amount.trim() || !Number.isFinite(n) || n <= 0) {
      e.preventDefault();
      setAmountError("Дүнгээ оруулна уу.");
    } else if (n > Number(remaining)) {
      e.preventDefault();
      setAmountError("Дүн үлдэгдлээс их байж болохгүй.");
    } else {
      setAmountError(null);
    }
  }

  return (
    <form action={formAction} onSubmit={validate} className="flex flex-col gap-4">
      <input type="hidden" name="orderId" value={orderId} />
      <label className="flex flex-col gap-1 text-sm text-[var(--oc-ink2)]">
        <span>
          Дүн (үлдэгдэл{" "}
          <span className="font-plex-mono tabular-nums">{formatTugrik(remaining)}</span>)
        </span>
        <input type="hidden" name="amount" value={amount.replace(/,/g, "")} />
        <input
          inputMode="decimal"
          value={amount}
          onChange={(e) => {
            setAmount(liveFormatPriceInput(e.target.value));
            setAmountError(null);
          }}
          onBlur={(e) => setAmount(formatPriceInput(e.target.value))}
          className="font-plex-mono tabular-nums rounded-md border border-[var(--oc-border)] bg-transparent px-3 py-2"
        />
      </label>
      {amountError ? <p className="text-xs text-red-400 light:text-red-600">{amountError}</p> : null}
      {state && !state.ok && state.message ? (
        <p className="text-xs text-red-400 light:text-red-600">{state.message}</p>
      ) : null}
      {sessionClosed ? <NoOpenSessionNotice /> : null}
      <Btn type="submit" disabled={formPending || sessionClosed} title={sessionClosed ? NO_OPEN_SESSION_REASON : undefined}>
        {formPending ? "Үүсгэж..." : "QR үүсгэх"}
      </Btn>
    </form>
  );
}

function QRPanel({ pending }: { pending: PendingOrderPayment }) {
  const [checking, setChecking] = useState(false);
  const [paid, setPaid] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const stopRef = useRef(false);
  const router = useRouter();

  async function check() {
    if (stopRef.current) return;
    setChecking(true);
    setMsg(null);
    try {
      const fd = new FormData();
      fd.set("paymentId", pending.id);
      const res = await checkOrderQPayPaymentAction(fd);
      if (res.paid) {
        setPaid(true);
        stopRef.current = true;
        setMsg("Төлбөр амжилттай — засварын хуудас шинэчилнэ...");
        setTimeout(() => {
          window.location.reload();
        }, 1500);
      } else if (!res.ok && res.message) {
        setMsg(res.message);
      } else {
        setMsg("Төлбөр төлөгдөөгүй байна. QR-аа уншуулсны дараа дахин шалгана уу.");
      }
    } finally {
      setChecking(false);
    }
  }

  async function cancel() {
    stopRef.current = true;
    const fd = new FormData();
    fd.set("paymentId", pending.id);
    const res = await cancelOrderQPayPaymentAction(fd);
    if (res.ok || res.refresh) {
      // Soft refresh keeps the payment modal open; the panel re-renders without the pending QR.
      router.refresh();
      return;
    }
    // Provider cancel failed: the QR is still live at QPay, so keep the panel and show the reason.
    stopRef.current = false;
    setMsg(res.message ?? "QPay нэхэмжлэх цуцлахад алдаа гарлаа. Дахин оролдоно уу.");
  }

  return (
    <div className="flex flex-col items-center gap-4">
      <div className="text-center text-xs text-[var(--oc-muted3)]">
        Үлдэгдэл:{" "}
        <span className="font-plex-mono text-[var(--oc-ink2)] font-semibold">
          {formatTugrik(pending.amount)}
        </span>
      </div>

      {paid ? (
        <div className="bg-emerald-500/15 border border-emerald-500/30 text-emerald-200 light:text-emerald-700 rounded-lg px-3 py-2 text-xs text-center">
          ✓ Төлбөр амжилттай
        </div>
      ) : pending.qrImage ? (
        <div className="bg-white p-3 rounded-lg">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`data:image/png;base64,${pending.qrImage}`}
            alt="QPay QR"
            className="w-48 h-48 object-contain"
          />
        </div>
      ) : (
        <div className="text-xs text-[var(--oc-muted3)]">QR үүсэхэд хүлээнэ үү...</div>
      )}

      {pending.urls.length > 0 ? (
        <div className="w-full">
          <QPayBankGrid urls={pending.urls} />
        </div>
      ) : null}

      {msg ? (
        <p className="text-[11px] text-[var(--oc-muted2)] text-center">{msg}</p>
      ) : null}

      <div className="flex items-center gap-2">
        <Btn type="button" onClick={check} disabled={checking || paid} size="sm">
          {checking ? "Шалгаж..." : "Шалгах"}
        </Btn>
        <ConfirmButton
          onConfirm={cancel}
          message="Энэ QPay төлбөрийн нэхэмжлэлийг цуцлах уу?"
          title="QPay нэхэмжлэл цуцлах"
          confirmLabel="Тийм, цуцлах"
          className="text-xs text-[var(--oc-muted3)] hover:text-[var(--oc-ink2)] underline underline-offset-2"
        >
          Цуцлах
        </ConfirmButton>
      </div>
    </div>
  );
}
