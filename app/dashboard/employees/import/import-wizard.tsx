"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import {
  checkEmployeeImportDuplicatesAction,
  importEmployeesAction,
  parseEmployeeImportAction,
} from "@/app/_actions/employee-import";
import { Btn, BtnLink, Chip } from "@/app/_components/landing-ops-ui";
import { Modal } from "@/app/_components/modal";
import {
  SelectAllCell,
  SelectRowCell,
  SelectionActions,
  useRowSelection,
} from "@/app/_components/row-selection";
import { Select } from "@/app/_components/select";
import { useToast } from "@/app/_components/toast";
import {
  buildImportRows,
  findInFileDuplicates,
  guessMapping,
  IMPORT_FIELDS,
  validateImportRow,
  type ImportField,
  type ImportMapping,
  type ImportRow,
  type ImportRowResult,
  type NamedOption,
  type ParsedSheet,
} from "@/lib/employees/import";

type Step = "upload" | "map" | "review";
type LoadedSheet = ParsedSheet & { fileName: string };
type Taken = Record<string, { phone?: boolean; email?: boolean }>;

const STEPS: Array<{ key: Step; label: string }> = [
  { key: "upload", label: "1. Файл" },
  { key: "map", label: "2. Багана тааруулах" },
  { key: "review", label: "3. Шалгах, үүрэг оноох" },
];

export function EmployeeImportWizard({ roles, branches }: { roles: NamedOption[]; branches: NamedOption[] }) {
  const [step, setStep] = useState<Step>("upload");
  const [sheet, setSheet] = useState<LoadedSheet | null>(null);
  const [mapping, setMapping] = useState<ImportMapping | null>(null);
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [importedCount, setImportedCount] = useState(0);

  return (
    <div className="flex flex-col gap-4">
      <ol className="flex flex-wrap gap-2 text-xs">
        {STEPS.map((s) => (
          <li key={s.key}>
            <Chip tone={s.key === step ? "accent" : "neutral"}>{s.label}</Chip>
          </li>
        ))}
      </ol>

      {step === "upload" ? (
        <UploadStep
          onLoaded={(loaded) => {
            setSheet(loaded);
            setMapping(guessMapping(loaded.headers));
            setStep("map");
          }}
        />
      ) : null}

      {step === "map" && sheet && mapping ? (
        <MapStep
          sheet={sheet}
          mapping={mapping}
          onChange={setMapping}
          onBack={() => setStep("upload")}
          onNext={() => {
            setRows(buildImportRows(sheet, mapping, roles, branches));
            setImportedCount(0);
            setStep("review");
          }}
        />
      ) : null}

      {step === "review" ? (
        <ReviewStep
          rows={rows}
          setRows={setRows}
          roles={roles}
          branches={branches}
          importedCount={importedCount}
          onImported={(n) => setImportedCount((c) => c + n)}
          onBack={() => setStep("map")}
        />
      ) : null}
    </div>
  );
}

// --- 1. Upload ---------------------------------------------------------------

