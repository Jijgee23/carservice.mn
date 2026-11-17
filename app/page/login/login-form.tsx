"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import {
  type ActionState,
  type ActivateAccountState,
  type LoginEmailState,
  activateAccountAction,
  checkLoginEmailAction,
  signInAction,
} from "@/app/_actions/auth";
import { Field, FormError, SubmitButton } from "@/app/_components/landing-ops-ui";

/**
 * Нэвтрэх — имэйл эсвэл утасны дугаараар эхэлсэн (progressive) урсгал:
 *   1) Имэйл / утас оруулна → checkLoginEmailAction
 *   2a) Бүртгэлтэй + идэвхжсэн → нууц үг асууна (signInAction)
 *   2b) Бүртгэлтэй ч нууц үггүй → OTP + шинэ нууц үг (activateAccountAction)
 *   2c) Бүртгэлгүй → мессеж + бүртгүүлэх холбоос
 */
export function LoginForm() {
  const [checkState, checkAction, checkPending] = useActionState<
    LoginEmailState,
    FormData
  >(checkLoginEmailAction, null);

  const status = checkState?.ok ? checkState.status : undefined;
  const identifier = checkState?.identifier ?? "";

  if (status === "password") {
    return <PasswordStep identifier={identifier} />;
  }
  if (status === "activate") {
    return (
      <ActivateStep
        identifier={identifier}
        maskedPhone={checkState?.maskedPhone ?? ""}
        notice={checkState?.message}
      />
    );
  }
  if (status === "not_registered") {
    return <NotRegistered message={checkState?.message} />;
  }
  return (
    <IdentifierStep state={checkState} formAction={checkAction} pending={checkPending} />
  );
}

// --- 1-р шат: имэйл эсвэл утас ------------------------------------------------

function IdentifierStep({
  state,
  formAction,
  pending,
}: {
  state: LoginEmailState;
  formAction: (fd: FormData) => void;
  pending: boolean;
}) {
  const fe = state?.fieldErrors ?? {};
  const [identifier, setIdentifier] = useState("");
  return (
    <form action={formAction} className="flex flex-col gap-5" noValidate>
      <Field
        label="Имэйл эсвэл утасны дугаар"
        htmlFor="identifier"
        error={fe.identifier}
      >
        <input
          id="identifier"
          name="identifier"
          type="text"
          required
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          autoFocus
          value={identifier}
          onChange={(e) => setIdentifier(e.target.value)}
          className={`auth-input ${fe.identifier ? "border-red-500/50" : ""}`}
          placeholder="manager@service.mn эсвэл 99112233"
        />
      </Field>

      <SubmitButton pending={pending}>Үргэлжлүүлэх →</SubmitButton>

      <div className="flex items-center justify-between gap-3">
        <Link
          href="/page/activate"
          className="text-xs text-[var(--oc-accent)] hover:text-[var(--oc-accent-hi)] transition-colors"
        >
          Нууц үг үүсгэх
        </Link>
        <Link
          href="/page/forgot"
          className="text-xs text-[var(--oc-accent)] hover:text-[var(--oc-accent-hi)] transition-colors"
        >
          Нууц үг сэргээх
        </Link>
      </div>

      {/* Progressive урсгалыг тайлбарлана — нууц үг дараагийн шатанд асуугдана */}
      <p className="text-center text-xs text-[var(--oc-muted3)]">
        Дараагийн алхамд нууц үгээ оруулж нэвтэрнэ. Анх удаагийн нэвтрэлт бол
        утсанд тань баталгаажуулах код ирнэ.
      </p>
    </form>
  );
}

// --- 2a: нууц үгээр нэвтрэх --------------------------------------------------

function PasswordStep({ identifier }: { identifier: string }) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(
    signInAction,
    null,
  );
  const fe = state?.fieldErrors ?? {};
  const [showPassword, setShowPassword] = useState(false);
  const [password, setPassword] = useState("");

  return (
    <form action={formAction} className="flex flex-col gap-5" noValidate>
      <input type="hidden" name="identifier" value={identifier} />
      <FormError message={state?.message} />

      <div className="rounded-[10px] border border-[var(--oc-line)] bg-[var(--oc-panel)] px-4 py-2.5 text-sm text-[var(--oc-muted2)]">
        {identifier}
      </div>

      <Field label="Нууц үг" htmlFor="password" error={fe.password}>
        <div className="relative">
          <input
            id="password"
            name="password"
            type={showPassword ? "text" : "password"}
            required
            autoComplete="current-password"
            autoFocus
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={`auth-input pr-14 ${fe.password ? "border-red-500/50" : ""}`}
            placeholder="••••••••"
          />
          <button
            type="button"
            onClick={() => setShowPassword(!showPassword)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--oc-muted3)] hover:text-[var(--oc-muted)] transition-colors text-xs"
          >
            {showPassword ? "Нуух" : "Харах"}
          </button>
        </div>
      </Field>

      <SubmitButton pending={pending}>Нэвтрэх →</SubmitButton>

      <div className="flex items-center justify-between gap-3">
        <a
          href="/page/login"
          className="text-xs text-[var(--oc-muted3)] hover:text-[var(--oc-accent-hi)] transition-colors"
        >
          ← Өөр нэвтрэх нэр
        </a>
        <Link
          href="/page/forgot"
          className="text-xs text-[var(--oc-accent)] hover:text-[var(--oc-accent-hi)] transition-colors"
        >
          Нууц үг мартсан уу?
        </Link>
      </div>
    </form>
  );
}

