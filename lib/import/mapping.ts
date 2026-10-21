// Excel импортын ерөнхий (client + server safe) туслахууд — багана тааруулах,
// нэрээр тааруулах, огноо нормчлох. Ажилтан (lib/employees/import.ts) болон
// ажил/сэлбэг (lib/services/import.ts) импорт хоёулаа ашиглана.

export const MAX_IMPORT_ROWS = 500;
export const MAX_IMPORT_BYTES = 2 * 1024 * 1024;

export type ParsedSheet = {
  headers: string[];
  /** Data rows (header excluded), every cell already a trimmed string. */
  rows: Array<{ excelRow: number; cells: string[] }>;
};

export type ImportFieldDef<K extends string> = {
  key: K;
  label: string;
  required: boolean;
  /** Normalized header spellings recognised by `guessFieldMapping`. */
  aliases: readonly string[];
};

export type FieldMapping<K extends string> = Record<K, number | null>;

export type NamedOption = { id: string; name: string };

export function normalizeLabel(value: string): string {
  return value.normalize("NFC").toLowerCase().replace(/[\s_]+/g, " ").replace(/[.:*]/g, "").trim();
}

/** Auto-map Excel headers to fields; each column is used at most once. */
export function guessFieldMapping<K extends string>(
  fields: ReadonlyArray<ImportFieldDef<K>>,
  headers: readonly string[],
): FieldMapping<K> {
  const mapping = Object.fromEntries(fields.map((f) => [f.key, null])) as FieldMapping<K>;
  const used = new Set<number>();
  const normalized = headers.map(normalizeLabel);
  // Exact alias match first, then "header contains alias" — so "Утасны дугаар"
  // still maps but an exact "Нэр" wins over "Овог нэр".
  for (const pass of ["exact", "contains"] as const) {
    for (const field of fields) {
      if (mapping[field.key] !== null) continue;
      const idx = normalized.findIndex(
        (h, i) =>
          !used.has(i) &&
          h.length > 0 &&
          field.aliases.some((a) => (pass === "exact" ? h === a : h.includes(a))),
      );
      if (idx >= 0) {
        mapping[field.key] = idx;
        used.add(idx);
      }
    }
  }
  return mapping;
}

/** Match an Excel name to an option (case/space-insensitive). */
export function matchByName(options: readonly NamedOption[], raw: string): string {
  const needle = normalizeLabel(raw);
  if (!needle) return "";
  return options.find((o) => normalizeLabel(o.name) === needle)?.id ?? "";
}

/**
 * Excel date cell / typed text → "YYYY-MM-DD". Accepts 2026-12-31,
 * 2026.12.31, 2026/12/31 (the parser already turns real date cells into
 * ISO). Anything else is returned unchanged so validation flags it.
 */
export function normalizeDateCell(raw: string): string {
  const v = raw.trim();
  if (!v) return "";
  const m = /^(\d{4})[-./](\d{1,2})[-./](\d{1,2})(?:[T\s].*)?$/.exec(v);
  if (!m) return v;
  const [, y, mo, d] = m;
  const iso = `${y}-${mo!.padStart(2, "0")}-${d!.padStart(2, "0")}`;
  const date = new Date(`${iso}T00:00:00Z`);
  // Reject 2026-02-31 etc. (Date would roll it over silently).
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === iso ? iso : v;
}

export function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/** Cell lookup for a mapped field ("" when unmapped). */
export function mappedCell<K extends string>(cells: readonly string[], mapping: FieldMapping<K>, field: K): string {
  const idx = mapping[field];
  return idx === null ? "" : (cells[idx] ?? "").trim();
}
