"use client";

import { useActionState, useState } from "react";
import {
  type QuoteRequestActionState,
  submitQuoteRequestAction,
} from "@/app/_actions/quote-requests";
import { MODULE_LIMIT_CODES, PLAN_LIMIT_META } from "@/lib/plan-limits";

type Defaults = {
  orgName?: string;
  contactName?: string;
  phone?: string;
  email?: string;
};

/**
 * Энтерпрайз багцын үнийн саналын хүсэлтийн маягт — нүүр хуудас (/page/quote)
 * ба dashboard (/dashboard/settings/subscription/quote) хоёуланд.
 */
export function QuoteRequestForm({
  source,
  defaults = {},
}: {
  source: "public" | "dashboard";
  defaults?: Defaults;
}) {
  // Анхдагчаар бүх модуль сонгогдсон — хэрэггүйгээ хасна.
  const [selected, setSelected] = useState<string[]>([...MODULE_LIMIT_CODES]);
  const [state, formAction, pending] = useActionState<QuoteRequestActionState, FormData>(
    async (prev, fd) => {
      const next = await submitQuoteRequestAction(prev, fd);
      // Алдаатай бол сонгосон модулиудыг сэргээнэ (маягт цэвэрлэгдэхээс хамгаална).
      if (next?.values) setSelected(next.values.modules);
      return next;
    },
    null,
  );
  const fe = state?.fieldErrors ?? {};
  const v = state?.values;

  if (state?.ok) {
    return (
      <div className="rounded-[10px] border border-[var(--oc-line)] bg-[var(--oc-panel)] p-8 text-center">
        <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-[var(--oc-ok)]/15 text-[var(--oc-ok)]">
          ✓
        </div>
        <h2 className="text-lg font-semibold text-[var(--oc-ink)]">Хүсэлт илгээгдлээ</h2>
        <p className="mt-2 text-sm text-[var(--oc-muted3)]">
          Таны үнийн саналын хүсэлтийг хүлээн авлаа. Манай баг удахгүй тантай холбогдоно.
        </p>
      </div>
    );
  }

  const toggle = (code: string) =>
    setSelected((cur) => (cur.includes(code) ? cur.filter((c) => c !== code) : [...cur, code]));

  return (
    <form key={state ? JSON.stringify(state.values ?? {}) : "init"} action={formAction} className="flex flex-col gap-5">
      <input type="hidden" name="source" value={source} />
      {/* Honeypot — хүнд харагдахгүй, bot бөглөвөл хүсэлт хадгалагдахгүй. */}
      <input
        type="text"
        name="website"
        tabIndex={-1}
        autoComplete="off"
        aria-hidden="true"
        className="absolute -left-[9999px] h-0 w-0 opacity-0"
      />

      <fieldset>
        <legend className="text-sm font-semibold text-[var(--oc-ink)]">Хэрэгтэй модулиуд</legend>
        <p className="mt-0.5 text-xs text-[var(--oc-muted3)]">
          Засварын хуудас, үйлчлүүлэгч, машин, үйлчилгээ, ажилтан, төлбөр, касс үндсэн хэсэгт багтсан.
        </p>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {MODULE_LIMIT_CODES.map((code) => {
            const meta = PLAN_LIMIT_META[code];
            const on = selected.includes(code);
            return (
              <label
                key={code}
                className={`flex cursor-pointer items-start gap-2.5 rounded-lg border px-3 py-2.5 transition-colors ${
                  on
                    ? "border-[var(--oc-accent)]/60 bg-[var(--oc-accent)]/[0.06]"
                    : "border-[var(--oc-line)] hover:border-[var(--oc-muted4)]"
                }`}
              >
                <input
                  type="checkbox"
                  name="modules"
                  value={code}
                  checked={on}
                  onChange={() => toggle(code)}
                  className="mt-0.5 accent-[var(--oc-accent)]"
                />
                <span>
                  <span className="block text-[13px] font-medium text-[var(--oc-ink2)]">{meta.label}</span>
                  <span className="block text-[11.5px] text-[var(--oc-muted3)]">{meta.description}</span>
                </span>
              </label>
            );
          })}
        </div>
        {fe.modules ? <p className="mt-1.5 text-xs text-red-400 light:text-red-700">{fe.modules}</p> : null}
      </fieldset>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Байгууллагын нэр *" name="orgName" defaultValue={v?.orgName ?? defaults.orgName} error={fe.orgName} maxLength={120} />
        <Field label="Холбогдох хүн *" name="contactName" defaultValue={v?.contactName ?? defaults.contactName} error={fe.contactName} maxLength={80} />
        <Field label="Утас *" name="phone" defaultValue={v?.phone ?? defaults.phone} error={fe.phone} inputMode="tel" placeholder="99112233" />
        <Field label="Имейл" name="email" type="email" defaultValue={v?.email ?? defaults.email} error={fe.email} maxLength={120} />
        <Field label="Салбарын тоо" name="branchCount" defaultValue={v?.branchCount} inputMode="numeric" error={fe.branchCount} placeholder="ж: 5" />
      </div>

      <label className="text-xs text-[var(--oc-muted)]">
        Нэмэлт тайлбар
        <textarea
          name="message"
          defaultValue={v?.message}
          rows={3}
          maxLength={2000}
          placeholder="Ажилтны тоо, тусгай шаардлага, интеграц г.м."
          className="auth-input mt-1 w-full resize-none"
        />
        {fe.message ? <span className="mt-1 block text-red-400 light:text-red-700">{fe.message}</span> : null}
      </label>

      {state && !state.ok && state.message ? (
        <p className="text-sm text-red-400 light:text-red-700">{state.message}</p>
      ) : null}

      <button
        type="submit"
        disabled={pending}
        className="self-start rounded-lg bg-[var(--oc-accent)] px-5 py-2.5 text-sm font-semibold text-[var(--oc-on-accent)] transition-colors hover:bg-[var(--oc-accent-hi)] disabled:cursor-not-allowed disabled:opacity-60"
      >
        {pending ? "Илгээж байна..." : "Үнийн санал авах"}
      </button>
    </form>
  );
}

function Field({
  label,
  name,
  error,
  ...rest
}: {
  label: string;
  name: string;
  error?: string;
} & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="text-xs text-[var(--oc-muted)]">
      {label}
      <input name={name} className={`auth-input mt-1 w-full ${error ? "border-red-500/50" : ""}`} {...rest} />
      {error ? <span className="mt-1 block text-red-400 light:text-red-700">{error}</span> : null}
    </label>
  );
}
