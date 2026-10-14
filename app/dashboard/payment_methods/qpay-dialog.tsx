"use client";

import { useActionState, useEffect, useState } from "react";
import {
  deleteTenantQPayAction,
  saveTenantQPayAction,
  type TenantQPayActionState,
} from "@/app/_actions/tenant-qpay";
import { Field, FormError } from "@/app/_components/auth-shell";
import { ConfirmForm } from "@/app/_components/confirm-form";
import { Btn } from "@/app/_components/landing-ops-ui";
import { DialogShell } from "@/app/dashboard/_components/pos-simulator";

/** Хадгалсан QPay тохиргоо (нууц үг хэзээ ч клиент рүү ирэхгүй — зөвхөн байгаа эсэх). */
export type QPayInitial = {
  username: string;
  invoiceCode: string;
  callbackUrl: string | null;
  enabled: boolean;
  hasPassword: boolean;
};

const FOCUS_RING =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--oc-accent)] focus-visible:ring-offset-1 focus-visible:ring-offset-transparent";

/**
 * «Төлбөрийн аргууд» хүснэгтийн QPay мөрийн тохиргоо (засварын хуудасны төлбөрийн merchant credentials).
 * Зөвхөн админ. Body нь нээгдэх бүрт шинээр mount хийгдэж state эхэлнэ.
 */
export function QPayDialog({ open, initial, onClose }: { open: boolean; initial: QPayInitial | null; onClose: () => void }) {
  const title = initial ? "QPay тохиргоо засах" : "QPay тохируулах";
  return (
    <DialogShell open={open} onClose={onClose} label={title} className="w-[min(94vw,32rem)] max-h-[90vh]">
      <DialogBody key={initial ? "edit" : "new"} initial={initial} title={title} onClose={onClose} />
    </DialogShell>
  );
}

function DialogBody({ initial, title, onClose }: { initial: QPayInitial | null; title: string; onClose: () => void }) {
  const [state, formAction, pending] = useActionState<TenantQPayActionState, FormData>(saveTenantQPayAction, null);

  const [username, setUsername] = useState(initial?.username ?? "");
  const [password, setPassword] = useState("");
  const [invoiceCode, setInvoiceCode] = useState(initial?.invoiceCode ?? "");
  const [callbackUrl, setCallbackUrl] = useState(initial?.callbackUrl ?? "");
  const [enabled, setEnabled] = useState(initial?.enabled ?? true);
  const [showPassword, setShowPassword] = useState(false);

  useEffect(() => {
    if (state?.ok) onClose();
  }, [state, onClose]);

  const fe = state?.fieldErrors ?? {};
  const isConfigured = Boolean(initial);

  return (
    <>
      <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-[var(--oc-line)] shrink-0">
        <h2 className="font-semibold text-[var(--oc-ink)] min-w-0 truncate">{title}</h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Хаах"
          className={`w-8 h-8 shrink-0 flex items-center justify-center rounded-lg text-[var(--oc-muted3)] hover:text-[var(--oc-ink)] hover:bg-white/[0.08] transition-colors ${FOCUS_RING}`}
        >
          <svg aria-hidden="true" viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round">
            <path d="M4 4l8 8M12 4l-8 8" />
          </svg>
        </button>
      </div>

      <div className="flex flex-col gap-4 p-5 overflow-y-auto">
        <p className="text-xs text-[var(--oc-muted3)]">
          Засварын хуудасны төлбөрийг QPay-ээр авах байгууллагын өөрийн merchant эрх. Цаг захиалгын хураамжийн (платформын) QPay-аас
          тусдаа.
        </p>
        <form id="qpay-form" action={formAction} className="flex flex-col gap-4" noValidate>
          <FormError message={state?.message && !state.ok ? state.message : undefined} />

          <div className="grid gap-3.5 sm:grid-cols-2">
            <Field label="Username" htmlFor="qp-username" error={fe.username} className="min-w-0">
              <input
                id="qp-username"
                name="username"
                type="text"
                required
                autoComplete="off"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className={`auth-input ${fe.username ? "border-red-500/50" : ""}`}
                placeholder="QPay merchant username"
              />
            </Field>

            <Field
              label="Password"
              htmlFor="qp-password"
              hint={initial?.hasPassword ? "Хоосон үлдээвэл хуучин үлдэнэ" : "QPay merchant нууц үг"}
              error={fe.password}
              className="min-w-0"
            >
              <div className="relative">
                <input
                  id="qp-password"
                  name="password"
                  type={showPassword ? "text" : "password"}
                  required={!isConfigured}
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className={`auth-input pr-14 ${fe.password ? "border-red-500/50" : ""}`}
                  placeholder={initial?.hasPassword ? "••••••••" : "QPay password"}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--oc-muted3)] hover:text-[var(--oc-ink2)] transition-colors text-xs"
                >
                  {showPassword ? "Нуух" : "Харах"}
                </button>
              </div>
            </Field>

            <Field label="Invoice code" htmlFor="qp-invoiceCode" error={fe.invoiceCode} className="min-w-0">
              <input
                id="qp-invoiceCode"
                name="invoiceCode"
                type="text"
                required
                autoComplete="off"
                value={invoiceCode}
                onChange={(e) => setInvoiceCode(e.target.value)}
                className={`auth-input ${fe.invoiceCode ? "border-red-500/50" : ""}`}
                placeholder="QPay invoice code"
              />
            </Field>

            <Field label="Callback URL" htmlFor="qp-callbackUrl" hint="заавал биш" error={fe.callbackUrl} className="min-w-0">
              <input
                id="qp-callbackUrl"
                name="callbackUrl"
                type="url"
                value={callbackUrl}
                onChange={(e) => setCallbackUrl(e.target.value)}
                className="auth-input"
                placeholder="https://your-domain.com/qpay-callback"
              />
            </Field>
          </div>

          <label className="flex items-start gap-3 p-3.5 rounded-[10px] border border-[var(--oc-line)] bg-[var(--oc-panel2)] cursor-pointer hover:border-[var(--oc-line2)]">
            <input
              type="checkbox"
              name="enabled"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
              value="on"
              className="mt-0.5 accent-[var(--oc-accent)]"
            />
            <div className="flex-1">
              <div className="text-sm font-medium text-[var(--oc-ink2)]">Идэвхтэй</div>
              <div className="text-xs text-[var(--oc-muted3)] mt-0.5">
                Засварын хуудсанд QPay QR үүсгэх боломжтой болно. Идэвхгүй болговол одоо байгаа QR-ууд хэвээр, шинээр үүсгэхгүй.
              </div>
            </div>
          </label>
          {!enabled ? <input type="hidden" name="enabled" value="off" /> : null}
        </form>

        <div className="flex flex-wrap items-center gap-2 pt-1">
          <Btn type="submit" form="qpay-form" size="md" disabled={pending} className={FOCUS_RING}>
            {pending ? "Хадгалж байна…" : "Хадгалах"}
          </Btn>
          <Btn type="button" variant="ghost" size="md" onClick={onClose} className={FOCUS_RING}>
            Болих
          </Btn>
          {isConfigured ? (
            <ConfirmForm
              className="ml-auto"
              action={async () => {
                await deleteTenantQPayAction();
                onClose();
              }}
              message="QPay тохиргоог устгах уу? Засварын хуудсанд QPay-ээр төлбөр авах боломжгүй болно."
            >
              <Btn type="submit" variant="danger" size="md">
                Тохиргоог устгах
              </Btn>
            </ConfirmForm>
          ) : null}
        </div>
      </div>
    </>
  );
}
