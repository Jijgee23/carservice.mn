"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { recordOrderPaymentAction, searchPayableOrdersAction } from "@/app/_actions/order-payments";
import { Btn, Field } from "@/app/_components/landing-ops-ui";
import { bookingDateKey } from "@/lib/booking-time";
import { formatTugrik } from "@/lib/orders";
import type { PayableOrderRow } from "@/lib/orders/order-payment-search";
import { PaymentMethodPanel, type PaymentChoice } from "../_components/payment-method-modal";
import { NoOpenSessionNotice } from "./session-warning";

function fmtDate(iso: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "";
  // Business time (Asia/Ulaanbaatar), same as the rest of the section, not the browser's timezone.
  return bookingDateKey(d).replaceAll("-", ".");
}

/**
 * «Захиалгын төлбөр» tab of the income dialog: step 1 finds an unpaid order of the working branch,
 * step 2 reuses the order page's payment panel (amount prefilled with the remaining balance).
 */
export function OrderPaymentTab({
  branches,
  defaultBranchId,
  showBranchSelect,
  banks,
  openBranchIds,
  onDone,
  onRecorded,
}: {
  branches: { id: string; name: string }[];
  defaultBranchId: string;
  /** Only when the working branch is ALL/unset; pinned-branch users see no selector. */
  showBranchSelect: boolean;
  banks: { code: string; label: string }[];
  openBranchIds: string[];
  /** Called after a payment was recorded (closes the dialog and refreshes the list). */
  onDone: () => void;
  /** Called as soon as a payment is saved (before the dialog closes), so any close path can refresh the list. */
  onRecorded?: () => void;
}) {
  const [picked, setPicked] = useState<PayableOrderRow | null>(null);
  const [q, setQ] = useState("");
  const [orders, setOrders] = useState<PayableOrderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState(0);
  const [note, setNote] = useState("");
  const [branchId, setBranchId] = useState(defaultBranchId);
  const [doneChange, setDoneChange] = useState<string | null>(null);
  const changeRef = useRef<string | null>(null);
  // Key of the query the current `orders` belong to; Enter is ignored while it lags the input.
  const [resultsKey, setResultsKey] = useState("");
  const currentKey = `${branchId}|${q}`;
  const sessionOpen = openBranchIds.includes(branchId);
  const seq = useRef(0);

  useEffect(() => {
    if (picked) return;
    const id = ++seq.current;
    const key = `${branchId}|${q}`;
    const timer = setTimeout(
      async () => {
        setLoading(true);
        try {
          const res = await searchPayableOrdersAction({ branchId, q });
          if (id !== seq.current) return;
          if (res.ok) {
            setOrders(res.orders);
            setResultsKey(key);
            setError(null);
            setActive(0);
          } else {
            setOrders([]);
            setResultsKey(key);
            setError(res.message);
          }
        } catch {
          if (id !== seq.current) return;
          setOrders([]);
          // Mark the (empty) results current so Enter/click are not blocked forever after a transient error.
          setResultsKey(key);
          setError("Захиалга хайхад алдаа гарлаа.");
        } finally {
          if (id === seq.current) setLoading(false);
        }
      },
      q ? 250 : 0,
    );
    return () => clearTimeout(timer);
  }, [q, branchId, picked]);

  function pick(o: PayableOrderRow | undefined) {
    if (!o) return;
    setNote("");
    setPicked(o);
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (orders.length === 0) return;
    const fresh = resultsKey === currentKey;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => (i + 1) % orders.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => (i + orders.length - 1) % orders.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (fresh) pick(orders[active]);
    }
  }

  async function recordPayment(choice: PaymentChoice, amount: string) {
    if (!picked) return { ok: false, message: "Захиалга сонгоогүй байна." };
    const fd = new FormData();
    fd.set("orderId", picked.id);
    fd.set("method", choice.method);
    fd.set("amount", amount);
    if (choice.method === "BANK_TRANSFER" || choice.method === "CARD") fd.set("bank", choice.bank);
    if (note.trim()) fd.set("note", note.trim());
    const res = await recordOrderPaymentAction(null, fd);
    if (res?.ok) {
      onRecorded?.();
      changeRef.current = res.change ?? null;
      return { ok: true };
    }
    return { ok: false, message: res?.message };
  }

  function changeBranch(next: string) {
    if (next === branchId) return;
    setBranchId(next);
    setPicked(null);
    setOrders([]);
    setActive(0);
    setLoading(true);
  }

  if (doneChange) {
    return (
      <div className="flex flex-col items-center gap-4 p-8 text-center">
        <p className="text-sm font-semibold text-emerald-500">Төлбөр амжилттай бүртгэгдлээ.</p>
        <p className="text-2xl font-semibold tabular-nums text-[var(--oc-ink)]">Хариулт өгөх: {formatTugrik(doneChange)}</p>
        <Btn type="button" size="md" onClick={onDone}>
          Хаах
        </Btn>
      </div>
    );
  }

  if (picked) {
    const remainingNum = Number.parseFloat(picked.remaining);
    return (
      <div className="flex flex-col gap-3 p-5 overflow-y-auto">
        <div className="rounded-lg border border-[var(--oc-line)] bg-[var(--oc-panel2)] px-3 py-2.5 text-sm">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="font-semibold text-[var(--oc-ink)] truncate">
                #{picked.number}
                {picked.plate ? ` · ${picked.plate}` : ""}
              </div>
              <div className="text-xs text-[var(--oc-muted3)] truncate">
                {[picked.customerName, picked.customerPhone].filter(Boolean).join(" · ")}
              </div>
            </div>
            <button
              type="button"
              onClick={() => setPicked(null)}
              className="shrink-0 text-xs text-[var(--oc-accent)] hover:text-[var(--oc-accent-hi)]"
            >
              Солих
            </button>
          </div>
          <dl className="mt-2 grid grid-cols-3 gap-2 text-xs tabular-nums">
            <div>
              <dt className="text-[var(--oc-muted3)]">Нийт</dt>
              <dd className="font-semibold text-[var(--oc-ink)]">{formatTugrik(picked.totalAmount)}</dd>
            </div>
            <div>
              <dt className="text-[var(--oc-muted3)]">Төлсөн</dt>
              <dd className="font-semibold text-[var(--oc-ink)]">{formatTugrik(picked.paidAmount)}</dd>
            </div>
            <div>
              <dt className="text-[var(--oc-muted3)]">Үлдэгдэл</dt>
              <dd className="font-semibold text-[var(--oc-ink)]">{formatTugrik(picked.remaining)}</dd>
            </div>
          </dl>
        </div>
        <div className="flex flex-col rounded-lg border border-[var(--oc-line)] h-[min(60vh,30rem)]">
          <PaymentMethodPanel
            mode="full"
            embedded
            open
            onClose={() => {
              if (changeRef.current) setDoneChange(changeRef.current);
              else onDone();
            }}
            title="Төлбөр бүртгэх"
            banks={banks}
            defaultAmount={picked.remaining}
            changeBase={remainingNum}
            onRecord={recordPayment}
            recordBlockedNotice={!sessionOpen ? <NoOpenSessionNotice /> : undefined}
            extraFields={
              <Field label="Тайлбар" htmlFor="order-pay-note">
                <textarea
                  id="order-pay-note"
                  rows={2}
                  maxLength={1000}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  className="compact-input w-full"
                />
              </Field>
            }
          />
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 p-5 overflow-y-auto">
      {showBranchSelect ? (
        <Field label="Салбар" htmlFor="order-pay-branch">
          <select
            id="order-pay-branch"
            value={branchId}
            onChange={(e) => changeBranch(e.target.value)}
            className="compact-input w-full"
          >
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </Field>
      ) : null}
      <input
        type="search"
        autoFocus
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={onKeyDown}
        maxLength={100}
        placeholder="Дугаар, улсын дугаар, утас, нэр, регистр"
        aria-label="Захиалга хайх"
        className="compact-input w-full"
      />
      {error ? <p className="text-xs text-red-400 light:text-red-600">{error}</p> : null}
      {loading && orders.length === 0 ? (
        <p className="text-xs text-[var(--oc-muted3)]">Хайж байна...</p>
      ) : orders.length === 0 && !error ? (
        <p className="text-xs text-[var(--oc-muted3)]">Төлөгдөөгүй захиалга олдсонгүй.</p>
      ) : (
        <ul
          role="listbox"
          aria-label="Төлөгдөөгүй захиалгууд"
          className={`flex flex-col gap-1.5 transition-opacity ${resultsKey === currentKey ? "" : "opacity-60"}`}
        >
          {orders.map((o, i) => (
            <li key={o.id} role="option" aria-selected={i === active}>
              <button
                type="button"
                onClick={() => {
                  // Ignore clicks on rows that belong to an older query while a new one is in flight.
                  if (resultsKey === currentKey) pick(o);
                }}
                onMouseEnter={() => setActive(i)}
                className={`w-full rounded-lg border px-3 py-2 text-left text-sm transition-colors ${i === active
                  ? "border-[var(--oc-accent)]/40 bg-[var(--oc-accent)]/15"
                  : "border-[var(--oc-line)] hover:bg-white/[0.06]"
                  }`}
              >
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                  <span className="min-w-0 truncate text-[var(--oc-ink)]">
                    <span className="font-semibold">#{o.number}</span>
                    {o.plate ? ` · ${o.plate}` : ""}
                    {o.customerPhone ? ` · ${o.customerPhone}` : ""}
                  </span>
                  <span className="shrink-0 text-xs tabular-nums text-[var(--oc-ink2)]">
                    {fmtDate(o.createdAt)} · Үлдэгдэл {formatTugrik(o.remaining)}
                  </span>
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