function UploadStep({ onLoaded }: { onLoaded: (sheet: LoadedSheet) => void }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function upload(file: File | undefined) {
    if (!file) return;
    setError(null);
    const fd = new FormData();
    fd.set("file", file);
    startTransition(async () => {
      const res = await parseEmployeeImportAction(fd);
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
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- .xlsx download route, not a page */}
        <a
          href="/dashboard/employees/import/template"
          className="text-[var(--oc-accent-hi)] underline underline-offset-2"
        >
          Excel загвар татах
        </a>{" "}
        — 2-р хуудсанд таны үүрэг, салбарын нэрс бий.
      </p>
    </div>
  );
}

// --- 2. Column mapping -------------------------------------------------------

function MapStep({
  sheet,
  mapping,
  onChange,
  onBack,
  onNext,
}: {
  sheet: LoadedSheet;
  mapping: ImportMapping;
  onChange: (m: ImportMapping) => void;
  onBack: () => void;
  onNext: () => void;
}) {
  const columnOptions = sheet.headers.map((h, i) => ({
    value: String(i),
    label: h,
    hint: sheet.rows.find((r) => r.cells[i])?.cells[i]?.slice(0, 40),
  }));
  const missing = IMPORT_FIELDS.filter((f) => f.required && mapping[f.key] === null);

  function set(field: ImportField, value: string) {
    onChange({ ...mapping, [field]: value === "" ? null : Number(value) });
  }

  return (
    <div className="rounded-[10px] border border-[var(--oc-line)] bg-[var(--oc-panel)] p-5 flex flex-col gap-4 max-w-2xl">
      <p className="text-sm text-[var(--oc-muted2)]">
        <span className="text-[var(--oc-ink)] font-medium">{sheet.fileName}</span> · {sheet.rows.length} мөр. Системийн
        талбар бүрт Excel-ийн аль баганыг ашиглахыг сонгоно уу.
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-[180px_1fr] gap-x-4 gap-y-3 items-center">
        {IMPORT_FIELDS.map((f) => (
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
      <p className="text-xs text-[var(--oc-muted3)]">
        Үүрэг/салбарын нэр системийнхтэй яг таарвал автоматаар оноогдоно; таараагүйг дараагийн алхамд гараар эсвэл
        олноор нь оноож болно.
      </p>
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

// --- 3. Review, assign roles, import ------------------------------------------

function ReviewStep({
  rows,
  setRows,
  roles,
  branches,
  importedCount,
  onImported,
  onBack,
}: {
  rows: ImportRow[];
  setRows: (update: (rows: ImportRow[]) => ImportRow[]) => void;
  roles: NamedOption[];
  branches: NamedOption[];
  importedCount: number;
  onImported: (n: number) => void;
  onBack: () => void;
}) {
  const toast = useToast();
  const [taken, setTaken] = useState<Taken>({});
  const [serverResults, setServerResults] = useState<Record<string, ImportRowResult>>({});
  const [onlyErrors, setOnlyErrors] = useState(false);
  const [assign, setAssign] = useState<"role" | "branch" | null>(null);
  const [pending, startTransition] = useTransition();

  // Tenant-internal phone/email collisions, re-checked (debounced) on edit.
  const dupSignature = rows.map((r) => `${r.key}|${r.phone}|${r.email}`).join("\n");
  useEffect(() => {
    if (rows.length === 0) return;
    const timer = setTimeout(async () => {
      const res = await checkEmployeeImportDuplicatesAction(rows);
      if (res.ok) setTaken(res.taken);
    }, 500);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dupSignature]);

  const errorsByKey = useMemo(() => {
    const inFile = findInFileDuplicates(rows);
    const out = new Map<string, Record<string, string>>();
    for (const row of rows) {
      const errors = validateImportRow(row);
      const dup = inFile.get(row.key);
      if (dup?.phone !== undefined && !errors.phone) errors.phone = `Утас ${dup.phone}-р мөртэй давхардсан.`;
      if (dup?.email !== undefined && !errors.email) errors.email = `Имэйл ${dup.email}-р мөртэй давхардсан.`;
      if (taken[row.key]?.phone && !errors.phone) errors.phone = "Энэ утастай ажилтан бүртгэлтэй байна.";
      if (taken[row.key]?.email && !errors.email) errors.email = "Энэ имэйлтэй ажилтан бүртгэлтэй байна.";
      const server = serverResults[row.key];
      if (server && !server.ok) {
        for (const [k, v] of Object.entries(server.fieldErrors ?? {})) errors[k] ??= v;
        if (!server.fieldErrors || Object.keys(server.fieldErrors).length === 0) errors._row = server.error ?? "Алдаа";
      }
      if (Object.keys(errors).length > 0) out.set(row.key, errors);
    }
    return out;
  }, [rows, taken, serverResults]);

  const visible = onlyErrors ? rows.filter((r) => errorsByKey.has(r.key)) : rows;
  const selectionRows = useMemo(() => visible.map((r) => ({ id: r.key })), [visible]);
  const selection = useRowSelection(selectionRows);
  const readyRows = rows.filter((r) => !errorsByKey.has(r.key));
  const errorCount = rows.length - readyRows.length;

  function update(key: string, patch: Partial<ImportRow>) {
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));
    // A server failure is stale once the user edits that row.
    setServerResults((prev) => {
      if (!prev[key]) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }

  function applyToSelected(patch: Partial<ImportRow>) {
    const keys = new Set(selection.selected);
    setRows((prev) => prev.map((r) => (keys.has(r.key) ? { ...r, ...patch } : r)));
    selection.clear();
  }

  function removeSelected() {
    const keys = new Set(selection.selected);
    setRows((prev) => prev.filter((r) => !keys.has(r.key)));
    selection.clear();
  }

  function runImport() {
    const batch = readyRows;
    if (batch.length === 0) return;
    startTransition(async () => {
      const res = await importEmployeesAction(batch);
      if (!res.ok) {
        toast.error("Алдаа гарлаа", res.message);
        return;
      }
      const okKeys = new Set(res.results.filter((r) => r.ok).map((r) => r.key));
      setRows((prev) => prev.filter((r) => !okKeys.has(r.key)));
      setServerResults((prev) => {
        const next = { ...prev };
        for (const r of res.results) if (!r.ok) next[r.key] = r;
        return next;
      });
      onImported(res.succeeded);
      if (res.failed === 0) toast.success("Амжилттай", `${res.succeeded} ажилтан бүртгэгдлээ.`);
      else if (res.succeeded > 0) toast.warning("Хэсэгчлэн амжилттай", `${res.succeeded} бүртгэгдэж, ${res.failed} мөр алдаатай.`);
      else toast.error("Бүртгэгдсэнгүй", `${res.failed} мөр алдаатай — хүснэгтээс шалгана уу.`);
    });
  }

  if (rows.length === 0) {
    return (
      <div className="rounded-[10px] border border-[var(--oc-line)] bg-[var(--oc-panel)] p-6 flex flex-col gap-3 max-w-2xl">
        <p className="text-sm text-[var(--oc-ink)]">
          {importedCount > 0 ? `${importedCount} ажилтан амжилттай бүртгэгдлээ.` : "Оруулах мөр үлдсэнгүй."}
        </p>
        <div className="flex gap-2">
          <BtnLink href="/dashboard/employees">Ажилтнуудын жагсаалт</BtnLink>
          <Btn type="button" variant="ghost" onClick={onBack}>
            ← Багана тааруулах руу
          </Btn>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-[10px] border border-[var(--oc-line)] bg-[var(--oc-panel)] overflow-hidden flex flex-col">
      <div className="flex flex-wrap items-center gap-3 px-4 py-3 border-b border-[var(--oc-line)] text-sm">
        <Chip tone="ok">Бэлэн {readyRows.length}</Chip>
        {errorCount > 0 ? <Chip tone="danger">Алдаатай {errorCount}</Chip> : null}
        {importedCount > 0 ? <Chip tone="neutral">Бүртгэгдсэн {importedCount}</Chip> : null}
        <label className="flex items-center gap-2 text-xs text-[var(--oc-muted2)] cursor-pointer">
          <input type="checkbox" checked={onlyErrors} onChange={(e) => setOnlyErrors(e.target.checked)} />
          Зөвхөн алдаатай
        </label>
        <div className="ml-auto flex gap-2">
          <Btn type="button" variant="ghost" onClick={onBack} disabled={pending}>
            ← Багана
          </Btn>
          <Btn type="button" onClick={runImport} disabled={pending || readyRows.length === 0}>
            {pending ? "Бүртгэж байна…" : `${readyRows.length} ажилтан бүртгэх`}
          </Btn>
        </div>
      </div>

      <SelectionActions
        selection={selection}
        noun="мөр"
        actions={[
          { label: "Үүрэг оноох", onSelect: () => setAssign("role") },
          { label: "Салбар оноох", onSelect: () => setAssign("branch") },
          { label: "Хасах", variant: "ghost", onSelect: removeSelected },
        ]}
      />

      <div className="overflow-auto import-grid">
        <table className="w-full min-w-[1180px] text-sm">
          <thead>
            <tr className="border-b border-[var(--oc-line)]">
              <SelectAllCell selection={selection} />
              {["Мөр", "Овог", "Нэр", "Утас", "Имэйл", "Үүрэг", "Салбар", "Идэвхтэй хүртэл", "Төлөв"].map((h) => (
                <th
                  key={h}
                  className="text-left font-plex-mono text-[10.5px] uppercase tracking-[0.08em] text-[var(--oc-muted3)] font-medium px-2 py-3"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--oc-line)]" {...selection.dragArea}>
            {visible.map((row) => {
              const errors = errorsByKey.get(row.key) ?? {};
              return (
                <tr key={row.key} className="align-top">
                  <SelectRowCell selection={selection} id={row.key} label={`${row.excelRow}-р мөр сонгох`} />
                  <td className="px-2 py-2 font-plex-mono text-xs text-[var(--oc-muted3)] pt-4">{row.excelRow}</td>
                  <TextCell value={row.lastName} error={errors.lastName} onChange={(v) => update(row.key, { lastName: v })} />
                  <TextCell value={row.firstName} error={errors.firstName} onChange={(v) => update(row.key, { firstName: v })} />
                  <TextCell value={row.phone} error={errors.phone} mono onChange={(v) => update(row.key, { phone: v })} />
                  <TextCell value={row.email} error={errors.email} wide onChange={(v) => update(row.key, { email: v })} />
                  <td className="px-2 py-2 min-w-[170px]">
                    <Select
                      name={`role-${row.key}`}
                      value={row.roleId}
                      onChange={(v) => update(row.key, { roleId: v })}
                      options={roles.map((r) => ({ value: r.id, label: r.name }))}
                      placeholder={row.roleRaw ? `«${row.roleRaw}» ?` : "— Үүрэг —"}
                      error={errors.roleId}
                      searchable
                    />
                  </td>
                  <td className="px-2 py-2 min-w-[170px]">
                    <Select
                      name={`branch-${row.key}`}
                      value={row.branchId}
                      onChange={(v) => update(row.key, { branchId: v, branchRaw: v ? row.branchRaw : "" })}
                      options={branches.map((b) => ({ value: b.id, label: b.name }))}
                      placeholder={row.branchRaw ? `«${row.branchRaw}» ?` : "— Салбаргүй —"}
                      error={errors.branchId}
                      clearable
                      searchable={branches.length > 8}
                    />
                  </td>
                  <TextCell
                    value={row.activeUntil}
                    error={errors.activeUntil}
                    placeholder="2026-12-31"
                    mono
                    onChange={(v) => update(row.key, { activeUntil: v.trim() })}
                  />
                  <td className="px-2 py-2 pt-4 text-xs min-w-[140px]">
                    {Object.keys(errors).length === 0 ? (
                      <span className="text-emerald-400 light:text-emerald-600">Бэлэн</span>
                    ) : (
                      <span className="text-red-400 light:text-red-600">{errors._row ?? "Засах шаардлагатай"}</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {assign ? (
        <AssignModal
          kind={assign}
          count={selection.selected.size}
          options={assign === "role" ? roles : branches}
          onClose={() => setAssign(null)}
          onApply={(id) => {
            applyToSelected(assign === "role" ? { roleId: id } : { branchId: id, branchRaw: "" });
            setAssign(null);
          }}
        />
      ) : null}
    </div>
  );
}

function TextCell({
  value,
  error,
  onChange,
  mono,
  wide,
  placeholder,
}: {
  value: string;
  error?: string;
  onChange: (v: string) => void;
  mono?: boolean;
  wide?: boolean;
  placeholder?: string;
}) {
  return (
    <td className={`px-2 py-2 ${wide ? "min-w-[200px]" : "min-w-[120px]"}`}>
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

function AssignModal({
  kind,
  count,
  options,
  onClose,
  onApply,
}: {
  kind: "role" | "branch";
  count: number;
  options: NamedOption[];
  onClose: () => void;
  onApply: (id: string) => void;
}) {
  const [value, setValue] = useState("");
  const isRole = kind === "role";
  return (
    <Modal open onClose={onClose} title={isRole ? "Үүрэг оноох" : "Салбар оноох"} widthClassName="max-w-md">
      <div className="flex flex-col gap-4">
        <p className="text-sm text-[var(--oc-muted2)]">
          Сонгосон {count} мөрөнд {isRole ? "үүрэг" : "үндсэн салбар"} оноох.
        </p>
        <Select
          name={`assign-${kind}`}
          value={value}
          onChange={setValue}
          options={options.map((o) => ({ value: o.id, label: o.name }))}
          placeholder={isRole ? "— Үүрэг сонгох —" : "— Салбар сонгох —"}
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
