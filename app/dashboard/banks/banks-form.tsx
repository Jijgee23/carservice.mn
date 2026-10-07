"use client";

import { useActionState } from "react";
import { saveEnabledBanksAction, type TenantBanksActionState } from "@/app/_actions/tenant-banks";
import { FormError } from "@/app/_components/auth-shell";
import { Btn } from "@/app/_components/landing-ops-ui";

export function BanksForm({
  banks,
  initialEnabled,
}: {
  banks: { code: string; label: string }[];
  /** Хоосон = тохируулаагүй (бүх банк харагдана). */
  initialEnabled: string[];
}) {
  const [state, formAction, pending] = useActionState<TenantBanksActionState, FormData>(
    saveEnabledBanksAction,
    null,
  );

  return (
    <form action={formAction} className="flex flex-col gap-4">
      {state?.ok ? (
        <div className="bg-[var(--oc-ok)]/10 border border-[var(--oc-ok)]/25 rounded-lg px-3 py-2 text-sm text-[var(--oc-ok)]">
          Хадгаллаа.
        </div>
      ) : null}
      <FormError message={state && !state.ok ? state.message : undefined} />
      <div className="flex flex-col gap-2">
        {banks.map((b) => (
          <label key={b.code} className="flex items-center gap-2 text-sm text-[var(--oc-ink2)] cursor-pointer">
            <input
              type="checkbox"
              name="enabledBanks"
              value={b.code}
              defaultChecked={initialEnabled.includes(b.code)}
            />
            {b.label}
          </label>
        ))}
      </div>
      <p className="text-xs text-[var(--oc-muted3)]">Сонгоогүй бол бүх банк харагдана.</p>
      <div>
        <Btn type="submit" disabled={pending} size="md">
          {pending ? "..." : "Хадгалах"}
        </Btn>
      </div>
    </form>
  );
}
