"use client";

import { startTransition, useActionState, useState } from "react";
import {
  type AccountAuthState,
  accountLoginAction,
} from "@/app/_actions/account-auth";
import { Field, FormError, SubmitButton } from "@/app/_components/landing-ops-ui";
import { ResendOtpButton } from "@/app/_components/resend-otp-button";

export function AccountLoginForm() {
  const [state, formAction, pending] = useActionState<AccountAuthState, FormData>(
    accountLoginAction,
    null,
  );
  const awaiting = Boolean(state?.awaitingOtp);
  const fe = state?.fieldErrors ?? {};

  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  // «Нэг удаагийн кодоор» (OTP) эсвэл «Нууц үгээр» — нууц үг тохируулсан хэрэглэгчид л хоёр дахь нь ажиллана.
  const [mode, setMode] = useState<"otp" | "password">("otp");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  const lockedPhone = state?.phone ?? phone;

  return (
    <form action={formAction} className="flex flex-col gap-5" noValidate>
      {awaiting && state?.message ? (
        <div className="bg-[var(--oc-accent)]/10 border border-[var(--oc-accent)]/25 rounded-[10px] px-4 py-3 text-sm text-[var(--oc-ink2)]">
          {state.message}
        </div>
      ) : (
        <FormError message={state?.message && !state.ok ? state.message : undefined} />
      )}

      {!awaiting ? (
        <div role="tablist" aria-label="Нэвтрэх арга" className="grid grid-cols-2 gap-1 rounded-[10px] border border-[var(--oc-line)] p-1">
          {(
            [
              ["otp", "Нэг удаагийн кодоор"],
              ["password", "Нууц үгээр"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={mode === value}
              onClick={() => setMode(value)}
              className={`rounded-lg py-2 text-sm transition-colors ${mode === value ? "bg-[var(--oc-accent)]/15 text-[var(--oc-ink)] ring-1 ring-[var(--oc-accent)]/40 font-medium" : "text-[var(--oc-muted3)] hover:text-[var(--oc-ink)]"}`}
            >
              {label}
            </button>
          ))}
        </div>
      ) : null}

      {!awaiting ? (
        <>
          {mode === "password" ? <input type="hidden" name="mode" value="password" /> : null}
          <Field label="Утасны дугаар" htmlFor="phone" error={fe.phone}>
            <input
              id="phone"
              name="phone"
              type="tel"
              inputMode="numeric"
              autoComplete="tel"
              required
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className={`auth-input ${fe.phone ? "border-red-500/50" : ""}`}
              placeholder="99112233"
            />
          </Field>
          {mode === "password" ? (
            <>
              <Field label="Нууц үг" htmlFor="password" error={fe.password}>
                <div className="relative">
                  <input
                    id="password"
                    name="password"
                    type={showPassword ? "text" : "password"}
                    autoComplete="current-password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className={`auth-input pr-14 ${fe.password ? "border-red-500/50" : ""}`}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-[var(--oc-muted3)] hover:text-[var(--oc-ink2)]"
                  >
                    {showPassword ? "Нуух" : "Харах"}
                  </button>
                </div>
              </Field>
              <SubmitButton pending={pending}>Нэвтрэх →</SubmitButton>
              <p className="text-center text-xs text-[var(--oc-muted3)]">
                Нууц үгээ мартсан эсвэл тохируулаагүй бол{" "}
                <button type="button" onClick={() => setMode("otp")} className="underline hover:text-[var(--oc-accent-hi)]">
                  нэг удаагийн кодоор нэвтэрнэ
                </button>{" "}
                үү. Нэвтэрсний дараа «Нууц үг» хэсэгт тохируулна.
              </p>
            </>
          ) : (
            <SubmitButton pending={pending}>Код авах →</SubmitButton>
          )}
        </>
      ) : (
        <>
          <input type="hidden" name="phone" value={lockedPhone} />
          <Field label="Баталгаажуулах код" htmlFor="otpCode" error={fe.otpCode}>
            <input
              id="otpCode"
              name="otpCode"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              required
              autoFocus
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              className={`auth-input text-center text-lg tracking-[0.4em] ${fe.otpCode ? "border-red-500/50" : ""}`}
              placeholder="000000"
            />
          </Field>
          <SubmitButton pending={pending}>Нэвтрэх →</SubmitButton>
          <ResendOtpButton
            pending={pending}
            onResend={() => {
              setCode("");
              const fd = new FormData();
              fd.set("phone", lockedPhone);
              startTransition(() => formAction(fd));
            }}
          />
          <a
            href="/login"
            className="text-center text-xs text-[var(--oc-muted3)] hover:text-[var(--oc-accent-hi)] transition-colors"
          >
            ← Өөр дугаар оруулах
          </a>
        </>
      )}
    </form>
  );
}
