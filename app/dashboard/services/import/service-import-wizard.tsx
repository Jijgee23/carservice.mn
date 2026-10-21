"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import {
  checkServiceImportCodesAction,
  importServicesAction,
  parseServiceImportAction,
} from "@/app/_actions/service-import";
import { AssignModal, MapStep, StepChips, TextCell, UploadStep, type LoadedSheet } from "@/app/_components/excel-import";
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
  buildServiceImportRows,
  findInFileDuplicateCodes,
  guessServiceMapping,
  SERVICE_CODE_EXISTS_MESSAGE,
  SERVICE_IMPORT_FIELDS,
  SERVICE_KIND_IMPORT_LABEL,
  validateServiceImportRow,
  type CategoryOption,
  type ImportServiceKind,
  type ServiceImportMapping,
  type ServiceImportRow,
  type ServiceImportRowResult,
  type UnitOption,
} from "@/lib/services/import";

type Step = "upload" | "map" | "review";

const STEPS: Array<{ key: Step; label: string }> = [
  { key: "upload", label: "1. Файл" },
  { key: "map", label: "2. Багана тааруулах" },
  { key: "review", label: "3. Шалгах, ангилал/нэгж оноох" },
];

export function ServiceImportWizard({
  type,
  slug,
  categories,
  units,
}: {
  type: ImportServiceKind;
  slug: "labor" | "goods";
  categories: CategoryOption[];
  units: UnitOption[];
}) {
  const [step, setStep] = useState<Step>("upload");
  const [sheet, setSheet] = useState<LoadedSheet | null>(null);
  const [mapping, setMapping] = useState<ServiceImportMapping | null>(null);
  const [rows, setRows] = useState<ServiceImportRow[]>([]);
  const [importedCount, setImportedCount] = useState(0);
  const fields = SERVICE_IMPORT_FIELDS[type];

  return (
    <div className="flex flex-col gap-4">
      <StepChips steps={STEPS} current={step} />

      {step === "upload" ? (
        <UploadStep
          parse={parseServiceImportAction}
          templateHref={`/dashboard/services/import/template?type=${slug}`}
          templateNote="2-р хуудсанд таны ангилал, нэгжийн нэрс бий. «Excel татах»-аар авсан жагсаалтаа засаад ч оруулж болно."
          onLoaded={(loaded) => {
            setSheet(loaded);
            setMapping(guessServiceMapping(type, loaded.headers));
            setStep("map");
          }}
        />
      ) : null}

      {step === "map" && sheet && mapping ? (
        <MapStep
          sheet={sheet}
          fields={fields}
          mapping={mapping}
          onChange={setMapping}
          note="Ангилал, нэгжийн нэр системийнхтэй таарвал автоматаар оноогдоно; таараагүйг дараагийн алхамд гараар эсвэл олноор нь оноож болно. Системд бүртгэлтэй кодтой мөр алгасагдана."
          onBack={() => setStep("upload")}
          onNext={() => {
            setRows(buildServiceImportRows(sheet, mapping, categories, units));
            setImportedCount(0);
            setStep("review");
          }}
        />
      ) : null}

      {step === "review" ? (
        <ReviewStep
          type={type}
          slug={slug}
          rows={rows}
          setRows={setRows}
          categories={categories}
          units={units}
          importedCount={importedCount}
          onImported={(n) => setImportedCount((c) => c + n)}
          onBack={() => setStep("map")}
        />
      ) : null}
    </div>
  );
}

