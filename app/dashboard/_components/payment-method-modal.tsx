"use client";

import { useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Btn } from "@/app/_components/landing-ops-ui";
import { bankLabel } from "@/lib/banks";
import { formatPriceInput, liveFormatPriceInput } from "@/lib/orders";
import { DialogShell, PosSimulator } from "./pos-simulator";

export type PaymentMethodKey = "CASH" | "QPAY" | "BANK_TRANSFER" | "CARD" | "OTHER";
export type PaymentChoice = { method: PaymentMethodKey; bank: string };

type Bank = { code: string; label: string };

type Base = {
  open: boolean;
  onClose: () => void;
  /** Гарчиг, жишээ «Төлбөр бүртгэх · Үлдэгдэл 10,000₮». */
  title: string;
  /** Идэвхтэй банкууд (Tenant.enabledBanks-аар шүүгдсэн). */
  banks: Bank[];
  /** Зөвхөн захиалгын төлбөрийн формд QPay мөр гаргана. */
  includeQpay?: boolean;
  /** Бүртгэх эрхгүй (зөвхөн QPay эрхтэй) үед зөвхөн QPay мөр үлдээнэ. */
  qpayOnly?: boolean;
  /** Нээгдэхэд сонгогдсон байх (анхдагч: Бэлэн). */
  initial?: PaymentChoice;
  /** Embedded (non-modal) use: the title header and close button are not rendered. */
  embedded?: boolean;
};

type PickerProps = Base & {
  mode: "picker";
  onConfirm: (choice: PaymentChoice) => void;
};

type FullProps = Base & {
  mode: "full";
  /** Дүнгийн анхдагч утга (жишээ үлдэгдэл). */
  defaultAmount: string;
  /** Нэг төлбөр бүртгэх — серверийн алдааг message-ээр буцаана. */
  onRecord: (choice: PaymentChoice, amount: string) => Promise<{ ok: boolean; message?: string }>;
  /** Бэлэн сонгосон үед (ж: нээлттэй касс байхгүй) харуулах анхааруулга. */
  cashWarning?: ReactNode;
  /** Set while the register is closed: record / POS controls are disabled and this reason is shown. */
  recordBlockedNotice?: ReactNode;
  /** Бэлэн + дүн нь үлдэгдлээс их үед хариулт тооцох үлдэгдэл. */
  changeBase?: number;
  /** «Бусад» дээр харуулах тэмдэглэл. */
  otherNote?: string;
  /** QPay сонгосон үед баруун талд гарах самбар (QR үүсгэх/шалгах). */
  qpayPanel?: ReactNode;
  /** Extra form fields (e.g. «Тайлбар») rendered just above the submit button of the record form. */
  extraFields?: ReactNode;
};

export type PaymentMethodModalProps = PickerProps | FullProps;

type Row = {
  key: string;
  choice: PaymentChoice;
  label: string;
  group: "top" | "transfer" | "card" | "other";
  icon: string;
};

const keyOf = (c: PaymentChoice) => `${c.method}:${c.bank}`;

/** Товч харуулалт, жишээ «💳 Хаан банк · POS» — форм дээрх «Төлбөрийн хэлбэр» товчид. */
export function paymentChoiceSummary(choice: PaymentChoice): string {
  switch (choice.method) {
    case "CASH":
      return "💵 Бэлэн";
    case "QPAY":
      return "▦ QPay";
    case "BANK_TRANSFER":
      return `🏦 ${bankLabel(choice.bank)} · Данс`;
    case "CARD":
      return `💳 ${bankLabel(choice.bank)} · POS`;
    default:
      return "Бусад";
  }
}

function buildRows(banks: Bank[], includeQpay: boolean, qpayOnly: boolean): Row[] {
  const cash: PaymentChoice = { method: "CASH", bank: "" };
  const qpay: PaymentChoice = { method: "QPAY", bank: "" };
  const other: PaymentChoice = { method: "OTHER", bank: "" };
  if (qpayOnly) return [{ key: keyOf(qpay), choice: qpay, label: "QPay", group: "top", icon: "▦" }];
  const rows: Row[] = [{ key: keyOf(cash), choice: cash, label: "Бэлэн", group: "top", icon: "💵" }];
  if (includeQpay) rows.push({ key: keyOf(qpay), choice: qpay, label: "QPay", group: "top", icon: "▦" });
  for (const b of banks) {
    const choice: PaymentChoice = { method: "BANK_TRANSFER", bank: b.code };
    rows.push({ key: keyOf(choice), choice, label: b.label, group: "transfer", icon: "🏦" });
  }
  for (const b of banks) {
    const choice: PaymentChoice = { method: "CARD", bank: b.code };
    rows.push({ key: keyOf(choice), choice, label: b.label, group: "card", icon: "💳" });
  }
  rows.push({ key: keyOf(other), choice: other, label: "Бусад", group: "other", icon: "•••" });
  return rows;
}

const GROUP_HEADER: Partial<Record<Row["group"], string>> = {
  transfer: "Дансаар шилжүүлэх",
  card: "Карт (POS)",
};

