"use client";

import { useActionState } from "react";
import {
  type ProfileActionState,
  updateProfileAction,
} from "@/app/_actions/profile";
import { Field, FormError } from "@/app/_components/auth-shell";
import { Btn } from "@/app/_components/landing-ops-ui";

type Initial = {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
};

const FIELD_MW = "max-w-xs";

export function ProfileForm({ initial }: { initial: Initial }) {
  const [state, formAction, pending] = useActionState<
    ProfileActionState,
    FormData
  >(updateProfileAction, null);

  const fe = state?.fieldErrors ?? {};

  return (
    <form action={formAction} className="flex flex-col gap-4" noValidate>
      {state?.ok && state.message ? (
        <div className="bg-[var(--oc-ok)]/10 border border-[var(--oc-ok)]/25 rounded-lg px-3 py-2 text-sm text-[var(--oc-ok)]">
          {state.message}
        </div>
      ) : null}
      <FormError
        message={state?.message && !state.ok ? state.message : undefined}
      />

      <div className="grid gap-3.5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        <Field label="Овог" htmlFor="lastName" error={fe.lastName} className={FIELD_MW}>
          <input
            id="lastName"
            name="lastName"
            type="text"
            required
            defaultValue={initial.lastName}
            className={`auth-input ${fe.lastName ? "border-red-500/50" : ""}`}
          />
        </Field>
        <Field label="Нэр" htmlFor="firstName" error={fe.firstName} className={FIELD_MW}>
          <input
            id="firstName"
            name="firstName"
            type="text"
            required
            defaultValue={initial.firstName}
            className={`auth-input ${fe.firstName ? "border-red-500/50" : ""}`}
          />
        </Field>
        <Field label="Имэйл" htmlFor="email" hint="Заавал биш" error={fe.email} className={FIELD_MW}>
          <input
            id="email"
            name="email"
            type="email"
            defaultValue={initial.email}
            className={`auth-input ${fe.email ? "border-red-500/50" : ""}`}
          />
        </Field>
        <Field label="Утас" htmlFor="phone" error={fe.phone} className={FIELD_MW}>
          <input
            id="phone"
            name="phone"
            type="tel"
            inputMode="numeric"
            maxLength={8}
            pattern="[0-9]{8}"
            required
            defaultValue={initial.phone}
            className={`auth-input ${fe.phone ? "border-red-500/50" : ""}`}
          />
        </Field>
      </div>

      <div className="flex pt-2">
        <Btn type="submit" disabled={pending}>
          {pending ? "..." : "Хадгалах"}
        </Btn>
      </div>
    </form>
  );
}