function ReviewStep({
  type,
  slug,
  rows,
  setRows,
  categories,
  units,
  importedCount,
  onImported,
  onBack,
}: {
  type: ImportServiceKind;
  slug: string;
  rows: ServiceImportRow[];
  setRows: (update: (rows: ServiceImportRow[]) => ServiceImportRow[]) => void;
  categories: CategoryOption[];
  units: UnitOption[];
  importedCount: number;
  onImported: (n: number) => void;
  onBack: () => void;
}) {
  const toast = useToast();
  const noun = SERVICE_KIND_IMPORT_LABEL[type];
  const [taken, setTaken] = useState<Set<string>>(new Set());
  const [serverResults, setServerResults] = useState<Record<string, ServiceImportRowResult>>({});
  const [onlyErrors, setOnlyErrors] = useState(false);
  const [assign, setAssign] = useState<"category" | "unit" | null>(null);
  const [pending, startTransition] = useTransition();
  const isGoods = type === "GOODS";

  // Системд бүртгэлтэй код (тухайн төрөлд) — засах бүрд debounce-той дахин шалгана.
  const codeSignature = rows.map((r) => r.code.trim().toUpperCase()).join("|");
  useEffect(() => {
    if (rows.length === 0) return;
    const timer = setTimeout(async () => {
      const codes = rows.map((r) => r.code).filter((c) => c.trim());
      const res = await checkServiceImportCodesAction(type, codes);
      if (res.ok) setTaken(new Set(res.taken.map((c) => c.toUpperCase())));
    }, 500);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [codeSignature, type]);

  const errorsByKey = useMemo(() => {
    const inFile = findInFileDuplicateCodes(rows);
    const out = new Map<string, Record<string, string>>();
    for (const row of rows) {
      const errors = validateServiceImportRow(type, row);
      const code = row.code.trim().toUpperCase();
      const dup = inFile.get(row.key);
      if (dup !== undefined && !errors.code) errors.code = `Код ${dup}-р мөртэй давхардсан.`;
      if (code && taken.has(code) && !errors.code) errors.code = SERVICE_CODE_EXISTS_MESSAGE;
      const server = serverResults[row.key];
      if (server && !server.ok) {
        for (const [k, v] of Object.entries(server.fieldErrors ?? {})) errors[k] ??= v;
        if (!server.fieldErrors || Object.keys(server.fieldErrors).length === 0) errors._row = server.error ?? "Алдаа";
      }
      if (Object.keys(errors).length > 0) out.set(row.key, errors);
    }
    return out;
  }, [rows, taken, serverResults, type]);

  const visible = onlyErrors ? rows.filter((r) => errorsByKey.has(r.key)) : rows;
  const selectionRows = useMemo(() => visible.map((r) => ({ id: r.key })), [visible]);
  const selection = useRowSelection(selectionRows);
  const readyRows = rows.filter((r) => !errorsByKey.has(r.key));
  const errorCount = rows.length - readyRows.length;
  const unitOptions = units.map((u) => ({ value: u.id, label: u.code ? `${u.name} (${u.code})` : u.name }));
  const categoryOptions = categories.map((c) => ({ value: c.id, label: c.name }));

  function update(key: string, patch: Partial<ServiceImportRow>) {
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));
    setServerResults((prev) => {
      if (!prev[key]) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }

  function applyToSelected(patch: Partial<ServiceImportRow>) {
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
      const res = await importServicesAction(type, batch);
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
      if (res.failed === 0) toast.success("Амжилттай", `${res.succeeded} ${noun} бүртгэгдлээ.`);
      else if (res.succeeded > 0) toast.warning("Хэсэгчлэн амжилттай", `${res.succeeded} бүртгэгдэж, ${res.failed} мөр алдаатай.`);
      else toast.error("Бүртгэгдсэнгүй", `${res.failed} мөр алдаатай — хүснэгтээс шалгана уу.`);
    });
  }

  if (rows.length === 0) {
    return (
      <div className="rounded-[10px] border border-[var(--oc-line)] bg-[var(--oc-panel)] p-6 flex flex-col gap-3 max-w-2xl">
        <p className="text-sm text-[var(--oc-ink)]">
          {importedCount > 0 ? `${importedCount} ${noun} амжилттай бүртгэгдлээ.` : "Оруулах мөр үлдсэнгүй."}
        </p>
        <div className="flex gap-2">
          <BtnLink href={`/dashboard/services/${slug}`}>Жагсаалт руу</BtnLink>
          <Btn type="button" variant="ghost" onClick={onBack}>
            ← Багана тааруулах руу
          </Btn>
        </div>
      </div>
    );
  }

  const headers = [
    "Мөр",
    "Код",
    "Нэр",
    "Ангилал",
    "Нэгж",
    "Үнэ",
    ...(isGoods ? ["Өртөг", "Үлдэгдэл"] : ["Хугацаа", "Хугацааны нэгж", "Сануулга (сар)"]),
    "Төлөв",
  ];

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
            {pending ? "Бүртгэж байна…" : `${readyRows.length} ${noun} бүртгэх`}
          </Btn>
        </div>
      </div>

      <SelectionActions
        selection={selection}
        noun="мөр"
        actions={[
          { label: "Ангилал оноох", onSelect: () => setAssign("category") },
          { label: "Нэгж оноох", onSelect: () => setAssign("unit") },
          { label: "Хасах", variant: "ghost", onSelect: removeSelected },
        ]}
      />

      <div className="overflow-auto import-grid">
        <table className={`w-full text-sm ${isGoods ? "min-w-[1150px]" : "min-w-[1300px]"}`}>
          <thead>
            <tr className="border-b border-[var(--oc-line)]">
              <SelectAllCell selection={selection} />
              {headers.map((h) => (
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
                  <TextCell value={row.code} error={errors.code} mono narrow onChange={(v) => update(row.key, { code: v.toUpperCase() })} />
                  <TextCell value={row.name} error={errors.name} wide onChange={(v) => update(row.key, { name: v })} />
                  <td className="px-2 py-2 min-w-[170px]">
                    <Select
                      name={`cat-${row.key}`}
                      value={row.categoryId}
                      onChange={(v) => update(row.key, { categoryId: v })}
                      options={categoryOptions}
                      placeholder={row.categoryRaw ? `«${row.categoryRaw}» ?` : "— Ангилал —"}
                      error={errors.categoryId}
                      searchable={categoryOptions.length > 8}
                    />
                  </td>
                  <td className="px-2 py-2 min-w-[140px]">
                    <Select
                      name={`unit-${row.key}`}
                      value={row.unitId}
                      onChange={(v) => update(row.key, { unitId: v })}
                      options={unitOptions}
                      placeholder={row.unitRaw ? `«${row.unitRaw}» ?` : "— Нэгж —"}
                      error={errors.unitId}
                      searchable={unitOptions.length > 8}
                    />
                  </td>
                  <TextCell value={row.price} error={errors.price} mono narrow onChange={(v) => update(row.key, { price: v })} />
                  {isGoods ? (
                    <>
                      <TextCell value={row.costPrice} error={errors.costPrice} mono narrow onChange={(v) => update(row.key, { costPrice: v })} />
                      <TextCell value={row.stock} error={errors.stock} mono narrow placeholder="0" onChange={(v) => update(row.key, { stock: v })} />
                    </>
                  ) : (
                    <>
                      <TextCell
                        value={row.durationValue}
                        error={errors.durationValue}
                        mono
                        narrow
                        onChange={(v) => update(row.key, { durationValue: v })}
                      />
                      <td className="px-2 py-2 min-w-[140px]">
                        <Select
                          name={`dur-${row.key}`}
                          value={row.durationUnitId}
                          onChange={(v) => update(row.key, { durationUnitId: v, durationUnitRaw: v ? row.durationUnitRaw : "" })}
                          options={unitOptions}
                          placeholder={row.durationUnitRaw ? `«${row.durationUnitRaw}» ?` : "— Байхгүй —"}
                          error={errors.durationUnitId}
                          clearable
                          searchable={unitOptions.length > 8}
                        />
                      </td>
                      <TextCell
                        value={row.reminderIntervalMonths}
                        error={errors.reminderIntervalMonths}
                        mono
                        narrow
                        onChange={(v) => update(row.key, { reminderIntervalMonths: v })}
                      />
                    </>
                  )}
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
          title={assign === "category" ? "Ангилал оноох" : "Нэгж оноох"}
          description={`Сонгосон ${selection.selected.size} мөрөнд ${assign === "category" ? "ангилал" : "хэмжих нэгж"} оноох.`}
          placeholder={assign === "category" ? "— Ангилал сонгох —" : "— Нэгж сонгох —"}
          options={assign === "category" ? categories : units}
          onClose={() => setAssign(null)}
          onApply={(id) => {
            applyToSelected(assign === "category" ? { categoryId: id } : { unitId: id });
            setAssign(null);
          }}
        />
      ) : null}
    </div>
  );
}
