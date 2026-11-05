"use client";

import { useActionState, useEffect, useRef } from "react";
import { type SystemCreditState, updateCreditAdjustmentAction } from "@/app/_actions/system-credit";
import { useToast } from "@/app/_components/toast";

export function CreditAdjustmentForm({
  tenantId,
  adjustment,
  note,
}: {
  tenantId: string;
  adjustment: number;
  note: string;
}) {
  const toast = useToast();
  const [state, formAction, pending] = useActionState<SystemCreditState, FormData>(updateCreditAdjustmentAction, null);
  const handled = useRef<SystemCreditState>(null);
  useEffect(() => {
    if (!state || state === handled.current) return;
    handled.current = state;
    if (state.ok) toast.success(state.message ?? "Хадгалагдлаа.");
    else toast.error(state.message ?? Object.values(state.fieldErrors ?? {})[0] ?? "Алдаа гарлаа.");
  }, [state, toast]);

  return (
    <form action={formAction} className="flex flex-col gap-2">
      <input type="hidden" name="tenantId" value={tenantId} />
      <label className="text-xs text-[var(--oc-muted)]">
        Залруулга (−50 … +50)
        <input
          name="creditAdjustment"
          type="number"
          min={-50}
          max={50}
          defaultValue={adjustment}
          className="auth-input mt-1 w-full font-plex-mono"
        />
      </label>
      <label className="text-xs text-[var(--oc-muted)]">
        Тайлбар
        <input name="creditAdjustmentNote" defaultValue={note} maxLength={300} className="auth-input mt-1 w-full" />
      </label>
      <button
        type="submit"
        disabled={pending}
        className="self-start rounded-lg bg-[var(--oc-accent)] px-3 py-1.5 text-xs font-medium text-[var(--oc-on-accent)] hover:bg-[var(--oc-accent-hi)] disabled:opacity-60"
      >
        {pending ? "Хадгалж байна..." : "Залруулга хадгалах"}
      </button>
    </form>
  );
}
