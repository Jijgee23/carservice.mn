"use client";

import { useState } from "react";
import {
  createPaymentAccountAction,
  updatePaymentAccountAction,
  type PaymentAccountActionState,
} from "@/app/_actions/payment-accounts";
import { Btn, FormError } from "@/app/_components/landing-ops-ui";
import { useRetainedFormAction } from "@/app/dashboard/cash/use-retained-form-action";
import { DialogShell } from "@/app/dashboard/_components/pos-simulator";
import {
  BANK_NAME_SUGGESTIONS,
  PAYMENT_ACCOUNT_TYPE_LABEL,
  PAYMENT_ACCOUNT_TYPES,
  TEST_BADGE,
  type PaymentAccountTypeValue,
} from "@/lib/payment-accounts";
import type { PaymentAccountDto } from "@/lib/payment-account-service";

const FOCUS_RING =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--oc-accent)] focus-visible:ring-offset-1 focus-visible:ring-offset-transparent";

const ALL_TYPE_OPTIONS = PAYMENT_ACCOUNT_TYPES.map((value) => ({ value, label: PAYMENT_ACCOUNT_TYPE_LABEL[value] }));

/**
 * `account` = edit mode; null = create mode, starting on `defaultType`. The body mounts only while open, so form
 * state resets on every open. `onSaved` reports the saved type so the list can show the tab it landed in.
 */
export function PaymentAccountDialog({
  open,
  account,
  defaultType = "BANK_ACCOUNT",
  onClose,
  onSaved,
}: {
  open: boolean;
  account: PaymentAccountDto | null;
  defaultType?: PaymentAccountTypeValue;
  onClose: () => void;
  onSaved?: (type: PaymentAccountTypeValue) => void;
}) {
  const title = account ? "Төлбөрийн арга засах" : "Төлбөрийн арга нэмэх";
  return (
    <DialogShell open={open} onClose={onClose} label={title} className="w-[min(94vw,26rem)] max-h-[90vh]">
      <DialogBody
        key={account?.id ?? `new-${defaultType}`}
        account={account}
        defaultType={defaultType === "CASH" ? "BANK_ACCOUNT" : defaultType}
        title={title}
        onClose={onClose}
        onSaved={onSaved}
      />
    </DialogShell>
  );
}

