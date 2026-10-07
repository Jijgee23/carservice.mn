"use client";

import { CASH_SESSION_ENTRY_LOCKED_MESSAGE } from "@/lib/cash/locked-copy";
import { useActionState, useEffect, useRef, useState } from "react";
import {
  recordOrderPaymentAction,
  reverseOrderPaymentAction,
  type OrderPaymentActionState,
} from "@/app/_actions/order-payments";
import Link from "next/link";
import { bankLabel } from "@/lib/banks";
import { Btn } from "@/app/_components/landing-ops-ui";
import { NO_OPEN_SESSION_REASON, NoOpenSessionNotice } from "../../cash/session-warning";
import { PaymentMethodModal, type PaymentChoice } from "../../_components/payment-method-modal";
import { QPayPanel, type PendingOrderPayment } from "./qpay-widget";
import {
  ORDER_PAYMENT_METHOD_BADGE,
  ORDER_PAYMENT_METHOD_LABEL,
  ORDER_PAYMENT_STATUS_LABEL,
  formatTugrik,
} from "@/lib/orders";

// Захиалгын мөрд plain string-ээр дамжина (Decimal/Date биш).
export type OrderPaymentRow = {
  id: string;
  amount: string;
  method: string;
  status: string;
  createdAt: string; // ISO
  bank: string | null;
  settlementId?: string | null; // «Нэгдсэн тооцоо» — буцаах боломжгүй
  locked?: boolean; // хаагдсан ээлжийн гүйлгээ — буцаах боломжгүй (CASH_SESSION_ENTRY_LOCKED)
};

const SETTLEMENT_LOCKED_HINT = "Нэгдсэн тооцооны төлбөрийг тооцоогоор нь цуцална уу.";
const CLOSED_SESSION_LOCKED_HINT = CASH_SESSION_ENTRY_LOCKED_MESSAGE;

