"use client";

import Link from "next/link";
import { useEffect, useState, useTransition } from "react";
import {
  createPostpaidSettlementAction,
  listEligiblePostpaidOrdersAction,
} from "@/app/_actions/cash-settlements";
import { FormError } from "@/app/_components/auth-shell";
import { DatePicker } from "@/app/_components/date-picker";
import { Btn, Field } from "@/app/_components/landing-ops-ui";
import { Modal } from "@/app/_components/modal";
import { bankLabel } from "@/lib/banks";
import { formatPriceInput, formatTugrik } from "@/lib/orders";
import { PaymentMethodModal, paymentChoiceSummary, type PaymentChoice } from "../../_components/payment-method-modal";
import { PosSimulatorModal } from "../../_components/pos-simulator";
import { NO_OPEN_SESSION_REASON, NoOpenSessionNotice } from "../../cash/session-warning";

type Option = { id: string; name: string };
type EligibleOrder = {
  id: string;
  number: string;
  plate: string | null;
  completedAt: string | null;
  totalAmount: string;
  paidAmount: string;
  outstanding: string;
};

type Props = {
  branches: Option[];
  defaultBranchId: string;
  customers: Option[];
  banks: { code: string; label: string }[];
  /** Business-day "YYYY-MM-DD" (Asia/Ulaanbaatar). */
  today: string;
  /** Branch ids that currently have an open cash session (any method: settling is disabled for a branch without one). */
  openBranchIds: string[];
};

/** Money strings -> integer minor units so the live sum never drifts. */
function toCents(value: string): number {
  const n = Number.parseFloat(value);
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("mn-MN", { timeZone: "Asia/Ulaanbaatar", year: "numeric", month: "2-digit", day: "2-digit" });
}

export function SettleButton(props: Props) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Btn type="button" size="md" onClick={() => setOpen(true)}>
        Тооцоо нийлэх
      </Btn>
      <Modal open={open} onClose={() => setOpen(false)} title="Тооцоо нийлэх" widthClassName="max-w-2xl">
        <SettleForm {...props} onDone={() => setOpen(false)} />
      </Modal>
    </>
  );
}

