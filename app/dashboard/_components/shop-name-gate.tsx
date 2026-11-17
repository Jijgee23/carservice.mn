"use client";

import { useActionState } from "react";
import { saveShopNameAction, type ShopNameState } from "@/app/_actions/tenant-shop-name";
import { Btn } from "@/app/_components/landing-ops-ui";

/**
 * Хувь хүний регистрээр бүртгүүлсэн байгууллагын нэр нь эзний овог нэр байдаг —
 * эзэн dashboard-д нэвтрэхэд засварын нэрээ заавал оруулах, хааж болохгүй
 * dialog (app/dashboard/layout.tsx). Хадгалмагц layout дахин render хийгдэж алга болно.
 */
export function ShopNameGate({ currentName }: { currentName: string }) {
  const [state, formAction, pending] = useActionState<ShopNameState, FormData>(
    saveShopNameAction,
    null,
  );
  return (
    <div className="fixed inset-0 z-[110] flex items-start justify-center overflow-y-auto bg-black/60 p-4 backdrop-blur-sm sm:items-center">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="shop-name-gate-title"
        className="w-full max-w-lg rounded-2xl border border-[var(--oc-line)] bg-[var(--oc-panel)] p-5 shadow-2xl sm:p-6"
      >
        <h2 id="shop-name-gate-title" className="text-lg font-semibold text-[var(--oc-ink)]">
          Засварын газрынхаа нэрийг оруулна уу
        </h2>
        <p className="mt-1 mb-5 text-sm text-[var(--oc-muted)]">
          Жолооч нар газрын зураг, цаг захиалга дээр танай засварыг энэ нэрээр харна.
          Одоогоор таны овог нэр (<span className="font-medium text-[var(--oc-ink2)]">{currentName}</span>)
          харагдаж байна.
        </p>
        <form action={formAction} className="flex flex-col gap-4">
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-[var(--oc-ink2)]">Засварын нэр</span>
            <input
              name="shopName"
              type="text"
              required
              minLength={2}
              maxLength={100}
              autoFocus
              placeholder="Жишээ: Бат Авто Засвар"
              className="auth-input h-11"
            />
          </label>
          {state && !state.ok && state.message ? (
            <p role="alert" className="text-sm text-red-400">
              {state.message}
            </p>
          ) : null}
          <div className="flex justify-end">
            <Btn type="submit" disabled={pending}>
              {pending ? "Хадгалж байна..." : "Хадгалах"}
            </Btn>
          </div>
        </form>
      </div>
    </div>
  );
}