// --- 2b: анхны нэвтрэлт — OTP + шинэ нууц үг ---------------------------------

function ActivateStep({
  identifier,
  maskedPhone,
  notice,
}: {
  identifier: string;
  maskedPhone: string;
  notice?: string;
}) {
  const [state, formAction, pending] = useActionState<
    ActivateAccountState,
    FormData
  >(activateAccountAction, null);
  const fe = state?.fieldErrors ?? {};
  const [showPassword, setShowPassword] = useState(false);
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");

  return (
    <form action={formAction} className="flex flex-col gap-5" noValidate>
      <input type="hidden" name="identifier" value={identifier} />

      <div className="bg-[var(--oc-accent)]/10 border border-[var(--oc-accent)]/25 rounded-[10px] px-4 py-3 text-sm text-[var(--oc-ink2)]">
        Анх удаа нэвтрэх тул нууц үгээ үүсгэнэ үү.{" "}
        {notice ?? `Утас ${maskedPhone} руу 6 оронтой код илгээлээ.`}
      </div>

      {!state?.ok && state?.message ? <FormError message={state.message} /> : null}

      <Field
        label="Баталгаажуулах код"
        htmlFor="code"
        error={fe.code}
        hint="6 оронтой тоо"
      >
        <input
          id="code"
          name="code"
          type="text"
          inputMode="numeric"
          pattern="\d{6}"
          maxLength={6}
          autoComplete="one-time-code"
          required
          autoFocus
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D+/g, ""))}
          className={`auth-input font-plex-mono tracking-[0.5em] text-center ${fe.code ? "border-red-500/50" : ""}`}
          placeholder="••••••"
        />
      </Field>

      <Field label="Нууц үг" htmlFor="new-password" hint="8+ тэмдэгт" error={fe.password}>
        <div className="relative">
          <input
            id="new-password"
            name="password"
            type={showPassword ? "text" : "password"}
            required
            minLength={8}
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={`auth-input pr-14 ${fe.password ? "border-red-500/50" : ""}`}
            placeholder="••••••••"
          />
          <button
            type="button"
            onClick={() => setShowPassword(!showPassword)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--oc-muted3)] hover:text-[var(--oc-muted)] transition-colors text-xs"
          >
            {showPassword ? "Нуух" : "Харах"}
          </button>
        </div>
      </Field>

      <Field
        label="Нууц үг давтан"
        htmlFor="new-password-confirm"
        error={fe.passwordConfirm}
      >
        <input
          id="new-password-confirm"
          name="passwordConfirm"
          type="password"
          required
          minLength={8}
          autoComplete="new-password"
          value={passwordConfirm}
          onChange={(e) => setPasswordConfirm(e.target.value)}
          className={`auth-input ${fe.passwordConfirm ? "border-red-500/50" : ""}`}
          placeholder="••••••••"
        />
      </Field>

      <SubmitButton pending={pending}>Нууц үг үүсгэж нэвтрэх</SubmitButton>

      <a
        href="/page/login"
        className="text-center text-xs text-[var(--oc-muted3)] hover:text-[var(--oc-accent-hi)] transition-colors"
      >
        ← Өөр нэвтрэх нэр
      </a>
    </form>
  );
}

// --- 2c: бүртгэлгүй ----------------------------------------------------------

function NotRegistered({ message }: { message?: string }) {
  return (
    <div className="flex flex-col gap-4 text-center">
      <div className="bg-[var(--oc-accent)]/10 border border-[var(--oc-accent)]/25 rounded-[10px] px-4 py-3 text-sm text-[var(--oc-ink2)]">
        {message ?? "Энэ имэйл / утас бүртгэлгүй байна."}
      </div>
      <Link
        href="/page/signup"
        className="text-sm font-medium text-[var(--oc-accent)] hover:text-[var(--oc-accent-hi)] transition-colors"
      >
        Байгууллага бүртгүүлэх →
      </Link>
      <a
        href="/page/login"
        className="text-xs text-[var(--oc-muted3)] hover:text-[var(--oc-accent-hi)] transition-colors"
      >
        ← Өөр имэйл / утас оруулах
      </a>
    </div>
  );
}
