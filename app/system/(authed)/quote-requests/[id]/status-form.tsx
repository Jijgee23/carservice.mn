"use client";

import { useActionState, useEffect, useRef } from "react";
import { updateQuoteRequestStatusAction, type QuoteAdminActionState } from "@/app/_actions/quote-requests";
import { useToast } from "@/app/_components/toast";
import { QUOTE_STATUS_LABEL, QUOTE_STATUS_VALUES, type QuoteStatus } from "@/lib/quote-requests";

export function QuoteStatusForm({
  id,
  status,
  adminNote,
}: {
  id: string;
  status: QuoteStatus;
  adminNote: string;
}) {
  const toast = useToast();
  const [state, formAction, pending] = useActionState<QuoteAdminActionState, FormData>(
    updateQuoteRequestStatusAction,
    null,
  );
  const handled = useRef<QuoteAdminActionState>(null);

  useEffect(() => {
    if (!state || state === handled.current) return;
    handled.current = state;
    if (state.ok) toast.success(state.message ?? "Хадгалагдлаа.");
    else toast.error(state.message ?? "Алдаа гарлаа.");
  }, [state, toast]);

  return (
    <form action={formAction} className="mt-6 flex flex-col gap-3 border-t border-[var(--oc-line2)] pt-5">
      <input type="hidden" name="id" value={id} />
      <label className="text-xs text-[var(--oc-muted)]">
        Төлөв
        <select name="status" defaultValue={status} className="auth-input mt-1 w-full">
          {QUOTE_STATUS_VALUES.map((v) => (
            <option key={v} value={v}>
              {QUOTE_STATUS_LABEL[v]}
            </option>
          ))}
        </select>
      </label>
      <label className="text-xs text-[var(--oc-muted)]">
        Тэмдэглэл (санал болгосон үнэ, ярилцсан зүйл — зөвхөн SuperAdmin-д)
        <textarea
          name="adminNote"
          defaultValue={adminNote}
          rows={3}
          maxLength={2000}
          className="auth-input mt-1 w-full resize-none"
        />
      </label>
      <button
        type="submit"
        disabled={pending}
        className="self-end rounded-lg border border-[var(--oc-line)] px-4 py-2 text-sm font-medium text-[var(--oc-ink2)] transition-colors hover:bg-[var(--oc-panel2)] disabled:opacity-60 disabled:cursor-not-allowed"
      >
        {pending ? "Хадгалж байна..." : "Хадгалах"}
      </button>
    </form>
  );
}
