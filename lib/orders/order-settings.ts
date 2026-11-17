// Засварын хуудасны тохиргоо (tenant бүр) — TenantOrderSettings.
//
// Мөр байхгүй tenant ORDER_SETTINGS_DEFAULTS-аар ажиллана: энэ нь өмнөх хатуу
// дүрэмтэй ЯГ адил (дугаар 00001, хариуцагч заавал, хаахад оношилгоо/бүх ажил/
// бүрэн төлбөр заавал, A4 хэвлэлт). Client-д ч импортлогдох тул энд зөвхөн
// цэвэр функц/тогтмол — DB-тэй ажиллах нь order-settings-server.ts-д.

export const CHECKLIST_STATUSES = ["OK", "ISSUE", "NA"] as const;
export type ChecklistStatus = (typeof CHECKLIST_STATUSES)[number];

export const CHECKLIST_STATUS_LABEL: Record<ChecklistStatus, string> = {
  OK: "Хэвийн",
  ISSUE: "Асуудалтай",
  NA: "Хамаарахгүй",
};

/** Tenant-ийн тодорхойлсон шалгах жагсаалтын мөр. */
export type ChecklistItemDef = { id: string; label: string };

/** Захиалга дээр хадгалагдах snapshot мөр. */
export type ChecklistAnswer = { label: string; status: ChecklistStatus; note?: string | null };

export const PRINT_FORMATS = ["a4", "80mm"] as const;
export type OrderPrintFormat = (typeof PRINT_FORMATS)[number];

export type OrderSettings = {
  numberPrefix: string;
  numberPadding: number;
  numberIncludeYear: boolean;
  requireAssignee: boolean;
  requireMileage: boolean;
  requireSignature: boolean;
  minIntakePhotos: number;
  requireChecklist: boolean;
  intakeChecklist: ChecklistItemDef[];
  requireDiagnosticsFilled: boolean;
  requireItemsCompleted: boolean;
  allowCloseUnpaid: boolean;
  printFormat: OrderPrintFormat;
  printHeaderNote: string | null;
  printFooterNote: string | null;
  printSignatureLines: boolean;
  printShowChecklist: boolean;
};

export const ORDER_SETTINGS_DEFAULTS: OrderSettings = {
  numberPrefix: "",
  numberPadding: 5,
  numberIncludeYear: false,
  requireAssignee: true,
  requireMileage: false,
  requireSignature: false,
  minIntakePhotos: 0,
  requireChecklist: false,
  intakeChecklist: [],
  requireDiagnosticsFilled: true,
  requireItemsCompleted: true,
  allowCloseUnpaid: false,
  printFormat: "a4",
  printHeaderNote: null,
  printFooterNote: null,
  printSignatureLines: true,
  printShowChecklist: true,
};

export const NUMBER_PREFIX_MAX = 10;
export const NUMBER_PADDING_MIN = 3;
export const NUMBER_PADDING_MAX = 8;
export const CHECKLIST_MAX_ITEMS = 50;
export const CHECKLIST_LABEL_MAX = 80;
export const CHECKLIST_NOTE_MAX = 300;
export const PRINT_HEADER_NOTE_MAX = 500;
export const PRINT_FOOTER_NOTE_MAX = 2000;
export const INTAKE_PHOTOS_REQUIRED_MAX = 20;

// Угтвар: латин/кирилл үсэг, тоо, «-», «/», «.» — дугаар URL/хэвлэлтэд аюулгүй.
const PREFIX_RE = /^[A-Za-z0-9А-Яа-яЁёӨөҮү\-/.]*$/;

