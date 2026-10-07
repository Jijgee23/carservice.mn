"use client";

import { CASH_SESSION_ENTRY_LOCKED_MESSAGE } from "@/lib/cash/locked-copy";
import { useState } from "react";
import {
  voidPostpaidSettlementAction,
  type SettlementActionState,
} from "@/app/_actions/cash-settlements";
import { FormError } from "@/app/_components/auth-shell";
import { Btn, Field } from "@/app/_components/landing-ops-ui";
import { Modal } from "@/app/_components/modal";
import { useRetainedFormAction } from "../../use-retained-form-action";
import { NO_OPEN_SESSION_REASON, NoOpenSessionNotice } from "../../session-warning";

/** Void the whole settlement; reason is required. Hidden by the caller when the user lacks either permission. */
export function SettlementVoidButton({ settlementId, sessionOpen, locked = false }: { settlementId: string; sessionOpen: boolean; /** Lump entry is in a closed session: void is refused (CASH_SESSION_ENTRY_LOCKED). */ locked?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <div className="flex flex-col items-end gap-1">
        <Btn
          type="button"
          variant="danger"
          size="md"
          disabled={locked || !sessionOpen}
          title={locked ? CASH_SESSION_ENTRY_LOCKED_MESSAGE : !sessionOpen ? NO_OPEN_SESSION_REASON : undefined}
          onClick={() => setOpen(true)}
        >
          Тооцоог цуцлах
        </Btn>
        {locked ? <span className="max-w-[14rem] text-right text-[10px] text-[var(--oc-muted4)]">{CASH_SESSION_ENTRY_LOCKED_MESSAGE}</span> : !sessionOpen ? <NoOpenSessionNotice className="text-right" /> : null}
      </div>
      <Modal open={open} onClose={() => setOpen(false)} title="Тооцоог цуцлах">
        <VoidForm settlementId={settlementId} onDone={() => setOpen(false)} />
      </Modal>
    </>
  );
}

function VoidForm({ settlementId, onDone }: { settlementId: string; onDone: () => void }) {
  const { state, pending, onSubmit } = useRetainedFormAction<SettlementActionState>(voidPostpaidSettlementAction, () => onDone());
  const reasonError = state && !state.ok ? state.fieldErrors?.reason : undefined;

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4 p-5">
      <input type="hidden" name="settlementId" value={settlementId} />
      <p className="text-sm text-[var(--oc-ink2)]">
        Тооцоонд хамаарах бүх захиалгын төлбөр цуцлагдаж, захиалгууд дахин үлдэгдэлтэй болно. Кассын бичлэг хүчингүй болно.
        Шалтгаан заавал шаардлагатай.
      </p>
      <FormError message={state && !state.ok && !reasonError ? state.message : undefined} />
      <Field label="Шалтгаан" htmlFor="settlement-void-reason" required error={reasonError}>
        <textarea id="settlement-void-reason" name="reason" rows={3} required maxLength={500} className="compact-input w-full" />
      </Field>
      <div className="flex justify-end gap-2">
        <Btn type="button" variant="ghost" size="md" onClick={onDone}>
          Болих
        </Btn>
        <Btn type="submit" variant="danger" size="md" disabled={pending}>
          {pending ? "..." : "Цуцлах"}
        </Btn>
      </div>
    </form>
  );
}
