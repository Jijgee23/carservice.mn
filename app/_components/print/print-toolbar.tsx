"use client";

import Link from "next/link";
import { btnClass } from "@/app/_components/landing-ops-ui";
import type { PrintFormat } from "@/lib/print/documents";

/** Screen-only bar above a printable document: back link, A4 / 80mm switch, print. */
export function PrintToolbar({ backHref, backLabel, format, basePath }: { backHref: string; backLabel: string; format: PrintFormat; basePath: string }) {
  const tab = (value: PrintFormat, label: string) => (
    <Link
      href={`${basePath}?format=${value}`}
      replace
      aria-current={format === value ? "page" : undefined}
      className={`rounded-[8px] px-3 py-1.5 text-sm transition-colors ${
        format === value ? "bg-[var(--oc-line)] text-[var(--oc-ink)] font-medium" : "text-[var(--oc-muted3)] hover:text-[var(--oc-ink)]"
      }`}
    >
      {label}
    </Link>
  );
  return (
    <div className="no-print flex flex-wrap items-center justify-between gap-3 mb-4">
      <Link href={backHref} className="text-sm text-[var(--oc-accent)] hover:text-[var(--oc-accent-hi)]">
        ← {backLabel}
      </Link>
      <div className="flex items-center gap-3">
        <div role="group" aria-label="Цаасны хэмжээ" className="inline-flex rounded-[10px] border border-[var(--oc-line)] bg-[var(--oc-panel)] p-0.5">
          {tab("a4", "A4")}
          {tab("80mm", "80мм")}
        </div>
        <button type="button" onClick={() => window.print()} className={btnClass("primary", "md")}>
          Хэвлэх
        </button>
      </div>
    </div>
  );
}
