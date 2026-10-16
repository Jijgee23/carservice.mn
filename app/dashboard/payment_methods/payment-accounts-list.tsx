"use client";

import { useCallback, useRef, useState, useTransition, type KeyboardEvent } from "react";
import {
  bulkDeletePaymentAccountsAction,
  bulkSetPaymentAccountsActiveAction,
  setPaymentAccountActiveAction,
  type PaymentAccountBulkState,
} from "@/app/_actions/payment-accounts";
import { setTenantQPayEnabledAction } from "@/app/_actions/tenant-qpay";
import { Btn } from "@/app/_components/landing-ops-ui";
import { Modal } from "@/app/_components/modal";
import { SelectAllCell, SelectRowCell, SelectionActions, useRowSelection } from "@/app/_components/row-selection";
import { PAYMENT_ACCOUNT_TYPE_LABEL, PAYMENT_ACCOUNT_TYPES, PAYMENT_ACCOUNTS_EMPTY, TEST_BADGE } from "@/lib/payment-accounts";
import type { PaymentAccountDto } from "@/lib/payment-account-service";
import { PaymentAccountDialog } from "./payment-account-dialog";
import { QPayDialog, type QPayInitial } from "./qpay-dialog";

type AccountType = PaymentAccountDto["type"];
/** «Бэлэн» нь нэг л мөр тул тусдаа шүүлтүүргүй — зөвхөн «Бүгд»-д харагдана. */
type Filter = Exclude<AccountType, "CASH"> | "QPAY" | "ALL";

/** Тенантын QPay интеграци (TenantQPaySettings); null = тохируулаагүй. */
export type QPaySummary = { enabled: boolean; invoiceCode: string } | null;

const FILTERS: { value: Filter; label: string }[] = [
  { value: "ALL", label: "Бүгд" },
  ...PAYMENT_ACCOUNT_TYPES.filter((t): t is Exclude<AccountType, "CASH"> => t !== "CASH").map((t) => ({
    value: t as Filter,
    label: PAYMENT_ACCOUNT_TYPE_LABEL[t],
  })),
  { value: "QPAY", label: "QPay" },
];


const TYPE_ORDER: Record<AccountType, number> = { CASH: 0, BANK_ACCOUNT: 1, POS: 2 };

const TYPE_BADGE: Record<AccountType, string> = {
  CASH: "border-emerald-500/30 bg-emerald-500/10 text-emerald-400 light:text-emerald-700",
  BANK_ACCOUNT: "border-sky-500/30 bg-sky-500/10 text-sky-400 light:text-sky-700",
  POS: "border-violet-500/30 bg-violet-500/10 text-violet-400 light:text-violet-700",
};
const QPAY_BADGE = "border-amber-500/30 bg-amber-500/10 text-amber-400 light:text-amber-700";

const FOCUS_RING =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--oc-accent)] focus-visible:ring-offset-1 focus-visible:ring-offset-transparent";

const TH = "font-plex-mono text-[10.5px] uppercase tracking-[0.08em] text-[var(--oc-muted3)] font-medium px-4 py-2.5 text-left";

type Notice =
  | { kind: "undo"; account: PaymentAccountDto }
  | { kind: "error"; message: string }
  | { kind: "bulk"; done: string; skipped: Array<{ name: string; message: string }> }
  | null;

type BulkOp = "delete" | "deactivate" | "activate";

const BULK_DONE: Record<BulkOp, string> = { delete: "устгагдлаа", deactivate: "идэвхгүй боллоо", activate: "идэвхжлээ" };

/** «Бэлэн» is automatic (never deleted / switched off), so it is not selectable. */
const selectable = (a: PaymentAccountDto) => a.type !== "CASH";

