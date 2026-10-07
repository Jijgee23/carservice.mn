"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createCashEntryAction, uploadCashAttachmentAction, type CashActionState } from "@/app/_actions/cash";
import { FormError } from "@/app/_components/auth-shell";
import { DatePicker } from "@/app/_components/date-picker";
import { Btn, Field } from "@/app/_components/landing-ops-ui";
import { Modal } from "@/app/_components/modal";
import { PaymentMethodModal, paymentChoiceSummary, type PaymentChoice } from "../_components/payment-method-modal";
import { PosSimulatorModal } from "../_components/pos-simulator";
import { bankLabel } from "@/lib/banks";
import { formatPriceInput, liveFormatPriceInput } from "@/lib/orders";
import { CustomerPicker } from "./customer-picker";
import { OrderPaymentTab } from "./order-payment-tab";
import { useRetainedFormAction } from "./use-retained-form-action";
import { NO_OPEN_SESSION_REASON, NoOpenSessionNotice } from "./session-warning";

type Option = { id: string; name: string };

type Props = {
  direction: "INCOME" | "EXPENSE";
  types: Option[];
  branches: Option[];
  defaultBranchId: string;
  banks: { code: string; label: string }[];
  /** Business-day "YYYY-MM-DD" (Asia/Ulaanbaatar). */
  today: string;
  /** Branch ids that currently have an open cash session (any method: saving is disabled for a branch without one). */
  openBranchIds: string[];
  /** Income only: user may record order payments (payments.create) -> show the «Захиалгын төлбөр» tab. */
  canRecordOrderPayments?: boolean;
  /** Working branch is a specific branch (not ALL/unset): hide the order tab's branch selector. */
  branchPinned?: boolean;
};

type IncomeTab = "order" | "other";
const TAB_KEY = "carcare.cashIncomeTab";

export function CashCreateButton(props: Props) {
  const [open, setOpen] = useState(false);
  const isIncome = props.direction === "INCOME";
  const router = useRouter();
  // No active branch to book against (e.g. the user's pinned branch was deactivated): say so instead of submitting an empty branch.
  const noActiveBranch = !props.defaultBranchId;
  const showTabs = isIncome && Boolean(props.canRecordOrderPayments) && !noActiveBranch;
  const [tab, setTab] = useState<IncomeTab>("order");
  // A payment recorded in the order tab must refresh the list however the dialog closes (X, Esc, backdrop, button).
  const recordedRef = useRef(false);
  function closeDialog() {
    setOpen(false);
    if (recordedRef.current) {
      recordedRef.current = false;
      router.refresh();
    }
  }
  function openDialog() {
    recordedRef.current = false;
    try {
      setTab(window.localStorage.getItem(TAB_KEY) === "other" ? "other" : "order");
    } catch {
      /* storage unavailable */
    }
    setOpen(true);
  }
  function chooseTab(next: IncomeTab) {
    setTab(next);
    try {
      window.localStorage.setItem(TAB_KEY, next);
    } catch {
      /* storage unavailable */
    }
  }
  return (
    <>
      <Btn type="button" size="md" onClick={openDialog}>
        {isIncome ? "+ Орлого нэмэх" : "+ Зарлага нэмэх"}
      </Btn>
      <Modal
        open={open}
        onClose={closeDialog}
        title={isIncome ? "Орлого бүртгэх" : "Зарлага бүртгэх"}
        widthClassName="max-w-xl"
      >
        {showTabs ? (
          <div role="tablist" className="flex gap-1 px-5 pt-3 shrink-0">
            {(
              [
                ["order", "Захиалгын төлбөр"],
                ["other", "Бусад орлого"],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={tab === key}
                onClick={() => chooseTab(key)}
                className={`flex-1 rounded-lg px-3 py-1.5 text-center text-sm transition-colors ${tab === key
                  ? "bg-[var(--oc-accent)]/15 text-[var(--oc-ink)] ring-1 ring-[var(--oc-accent)]/40"
                  : "text-[var(--oc-ink2)] hover:bg-white/[0.06]"
                  }`}
              >
                {label}
              </button>
            ))}
          </div>
        ) : null}
        {noActiveBranch ? (
          <div className="flex flex-col gap-4 p-5">
            <FormError message="Таны салбар идэвхгүй байна, тиймээс бичлэг нэмэх боломжгүй. Администратороосоо салбараа идэвхжүүлэхийг хүснэ үү." />
            <div className="flex justify-end">
              <Btn type="button" variant="ghost" size="md" onClick={closeDialog}>
                Хаах
              </Btn>
            </div>
          </div>
        ) : showTabs && tab === "order" ? (
          <OrderPaymentTab
            branches={props.branches}
            defaultBranchId={props.defaultBranchId}
            showBranchSelect={!props.branchPinned}
            banks={props.banks}
            openBranchIds={props.openBranchIds}
            onRecorded={() => {
              recordedRef.current = true;
            }}
            onDone={() => {
              recordedRef.current = true;
              closeDialog();
            }}
          />
        ) : (
          <CashEntryForm {...props} onDone={() => setOpen(false)} />
        )}
      </Modal>
    </>
  );
}

