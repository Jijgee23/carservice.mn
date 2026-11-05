"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import {
  type CatalogImportResult,
  type CatalogPreviewResult,
  type CatalogPreviewRow,
  importCatalogRowsAction,
  previewCatalogImportAction,
} from "@/app/_actions/system-catalog";
import { CATALOG_TYPE_LABEL, type CatalogType } from "@/lib/catalog/catalog-input";

const STATUS: Record<CatalogPreviewRow["status"], { label: string; cls: string }> = {
  ok: { label: "Шинэ", cls: "text-[var(--oc-ok)]" },
  exists: { label: "Санд байгаа", cls: "text-[var(--oc-muted3)]" },
  duplicate: { label: "Давхардсан", cls: "text-[var(--oc-warn)]" },
  error: { label: "Алдаатай", cls: "text-red-400 light:text-red-700" },
};

export function CatalogImportWizard() {
  const [type, setType] = useState<CatalogType>("GOODS");
  const [preview, setPreview] = useState<Extract<CatalogPreviewResult, { ok: true }> | null>(null);
  const [result, setResult] = useState<Extract<CatalogImportResult, { ok: true }> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const okRows = preview?.rows.filter((r) => r.status === "ok") ?? [];

  function onPreview(formData: FormData) {
    setError(null);
    setResult(null);
    start(async () => {
      const r = await previewCatalogImportAction(formData);
      if (r.ok) setPreview(r);
      else {
        setPreview(null);
        setError(r.message);
      }
    });
  }

  function onImport() {
    if (!preview) return;
    setError(null);
    start(async () => {
      const r = await importCatalogRowsAction(
        preview.type,
        okRows.map((row) => ({ excelRow: row.excelRow, raw: row.raw })),
      );
      if (r.ok) {
        setResult(r);
        setPreview(null);
      } else setError(r.message);
    });
  }

  if (result) {
    return (
      <div className="mt-5 flex flex-col gap-3 rounded-lg border border-[var(--oc-line)] bg-[var(--oc-panel2)] p-4 text-sm">
        <div className="font-semibold text-[var(--oc-ink)]">Импорт дууслаа</div>
        <div className="text-[var(--oc-muted)]">
          Санд нэмэгдсэн: <b className="text-[var(--oc-ok)]">{result.created}</b> · Алгассан (давхардсан):{" "}
          {result.skipped} · Алдаатай: {result.failed.length}
        </div>
        {result.failed.length > 0 ? (
          <ul className="text-xs text-red-400 light:text-red-700">
            {result.failed.map((f) => (
              <li key={f.excelRow}>
                {f.excelRow}-р мөр: {f.message}
              </li>
            ))}
          </ul>
        ) : null}
        <div className="flex gap-3">
          <Link href="/system/catalog" className="text-[var(--oc-accent)] hover:underline">
            Нэгдсэн сан руу →
          </Link>
          <button type="button" onClick={() => setResult(null)} className="text-[var(--oc-muted2)] hover:underline">
            Дахин импорт хийх
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-5 flex flex-col gap-4">
      <form action={onPreview} className="flex flex-col gap-3">
        <fieldset className="flex flex-wrap gap-2">
          <legend className="sr-only">Төрөл</legend>
          {(["GOODS", "LABOR"] as const).map((t) => (
            <label
              key={t}
              className={`cursor-pointer rounded-lg border px-3 py-2 text-sm ${
                type === t
                  ? "border-[var(--oc-accent)] bg-[var(--oc-accent)]/[0.08] text-[var(--oc-ink)]"
                  : "border-[var(--oc-line)] text-[var(--oc-muted)]"
              }`}
            >
              <input
                type="radio"
                name="type"
                value={t}
                checked={type === t}
                onChange={() => {
                  setType(t);
                  setPreview(null);
                }}
                className="mr-2 accent-[var(--oc-accent)]"
              />
              {CATALOG_TYPE_LABEL[t]}
            </label>
          ))}
          <a
            href={`/system/catalog/import/template?type=${type}`}
            className="ml-auto self-center text-sm text-[var(--oc-accent)] hover:underline"
          >
            Загвар татах (.xlsx)
          </a>
        </fieldset>
        <div className="flex flex-wrap items-center gap-3">
          <label className="text-xs text-[var(--oc-muted)]">
            <span className="sr-only">Excel файл</span>
            <input name="file" type="file" accept=".xlsx" required className="text-sm text-[var(--oc-ink2)]" />
          </label>
          <button
            type="submit"
            disabled={pending}
            className="rounded-lg border border-[var(--oc-line)] px-4 py-2 text-sm font-medium text-[var(--oc-ink2)] hover:bg-[var(--oc-panel2)] disabled:opacity-60"
          >
            {pending && !preview ? "Шалгаж байна..." : "Урьдчилан шалгах"}
          </button>
        </div>
      </form>

      {error ? <p className="text-sm text-red-400 light:text-red-700">{error}</p> : null}

      {preview ? (
        <div className="flex flex-col gap-3">
          <div className="text-sm text-[var(--oc-muted)]">
            {preview.fileName} · {preview.rows.length} мөр · шинэ <b className="text-[var(--oc-ok)]">{okRows.length}</b>
          </div>
          <div className="max-h-[28rem] overflow-auto rounded-lg border border-[var(--oc-line)]">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="sticky top-0 bg-[var(--oc-panel2)]">
                <tr className="text-left text-xs text-[var(--oc-muted3)]">
                  <th className="px-3 py-2 font-medium">Мөр</th>
                  <th className="px-3 py-2 font-medium">Нэр</th>
                  <th className="px-3 py-2 font-medium">Код</th>
                  <th className="px-3 py-2 font-medium">Баркод</th>
                  <th className="px-3 py-2 font-medium">Нэгж</th>
                  <th className="px-3 py-2 font-medium">Үнэ</th>
                  <th className="px-3 py-2 font-medium">Төлөв</th>
                </tr>
              </thead>
              <tbody>
                {preview.rows.map((r) => (
                  <tr key={r.excelRow} className="border-t border-[var(--oc-line2)]">
                    <td className="px-3 py-2 font-plex-mono text-xs text-[var(--oc-muted3)]">{r.excelRow}</td>
                    <td className="px-3 py-2 text-[var(--oc-ink2)]">{r.raw.name}</td>
                    <td className="px-3 py-2 font-plex-mono text-xs">{r.raw.code}</td>
                    <td className="px-3 py-2 font-plex-mono text-xs">{r.raw.barcode ?? ""}</td>
                    <td className="px-3 py-2">{r.raw.unitName}</td>
                    <td className="px-3 py-2 font-plex-mono text-xs">{r.raw.price}</td>
                    <td className={`px-3 py-2 text-xs ${STATUS[r.status].cls}`}>
                      {STATUS[r.status].label}
                      {r.message ? <span className="block text-[11px] opacity-80">{r.message}</span> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button
            type="button"
            onClick={onImport}
            disabled={pending || okRows.length === 0}
            className="self-end rounded-lg bg-[var(--oc-accent)] px-4 py-2 text-sm font-medium text-[var(--oc-on-accent)] hover:bg-[var(--oc-accent-hi)] disabled:opacity-60"
          >
            {pending ? "Нэмж байна..." : `${okRows.length} мөрийг санд нэмэх`}
          </button>
        </div>
      ) : null}
    </div>
  );
}
