"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import {
  checkEmployeeImportDuplicatesAction,
  importEmployeesAction,
  parseEmployeeImportAction,
} from "@/app/_actions/employee-import";
import {
  AssignModal,
  MapStep,
  StepChips,
  TextCell,
  UploadStep,
  type LoadedSheet,
} from "@/app/_components/excel-import";
import { Btn, BtnLink, Chip } from "@/app/_components/landing-ops-ui";
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
  type ImportMapping,
  type ImportRow,
  type ImportRowResult,
  type NamedOption,
} from "@/lib/employees/import";

type Step = "upload" | "map" | "review";
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
      <StepChips steps={STEPS} current={step} />

      {step === "upload" ? (
        <UploadStep
          parse={parseEmployeeImportAction}
          templateHref="/dashboard/employees/import/template"
          templateNote="2-р хуудсанд таны үүрэг, салбарын нэрс бий."
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
          fields={IMPORT_FIELDS}
          mapping={mapping}
          note="Үүрэг/салбарын нэр системийнхтэй яг таарвал автоматаар оноогдоно; таараагүйг дараагийн алхамд гараар эсвэл олноор нь оноож болно."
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
          title={assign === "role" ? "Үүрэг оноох" : "Салбар оноох"}
          description={`Сонгосон ${selection.selected.size} мөрөнд ${assign === "role" ? "үүрэг" : "үндсэн салбар"} оноох.`}
          placeholder={assign === "role" ? "— Үүрэг сонгох —" : "— Салбар сонгох —"}
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