function CashEntryForm({ direction, types, branches, defaultBranchId, branchPinned, banks, today, openBranchIds, onDone }: Props & { onDone: () => void }) {
  const isIncome = direction === "INCOME";
  const [choice, setChoice] = useState<PaymentChoice>({ method: "CASH", bank: "" });
  const [pickerOpen, setPickerOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [posAmount, setPosAmount] = useState<string | null>(null);
  const posConfirmed = useRef(false);
  const formRef = useRef<HTMLFormElement>(null);
  const [branchId, setBranchId] = useState(defaultBranchId);
  const sessionClosed = !openBranchIds.includes(branchId);
  const [attachment, setAttachment] = useState<{ path: string; name: string } | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  // onSubmit-driven (not <form action>) so a failed save keeps every field, incl. selects, date, note and the attached file.
  const { state, pending, onSubmit: submitEntry } = useRetainedFormAction<CashActionState>(createCashEntryAction, () => onDone());
  const fieldErrors = state && !state.ok ? (state.fieldErrors ?? {}) : {};

  async function onFile(file: File | undefined) {
    setUploadError(null);
    if (!file) {
      setAttachment(null);
      return;
    }
    setUploading(true);
    try {
      const fd = new FormData();
      fd.set("file", file);
      const res = await uploadCashAttachmentAction(fd);
      if (res.ok && res.path) setAttachment({ path: res.path, name: file.name });
      else {
        setAttachment(null);
        setUploadError(res.message ?? "Файл хуулахад алдаа.");
      }
    } catch {
      setAttachment(null);
      setUploadError("Файл хуулахад алдаа.");
    } finally {
      setUploading(false);
    }
  }

  return (
    <form
      ref={formRef}
      className="flex flex-col gap-4 p-5 overflow-y-auto"
      onSubmit={(e) => {
        // CARD: submit-ийн өмнө туршилтын POS-оор баталгаажуулна (талбарууд шалгагдсаны дараа л энд орж ирнэ).
        if (choice.method !== "CARD") {
          submitEntry(e);
          return;
        }
        if (posConfirmed.current) {
          posConfirmed.current = false;
          submitEntry(e);
          return;
        }
        e.preventDefault();
        const raw = new FormData(e.currentTarget).get("amount");
        setPosAmount(formatPriceInput(typeof raw === "string" ? raw : ""));
      }}
    >
      <input type="hidden" name="method" value={choice.method} />
      <input type="hidden" name="bank" value={choice.method === "BANK_TRANSFER" || choice.method === "CARD" ? choice.bank : ""} />
      <input type="hidden" name="direction" value={direction} />
      <input type="hidden" name="attachmentPath" value={attachment?.path ?? ""} />
      <FormError message={state && !state.ok && Object.keys(fieldErrors).length === 0 ? state.message : undefined} />

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Field label="Ангилал" htmlFor="cash-type" required error={fieldErrors.typeId}>
          <select id="cash-type" name="typeId" required defaultValue="" className="compact-input w-full">
            <option value="" disabled>
              Сонгох
            </option>
            {types.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Салбар" htmlFor="cash-branch" required error={fieldErrors.branchId}>
          {branchPinned ? (
            <>
              <input type="hidden" name="branchId" value={branchId} />
              <div id="cash-branch" className="compact-input w-full">
                {branches.find((b) => b.id === branchId)?.name ?? "—"}
              </div>
            </>
          ) : (
            <select id="cash-branch" name="branchId" required value={branchId} onChange={(e) => setBranchId(e.target.value)} className="compact-input w-full">
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label="Дүн (₮)" htmlFor="cash-amount" required error={fieldErrors.amount}>
          <input type="hidden" name="amount" value={amount.replace(/,/g, "")} />
          <input
            id="cash-amount"
            type="text"
            inputMode="decimal"
            required
            value={amount}
            onChange={(e) => setAmount(liveFormatPriceInput(e.target.value))}
            onBlur={(e) => setAmount(formatPriceInput(e.target.value))}
            placeholder="0"
            className="compact-input w-full text-right tabular-nums"
          />
        </Field>
        <Field label="Огноо" htmlFor="cash-date" required error={fieldErrors.occurredAt}>
          <DatePicker id="cash-date" name="occurredAt" defaultValue={today} required />
        </Field>
        <Field label="Төлбөрийн хэлбэр" htmlFor="cash-method" required error={fieldErrors.method ?? fieldErrors.bank}>
          <button
            id="cash-method"
            type="button"
            onClick={() => setPickerOpen(true)}
            className="compact-input w-full text-left"
          >
            {paymentChoiceSummary(choice)}
          </button>
        </Field>
        <Field label="Харилцагч (үйлчлүүлэгч)" htmlFor="cash-customer" error={fieldErrors.customerId}>
          <CustomerPicker id="cash-customer" />
        </Field>
        <Field label="Харилцагч (бичвэр)" htmlFor="cash-counterparty" error={fieldErrors.counterparty}>
          <input
            id="cash-counterparty"
            name="counterparty"
            type="text"
            maxLength={200}
            placeholder="Нийлүүлэгч, байгууллагын нэр"
            className="compact-input w-full"
          />
        </Field>
      </div>

      {sessionClosed ? <NoOpenSessionNotice /> : null}

      {!isIncome ? (
        <Field
          label="Татвар (туршилт)"
          htmlFor="cash-tax"
          hint="Туршилтын талбар: зөвхөн хадгалагдана, ямар ч нийлбэрт орохгүй."
          error={fieldErrors.taxIncluded}
        >
          <input
            id="cash-tax"
            name="taxIncluded"
            type="text"
            inputMode="decimal"
            placeholder="0"
            className="compact-input w-full text-right tabular-nums"
          />
        </Field>
      ) : null}

      <Field label="Тайлбар" htmlFor="cash-note" error={fieldErrors.note}>
        <textarea id="cash-note" name="note" rows={2} maxLength={1000} className="compact-input w-full" />
      </Field>

      <Field
        label="Хавсралт (зураг)"
        htmlFor="cash-file"
        hint="PNG, JPG, WEBP — 2MB хүртэл."
        error={uploadError ?? fieldErrors.attachmentPath}
      >
        <input
          id="cash-file"
          type="file"
          accept="image/png,image/jpeg,image/webp"
          onChange={(e) => void onFile(e.target.files?.[0])}
          className="text-sm text-[var(--oc-ink2)]"
        />
        {uploading ? <span className="text-xs text-[var(--oc-muted3)]">Хуулж байна...</span> : null}
        {attachment ? <span className="text-xs text-[var(--oc-ok)]">Хавсаргасан: {attachment.name}</span> : null}
      </Field>

      <div className="flex justify-end gap-2">
        <Btn type="button" variant="ghost" size="md" onClick={onDone}>
          Болих
        </Btn>
        <Btn type="submit" size="md" disabled={pending || uploading || sessionClosed} title={sessionClosed ? NO_OPEN_SESSION_REASON : undefined}>
          {pending ? "Хадгалж байна..." : "Хадгалах"}
        </Btn>
      </div>

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
        open={posAmount !== null}
        bankName={bankLabel(choice.bank)}
        amount={posAmount ?? ""}
        onCancel={() => setPosAmount(null)}
        onSuccess={() => {
          setPosAmount(null);
          posConfirmed.current = true;
          formRef.current?.requestSubmit();
        }}
      />
    </form>
  );
}
