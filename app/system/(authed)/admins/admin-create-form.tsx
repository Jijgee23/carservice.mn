"use client";

import { useActionState } from "react";
import {
  createSuperAdminAction,
  type SuperAdminActionState,
} from "@/app/_actions/system-admins";
import { Btn, Field, FormError } from "@/app/_components/landing-ops-ui";

export function AdminCreateForm() {
  const [state, formAction, pending] = useActionState<
    SuperAdminActionState,
    FormData
  >(createSuperAdminAction, null);
  const fe = state?.fieldErrors ?? {};
  // Амжилттай урьсны дараа form-ыг тэг болгох — state.message нь тогтмол
  // (Math.random() шиг impure биш) тул react-hooks/purity зөрчихгүй.
  const formKey = state?.ok ? `created-${state.message ?? ""}` : "create";

  return (
    <form
      key={formKey}
      action={formAction}
      className="flex flex-col gap-3"
      noValidate
    >
      {state?.ok && state.message ? (
        <div className="bg-[var(--oc-ok)]/10 border border-[var(--oc-ok)]/25 rounded-lg px-3 py-2 text-sm text-[var(--oc-ok)]">
          {state.message}
        </div>
      ) : null}
      {state?.message && !state.ok ? (
        <FormError message={state.message} />
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Овог" htmlFor="sa-lastName" error={fe.lastName}>
          <input
            id="sa-lastName"
            name="lastName"
            type="text"
            required
            defaultValue={state?.values?.lastName}
            className={`auth-input ${fe.lastName ? "border-red-500/50" : ""}`}
          />
        </Field>
        <Field label="Нэр" htmlFor="sa-firstName" error={fe.firstName}>
          <input
            id="sa-firstName"
            name="firstName"
            type="text"
            required
            defaultValue={state?.values?.firstName}
            className={`auth-input ${fe.firstName ? "border-red-500/50" : ""}`}
          />
        </Field>
      </div>

      <Field label="Имэйл" htmlFor="sa-email" error={fe.email}>
        <input
          id="sa-email"
          name="email"
          type="email"
          required
          defaultValue={state?.values?.email}
          className={`auth-input ${fe.email ? "border-red-500/50" : ""}`}
        />
      </Field>

      <Field
        label="Төрөл"
        htmlFor="sa-kind"
        hint="System ажилтан зөвхөн мобайл апп-аар нэвтэрч харилцагч бүртгэх, засах эрхтэй"
      >
        <select id="sa-kind" name="kind" defaultValue={state?.values?.kind ?? "STAFF"} className="auth-input">
          <option value="STAFF">System ажилтан (мобайл — харилцагч бүртгэх/засах)</option>
          <option value="ROOT">Бүрэн admin (вэб /system + мобайл)</option>
        </select>
      </Field>

      <Field
        label="Нууц үг"
        htmlFor="sa-password"
        hint="хамгийн багадаа 8 тэмдэгт"
        error={fe.password}
      >
        <input
          id="sa-password"
          name="password"
          type="password"
          required
          minLength={8}
          className={`auth-input ${fe.password ? "border-red-500/50" : ""}`}
        />
      </Field>

      <div>
        <Btn type="submit" disabled={pending}>
          {pending ? "Нэмж..." : "Нэмэх"}
        </Btn>
      </div>
    </form>
  );
}
