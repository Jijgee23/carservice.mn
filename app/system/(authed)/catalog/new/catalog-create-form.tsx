"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { type CatalogCreateState, createCatalogItemAction } from "@/app/_actions/system-catalog";
import { CATALOG_TYPE_LABEL, type CatalogType } from "@/lib/catalog/catalog-input";

const ERR = "mt-1 block text-red-400 light:text-red-700";

export function CatalogCreateForm({
  initialType,
  goodsCategories,
}: {
  initialType: CatalogType;
  goodsCategories: { id: string; name: string }[];
}) {
  const [state, formAction, pending] = useActionState<CatalogCreateState, FormData>(createCatalogItemAction, null);
  const [type, setType] = useState<CatalogType>(initialType);
  const fe = state?.fieldErrors ?? {};

  return (
    <form action={formAction} className="mt-5 flex flex-col gap-4">
      <fieldset className="flex gap-2">
        <legend className="sr-only">Төрөл</legend>
        {(["GOODS", "LABOR"] as const).map((t) => (
          <label
            key={t}
            className={`flex-1 cursor-pointer rounded-lg border px-3 py-2.5 text-sm transition-colors ${
              type === t
                ? "border-[var(--oc-accent)] bg-[var(--oc-accent)]/[0.08] text-[var(--oc-ink)]"
                : "border-[var(--oc-line)] text-[var(--oc-muted)] hover:border-[var(--oc-muted4)]"
            }`}
          >
            <input
              type="radio"
              name="type"
              value={t}
              checked={type === t}
              onChange={() => setType(t)}
              className="mr-2 accent-[var(--oc-accent)]"
            />
            {CATALOG_TYPE_LABEL[t]}
          </label>
        ))}
      </fieldset>

      <label className="text-xs text-[var(--oc-muted)]">
        Нэр *
        <input
          name="name"
          required
          maxLength={200}
          placeholder={type === "GOODS" ? "ж: 5W-30 моторын тос" : "ж: Тосны солилт"}
          className="auth-input mt-1 w-full"
        />
        {fe.name ? <span className={ERR}>{fe.name}</span> : null}
      </label>

      <div className="grid gap-3 sm:grid-cols-3">
        <label className="text-xs text-[var(--oc-muted)]">
          {type === "GOODS" ? "Код / SKU" : "Код"}
          <input name="code" maxLength={60} className="auth-input mt-1 w-full uppercase font-plex-mono" />
          {fe.code ? <span className={ERR}>{fe.code}</span> : null}
        </label>
        <label className="text-xs text-[var(--oc-muted)]">
          Нэгж *
          <input
            name="unitName"
            required
            maxLength={40}
            defaultValue={type === "GOODS" ? "ширхэг" : "хүн/цаг"}
            key={type}
            className="auth-input mt-1 w-full"
          />
          {fe.unitName ? <span className={ERR}>{fe.unitName}</span> : null}
        </label>
        <label className="text-xs text-[var(--oc-muted)]">
          Санал болгох үнэ (₮) *
          <input name="price" required inputMode="decimal" className="auth-input mt-1 w-full font-plex-mono" />
          {fe.price ? <span className={ERR}>{fe.price}</span> : null}
        </label>
      </div>

      {type === "GOODS" ? (
        <label className="text-xs text-[var(--oc-muted)]">
          Баркод
          <input
            name="barcode"
            maxLength={64}
            autoComplete="off"
            placeholder="8801234567890"
            onKeyDown={(e) => {
              if (e.key === "Enter") e.preventDefault();
            }}
            className="auth-input mt-1 w-full font-plex-mono"
          />
          {fe.barcode ? <span className={ERR}>{fe.barcode}</span> : null}
        </label>
      ) : null}

      {type === "GOODS" ? (
        <label className="text-xs text-[var(--oc-muted)]">
          Системийн ангилал
          <select name="categoryId" defaultValue="" className="auth-input mt-1 w-full">
            <option value="">—</option>
            {goodsCategories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          {fe.categoryId ? <span className={ERR}>{fe.categoryId}</span> : null}
        </label>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-xs text-[var(--oc-muted)]">
            Хугацаа
            <input name="durationValue" inputMode="decimal" placeholder="ж: 30" className="auth-input mt-1 w-full font-plex-mono" />
            {fe.durationValue ? <span className={ERR}>{fe.durationValue}</span> : null}
          </label>
          <label className="text-xs text-[var(--oc-muted)]">
            Хугацааны нэгж
            <input name="durationUnitName" placeholder="ж: мин" maxLength={20} className="auth-input mt-1 w-full" />
            {fe.durationUnitName ? <span className={ERR}>{fe.durationUnitName}</span> : null}
          </label>
        </div>
      )}

      <label className="text-xs text-[var(--oc-muted)]">
        Тайлбар
        <textarea name="description" rows={2} maxLength={1000} className="auth-input mt-1 w-full resize-none" />
      </label>

      {state && !state.ok && state.message ? (
        <p className="text-sm text-red-400 light:text-red-700">
          {state.message}{" "}
          {state.existingId ? (
            <Link href={`/system/catalog/${state.existingId}`} className="underline">
              Мөрийг нээх →
            </Link>
          ) : null}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={pending}
        className="self-end rounded-lg bg-[var(--oc-accent)] px-4 py-2 text-sm font-medium text-[var(--oc-on-accent)] hover:bg-[var(--oc-accent-hi)] disabled:opacity-60"
      >
        {pending ? "Бүртгэж байна..." : "Бүртгэх"}
      </button>
    </form>
  );
}
