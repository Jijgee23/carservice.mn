"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import {
  markAppointmentRefundVerifiedAction,
  type RefundActionState,
} from "@/app/_actions/booking-revenue";
import { useToast } from "@/app/_components/toast";

/** SuperAdmin: a refund attempt ended ambiguously; mark it refunded after verifying at QPay. */
export function VerifyRefundButton({ paymentId }: { paymentId: string }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState<RefundActionState, FormData>(
    markAppointmentRefundVerifiedAction,
    null,
  );
  const handled = useRef<RefundActionState>(null);

  useEffect(() => {
    if (!state || state === handled.current) return;
    handled.current = state;
    if (state.ok) toast.success("Буцаагдлаа", state.message);
    else toast.error("Тэмдэглэх боломжгүй", state.message);
  }, [state, toast]);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-xs text-amber-300 hover:text-amber-200 light:text-amber-700 underline underline-offset-2"
      >
        Буцаасан гэж тэмдэглэх
      </button>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-1.5 w-56">
      <input type="hidden" name="paymentId" value={paymentId} />
      <p className="text-[10.5px] text-[var(--oc-muted3)]">
        Буцаалт QPay дээр хийгдсэнийг шалгасны дараа л баталгаажуулна уу.
      </p>
      <textarea
        name="note"
        required
        rows={2}
        placeholder="QPay дээр шалгасан тэмдэглэл..."
        className="text-xs px-2 py-1.5 rounded-lg bg-[var(--oc-panel2)] border border-[var(--oc-line)] text-[var(--oc-ink2)] placeholder:text-[var(--oc-muted4)] resize-none focus:outline-none focus:border-amber-500/40"
      />
      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={pending}
          className="text-xs bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/30 transition-colors px-2.5 py-1 rounded-lg font-medium disabled:opacity-60"
        >
          {pending ? "..." : "Баталгаажуулах"}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-xs text-[var(--oc-muted3)] hover:text-[var(--oc-muted)]"
        >
          Цуцлах
        </button>
      </div>
    </form>
  );
}