function ReverseButton({ orderId, payment, sessionOpen }: { orderId: string; payment: OrderPaymentRow; sessionOpen: boolean }) {
  const [state, formAction, pending] = useActionState<OrderPaymentActionState, FormData>(
    reverseOrderPaymentAction,
    null,
  );
  const sessionLocked = Boolean(payment.locked);
  return (
    <form action={formAction} className="shrink-0 flex flex-col items-end">
      <input type="hidden" name="orderId" value={orderId} />
      <input type="hidden" name="paymentId" value={payment.id} />
      <button
        type="submit"
        disabled={sessionLocked || pending || !sessionOpen}
        title={sessionLocked ? CLOSED_SESSION_LOCKED_HINT : !sessionOpen ? NO_OPEN_SESSION_REASON : "Бүртгэлийг цуцлах"}
        className="shrink-0 text-[var(--oc-muted4)] hover:text-red-400 light:hover:text-red-600 transition-colors disabled:opacity-50 disabled:hover:text-[var(--oc-muted4)]"
      >
        Цуцлах
      </button>
      {sessionLocked ? (
        <span className="max-w-[14rem] text-right text-[10px] text-[var(--oc-muted4)]">{CLOSED_SESSION_LOCKED_HINT}</span>
      ) : !sessionOpen ? (
        <NoOpenSessionNotice className="max-w-[14rem] text-right" />
      ) : state && !state.ok && state.message ? (
        <span className="max-w-[14rem] text-right text-red-400 light:text-red-600">{state.message}</span>
      ) : null}
    </form>
  );
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

// order-items.tsx-тэй адил шалтгаанаар Intl.toLocaleString("mn-MN")
// ашиглахгүй (client/server ICU ялгаатай бол hydration mismatch).
function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return iso;
  return `${d.getFullYear()}.${pad2(d.getMonth() + 1)}.${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

export function OrderPaymentsList({
  orderId,
  payments,
  remaining,
  canRecord,
  canReverse,
  banks,
  cashSessionOpen,
  qpayAvailable,
  qpayConfigured,
  pendingQPay,
}: {
  orderId: string;
  payments: OrderPaymentRow[];
  remaining: string;
  canRecord: boolean;
  canReverse: boolean;
  /** Идэвхтэй банкууд (picker-д). */
  banks: { code: string; label: string }[];
  /** Whether the order's branch has an open cash session; when false, record/QPay/reverse are disabled. */
  cashSessionOpen: boolean;
  /** QPay сонголтыг (modal-д) гаргах эсэх — эрх + төлөгдөөгүй төлөвөөс хамаарна. */
  qpayAvailable: boolean;
  qpayConfigured: boolean;
  /** Хүлээгдэж буй QPay нэхэмжлэл (байвал QR самбарт харуулна). */
  pendingQPay: PendingOrderPayment | null;
}) {

  const remainingNum = Number.parseFloat(remaining);
  const hasRemaining = Number.isFinite(remainingNum) && remainingNum > 0;

  const [modalOpen, setModalOpen] = useState(false);
  const [modalInitial, setModalInitial] = useState<PaymentChoice | undefined>(undefined);
  const [lastChange, setLastChange] = useState<string | null>(null);

  // Шинэ QPay нэхэмжлэл үүсэх бүрд (QR үүсгэсний дараа) modal-ийг QPay дээр нь нээнэ.
  const seenQPayId = useRef<string | null>(pendingQPay?.id ?? null);
  useEffect(() => {
    if (pendingQPay && pendingQPay.id !== seenQPayId.current) {
      seenQPayId.current = pendingQPay.id;
      setModalInitial({ method: "QPAY", bank: "" });
      setModalOpen(true);
    }
  }, [pendingQPay]);

  function openModal() {
    setModalInitial(pendingQPay && qpayAvailable ? { method: "QPAY", bank: "" } : undefined);
    setModalOpen(true);
  }

  // Урьдчилан хэвээр байсан recordOrderPaymentAction-ийг ижил payload-оор
  // (orderId, method, amount, bank) дуудна; серверийн алдааг modal-д буцаана.
  async function recordPayment(choice: PaymentChoice, amount: string) {
    const fd = new FormData();
    fd.set("orderId", orderId);
    fd.set("method", choice.method);
    fd.set("amount", amount);
    if (choice.method === "BANK_TRANSFER" || choice.method === "CARD") fd.set("bank", choice.bank);
    const res = await recordOrderPaymentAction(null, fd);
    if (res?.ok) {
      setLastChange(res.change ?? null);
      return { ok: true };
    }
    return { ok: false, message: res?.message };
  }

  return (
    <div className="flex flex-col gap-3">
      {payments.length > 0 ? (
        <ul className="flex flex-col gap-1.5">
          {payments.map((p) => (
            <li
              key={p.id}
              className={`flex items-start justify-between gap-3 rounded-lg border px-2.5 py-1.5 text-xs ${p.status === "CANCELLED"
                ? "border-[var(--oc-line)] opacity-50"
                : "border-[var(--oc-line)] bg-[var(--oc-panel2)]"
                }`}
            >
              <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 min-w-0 flex-1">
                <span
                  className={`shrink-0 font-plex-mono text-[10px] px-1.5 py-0.5 rounded-full ${ORDER_PAYMENT_METHOD_BADGE[p.method] ?? ORDER_PAYMENT_METHOD_BADGE.OTHER
                    }`}
                >
                  {ORDER_PAYMENT_METHOD_LABEL[p.method] ?? p.method}
                </span>
                <span
                  className={`font-plex-mono font-semibold tabular-nums ${p.status === "CANCELLED" ? "line-through" : "text-[var(--oc-ink2)]"}`}
                >
                  {formatTugrik(p.amount)}
                </span>
                <span className="shrink-0 text-[var(--oc-muted4)] whitespace-nowrap">
                  {fmtDateTime(p.createdAt)}
                </span>
                {p.bank ? (
                  <span className="shrink-0 text-[var(--oc-muted4)]">{bankLabel(p.bank)}</span>
                ) : null}
                {p.settlementId ? (
                  <Link
                    href={`/dashboard/cash/settlements/${p.settlementId}`}
                    className="shrink-0 text-[var(--oc-accent)] hover:text-[var(--oc-accent-hi)] transition-colors"
                  >
                    Нэгдсэн тооцоо
                  </Link>
                ) : null}
                {p.status === "CANCELLED" ? (
                  <span className="shrink-0 text-[var(--oc-muted4)]">
                    · {ORDER_PAYMENT_STATUS_LABEL.CANCELLED}
                  </span>
                ) : null}
              </div>
              {canReverse && p.status === "PAID" ? (
                p.settlementId ? (
                  <span className="max-w-[14rem] shrink-0 text-right text-[10px] text-[var(--oc-muted4)]">{SETTLEMENT_LOCKED_HINT}</span>
                ) : (
                  <ReverseButton orderId={orderId} payment={p} sessionOpen={cashSessionOpen} />
                )
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}

      {lastChange ? (
        <p className="text-xs text-emerald-500">Хариулт өгөх: {formatTugrik(lastChange)}</p>
      ) : null}

      {(canRecord && hasRemaining) || qpayAvailable ? (
        <div className="flex flex-col gap-2">
          {pendingQPay && qpayAvailable ? (
            <p className="text-xs text-[var(--oc-muted3)]">
              QPay төлбөр хүлээгдэж байна: {formatTugrik(pendingQPay.amount)}
            </p>
          ) : null}
          <Btn type="button" size="md" onClick={openModal} disabled={!cashSessionOpen && !pendingQPay} title={!cashSessionOpen && !pendingQPay ? NO_OPEN_SESSION_REASON : undefined}>
            {canRecord && hasRemaining ? "Төлбөр бүртгэх" : "QPay-ээр төлөх"}
          </Btn>
          {!cashSessionOpen && !pendingQPay ? <NoOpenSessionNotice /> : null}
          <PaymentMethodModal
            mode="full"
            open={modalOpen}
            onClose={() => setModalOpen(false)}
            title={`Төлбөр бүртгэх · Үлдэгдэл ${formatTugrik(remaining)}`}
            banks={banks}
            includeQpay={qpayAvailable}
            qpayOnly={!(canRecord && hasRemaining)}
            initial={modalInitial}
            defaultAmount={remaining}
            changeBase={remainingNum}
            onRecord={recordPayment}
            recordBlockedNotice={!cashSessionOpen ? <NoOpenSessionNotice /> : undefined}
            qpayPanel={
              <QPayPanel
                orderId={orderId}
                qpayConfigured={qpayConfigured}
                pending={pendingQPay}
                remaining={remaining}
                sessionClosed={!cashSessionOpen}
              />
            }
          />
        </div>
      ) : null}
    </div>
  );
}