/**
 * Төлбөрийн хэлбэр сонгох modal. Зүүн талд жагсаалт, баруун талд сонголтын
 * дэлгэрэнгүй. `mode="full"` нь дүн + бүртгэлийг modal дотроо хийнэ;
 * `mode="picker"` нь зөвхөн хэлбэр сонгоод баталгаажуулна (дүн/илгээлтгүй).
 * Нээгдэх бүрт state шинээр эхэлнэ (body нь `open` үед л mount хийгдэнэ).
 */
export function PaymentMethodModal(props: PaymentMethodModalProps) {
  return (
    <DialogShell
      open={props.open}
      onClose={props.onClose}
      label={props.title}
      className="w-[min(96vw,52rem)] h-[min(88vh,38rem)]"
    >
      <ModalBody {...props} />
    </DialogShell>
  );
}

/** Same body as the modal, for embedding in another dialog (pass `embedded`; give it a flex-col parent with a height). */
export function PaymentMethodPanel(props: PaymentMethodModalProps) {
  return <ModalBody {...props} />;
}

function ModalBody(props: PaymentMethodModalProps) {
  const { banks, includeQpay = false, qpayOnly = false, title, onClose } = props;
  const rows = buildRows(banks, includeQpay, qpayOnly);
  const [selectedKey, setSelectedKey] = useState(() => {
    const wanted = props.initial ? keyOf(props.initial) : "";
    return rows.some((r) => r.key === wanted) ? wanted : rows[0].key;
  });
  // Жижиг дэлгэц: жагсаалт эхэлж, сонголт дээр дэлгэрэнгүй руу орно.
  const [detailOpen, setDetailOpen] = useState(() => Boolean(props.initial));
  const listRef = useRef<HTMLDivElement>(null);
  const selected = rows.find((r) => r.key === selectedKey) ?? rows[0];

  function select(key: string, focus = false) {
    setSelectedKey(key);
    if (focus) {
      requestAnimationFrame(() => {
        listRef.current?.querySelector<HTMLElement>(`[data-key="${CSS.escape(key)}"]`)?.focus();
      });
    }
  }

  function onListKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const idx = rows.findIndex((r) => r.key === selectedKey);
    const next = rows[(idx + (e.key === "ArrowDown" ? 1 : rows.length - 1)) % rows.length];
    select(next.key, true);
  }

  return (
    <>
      {props.embedded ? null : (
        <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-[var(--oc-line)] shrink-0">
          <h2 className="font-semibold text-[var(--oc-ink)] min-w-0 truncate">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Хаах"
            className="w-8 h-8 shrink-0 flex items-center justify-center rounded-lg text-[var(--oc-muted3)] hover:text-[var(--oc-ink)] hover:bg-white/[0.08] transition-colors"
          >
            ✕
          </button>
        </div>
      )}
      <div className="flex flex-1 min-h-0">
        <div
          ref={listRef}
          role="listbox"
          aria-label="Төлбөрийн хэлбэр"
          onKeyDown={onListKeyDown}
          className={`${detailOpen ? "hidden sm:block" : "block"} w-full sm:w-64 shrink-0 overflow-y-auto border-r border-[var(--oc-line)] p-2`}
        >
          {rows.map((r, i) => {
            const header = r.group !== rows[i - 1]?.group ? GROUP_HEADER[r.group] : undefined;
            const active = r.key === selectedKey;
            return (
              <div key={r.key}>
                {header ? (
                  <div className="px-2 pt-3 pb-1 font-plex-mono text-[10px] uppercase tracking-[0.1em] text-[var(--oc-muted3)]">
                    {header}
                  </div>
                ) : null}
                <button
                  type="button"
                  role="option"
                  aria-selected={active}
                  data-key={r.key}
                  tabIndex={active ? 0 : -1}
                  onClick={() => {
                    select(r.key);
                    setDetailOpen(true);
                  }}
                  className={`w-full flex items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm transition-colors ${active
                    ? "bg-[var(--oc-accent)]/15 text-[var(--oc-ink)] ring-1 ring-[var(--oc-accent)]/40"
                    : "text-[var(--oc-ink2)] hover:bg-white/[0.06]"
                    }`}
                >
                  <span className="w-5 shrink-0 text-center" aria-hidden>
                    {r.icon}
                  </span>
                  <span className={`min-w-0 flex-1 truncate ${r.group === "card" ? "font-bold" : ""}`}>{r.label}</span>
                  {r.group === "card" ? (
                    <span className="shrink-0 rounded-full border border-[var(--oc-line)] px-1.5 py-0.5 font-plex-mono text-[9px] text-[var(--oc-muted3)]">
                      POS
                    </span>
                  ) : null}
                </button>
              </div>
            );
          })}
        </div>
        <div className={`${detailOpen ? "flex" : "hidden sm:flex"} flex-1 min-w-0 flex-col overflow-y-auto p-5`}>
          <button
            type="button"
            onClick={() => setDetailOpen(false)}
            className="sm:hidden self-start mb-3 text-xs text-[var(--oc-muted3)] hover:text-[var(--oc-ink)]"
          >
            ← Буцах
          </button>
          {/* key: сонголт солигдоход панелийн дотоод state (POS шат, алдаа) шинэчлэгдэнэ. */}
          {props.mode === "picker" ? (
            <PickerDetail key={selected.key} row={selected} onConfirm={props.onConfirm} />
          ) : (
            <FullDetail key={selected.key} row={selected} {...props} />
          )}
        </div>
      </div>
    </>
  );
}