function SettleForm({ branches, defaultBranchId, customers, banks, today, openBranchIds, onDone }: Props & { onDone: () => void }) {
  const [branchId, setBranchId] = useState(defaultBranchId);
  const [customerId, setCustomerId] = useState("");
  const [orders, setOrders] = useState<EligibleOrder[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loadError, setLoadError] = useState<string | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [choice, setChoice] = useState<PaymentChoice>({ method: "CASH", bank: "" });
  const [pickerOpen, setPickerOpen] = useState(false);
  const [posOpen, setPosOpen] = useState(false);
  const method = choice.method;
  const bank = choice.bank;
  const [date, setDate] = useState(today);
  const [note, setNote] = useState("");
  const [submitError, setSubmitError] = useState<{ message: string; fields: Record<string, string> } | null>(null);
  const [staleNotice, setStaleNotice] = useState<string | null>(null);
  const [createdId, setCreatedId] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const needsBank = method === "BANK_TRANSFER" || method === "CARD";
  const sessionClosed = !openBranchIds.includes(branchId);

  // (Re)load the eligible orders for the picked branch + customer; everything ticked by default.
  useEffect(() => {
    if (!branchId || !customerId) return;
    let cancelled = false;
    void listEligiblePostpaidOrdersAction(customerId, branchId).then((res) => {
      if (cancelled) return;
      if (res.ok) {
        setLoadError(null);
        setOrders(res.data.orders);
        setTruncated(res.data.truncated);
        setSelected(new Set(res.data.orders.map((o) => o.id)));
      } else {
        setOrders([]);
        setTruncated(false);
        setSelected(new Set());
        setLoadError(res.message);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [branchId, customerId, reloadKey]);

  const visibleOrders = branchId && customerId ? orders : null;
  const ticked = (visibleOrders ?? []).filter((o) => selected.has(o.id));
  const totalCents = ticked.reduce((sum, o) => sum + toCents(o.outstanding), 0);
  const total = (totalCents / 100).toString();

  function pickBranch(value: string) {
    setBranchId(value);
    setOrders(null);
    setStaleNotice(null);
    setSubmitError(null);
  }
  function pickCustomer(value: string) {
    setCustomerId(value);
    setOrders(null);
    setStaleNotice(null);
    setSubmitError(null);
  }
  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function submit() {
    setSubmitError(null);
    setStaleNotice(null);
    const fd = new FormData();
    fd.set("branchId", branchId);
    fd.set("customerId", customerId);
    for (const o of ticked) fd.append("orderIds", o.id);
    fd.set("method", method);
    if (needsBank) fd.set("bank", bank);
    fd.set("occurredAt", date);
    if (note.trim()) fd.set("note", note.trim());
    fd.set("expectedAmount", total);
    startTransition(async () => {
      const res = await createPostpaidSettlementAction(null, fd);
      if (res?.ok) {
        setCreatedId(res.settlementId ?? null);
        return;
      }
      if (res?.code === "SETTLEMENT_AMOUNT_CHANGED") {
        // Stale view: show the server's message and reload the eligible list.
        setStaleNotice(res.message ?? "Үлдэгдэл өөрчлөгдсөн байна. Жагсаалтыг шинэчиллээ.");
        setOrders(null);
        setReloadKey((k) => k + 1);
        return;
      }
      setSubmitError({ message: res?.message ?? "Тооцоо бүртгэхэд алдаа гарлаа.", fields: res?.fieldErrors ?? {} });
    });
  }

  if (createdId) {
    return (
      <div className="flex flex-col gap-4 p-5">
        <p className="text-sm text-[var(--oc-ink2)]">Тооцоо амжилттай бүртгэгдлээ.</p>
        <div className="flex justify-end gap-3">
          <Link href={`/dashboard/cash/settlements/${createdId}`} className="text-sm text-[var(--oc-accent)] hover:text-[var(--oc-accent-hi)] self-center">
            Тооцоог харах
          </Link>
          <Btn type="button" size="md" onClick={onDone}>
            Хаах
          </Btn>
        </div>
      </div>
    );
  }

  const fieldErrors = submitError?.fields ?? {};
  const canSubmit = !sessionClosed && ticked.length > 0 && totalCents > 0 && (!needsBank || bank !== "") && !pending;

  return (
    <div className="flex flex-col gap-4 p-5 overflow-y-auto">
      <FormError message={submitError && Object.keys(fieldErrors).length === 0 ? submitError.message : undefined} />
      {staleNotice ? <p className="text-sm text-[var(--oc-warn)]">{staleNotice}</p> : null}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Field label="Салбар" htmlFor="settle-branch" required error={fieldErrors.branchId}>
          <select id="settle-branch" value={branchId} onChange={(e) => pickBranch(e.target.value)} className="compact-input w-full">
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Үйлчлүүлэгч (байгууллага / хувь хүн)" htmlFor="settle-customer" required error={fieldErrors.customerId}>
          <select id="settle-customer" value={customerId} onChange={(e) => pickCustomer(e.target.value)} className="compact-input w-full">
            <option value="" disabled>
              Сонгох
            </option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>
      </div>

      {customerId && branchId ? (
        <div className="rounded-lg border border-[var(--oc-line)] overflow-hidden">
          {loadError ? <p className="px-3 py-2 text-sm text-red-400 light:text-red-600">{loadError}</p> : null}
          {truncated && visibleOrders !== null ? (
            <p className="px-3 py-2 text-xs text-amber-500">
              Жагсаалт хэт урт тул зөвхөн эхний хэсгийг харуулж байна. Эдгээрийг тооцоолсны дараа үлдсэнийг нь дахин сонгоно уу.
            </p>
          ) : null}
          {visibleOrders === null ? (
            <p className="px-3 py-4 text-sm text-[var(--oc-muted3)]">Ачаалж байна...</p>
          ) : visibleOrders.length === 0 ? (
            <p className="px-3 py-4 text-sm text-[var(--oc-muted3)]">Тооцоо нийлэх үлдэгдэлтэй захиалга алга.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--oc-line)] text-xs text-[var(--oc-muted3)]">
                  <th className="px-3 py-2 w-8">
                    <input
                      type="checkbox"
                      aria-label="Бүгдийг сонгох"
                      checked={selected.size === visibleOrders.length}
                      onChange={(e) => setSelected(e.target.checked ? new Set(visibleOrders.map((o) => o.id)) : new Set())}
                    />
                  </th>
                  <th className="px-3 py-2 text-left font-medium">Захиалга</th>
                  <th className="px-3 py-2 text-left font-medium">Дууссан</th>
                  <th className="px-3 py-2 text-right font-medium">Дүн</th>
                  <th className="px-3 py-2 text-right font-medium">Үлдэгдэл</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--oc-line)]">
                {visibleOrders.map((o) => (
                  <tr key={o.id}>
                    <td className="px-3 py-2">
                      <input type="checkbox" aria-label={`#${o.number}`} checked={selected.has(o.id)} onChange={() => toggle(o.id)} />
                    </td>
                    <td className="px-3 py-2 text-[var(--oc-ink2)]">
                      #{o.number}
                      {o.plate ? <span className="ml-1.5 font-mono text-xs text-[var(--oc-muted4)]">{o.plate}</span> : null}
                    </td>
                    <td className="px-3 py-2 text-xs text-[var(--oc-muted3)] whitespace-nowrap">{fmtDate(o.completedAt)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-[var(--oc-muted3)]">{formatTugrik(o.totalAmount)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-[var(--oc-ink)]">{formatTugrik(o.outstanding)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-[var(--oc-line)] bg-[var(--oc-panel2)]">
                  <td colSpan={4} className="px-3 py-2 text-xs text-[var(--oc-muted3)]">
                    Сонгосон {ticked.length} захиалгын нийт дүн
                  </td>
                  <td className="px-3 py-2 text-right font-semibold tabular-nums text-[var(--oc-ink)]">{formatTugrik(total)}</td>
                </tr>
              </tfoot>
            </table>
          )}
        </div>
      ) : null}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Field label="Төлбөрийн хэлбэр" htmlFor="settle-method" required error={fieldErrors.method ?? fieldErrors.bank}>
          <button
            id="settle-method"
            type="button"
            onClick={() => setPickerOpen(true)}
            className="compact-input w-full text-left"
          >
            {paymentChoiceSummary(choice)}
          </button>
        </Field>
        <Field label="Огноо" htmlFor="settle-date" required error={fieldErrors.occurredAt}>
          <DatePicker id="settle-date" max={today} value={date} onChange={setDate} required />
        </Field>
        <Field label="Тайлбар" htmlFor="settle-note" error={fieldErrors.note}>
          <input id="settle-note" type="text" value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} className="compact-input w-full" />
        </Field>
      </div>
      {sessionClosed ? <NoOpenSessionNotice /> : null}
      <PaymentMethodModal
        mode="picker"
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        title="Төлбөрийн хэлбэр"
        banks={banks}
        initial={choice}
        onConfirm={(c) => {
          setChoice(c);
          setPickerOpen(false);
        }}
      />
      <PosSimulatorModal
        open={posOpen}
        bankName={bankLabel(bank)}
        amount={formatPriceInput(total)}
        onCancel={() => setPosOpen(false)}
        onSuccess={() => {
          setPosOpen(false);
          submit();
        }}
      />
      {fieldErrors.orderIds ? <p className="text-red-400 text-xs light:text-red-600">{fieldErrors.orderIds}</p> : null}

      <div className="flex justify-end gap-2">
        <Btn type="button" variant="ghost" size="md" onClick={onDone}>
          Болих
        </Btn>
        <Btn type="button" size="md" disabled={!canSubmit} title={sessionClosed ? NO_OPEN_SESSION_REASON : undefined} onClick={() => (method === "CARD" ? setPosOpen(true) : submit())}>
          {pending ? "Бүртгэж байна..." : `Нийлэх · ${formatTugrik(total)}`}
        </Btn>
      </div>
    </div>
  );
}