/** DB мөр (эсвэл null) → бүрэн OrderSettings (буруу/хуучин утгыг анхдагчаар). */
export function normalizeOrderSettings(row: Partial<Record<keyof OrderSettings, unknown>> | null | undefined): OrderSettings {
  if (!row) return { ...ORDER_SETTINGS_DEFAULTS, intakeChecklist: [] };
  const d = ORDER_SETTINGS_DEFAULTS;
  const bool = (v: unknown, fb: boolean) => (typeof v === "boolean" ? v : fb);
  const int = (v: unknown, fb: number) => (typeof v === "number" && Number.isInteger(v) ? v : fb);
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v : null);
  return {
    numberPrefix: typeof row.numberPrefix === "string" ? row.numberPrefix : d.numberPrefix,
    numberPadding: int(row.numberPadding, d.numberPadding),
    numberIncludeYear: bool(row.numberIncludeYear, d.numberIncludeYear),
    requireAssignee: bool(row.requireAssignee, d.requireAssignee),
    requireMileage: bool(row.requireMileage, d.requireMileage),
    requireSignature: bool(row.requireSignature, d.requireSignature),
    minIntakePhotos: int(row.minIntakePhotos, d.minIntakePhotos),
    requireChecklist: bool(row.requireChecklist, d.requireChecklist),
    intakeChecklist: parseChecklistDefs(row.intakeChecklist),
    requireDiagnosticsFilled: bool(row.requireDiagnosticsFilled, d.requireDiagnosticsFilled),
    requireItemsCompleted: bool(row.requireItemsCompleted, d.requireItemsCompleted),
    allowCloseUnpaid: bool(row.allowCloseUnpaid, d.allowCloseUnpaid),
    printFormat: (PRINT_FORMATS as readonly unknown[]).includes(row.printFormat)
      ? (row.printFormat as OrderPrintFormat)
      : d.printFormat,
    printHeaderNote: str(row.printHeaderNote),
    printFooterNote: str(row.printFooterNote),
    printSignatureLines: bool(row.printSignatureLines, d.printSignatureLines),
    printShowChecklist: bool(row.printShowChecklist, d.printShowChecklist),
  };
}

function parseChecklistDefs(v: unknown): ChecklistItemDef[] {
  if (!Array.isArray(v)) return [];
  const out: ChecklistItemDef[] = [];
  for (const it of v) {
    if (it && typeof it === "object") {
      const { id, label } = it as Record<string, unknown>;
      if (typeof id === "string" && id && typeof label === "string" && label.trim()) {
        out.push({ id, label: label.trim() });
      }
    }
  }
  return out;
}

export type OrderSettingsInput = Partial<Record<keyof OrderSettings, unknown>>;

/**
 * Web form болон API JSON-д нийтлэг шалгалт. `input`-д байхгүй талбарыг
 * `current`-ээс авна (API PATCH хэсэгчилсэн байж болно).
 */