function selectionTitle(row: Row): string {
  if (row.choice.method === "BANK_TRANSFER") return `Дансаар шилжүүлэх · ${row.label}`;
  if (row.choice.method === "CARD") return `Карт (POS) · ${row.label}`;
  return row.label;
}

function PickerDetail({ row, onConfirm }: { row: Row; onConfirm: (c: PaymentChoice) => void }) {
  return (
    <div className="flex flex-col gap-4">
      <div className="text-base font-semibold text-[var(--oc-ink)]">{selectionTitle(row)}</div>
      {row.choice.method === "CARD" ? (
        <p className="text-xs text-[var(--oc-muted3)]">Форм хадгалах үед туршилтын POS-оор баталгаажуулна.</p>
      ) : null}
      <Btn type="button" size="md" onClick={() => onConfirm(row.choice)}>
        Сонгох
      </Btn>
    </div>
  );
}

function FullDetail(props: FullProps & { row: Row }) {
  const { row, defaultAmount, onRecord, cashWarning, recordBlockedNotice, changeBase, otherNote, qpayPanel, extraFields, onClose } = props;
  const { method, bank } = row.choice;
  const [amount, setAmount] = useState(formatPriceInput(defaultAmount));
  const [pos, setPos] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const amountNum = Number.parseFloat(amount.replace(/,/g, ""));
  const amountOk = Number.isFinite(amountNum) && amountNum > 0;

  async function record() {
    setError(null);
    setPending(true);
    try {
      const res = await onRecord(row.choice, amount);
      if (res.ok) onClose();
      else setError(res.message ?? "Төлбөр бүртгэхэд алдаа гарлаа.");
    } finally {
      setPending(false);
    }
  }

  if (method === "QPAY") {
    return (
      <div className="flex flex-col gap-4">
        <div className="text-base font-semibold text-[var(--oc-ink)]">QPay</div>
        {qpayPanel}
      </div>
    );
  }

  if (method === "CARD" && pos) {
    return (
      <div className="flex flex-col gap-4">
        <div className="text-base font-semibold text-[var(--oc-ink)]">{selectionTitle(row)}</div>
        <PosSimulator
          bankName={bankLabel(bank)}
          amount={amount}
          pending={pending}
          error={error}
          onSuccess={() => void record()}
          onCancel={() => {
            setError(null);
            setPos(false);
          }}
        />
      </div>
    );
  }

  const showChange =
    method === "CASH" && changeBase !== undefined && Number.isFinite(amountNum) && amountNum > changeBase;

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (!amountOk) {
          setError("Дүнгээ оруулна уу.");
          return;
        }
        if (method === "CARD") {
          setError(null);
          setPos(true);
          return;
        }
        void record();
      }}
    >
      <div className="text-base font-semibold text-[var(--oc-ink)]">{selectionTitle(row)}</div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="pm-amount" className="text-sm font-medium text-[var(--oc-ink2)]">
          Дүн (₮)
        </label>
        <div className="relative">
          <input
            id="pm-amount"
            type="text"
            inputMode="decimal"
            autoFocus
            value={amount}
            onChange={(e) => setAmount(liveFormatPriceInput(e.target.value))}
            onBlur={(e) => setAmount(formatPriceInput(e.target.value))}
            className="compact-input w-full pr-6 text-right tabular-nums"
          />
          <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[11px] text-[var(--oc-muted3)]">
            ₮
          </span>
        </div>
      </div>
      {method === "CASH" ? cashWarning : null}
      {recordBlockedNotice ?? null}
      {showChange ? (
        <p className="text-xs text-[var(--oc-ink2)]">
          Хариулт:{" "}
          <span className="font-semibold tabular-nums">
            {formatPriceInput(String(Math.round((amountNum - (changeBase ?? 0)) * 100) / 100))}₮
          </span>
        </p>
      ) : null}
      {method === "OTHER" && otherNote ? <p className="text-xs text-[var(--oc-muted3)]">{otherNote}</p> : null}
      {extraFields}
      {error ? <p className="text-xs text-red-400 light:text-red-600">{error}</p> : null}
      <Btn type="submit" size="md" disabled={pending || Boolean(recordBlockedNotice) || (method === "CARD" && !amountOk)}>
        {method === "CARD" ? "POS-оор төлөх" : pending ? "Бүртгэж..." : "Бүртгэх"}
      </Btn>
    </form>
  );
}