export function PaymentAccountsList({
  accounts,
  qpay,
  qpayInitial,
  canManageQpay,
}: {
  accounts: PaymentAccountDto[];
  qpay: QPaySummary;
  /** Админд л: QPay dialog-ын анхны утга (нууц үггүй). */
  qpayInitial: QPayInitial | null;
  /** QPay тохиргоо/switch нь зөвхөн админ (owner). */
  canManageQpay: boolean;
}) {
  const [dialog, setDialog] = useState<{ open: boolean; account: PaymentAccountDto | null }>({ open: false, account: null });
  const closeDialog = useCallback(() => setDialog((d) => ({ ...d, open: false })), []);
  const [qpayOpen, setQpayOpen] = useState(false);
  const closeQpay = useCallback(() => setQpayOpen(false), []);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [, startTransition] = useTransition();
  const [filter, setFilter] = useState<Filter>("ALL");
  const [showInactive, setShowInactive] = useState(false);
  const filterRefs = useRef<Partial<Record<Filter, HTMLButtonElement | null>>>({});
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [bulkPending, startBulk] = useTransition();

  function runBulk(op: BulkOp) {
    const ids = [...selection.selected];
    if (ids.length === 0) return;
    setNotice(null);
    startBulk(async () => {
      const res: PaymentAccountBulkState =
        op === "delete" ? await bulkDeletePaymentAccountsAction(ids) : await bulkSetPaymentAccountsActiveAction(ids, op === "activate");
      setConfirmDelete(false);
      if (!res.ok) {
        setNotice({ kind: "error", message: res.message });
        return;
      }
      const done = res.results.filter((r) => r.status === "deleted" || r.status === "updated" || r.status === "unchanged");
      const skipped = res.results
        .filter((r) => !done.includes(r))
        .map((r) => ({ name: r.name ?? accounts.find((a) => a.id === r.id)?.name ?? r.id, message: r.message ?? "Боломжгүй." }));
      setNotice({ kind: "bulk", done: done.length ? `${done.length} төлбөрийн арга ${BULK_DONE[op]}.` : "", skipped });
      // Keep the skipped ones selected so «Идэвхгүй болгох» is one click away for accounts still in use.
      selection.clear();
      for (const r of res.results) if (!done.includes(r) && r.status !== "not_found") selection.toggle(r.id);
    });
  }

  function setActive(account: PaymentAccountDto, next: boolean) {
    setNotice(null);
    setPendingId(account.id);
    startTransition(async () => {
      const res = await setPaymentAccountActiveAction(account.id, next);
      if (!res?.ok) setNotice({ kind: "error", message: `${account.name}: ${res?.message ?? "Хадгалахад алдаа гарлаа."}` });
      // Switching off hides the row (unless inactive rows are shown), so say so and offer the way back.
      else if (!next) setNotice({ kind: "undo", account });
      setPendingId(null);
    });
  }

  function setQpayEnabled(next: boolean) {
    setNotice(null);
    setPendingId("qpay");
    startTransition(async () => {
      const res = await setTenantQPayEnabledAction(next);
      if (!res?.ok) setNotice({ kind: "error", message: `QPay: ${res?.message ?? "Хадгалахад алдаа гарлаа."}` });
      setPendingId(null);
    });
  }

  function selectFilter(value: Filter, focus = false) {
    setFilter(value);
    if (focus) filterRefs.current[value]?.focus();
  }

  function onFilterKeyDown(e: KeyboardEvent<HTMLButtonElement>) {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight" && e.key !== "Home" && e.key !== "End") return;
    e.preventDefault();
    const i = FILTERS.findIndex((f) => f.value === filter);
    const next =
      e.key === "Home" ? 0 : e.key === "End" ? FILTERS.length - 1 : (i + (e.key === "ArrowRight" ? 1 : -1) + FILTERS.length) % FILTERS.length;
    selectFilter(FILTERS[next].value, true);
  }

  const inFilter = accounts.filter((a) => filter === "ALL" || a.type === filter);
  const showQpay = filter === "ALL" || filter === "QPAY";
  const inactiveCount = inFilter.filter((a) => !a.isActive).length;
  const rows = inFilter
    .filter((a) => showInactive || a.isActive)
    .sort((a, b) => Number(b.isActive) - Number(a.isActive) || TYPE_ORDER[a.type] - TYPE_ORDER[b.type] || a.name.localeCompare(b.name));
  const filterLabel = FILTERS.find((f) => f.value === filter)!.label;
  // Same selection as the other bulk tables: checkbox, drag across rows (mouse 1), right-click menu (mouse 2).
  const selection = useRowSelection(rows.filter(selectable));
  const selectedAccounts = accounts.filter((a) => selection.selected.has(a.id));
  const bulkActions = [
    { label: "Идэвхжүүлэх", onSelect: () => runBulk("activate"), disabled: bulkPending, variant: "ghost" as const },
    { label: "Идэвхгүй болгох", onSelect: () => runBulk("deactivate"), disabled: bulkPending, variant: "ghost" as const },
    { label: "Устгах", onSelect: () => setConfirmDelete(true), disabled: bulkPending },
  ];

  const qpayRow = () => {
    const active = Boolean(qpay?.enabled);
    const muted = active ? "" : "opacity-60";
    return (
      <tr key="qpay" className="border-b border-[var(--oc-line)] last:border-b-0">
        <td className="w-10 pl-4 pr-1 py-2.5" />
        <td className={`px-4 py-2.5 ${muted}`}>
          <span className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-medium ${QPAY_BADGE}`}>QPay</span>
        </td>
        <td className={`px-4 py-2.5 ${muted}`}>
          <span className="text-sm font-medium text-[var(--oc-ink)]">QPay</span>
          {qpay ? null : <span className="ml-2 text-xs text-[var(--oc-muted3)]">Тохируулаагүй</span>}
        </td>
        <td className={`px-4 py-2.5 text-sm ${muted}`}>
          <span className="text-[var(--oc-muted3)]">—</span>
        </td>
        <td className={`px-4 py-2.5 text-xs tabular-nums whitespace-nowrap text-[var(--oc-muted3)] ${muted}`}>
          {qpay ? `Invoice ${qpay.invoiceCode}` : "—"}
        </td>
        <td className="px-4 py-1">
          {qpay && canManageQpay ? (
            <button
              type="button"
              role="switch"
              aria-checked={active}
              aria-busy={pendingId === "qpay"}
              aria-label={`QPay: ${active ? "Идэвхтэй" : "Идэвхгүй"}`}
              title={active ? "Идэвхтэй" : "Идэвхгүй"}
              disabled={pendingId === "qpay"}
              onClick={() => setQpayEnabled(!active)}
              className={`grid h-11 w-[3.75rem] cursor-pointer place-items-center rounded-full disabled:cursor-wait ${FOCUS_RING}`}
            >
              <span
                className={`relative h-5 w-9 rounded-full transition-colors ${pendingId === "qpay" ? "animate-pulse" : ""} ${active ? "bg-[var(--oc-accent)]" : "bg-[var(--oc-line2)]"}`}
              >
                <span className={`absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white transition-transform ${active ? "translate-x-4" : ""}`} />
              </span>
            </button>
          ) : (
            <span className="px-3 text-xs text-[var(--oc-muted3)]">{qpay ? (active ? "Идэвхтэй" : "Идэвхгүй") : "—"}</span>
          )}
        </td>
        <td className="px-4 py-1 text-right">
          {canManageQpay ? (
            <Btn
              type="button"
              variant="ghost"
              size="sm"
              className={FOCUS_RING}
              aria-label={qpay ? "Засах: QPay" : "QPay тохируулах"}
              onClick={() => setQpayOpen(true)}
            >
              {qpay ? "Засах" : "Тохируулах"}
            </Btn>
          ) : null}
        </td>
      </tr>
    );
  };

  const renderRow = (a: PaymentAccountDto) => {
    const muted = a.isActive ? "" : "opacity-60";
    const terminal = [a.terminalId ? `TID ${a.terminalId}` : null, a.merchantId ? `MID ${a.merchantId}` : null].filter(Boolean).join(" · ");
    return (
      <tr key={a.id} className={`border-b border-[var(--oc-line)] last:border-b-0 ${selection.selected.has(a.id) ? "bg-[var(--oc-accent)]/[0.06]" : ""}`}>
        {selectable(a) ? (
          <SelectRowCell selection={selection} id={a.id} label={`Сонгох: ${a.name}`} className="w-10 pl-4 pr-1 py-2.5" />
        ) : (
          <td className="w-10 pl-4 pr-1 py-2.5" />
        )}
        <td className={`px-4 py-2.5 ${muted}`}>
          <span className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-medium ${TYPE_BADGE[a.type]}`}>
            {PAYMENT_ACCOUNT_TYPE_LABEL[a.type]}
          </span>
        </td>
        <td className={`px-4 py-2.5 ${muted}`}>
          <div className="flex items-center gap-2 min-w-0">
            <span className="truncate text-sm font-medium text-[var(--oc-ink)]">{a.name}</span>
            {a.isTest ? (
              <span className="shrink-0 rounded-full border border-[var(--oc-line)] px-1.5 py-0.5 font-plex-mono text-[9px] text-[var(--oc-muted3)]">
                {TEST_BADGE}
              </span>
            ) : null}
          </div>
        </td>
        <td className={`px-4 py-2.5 text-sm tabular-nums whitespace-nowrap ${muted}`}>
          {a.type === "CASH" ? (
            <span className="text-[var(--oc-muted3)]">—</span>
          ) : a.accountNumber ? (
            <span className="text-[var(--oc-ink)] select-all">{a.accountNumber}</span>
          ) : (
            <span className="text-xs text-[var(--oc-muted3)]">Дансны дугааргүй — засна уу</span>
          )}
        </td>
        <td className={`px-4 py-2.5 text-xs tabular-nums whitespace-nowrap text-[var(--oc-muted3)] ${muted}`}>
          {a.type === "POS" ? terminal || "Терминалын мэдээлэлгүй" : "—"}
        </td>
        <td className="px-4 py-1">
          {a.type === "CASH" ? (
            <span className="px-3 text-xs text-[var(--oc-muted3)]" title="«Бэлэн» үргэлж идэвхтэй">
              Үндсэн
            </span>
          ) : (
          /* 44×44 hit area around a 20×36 visual switch. */
          <button
            type="button"
            role="switch"
            aria-checked={a.isActive}
            aria-busy={pendingId === a.id}
            aria-label={`${a.name}: ${a.isActive ? "Идэвхтэй" : "Идэвхгүй"}`}
            title={a.isActive ? "Идэвхтэй" : "Идэвхгүй"}
            disabled={pendingId === a.id}
            onClick={() => setActive(a, !a.isActive)}
            className={`grid h-11 w-[3.75rem] cursor-pointer place-items-center rounded-full disabled:cursor-wait ${FOCUS_RING}`}
          >
            <span
              className={`relative h-5 w-9 rounded-full transition-colors ${pendingId === a.id ? "animate-pulse" : ""} ${a.isActive ? "bg-[var(--oc-accent)]" : "bg-[var(--oc-line2)]"}`}
            >
              <span className={`absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white transition-transform ${a.isActive ? "translate-x-4" : ""}`} />
            </span>
          </button>
          )}
        </td>
        <td className="px-4 py-1 text-right">
          <Btn
            type="button"
            variant="ghost"
            size="sm"
            className={FOCUS_RING}
            aria-label={`Засах: ${a.name}`}
            onClick={() => setDialog({ open: true, account: a })}
          >
            Засах
          </Btn>
        </td>
      </tr>
    );
  };

  return (
    <div className="flex flex-col gap-4 max-w-5xl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div role="tablist" aria-label="Төрөл" className="inline-flex flex-wrap rounded-[10px] border border-[var(--oc-line)] bg-[var(--oc-panel)] p-0.5">
          {FILTERS.map((f) => {
            const qpayCount = qpay?.enabled && (f.value === "ALL" || f.value === "QPAY") ? 1 : 0;
            const activeCount = accounts.filter((a) => (f.value === "ALL" || a.type === f.value) && a.isActive).length + qpayCount;
            const selected = filter === f.value;
            return (
              <button
                key={f.value}
                ref={(el) => {
                  filterRefs.current[f.value] = el;
                }}
                id={`pa-tab-${f.value}`}
                type="button"
                role="tab"
                aria-selected={selected}
                aria-controls="pa-panel"
                tabIndex={selected ? 0 : -1}
                onClick={() => selectFilter(f.value)}
                onKeyDown={onFilterKeyDown}
                className={`rounded-[8px] px-3 py-2 text-sm transition-colors ${FOCUS_RING} ${selected ? "bg-[var(--oc-line)] text-[var(--oc-ink)] font-medium" : "text-[var(--oc-muted3)] hover:text-[var(--oc-ink)]"}`}
              >
                {f.label}
                <span className="ml-1.5 tabular-nums text-xs text-[var(--oc-muted3)]">
                  {activeCount}
                  <span className="sr-only"> идэвхтэй</span>
                </span>
              </button>
            );
          })}
        </div>
        <Btn type="button" size="md" className={FOCUS_RING} onClick={() => setDialog({ open: true, account: null })}>
          Нэмэх
        </Btn>
      </div>

      <div aria-live="polite" className="empty:hidden">
        {notice?.kind === "bulk" ? (
          <div className="rounded-[10px] border border-[var(--oc-line)] bg-[var(--oc-panel)] px-4 py-2.5 text-sm text-[var(--oc-ink2)] flex flex-col gap-1">
            {notice.done ? <span className="text-[var(--oc-ok)]">{notice.done}</span> : null}
            {notice.skipped.length > 0 ? (
              <>
                <span>{notice.skipped.length} нь өөрчлөгдөөгүй:</span>
                <ul className="list-disc pl-5 text-xs text-[var(--oc-muted3)]">
                  {notice.skipped.map((s) => (
                    <li key={s.name}>
                      <span className="text-[var(--oc-ink2)]">{s.name}</span> — {s.message}
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
          </div>
        ) : notice?.kind === "undo" ? (
          <div className="flex items-center justify-between gap-3 rounded-[10px] border border-[var(--oc-line)] bg-[var(--oc-panel)] px-4 py-2.5 text-sm text-[var(--oc-ink2)]">
            <span className="min-w-0 truncate">{notice.account.name} идэвхгүй боллоо.</span>
            <Btn type="button" variant="ghost" size="sm" className={FOCUS_RING} onClick={() => setActive(notice.account, true)}>
              Буцаах
            </Btn>
          </div>
        ) : notice?.kind === "error" ? (
          <p role="alert" className="rounded-[10px] border border-red-500/30 bg-red-500/10 px-4 py-2.5 text-sm text-red-400 light:text-red-600">
            {notice.message}
          </p>
        ) : null}
      </div>

      <section id="pa-panel" role="tabpanel" aria-labelledby={`pa-tab-${filter}`} className="flex flex-col gap-2">
        {rows.length > 0 || showQpay ? (
          <div className="rounded-[10px] border border-[var(--oc-line)] bg-[var(--oc-panel)] overflow-hidden">
            <SelectionActions selection={selection} noun="төлбөрийн арга" actions={bulkActions} />
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px]">
                <thead>
                  <tr className="border-b border-[var(--oc-line)]">
                    <SelectAllCell selection={selection} className="w-10 pl-4 pr-1 py-2.5" />
                    <th className={TH}>Төрөл</th>

                    <th className={TH}>Нэр</th>
                    <th className={TH}>Дансны дугаар</th>
                    <th className={TH}>Терминал / код</th>
                    <th className={TH}>Төлөв</th>
                    <th className={TH}>
                      <span className="sr-only">Үйлдэл</span>
                    </th>
                  </tr>
                </thead>
                <tbody {...selection.dragArea}>
                  {showQpay ? qpayRow() : null}
                  {rows.map(renderRow)}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          <p className="rounded-[10px] border border-dashed border-[var(--oc-line)] px-4 py-6 text-center text-sm text-[var(--oc-muted3)]">
            {accounts.length === 0 ? PAYMENT_ACCOUNTS_EMPTY : `Идэвхтэй «${filterLabel}» төлбөрийн арга алга`}. «Нэмэх» дарж бүртгэнэ үү.
          </p>
        )}
        {inactiveCount > 0 ? (
          <button
            type="button"
            aria-pressed={showInactive}
            onClick={() => setShowInactive((v) => !v)}
            className={`self-start rounded px-1 py-1.5 text-xs text-[var(--oc-muted3)] hover:text-[var(--oc-ink)] ${FOCUS_RING}`}
          >
            Идэвхгүй ({inactiveCount}) {showInactive ? "нуух ▾" : "харах ▸"}
          </button>
        ) : null}
        {filter === "ALL" ? (
          <p className="text-xs text-[var(--oc-muted3)]">
            «Бэлэн» байгууллага бүрт автоматаар бий (нэрийг нь засаж болно, унтраахгүй). Кассын ээлжид бүх бэлэн мөнгө нэг мөрөнд
            тооцогдоно.
          </p>
        ) : null}
        {showQpay ? (
          <p className="text-xs text-[var(--oc-muted3)]">
            QPay нь байгууллагын нэг merchant тохиргоо — QPay мөрийн «Засах / Тохируулах»-аар (зөвхөн админ) тохируулна. Идэвхгүй
            бол засварын хуудасны төлбөрт QPay сонголт гарахгүй.
          </p>
        ) : null}
      </section>

      <PaymentAccountDialog
        open={dialog.open}
        account={dialog.account}
        defaultType={filter === "ALL" || filter === "QPAY" ? "BANK_ACCOUNT" : filter}
        onClose={closeDialog}
        onSaved={(type) => {
          // «Бэлэн» has no tab of its own: show it under «Бүгд».
          if (filter !== "ALL" && type !== filter) selectFilter(type === "CASH" ? "ALL" : type);
        }}
      />
      <Modal open={confirmDelete} onClose={() => setConfirmDelete(false)} title="Төлбөрийн арга устгах" widthClassName="max-w-md">
        <div className="flex flex-col gap-3 p-5 text-sm text-[var(--oc-ink2)]">
          <p>
            Сонгосон <b className="text-[var(--oc-ink)]">{selectedAccounts.length}</b> төлбөрийн аргыг устгах уу?
          </p>
          <ul className="list-disc pl-5 text-xs text-[var(--oc-muted3)] max-h-40 overflow-auto">
            {selectedAccounts.map((a) => (
              <li key={a.id}>
                {a.name} · {PAYMENT_ACCOUNT_TYPE_LABEL[a.type]}
                {a.accountNumber ? ` · ${a.accountNumber}` : ""}
              </li>
            ))}
          </ul>
          <p className="text-xs text-[var(--oc-muted3)]">
            Гүйлгээнд ашиглагдсан арга устахгүй (түүх нь хадгалагдана) — тэдгээрийг идэвхгүй болгоно уу.
          </p>
          <div className="flex items-center gap-2 pt-1">
            <Btn type="button" variant="danger" size="md" disabled={bulkPending} onClick={() => runBulk("delete")}>
              {bulkPending ? "Устгаж байна…" : "Устгах"}
            </Btn>
            <Btn type="button" variant="ghost" size="md" onClick={() => setConfirmDelete(false)}>
              Болих
            </Btn>
          </div>
        </div>
      </Modal>
      {canManageQpay ? <QPayDialog open={qpayOpen} initial={qpayInitial} onClose={closeQpay} /> : null}
    </div>
  );
}
