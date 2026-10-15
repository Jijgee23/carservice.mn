"use client";

import { useActionState, useState, useTransition } from "react";
import {
  accountRemovePasswordAction,
  accountSetPasswordAction,
  requestAccountPasswordOtpAction,
  type AccountPasswordState,
} from "@/app/_actions/account-auth";
import { Btn, Field, FormError } from "@/app/_components/landing-ops-ui";

/**
 * Set / change / remove the customer's password. Every change needs a fresh SMS code («Код авах») so an open session
 * alone cannot add a password.
 */
export function PasswordForm({ hasPassword }: { hasPassword: boolean }) {
  const [mode, setMode] = useState<"set" | "remove">("set");
  const [setState, setAction, setPending] = useActionState<AccountPasswordState, FormData>(accountSetPasswordAction, null);
  const [removeState, removeAction, removePending] = useActionState<AccountPasswordState, FormData>(accountRemovePasswordAction, null);
  const [otpNotice, setOtpNotice] = useState<{ ok: boolean; message: string } | null>(null);
  const [sending, startSending] = useTransition();
  const [show, setShow] = useState(false);

  const state = mode === "set" ? setState : removeState;
  const fe = state?.fieldErrors ?? {};
  const pending = mode === "set" ? setPending : removePending;

  function requestCode() {
    startSending(async () => setOtpNotice(await requestAccountPasswordOtpAction()));
  }

  if (state?.ok) {
    return (
      <div className="bg-[var(--oc-ok)]/10 border border-[var(--oc-ok)]/25 rounded-lg px-3 py-2 text-sm text-[var(--oc-ok)]">{state.message}</div>
    );
  }

  const codeField = (
    <Field label="SMS код" htmlFor="pw-code" error={fe.code}>
      <div className="flex gap-2">
        <input
          id="pw-code"
          name="code"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          required
          className={`auth-input flex-1 tracking-[0.3em] ${fe.code ? "border-red-500/50" : ""}`}
          placeholder="000000"
        />
        <Btn type="button" variant="ghost" size="md" disabled={sending} onClick={requestCode} className="shrink-0">
          {sending ? "Илгээж байна…" : otpNotice?.ok ? "Дахин авах" : "Код авах"}
        </Btn>
      </div>
      {otpNotice ? (
        <p className={`text-xs mt-1 ${otpNotice.ok ? "text-[var(--oc-muted3)]" : "text-red-400 light:text-red-600"}`}>{otpNotice.message}</p>
      ) : null}
    </Field>
  );

  return (
    <div className="flex flex-col gap-4">
      {hasPassword ? (
        <div className="inline-flex self-start rounded-[10px] border border-[var(--oc-line)] p-0.5 text-sm">
          {(
            [
              ["set", "Солих"],
              ["remove", "Устгах"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setMode(value)}
              aria-pressed={mode === value}
              className={`rounded-[8px] px-3 py-1.5 ${mode === value ? "bg-[var(--oc-line)] text-[var(--oc-ink)] font-medium" : "text-[var(--oc-muted3)] hover:text-[var(--oc-ink)]"}`}
            >
              {label}
            </button>
          ))}
        </div>
      ) : null}

      {mode === "set" ? (
        <form action={setAction} className="flex flex-col gap-4" noValidate>
          <FormError message={state?.message && !state.ok ? state.message : undefined} />
          <Field label={hasPassword ? "Шинэ нууц үг" : "Нууц үг"} htmlFor="pw-new" error={fe.password} hint="8+ тэмдэгт, үсэг ба тоо агуулсан">
            <div className="relative">
              <input
                id="pw-new"
                name="password"
                type={show ? "text" : "password"}
                autoComplete="new-password"
                required
                className={`auth-input pr-14 ${fe.password ? "border-red-500/50" : ""}`}
              />
              <button type="button" onClick={() => setShow((v) => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-[var(--oc-muted3)] hover:text-[var(--oc-ink2)]">
                {show ? "Нуух" : "Харах"}
              </button>
            </div>
          </Field>
          <Field label="Нууц үг давтах" htmlFor="pw-confirm" error={fe.confirm}>
            <input
              id="pw-confirm"
              name="confirm"
              type={show ? "text" : "password"}
              autoComplete="new-password"
              required
              className={`auth-input ${fe.confirm ? "border-red-500/50" : ""}`}
            />
          </Field>
          {codeField}
          <Btn type="submit" size="md" disabled={pending} className="self-start">
            {pending ? "Хадгалж байна…" : hasPassword ? "Нууц үг солих" : "Нууц үг тохируулах"}
          </Btn>
        </form>
      ) : (
        <form action={removeAction} className="flex flex-col gap-4" noValidate>
          <FormError message={state?.message && !state.ok ? state.message : undefined} />
          <p className="text-sm text-[var(--oc-ink2)]">Нууц үгийг устгавал цаашид зөвхөн SMS кодоор нэвтэрнэ.</p>
          {codeField}
          <Btn type="submit" variant="danger" size="md" disabled={pending} className="self-start">
            {pending ? "Устгаж байна…" : "Нууц үг устгах"}
          </Btn>
        </form>
      )}
    </div>
  );
}
