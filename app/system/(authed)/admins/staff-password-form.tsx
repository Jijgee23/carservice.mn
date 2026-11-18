"use client";

import { useActionState, useState } from "react";
import { resetStaffPasswordAction, type SuperAdminActionState } from "@/app/_actions/system-admins";

/** Root «System ажилтан»-ы нууц үгийг шинээр тохируулна (мартсан/түгжигдсэн үед). Ажилтан бүх төхөөрөмжөөс гарна. */
export function StaffPasswordForm({ adminId }: { adminId: string }) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState<SuperAdminActionState, FormData>(resetStaffPasswordAction, null);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="ml-2 text-[11px] text-[var(--oc-accent)] hover:text-[var(--oc-accent-hi)]"
      >
        Нууц үг сэргээх
      </button>
    );
  }
  return (
    <form action={formAction} className="mt-2 flex flex-wrap items-center gap-2" noValidate>
      <input type="hidden" name="id" value={adminId} />
      <input
        name="password"
        type="password"
        minLength={8}
        required
        autoComplete="new-password"
        placeholder="Шинэ нууц үг (8+)"
        aria-label="Шинэ нууц үг"
        className="auth-input h-8 w-48 text-xs"
      />
      <button type="submit" disabled={pending} className="text-xs px-2 py-1 rounded-md bg-[var(--oc-accent)] text-[var(--oc-on-accent)]">
        {pending ? "…" : "Хадгалах"}
      </button>
      <button type="button" onClick={() => setOpen(false)} className="text-xs text-[var(--oc-muted3)]">
        Хаах
      </button>
      {state?.message ? (
        <span role="status" className={`text-xs ${state.ok ? "text-[var(--oc-ok)]" : "text-red-400 light:text-red-600"}`}>
          {state.message}
        </span>
      ) : null}
      {state?.fieldErrors?.password ? <span className="text-xs text-red-400 light:text-red-600">{state.fieldErrors.password}</span> : null}
    </form>
  );
}
