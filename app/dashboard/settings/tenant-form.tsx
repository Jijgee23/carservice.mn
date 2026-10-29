"use client";

import { useActionState } from "react";
import {
  type TenantActionState,
  updateTenantAction,
} from "@/app/_actions/tenant";
import { Field, FormError } from "@/app/_components/auth-shell";
import { Btn, ToggleChip } from "@/app/_components/landing-ops-ui";

type Initial = {
  name: string;
  registerNumber: string;
  email: string;
  phone1: string;
  phone2: string | null;
  acceptsOnlineBooking: boolean;
};

const FIELD_MW = "w-full";

export function TenantForm({ initial }: { initial: Initial }) {
  const [state, formAction, pending] = useActionState<
    TenantActionState,
    FormData
  >(updateTenantAction, null);

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

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
        <Field label="Байгууллага / хувь хүний нэр" htmlFor="name" error={fe.name} className={FIELD_MW}>
          <input
            id="name"
            name="name"
            type="text"
            required
            defaultValue={initial.name}
            className={`auth-input h-11 ${fe.name ? "border-red-500/50" : ""}`}
          />
        </Field>
        <Field
          label="Регистр"
          htmlFor="registerNumber"
          hint="Байгууллага: 7 оронтой тоо · Хувь хүн: ҮҮ99993333"
          error={fe.registerNumber}
          className={FIELD_MW}
        >
          <input
            id="registerNumber"
            name="registerNumber"
            type="text"
            maxLength={10}
            required
            defaultValue={initial.registerNumber}
            className={`auth-input h-11 font-plex-mono ${fe.registerNumber ? "border-red-500/50" : ""}`}
          />
        </Field>
        <Field label="Имэйл" htmlFor="email" error={fe.email} className={FIELD_MW}>
          <input
            id="email"
            name="email"
            type="email"
            required
            defaultValue={initial.email}
            className={`auth-input h-11 ${fe.email ? "border-red-500/50" : ""}`}
          />
        </Field>
        <Field label="Утас 1" htmlFor="phone1" error={fe.phone1} className={FIELD_MW}>
          <input
            id="phone1"
            name="phone1"
            type="tel"
            inputMode="numeric"
            maxLength={8}
            pattern="[0-9]{8}"
            required
            defaultValue={initial.phone1}
            className={`auth-input h-11 font-plex-mono ${fe.phone1 ? "border-red-500/50" : ""}`}
          />
        </Field>
        <Field
          label="Утас 2"
          htmlFor="phone2"
          hint="заавал биш"
          error={fe.phone2}
          className={FIELD_MW}
        >
          <input
            id="phone2"
            name="phone2"
            type="tel"
            inputMode="numeric"
            maxLength={8}
            pattern="[0-9]{8}"
            defaultValue={initial.phone2 ?? ""}
            className="auth-input h-11 font-plex-mono"
          />
        </Field>

        {/* Утас талбаруудын label-тэй мөр зэрэгцэхийн тулд толгойд адил
            өндөртэй хоосон spacer нэмнэ (Утас 2 доор hint байгаа эсэхээс үл
            хамааран toggle/товч INPUT-той нэг эгнээнд зогсоно). */}
        <div className="flex flex-col gap-1.5">
          <span aria-hidden="true" className="text-sm font-medium select-none">
            &nbsp;
          </span>
          <ToggleChip
            name="acceptsOnlineBooking"
            label="Онлайн цаг захиалга"
            defaultChecked={initial.acceptsOnlineBooking}
            className="rounded-lg "
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <span aria-hidden="true" className="text-sm font-medium select-none">
            &nbsp;
          </span>
          <Btn type="submit" disabled={pending} size="md" className="h-11 w-full">
            {pending ? "..." : "Хадгалах"}
          </Btn>
        </div>
      </div>

      <p className="text-xs text-[var(--oc-muted3)] max-w-lg">
        Онлайн цаг захиалга идэвхжүүлбэл байгууллага хэрэглэгчийн вэб дэх каталог
        (/discover)-т харагдаж, үйлчлүүлэгчид онлайнаар цаг захиална.
      </p>
    </form>
  );
}