function DialogBody({
  account,
  defaultType,
  title,
  onClose,
  onSaved,
}: {
  account: PaymentAccountDto | null;
  defaultType: PaymentAccountTypeValue;
  title: string;
  onClose: () => void;
  onSaved?: (type: PaymentAccountTypeValue) => void;
}) {
  const editing = account !== null;
  // «Бэлэн» is automatic: never offered when adding; editing it (name only) shows just its own type.
  const typeOptions = ALL_TYPE_OPTIONS.filter((o) => (account?.type === "CASH" ? o.value === "CASH" : o.value !== "CASH"));
  const [type, setType] = useState<PaymentAccountTypeValue>(account?.type ?? defaultType);
  // onSubmit + transition (not <form action>) so React 19 does not reset typed values on a failed result.
  const { state, pending, onSubmit } = useRetainedFormAction<PaymentAccountActionState>(
    editing ? updatePaymentAccountAction : createPaymentAccountAction,
    () => {
      onSaved?.(type);
      onClose();
    },
  );
  const fieldErrors = state && !state.ok ? state.fieldErrors : undefined;

  return (
    <>
      <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-[var(--oc-line)] shrink-0">
        <h2 className="font-semibold text-[var(--oc-ink)] min-w-0 truncate">{title}</h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Хаах"
          className={`w-8 h-8 shrink-0 flex items-center justify-center rounded-lg text-[var(--oc-muted3)] hover:text-[var(--oc-ink)] hover:bg-white/[0.08] transition-colors ${FOCUS_RING}`}
        >
          <svg aria-hidden="true" viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round">
            <path d="M4 4l8 8M12 4l-8 8" />
          </svg>
        </button>
      </div>
      <form onSubmit={onSubmit} className="flex flex-col gap-4 p-5 overflow-y-auto">
        {account ? <input type="hidden" name="id" value={account.id} /> : null}
        {account && type === "POS" ? <input type="hidden" name="isTestPresent" value="1" /> : null}
        <FormError message={state && !state.ok ? state.message : undefined} />
        {fieldErrors?.type ? <p className="text-xs text-red-400 light:text-red-600">{fieldErrors.type}</p> : null}

        <fieldset className="flex flex-col gap-1.5" disabled={editing}>
          <legend className="text-sm font-medium text-[var(--oc-ink2)] mb-1.5">Төрөл</legend>
          <div
            className={`grid ${typeOptions.length === 1 ? "grid-cols-1" : "grid-cols-2"} gap-1 rounded-lg border border-[var(--oc-line)] p-1`}
          >
            {typeOptions.map((o) => (
              <label
                key={o.value}
                className={`text-center text-sm rounded-md py-1.5 transition-colors ${type === o.value
                  ? "bg-[var(--oc-accent)]/15 text-[var(--oc-ink)] ring-1 ring-[var(--oc-accent)]/40"
                  : "text-[var(--oc-ink2)]"
                  } ${editing ? "opacity-60 cursor-not-allowed" : "cursor-pointer hover:bg-white/[0.06]"} has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-[var(--oc-accent)]`}
              >
                <input
                  type="radio"
                  name="type"
                  value={o.value}
                  checked={type === o.value}
                  onChange={() => setType(o.value)}
                  className="sr-only"
                />
                {o.label}
              </label>
            ))}
          </div>
        </fieldset>

        <Field id="pa-name" label="Нэр" error={fieldErrors?.name}>
          <input
            id="pa-name"
            {...errorProps("pa-name", fieldErrors?.name)}
            name="name"
            type="text"
            list={type === "CASH" ? undefined : "bank-names"}
            placeholder={type === "CASH" ? "Жишээ: Бэлэн, Касс 1" : undefined}
            required
            maxLength={80}
            defaultValue={account?.name ?? ""}
            autoComplete="off"
            className="compact-input w-full"
          />
          <datalist id="bank-names">
            {BANK_NAME_SUGGESTIONS.map((n) => (
              <option key={n} value={n} />
            ))}
          </datalist>
        </Field>

        {type === "CASH" ? null : (
          <Field id="pa-number" label="Дансны дугаар" error={fieldErrors?.accountNumber}>
            <input
              id="pa-number"
              {...errorProps("pa-number", fieldErrors?.accountNumber)}
              name="accountNumber"
              type="text"
              inputMode="numeric"
              required
              defaultValue={account?.accountNumber ?? ""}
              autoComplete="off"
              className="compact-input w-full tabular-nums"
            />
          </Field>
        )}

        {type === "POS" ? (
          <>
            <Field id="pa-terminal" label="Терминалын ID" error={fieldErrors?.terminalId}>
              <input
                id="pa-terminal"
            {...errorProps("pa-terminal", fieldErrors?.terminalId)}
                name="terminalId"
                type="text"
                maxLength={32}
                defaultValue={account?.terminalId ?? ""}
                autoComplete="off"
                className="compact-input w-full"
              />
            </Field>
            <Field id="pa-merchant" label="Merchant ID" error={fieldErrors?.merchantId}>
              <input
                id="pa-merchant"
            {...errorProps("pa-merchant", fieldErrors?.merchantId)}
                name="merchantId"
                type="text"
                maxLength={32}
                defaultValue={account?.merchantId ?? ""}
                autoComplete="off"
                className="compact-input w-full"
              />
            </Field>
            <label className="flex items-center gap-2 text-sm text-[var(--oc-ink2)] cursor-pointer">
              <input type="checkbox" name="isTest" defaultChecked={account ? account.isTest : false} />
              {TEST_BADGE}
            </label>
          </>
        ) : null}

        <div className="flex items-center gap-2 pt-1">
          <Btn type="submit" size="md" disabled={pending} className={FOCUS_RING}>
            {pending ? "Хадгалж байна…" : "Хадгалах"}
          </Btn>
          <Btn type="button" variant="ghost" size="md" onClick={onClose} className={FOCUS_RING}>
            Болих
          </Btn>
        </div>
      </form>
    </>
  );
}

function Field({ id, label, error, children }: { id: string; label: string; error?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium text-[var(--oc-ink2)]">
        {label}
      </label>
      {children}
      {error ? (
        <p id={`${id}-error`} className="text-xs text-red-400 light:text-red-600">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** Links an input to its `Field` error so screen readers announce it and mark the input invalid. */
function errorProps(id: string, error?: string) {
  return error ? { "aria-invalid": true as const, "aria-describedby": `${id}-error` } : {};
}
