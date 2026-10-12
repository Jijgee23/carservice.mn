"use client";

import { useCallback, useRef, useState, useTransition, type KeyboardEvent } from "react";
import { setPaymentAccountActiveAction } from "@/app/_actions/payment-accounts";
import { Btn } from "@/app/_components/landing-ops-ui";
import { PAYMENT_ACCOUNTS_EMPTY, TEST_BADGE } from "@/lib/payment-accounts";
import type { PaymentAccountDto } from "@/lib/payment-account-service";
import { PaymentAccountDialog } from "./payment-account-dialog";

type AccountType = PaymentAccountDto["type"];

const GROUPS: { type: AccountType; title: string; noun: string }[] = [
  { type: "BANK_ACCOUNT", title: "Данс", noun: "данс" },
  { type: "POS", title: "POS", noun: "терминал" },
];

const FOCUS_RING =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--oc-accent)] focus-visible:ring-offset-1 focus-visible:ring-offset-transparent";

type Notice = { kind: "undo"; account: PaymentAccountDto } | { kind: "error"; message: string } | null;

export function PaymentAccountsList({ accounts }: { accounts: PaymentAccountDto[] }) {
  const [dialog, setDialog] = useState<{ open: boolean; account: PaymentAccountDto | null }>({ open: false, account: null });
  const closeDialog = useCallback(() => setDialog((d) => ({ ...d, open: false })), []);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [, startTransition] = useTransition();
  const [tab, setTab] = useState<AccountType>("BANK_ACCOUNT");
  const [showInactive, setShowInactive] = useState(false);
  const tabRefs = useRef<Record<AccountType, HTMLButtonElement | null>>({ BANK_ACCOUNT: null, POS: null });

  function setActive(account: PaymentAccountDto, next: boolean) {
    setNotice(null);
    setPendingId(account.id);
    startTransition(async () => {
      const res = await setPaymentAccountActiveAction(account.id, next);
      if (!res?.ok) setNotice({ kind: "error", message: `${account.name}: ${res?.message ?? "Хадгалахад алдаа гарлаа."}` });
      // Switching off moves the row into the collapsed list, so say so and offer the way back.
      else if (!next) setNotice({ kind: "undo", account });
      setPendingId(null);
    });
  }

  function selectTab(type: AccountType, focus = false) {
    setTab(type);
    setShowInactive(false);
    if (focus) tabRefs.current[type]?.focus();
  }

  function onTabKeyDown(e: KeyboardEvent<HTMLButtonElement>) {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight" && e.key !== "Home" && e.key !== "End") return;
    e.preventDefault();
    const i = GROUPS.findIndex((g) => g.type === tab);
    const next =
      e.key === "Home" ? 0 : e.key === "End" ? GROUPS.length - 1 : (i + (e.key === "ArrowRight" ? 1 : -1) + GROUPS.length) % GROUPS.length;
    selectTab(GROUPS[next].type, true);
  }

  const group = GROUPS.find((g) => g.type === tab)!;
  const rows = accounts.filter((a) => a.type === tab);
  const active = rows.filter((a) => a.isActive);
  const inactive = rows.filter((a) => !a.isActive);

  const renderRow = (a: PaymentAccountDto) => {
    const detail = [a.accountNumberMasked, a.type === "POS" ? a.terminalId : null].filter(Boolean).join(" · ");
    return (
      <li key={a.id} className="flex items-center gap-3 px-4 py-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 min-w-0">
            <span className={`truncate text-sm font-medium ${a.isActive ? "text-[var(--oc-ink)]" : "text-[var(--oc-ink2)]"}`}>{a.name}</span>
            {a.isTest ? (
              <span className="shrink-0 rounded-full border border-[var(--oc-line)] px-1.5 py-0.5 font-plex-mono text-[9px] text-[var(--oc-muted3)]">
                {TEST_BADGE}
              </span>
            ) : null}
          </div>
          <div className="text-xs text-[var(--oc-muted3)] tabular-nums truncate">
            {detail || (a.type === "POS" ? "Терминалын мэдээлэлгүй — засна уу" : "Дансны дугааргүй — засна уу")}
          </div>
        </div>
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
        {/* 44×44 hit area around a 20×36 visual switch. */}
        <button
          type="button"
          role="switch"
          aria-checked={a.isActive}
          aria-busy={pendingId === a.id}
          aria-label={`${a.name}: ${a.isActive ? "Идэвхтэй" : "Идэвхгүй"}`}
          title={a.isActive ? "Идэвхтэй" : "Идэвхгүй"}
          disabled={pendingId === a.id}
          onClick={() => setActive(a, !a.isActive)}
          className={`-m-3 grid h-11 w-[3.75rem] shrink-0 cursor-pointer place-items-center rounded-full disabled:cursor-wait ${FOCUS_RING}`}
        >
          <span
            className={`relative h-5 w-9 rounded-full transition-colors ${pendingId === a.id ? "animate-pulse" : ""} ${a.isActive ? "bg-[var(--oc-accent)]" : "bg-[var(--oc-line2)]"}`}
          >
            <span
              className={`absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white transition-transform ${a.isActive ? "translate-x-4" : ""}`}
            />
          </span>
        </button>
      </li>
    );
  };

  return (
    <div className="flex flex-col gap-4 max-w-2xl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div role="tablist" aria-label="Төрөл" className="inline-flex rounded-[10px] border border-[var(--oc-line)] bg-[var(--oc-panel)] p-0.5">
          {GROUPS.map((g) => {
            const activeCount = accounts.filter((a) => a.type === g.type && a.isActive).length;
            const selected = tab === g.type;
            return (
              <button
                key={g.type}
                ref={(el) => {
                  tabRefs.current[g.type] = el;
                }}
                id={`pa-tab-${g.type}`}
                type="button"
                role="tab"
                aria-selected={selected}
                aria-controls={`pa-panel-${g.type}`}
                tabIndex={selected ? 0 : -1}
                onClick={() => selectTab(g.type)}
                onKeyDown={onTabKeyDown}
                className={`rounded-[8px] px-3 py-2 text-sm transition-colors ${FOCUS_RING} ${selected ? "bg-[var(--oc-line)] text-[var(--oc-ink)] font-medium" : "text-[var(--oc-muted3)] hover:text-[var(--oc-ink)]"}`}
              >
                {g.title}
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
        {notice?.kind === "undo" ? (
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

      <section id={`pa-panel-${tab}`} role="tabpanel" aria-labelledby={`pa-tab-${tab}`} className="flex flex-col gap-2">
        {active.length > 0 ? (
          <ul className="rounded-[10px] border border-[var(--oc-line)] bg-[var(--oc-panel)] divide-y divide-[var(--oc-line)]">{active.map(renderRow)}</ul>
        ) : (
          <p className="rounded-[10px] border border-dashed border-[var(--oc-line)] px-4 py-6 text-center text-sm text-[var(--oc-muted3)]">
            {accounts.length === 0 ? PAYMENT_ACCOUNTS_EMPTY : `Идэвхтэй ${group.noun} алга`}. «Нэмэх» дарж бүртгэнэ үү.
          </p>
        )}
        {inactive.length > 0 ? (
          <>
            <button
              type="button"
              aria-expanded={showInactive}
              aria-controls="pa-inactive"
              onClick={() => setShowInactive((v) => !v)}
              className={`self-start rounded px-1 py-1.5 text-xs text-[var(--oc-muted3)] hover:text-[var(--oc-ink)] ${FOCUS_RING}`}
            >
              Идэвхгүй ({inactive.length}) {showInactive ? "нуух ▾" : "харах ▸"}
            </button>
            {showInactive ? (
              <ul
                id="pa-inactive"
                className="rounded-[10px] border border-[var(--oc-line)] bg-[var(--oc-panel)] divide-y divide-[var(--oc-line)]"
              >
                {inactive.map(renderRow)}
              </ul>
            ) : null}
          </>
        ) : null}
      </section>

      <PaymentAccountDialog
        open={dialog.open}
        account={dialog.account}
        defaultType={tab}
        onClose={closeDialog}
        onSaved={(type) => {
          if (type !== tab) selectTab(type);
        }}
      />
    </div>
  );
}