export function validateOrderSettings(
  input: OrderSettingsInput,
  current: OrderSettings = ORDER_SETTINGS_DEFAULTS,
): { ok: true; value: OrderSettings } | { ok: false; fieldErrors: Record<string, string> } {
  const errors: Record<string, string> = {};
  const pick = <K extends keyof OrderSettings>(k: K): unknown => (k in input ? input[k] : current[k]);

  const boolField = (k: keyof OrderSettings): boolean => {
    const v = pick(k);
    if (typeof v !== "boolean") {
      errors[k] = "Буруу утга.";
      return false;
    }
    return v;
  };
  const intField = (k: keyof OrderSettings, min: number, max: number, msg: string): number => {
    const raw = pick(k);
    const v = typeof raw === "string" && raw.trim() !== "" ? Number(raw) : raw;
    if (typeof v !== "number" || !Number.isInteger(v) || v < min || v > max) {
      errors[k] = msg;
      return min;
    }
    return v;
  };
  const textField = (k: keyof OrderSettings, max: number): string | null => {
    const v = pick(k);
    if (v == null) return null;
    if (typeof v !== "string") {
      errors[k] = "Буруу утга.";
      return null;
    }
    const t = v.replace(/\r\n/g, "\n").trim();
    if (t.length > max) errors[k] = `${max} тэмдэгтээс хэтрэхгүй.`;
    return t || null;
  };

  const prefixRaw = pick("numberPrefix");
  const numberPrefix = typeof prefixRaw === "string" ? prefixRaw.trim() : "";
  if (typeof prefixRaw !== "string" && prefixRaw != null) errors.numberPrefix = "Буруу утга.";
  else if (numberPrefix.length > NUMBER_PREFIX_MAX) errors.numberPrefix = `Угтвар ${NUMBER_PREFIX_MAX} тэмдэгтээс хэтрэхгүй.`;
  else if (!PREFIX_RE.test(numberPrefix)) errors.numberPrefix = "Угтварт зөвхөн үсэг, тоо, «-», «/», «.» ашиглана.";

  const numberPadding = intField("numberPadding", NUMBER_PADDING_MIN, NUMBER_PADDING_MAX, `Оронгийн тоо ${NUMBER_PADDING_MIN}–${NUMBER_PADDING_MAX}.`);
  const minIntakePhotos = intField("minIntakePhotos", 0, INTAKE_PHOTOS_REQUIRED_MAX, `Зургийн тоо 0–${INTAKE_PHOTOS_REQUIRED_MAX}.`);

  const checklistRaw = pick("intakeChecklist");
  const intakeChecklist: ChecklistItemDef[] = [];
  if (!Array.isArray(checklistRaw)) {
    errors.intakeChecklist = "Буруу утга.";
  } else if (checklistRaw.length > CHECKLIST_MAX_ITEMS) {
    errors.intakeChecklist = `Хамгийн ихдээ ${CHECKLIST_MAX_ITEMS} мөр.`;
  } else {
    const seenIds = new Set<string>();
    const seenLabels = new Set<string>();
    for (const it of checklistRaw) {
      const rec = it && typeof it === "object" ? (it as Record<string, unknown>) : {};
      const label = typeof rec.label === "string" ? rec.label.trim().replace(/\s+/g, " ") : "";
      if (!label) continue; // хоосон мөрийг чимээгүй алгасна
      if (label.length > CHECKLIST_LABEL_MAX) {
        errors.intakeChecklist = `Мөрийн нэр ${CHECKLIST_LABEL_MAX} тэмдэгтээс хэтрэхгүй.`;
        break;
      }
      const key = label.toLowerCase();
      if (seenLabels.has(key)) {
        errors.intakeChecklist = `«${label}» давхардсан байна.`;
        break;
      }
      seenLabels.add(key);
      let id = typeof rec.id === "string" && /^[A-Za-z0-9_-]{1,40}$/.test(rec.id) ? rec.id : "";
      if (!id || seenIds.has(id)) id = newChecklistId(seenIds);
      seenIds.add(id);
      intakeChecklist.push({ id, label });
    }
  }

  const value: OrderSettings = {
    numberPrefix,
    numberPadding,
    numberIncludeYear: boolField("numberIncludeYear"),
    requireAssignee: boolField("requireAssignee"),
    requireMileage: boolField("requireMileage"),
    requireSignature: boolField("requireSignature"),
    minIntakePhotos,
    requireChecklist: boolField("requireChecklist"),
    intakeChecklist,
    requireDiagnosticsFilled: boolField("requireDiagnosticsFilled"),
    requireItemsCompleted: boolField("requireItemsCompleted"),
    allowCloseUnpaid: boolField("allowCloseUnpaid"),
    printFormat: "a4",
    printHeaderNote: textField("printHeaderNote", PRINT_HEADER_NOTE_MAX),
    printFooterNote: textField("printFooterNote", PRINT_FOOTER_NOTE_MAX),
    printSignatureLines: boolField("printSignatureLines"),
    printShowChecklist: boolField("printShowChecklist"),
  };
  const fmt = pick("printFormat");
  if ((PRINT_FORMATS as readonly unknown[]).includes(fmt)) value.printFormat = fmt as OrderPrintFormat;
  else errors.printFormat = "Хэвлэх хэмжээ буруу.";

  if (value.requireChecklist && value.intakeChecklist.length === 0 && !errors.intakeChecklist) {
    errors.requireChecklist = "Шалгах жагсаалтад дор хаяж нэг мөр нэмнэ үү.";
  }

  return Object.keys(errors).length > 0 ? { ok: false, fieldErrors: errors } : { ok: true, value };
}

