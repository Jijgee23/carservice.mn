"use client";

import { useState } from "react";
import { voidCashEntryAction, type CashActionState } from "@/app/_actions/cash";
import { FormError } from "@/app/_components/auth-shell";
import { Btn, Field } from "@/app/_components/landing-ops-ui";
import { Modal } from "@/app/_components/modal";
import { useRetainedFormAction } from "./use-retained-form-action";
import { CASH_SESSION_ENTRY_LOCKED_MESSAGE } from "@/lib/cash/locked-copy";
import { NO_OPEN_SESSION_REASON, NoOpenSessionNotice } from "./session-warning";

const CLOSED_SESSION_ENTRY_LOCKED_REASON = CASH_SESSION_ENTRY_LOCKED_MESSAGE;

/** `hideNotice`: the page shows one shared notice instead of one per row. `sessionOpen`: the entry's branch has an open register; voiding is a money write and is refused otherwise. */
export function CashVoidButton({ entryId, sessionOpen, locked = false, hideNotice = false }: { entryId: string; sessionOpen: boolean; /** Entry belongs to a closed session: void is refused (CASH_SESSION_ENTRY_LOCKED). */ locked?: boolean; hideNotice?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Btn
        type="button"
        variant="danger"
        size="sm"
        disabled={locked || !sessionOpen}
        title={locked ? CLOSED_SESSION_ENTRY_LOCKED_REASON : !sessionOpen ? NO_OPEN_SESSION_REASON : undefined}
        onClick={() => setOpen(true)}
      >
        Хүчингүй болгох
      </Btn>
      {locked ? <span className="mt-1 block max-w-[14rem] whitespace-normal text-right text-[10px] text-[var(--oc-muted4)]">{CLOSED_SESSION_ENTRY_LOCKED_REASON}</span> : null}
      {!locked && !sessionOpen && !hideNotice ? <NoOpenSessionNotice className="mt-1 max-w-[14rem] whitespace-normal text-right" /> : null}
      <Modal open={open} onClose={() => setOpen(false)} title="Бичлэгийг хүчингүй болгох">
        <VoidForm entryId={entryId} onDone={() => setOpen(false)} />
      </Modal>
    </>
  );
}

function VoidForm({ entryId, onDone }: { entryId: string; onDone: () => void }) {
  const { state, pending, onSubmit } = useRetainedFormAction<CashActionState>(voidCashEntryAction, () => onDone());
  const reasonError = state && !state.ok ? state.fieldErrors?.reason : undefined;

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4 p-5">
      <input type="hidden" name="entryId" value={entryId} />
      <p className="text-sm text-[var(--oc-ink2)]">
        Бичлэг устахгүй, «Хүчингүй» гэж тэмдэглэгдэж нийлбэрээс хасагдана. Шалтгаан заавал шаардлагатай.
      </p>
      <FormError message={state && !state.ok && !reasonError ? state.message : undefined} />
      <Field label="Шалтгаан" htmlFor="void-reason" required error={reasonError}>
        <textarea id="void-reason" name="reason" rows={3} required maxLength={500} className="compact-input w-full" />
      </Field>
      <div className="flex justify-end gap-2">
        <Btn type="button" variant="ghost" size="md" onClick={onDone}>
          Болих
        </Btn>
        <Btn type="submit" variant="danger" size="md" disabled={pending}>
          {pending ? "..." : "Хүчингүй болгох"}
        </Btn>
      </div>
    </form>
  );
}
