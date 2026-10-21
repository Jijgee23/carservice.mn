"use client";

// Excel импортын wizard-уудын (ажилтан, ажил/сэлбэг) нийтлэг хэсгүүд:
// алхмын тэмдэг, файл оруулах, багана тааруулах, засах нүд, олноор оноох modal.

import { useState, useTransition } from "react";
import { Btn, Chip } from "@/app/_components/landing-ops-ui";
import { Modal } from "@/app/_components/modal";
import { Select } from "@/app/_components/select";
import type { ParsedSheet } from "@/lib/import/mapping";

export type LoadedSheet = ParsedSheet & { fileName: string };

export function StepChips<S extends string>({ steps, current }: { steps: ReadonlyArray<{ key: S; label: string }>; current: S }) {
  return (
    <ol className="flex flex-wrap gap-2 text-xs">
      {steps.map((s) => (
        <li key={s.key}>
          <Chip tone={s.key === current ? "accent" : "neutral"}>{s.label}</Chip>
        </li>
      ))}
    </ol>
  );
}

export function UploadStep({
  parse,
  onLoaded,
  templateHref,
  templateNote,
}: {
  parse: (fd: FormData) => Promise<({ ok: true } & LoadedSheet) | { ok: false; message: string }>;
  onLoaded: (sheet: LoadedSheet) => void;
  templateHref: string;
  templateNote: string;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function upload(file: File | undefined) {
    if (!file) return;
    setError(null);
    const fd = new FormData();
    fd.set("file", file);
    startTransition(async () => {
      const res = await parse(fd);
      if (res.ok) onLoaded(res);
      else setError(res.message);
    });
  }

  return (
    <div className="rounded-[10px] border border-[var(--oc-line)] bg-[var(--oc-panel)] p-5 flex flex-col gap-4 max-w-2xl">
      <label
        className="flex flex-col items-center justify-center gap-2 rounded-[10px] border border-dashed border-[var(--oc-line2,var(--oc-line))] bg-[var(--oc-panel2)] px-6 py-10 text-center cursor-pointer hover:border-[var(--oc-accent)] transition-colors"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          upload(e.dataTransfer.files[0]);
        }}
      >
        <span className="text-sm font-medium text-[var(--oc-ink)]">
          {pending ? "Уншиж байна…" : "Excel файлаа энд чирж оруулах эсвэл дарж сонгох"}
        </span>
        <span className="text-xs text-[var(--oc-muted3)]">.xlsx · 2MB хүртэл · 500 мөр хүртэл · эхний мөр нь гарчиг</span>
        <input
          type="file"
          accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          className="sr-only"
          disabled={pending}
          onChange={(e) => {
            upload(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
      </label>
      {error ? <p className="text-sm text-red-400 light:text-red-600">{error}</p> : null}
      <p className="text-xs text-[var(--oc-muted3)]">
        Загвар хэрэгтэй бол{" "}
        <a href={templateHref} className="text-[var(--oc-accent-hi)] underline underline-offset-2">
          Excel загвар татах
        </a>{" "}
        — {templateNote}
      </p>
    </div>
  );
}

export function MapStep<K extends string>({
  sheet,
  fields,
  mapping,
  onChange,
  onBack,
  onNext,
  note,
}: {
  sheet: LoadedSheet;
  fields: ReadonlyArray<{ key: K; label: string; required: boolean }>;
  mapping: Record<K, number | null>;
  onChange: (m: Record<K, number | null>) => void;
  onBack: () => void;
  onNext: () => void;
  note: string;
}) {
  const columnOptions = sheet.headers.map((h, i) => ({
    value: String(i),
    label: h,
    hint: sheet.rows.find((r) => r.cells[i])?.cells[i]?.slice(0, 40),
  }));
  const missing = fields.filter((f) => f.required && mapping[f.key] === null);

  function set(field: K, value: string) {
    onChange({ ...mapping, [field]: value === "" ? null : Number(value) });
  }

  return (
    <div className="rounded-[10px] border border-[var(--oc-line)] bg-[var(--oc-panel)] p-5 flex flex-col gap-4 max-w-2xl">
      <p className="text-sm text-[var(--oc-muted2)]">
        <span className="text-[var(--oc-ink)] font-medium">{sheet.fileName}</span> · {sheet.rows.length} мөр. Системийн
        талбар бүрт Excel-ийн аль баганыг ашиглахыг сонгоно уу.
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-[180px_1fr] gap-x-4 gap-y-3 items-center">
        {fields.map((f) => (
          <div key={f.key} className="contents">
            <label className="text-sm text-[var(--oc-ink2)]">
              {f.label}
              {f.required ? <span className="text-red-400"> *</span> : null}
            </label>
            <Select
              name={`map-${f.key}`}
              value={mapping[f.key] === null ? "" : String(mapping[f.key])}
              onChange={(v) => set(f.key, v)}
              placeholder={f.required ? "— Багана сонгох —" : "— Ашиглахгүй —"}
              options={columnOptions}
              clearable
              searchable={columnOptions.length > 8}
            />
          </div>
        ))}
      </div>
      <p className="text-xs text-[var(--oc-muted3)]">{note}</p>
      <div className="flex justify-end gap-2">
        <Btn type="button" variant="ghost" onClick={onBack}>
          ← Өөр файл
        </Btn>
        <Btn
          type="button"
          disabled={missing.length > 0}
          title={missing.length > 0 ? `Тааруулаагүй: ${missing.map((f) => f.label).join(", ")}` : undefined}
          onClick={onNext}
        >
          Дараах →
        </Btn>
      </div>
    </div>
  );
}

export function TextCell({
  value,
  error,
  onChange,
  mono,
  wide,
  narrow,
  placeholder,
}: {
  value: string;
  error?: string;
  onChange: (v: string) => void;
  mono?: boolean;
  wide?: boolean;
  narrow?: boolean;
  placeholder?: string;
}) {
  return (
    <td className={`px-2 py-2 ${wide ? "min-w-[200px]" : narrow ? "min-w-[90px]" : "min-w-[120px]"}`}>
      <input
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={Boolean(error)}
        className={`compact-input ${mono ? "font-plex-mono" : ""} ${error ? "border-red-500/50" : ""}`}
      />
      {error ? <p className="mt-1 text-[11px] leading-snug text-red-400 light:text-red-600">{error}</p> : null}
    </td>
  );
}

export function AssignModal({
  title,
  description,
  placeholder,
  options,
  onClose,
  onApply,
}: {
  title: string;
  description: string;
  placeholder: string;
  options: ReadonlyArray<{ id: string; name: string }>;
  onClose: () => void;
  onApply: (id: string) => void;
}) {
  const [value, setValue] = useState("");
  return (
    <Modal open onClose={onClose} title={title} widthClassName="max-w-md">
      <div className="flex flex-col gap-4">
        <p className="text-sm text-[var(--oc-muted2)]">{description}</p>
        <Select
          name="assign"
          value={value}
          onChange={setValue}
          options={options.map((o) => ({ value: o.id, label: o.name }))}
          placeholder={placeholder}
          searchable={options.length > 8}
        />
        <div className="flex justify-end gap-2">
          <Btn type="button" variant="ghost" onClick={onClose}>
            Болих
          </Btn>
          <Btn type="button" disabled={!value} onClick={() => onApply(value)}>
            Оноох
          </Btn>
        </div>
      </div>
    </Modal>
  );
}
