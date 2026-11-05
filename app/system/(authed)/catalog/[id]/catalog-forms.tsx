"use client";

import { useActionState, useEffect, useRef } from "react";
import {
  type SystemCatalogState,
  mergeCatalogItemAction,
  updateCatalogItemAction,
} from "@/app/_actions/system-catalog";
import { useToast } from "@/app/_components/toast";

function useResultToast(state: SystemCatalogState) {
  const toast = useToast();
  const handled = useRef<SystemCatalogState>(null);
  useEffect(() => {
    if (!state || state === handled.current) return;
    handled.current = state;
    if (state.ok) toast.success(state.message ?? "Хадгалагдлаа.");
    else if (state.message) toast.error(state.message);
  }, [state, toast]);
}

const BTN =
  "self-end rounded-lg bg-[var(--oc-accent)] px-4 py-2 text-sm font-medium text-[var(--oc-on-accent)] transition-colors hover:bg-[var(--oc-accent-hi)] disabled:opacity-60 disabled:cursor-not-allowed";

export function CatalogItemForm({
  initial,
  categories,
}: {
  initial: {
    id: string;
    name: string;
    code: string;
    barcode: string;
    isGoods: boolean;
    unitName: string;
    price: string;
    categoryId: string;
    description: string;
    isActive: boolean;
  };
  categories: { id: string; name: string }[];
}) {
  const [state, formAction, pending] = useActionState<SystemCatalogState, FormData>(updateCatalogItemAction, null);
  useResultToast(state);
  const fe = state?.fieldErrors ?? {};

  return (
    <form action={formAction} className="mt-5 flex flex-col gap-3">
      <input type="hidden" name="id" value={initial.id} />
      <label className="text-xs text-[var(--oc-muted)]">
        Нэр
        <input name="name" defaultValue={initial.name} maxLength={200} className="auth-input mt-1 w-full" />
        {fe.name ? <span className="mt-1 block text-red-400 light:text-red-700">{fe.name}</span> : null}
      </label>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="text-xs text-[var(--oc-muted)]">
          Код
          <input name="code" defaultValue={initial.code} className="auth-input mt-1 w-full uppercase font-plex-mono" />
        </label>
        <label className="text-xs text-[var(--oc-muted)]">
          Нэгж
          <input name="unitName" defaultValue={initial.unitName} className="auth-input mt-1 w-full" />
          {fe.unitName ? <span className="mt-1 block text-red-400 light:text-red-700">{fe.unitName}</span> : null}
        </label>
        <label className="text-xs text-[var(--oc-muted)]">
          Санал болгох үнэ (₮)
          <input name="price" defaultValue={initial.price} inputMode="decimal" className="auth-input mt-1 w-full font-plex-mono" />
          {fe.price ? <span className="mt-1 block text-red-400 light:text-red-700">{fe.price}</span> : null}
        </label>
      </div>
      {initial.isGoods ? (
        <label className="text-xs text-[var(--oc-muted)]">
          Баркод
          <input name="barcode" defaultValue={initial.barcode} maxLength={64} className="auth-input mt-1 w-full font-plex-mono" />
          {fe.barcode ? <span className="mt-1 block text-red-400 light:text-red-700">{fe.barcode}</span> : null}
        </label>
      ) : null}
      <label className="text-xs text-[var(--oc-muted)]">
        Системийн ангилал
        <select name="categoryId" defaultValue={initial.categoryId} className="auth-input mt-1 w-full">
          <option value="">—</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        {fe.categoryId ? <span className="mt-1 block text-red-400 light:text-red-700">{fe.categoryId}</span> : null}
      </label>
      <label className="text-xs text-[var(--oc-muted)]">
        Тайлбар
        <textarea name="description" defaultValue={initial.description} rows={2} className="auth-input mt-1 w-full resize-none" />
      </label>
      <label className="inline-flex items-center gap-2 text-sm text-[var(--oc-muted)]">
        <input type="checkbox" name="isActive" defaultChecked={initial.isActive} className="accent-[var(--oc-accent)]" />
        Идэвхтэй (идэвхгүй бол шинээр бүртгэх үед хайлтад гарахгүй)
      </label>
      <button type="submit" disabled={pending} className={BTN}>
        {pending ? "Хадгалж байна..." : "Хадгалах"}
      </button>
    </form>
  );
}

export function CatalogMergeForm({
  sourceId,
  candidates,
}: {
  sourceId: string;
  candidates: { id: string; label: string }[];
}) {
  const [state, formAction, pending] = useActionState<SystemCatalogState, FormData>(mergeCatalogItemAction, null);
  useResultToast(state);
  if (candidates.length === 0) return null;

  return (
    <form action={formAction} className="mt-6 flex flex-col gap-3 border-t border-[var(--oc-line2)] pt-5">
      <input type="hidden" name="sourceId" value={sourceId} />
      <div className="text-sm font-semibold text-[var(--oc-ink)]">Давхардлыг нэгтгэх</div>
      <p className="text-xs text-[var(--oc-muted3)]">
        Энэ мөрийг сонгосон мөрөнд нэгтгэнэ: ашиглаж буй байгууллагууд тэр мөр рүү шилжиж, энэ мөр устна.
      </p>
      <select name="targetId" defaultValue="" className="auth-input w-full">
        <option value="" disabled>
          — Нэгтгэх мөр —
        </option>
        {candidates.map((c) => (
          <option key={c.id} value={c.id}>
            {c.label}
          </option>
        ))}
      </select>
      <button
        type="submit"
        disabled={pending}
        className="self-end rounded-lg border border-[var(--oc-line)] px-4 py-2 text-sm font-medium text-[var(--oc-ink2)] hover:bg-[var(--oc-panel2)] disabled:opacity-60"
      >
        {pending ? "Нэгтгэж байна..." : "Нэгтгэх"}
      </button>
    </form>
  );
}