function newChecklistId(taken: Set<string>): string {
  for (;;) {
    const id = `c${Math.random().toString(36).slice(2, 10)}`;
    if (!taken.has(id)) return id;
  }
}

/** Монголын цагийн бүсээрх он (дугаарлалтын жил). */
export function orderNumberYear(now: Date = new Date()): number {
  return Number(
    new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Ulaanbaatar", year: "numeric" }).format(now),
  );
}

/** {prefix}{YYYY-}{seq padStart(padding)} — ж: «ZS-2026-0001», анхдагч «00001». */
export function formatOrderNumber(
  settings: Pick<OrderSettings, "numberPrefix" | "numberPadding" | "numberIncludeYear">,
  seq: number,
  year: number,
): string {
  const yearPart = settings.numberIncludeYear ? `${year}-` : "";
  return `${settings.numberPrefix}${yearPart}${String(seq).padStart(settings.numberPadding, "0")}`;
}

/**
 * Хүлээн авалтын шалгах жагсаалтын хариулт (API/форм) → snapshot. Tenant-ийн
 * жагсаалтад байхгүй id, буруу status-ыг алдаа гэж үзнэ. `requireAll` үед бүх
 * мөрөнд хариулт заавал. Хоосон (хариултгүй) бол null.
 */
export function buildChecklistSnapshot(
  defs: ChecklistItemDef[],
  raw: unknown,
  requireAll: boolean,
): { ok: true; value: ChecklistAnswer[] | null } | { ok: false; error: string } {
  const answers = new Map<string, { status: ChecklistStatus; note: string | null }>();
  if (raw != null) {
    if (!Array.isArray(raw)) return { ok: false, error: "Шалгах жагсаалтын хариулт буруу." };
    const known = new Set(defs.map((d) => d.id));
    for (const it of raw) {
      const rec = it && typeof it === "object" ? (it as Record<string, unknown>) : null;
      if (!rec || typeof rec.id !== "string" || !known.has(rec.id)) {
        return { ok: false, error: "Шалгах жагсаалтын мөр олдсонгүй. Хуудсаа шинэчлээд дахин оролдоно уу." };
      }
      if (rec.status === "" || rec.status == null) continue;
      if (!(CHECKLIST_STATUSES as readonly unknown[]).includes(rec.status)) {
        return { ok: false, error: "Шалгах жагсаалтын төлөв буруу." };
      }
      const note = typeof rec.note === "string" ? rec.note.trim() : "";
      if (note.length > CHECKLIST_NOTE_MAX) {
        return { ok: false, error: `Шалгах жагсаалтын тэмдэглэл ${CHECKLIST_NOTE_MAX} тэмдэгтээс хэтрэхгүй.` };
      }
      answers.set(rec.id, { status: rec.status as ChecklistStatus, note: note || null });
    }
  }
  if (requireAll) {
    const missing = defs.filter((d) => !answers.has(d.id));
    if (missing.length > 0) {
      return { ok: false, error: `Шалгах жагсаалтын ${missing.length} мөр бөглөгдөөгүй байна.` };
    }
  }
  if (answers.size === 0) return { ok: true, value: null };
  return {
    ok: true,
    value: defs
      .filter((d) => answers.has(d.id))
      .map((d) => {
        const a = answers.get(d.id)!;
        return { label: d.label, status: a.status, ...(a.note ? { note: a.note } : {}) };
      }),
  };
}

/** Захиалга дээрх snapshot JSON → харуулах/хэвлэх мөрүүд (буруу хэлбэрийг алгасна). */
export function parseChecklistSnapshot(v: unknown): ChecklistAnswer[] {
  if (!Array.isArray(v)) return [];
  const out: ChecklistAnswer[] = [];
  for (const it of v) {
    const rec = it && typeof it === "object" ? (it as Record<string, unknown>) : null;
    if (
      rec &&
      typeof rec.label === "string" &&
      (CHECKLIST_STATUSES as readonly unknown[]).includes(rec.status)
    ) {
      out.push({
        label: rec.label,
        status: rec.status as ChecklistStatus,
        note: typeof rec.note === "string" ? rec.note : null,
      });
    }
  }
  return out;
}
