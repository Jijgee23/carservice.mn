// Мобайл Excel импортын дундын туслах (client/server аюулгүй, DB-гүй): upload шалгах, багана тааруулалт.

import { MAX_IMPORT_BYTES, type FieldMapping } from "./mapping";

/** Multipart-ийн толгой/хил хязгаарт зориулсан нөөц (файл өөрөө MAX_IMPORT_BYTES). */
const MULTIPART_OVERHEAD = 64 * 1024;

export type UploadCheck =
  | { ok: true; file: File }
  | { ok: false; status: 400 | 413 | 415; message: string };

/**
 * Content-Length-ээр бие уншихаас ӨМНӨ том хүсэлтийг татгалзана (formData() бүгдийг санах ойд уншдаг).
 * Header байхгүй/буруу бол шалгалт алгасч, файлын бодит хэмжээгээр дараа нь шалгана.
 */
export function rejectOversizedRequest(contentLength: string | null): { status: 413; message: string } | null {
  if (contentLength == null) return null;
  const n = Number(contentLength);
  if (Number.isFinite(n) && n > MAX_IMPORT_BYTES + MULTIPART_OVERHEAD) {
    return { status: 413, message: "Файл 2MB-аас хэтэрсэн байна." };
  }
  return null;
}

/** multipart-ийн `file` талбар: байгаа, .xlsx, хоосон биш, ≤ 2MB. */
export function checkUploadedWorkbook(value: unknown): UploadCheck {
  if (!(value instanceof File) || value.size === 0) return { ok: false, status: 400, message: "Excel файлаа (file талбар) илгээнэ үү." };
  if (!/\.xlsx$/i.test(value.name)) {
    return { ok: false, status: 415, message: "Зөвхөн .xlsx файл оруулна. Excel-ээс «Save As → Excel Workbook (.xlsx)» сонгоно уу." };
  }
  if (value.size > MAX_IMPORT_BYTES) return { ok: false, status: 413, message: "Файл 2MB-аас хэтэрсэн байна." };
  return { ok: true, file: value };
}

export type MappingParse<K extends string> =
  | { ok: true; mapping: FieldMapping<K> | null }
  | { ok: false; message: string };

/**
 * Клиентийн өгсөн баганын тааруулалт (JSON: { lastName: 0, phone: 2, email: null, … }).
 * Байхгүй (undefined/хоосон) → mapping=null (дуудагч автоматаар таана). Тодорхойгүй түлхүүр, багана
 * гарчгаас хэтэрсэн индекс, нэг баганыг хоёр талбарт олгох → алдаа. Заавал талбарыг тооцохгүй (preview
 * мөр бүрийн алдааг өөрөө харуулна).
 */
export function parseMappingInput<K extends string>(
  raw: unknown,
  fieldKeys: readonly K[],
  headerCount: number,
): MappingParse<K> {
  if (raw == null || raw === "") return { ok: true, mapping: null };
  let value: unknown = raw;
  if (typeof raw === "string") {
    try {
      value = JSON.parse(raw);
    } catch {
      return { ok: false, message: "mapping нь JSON байх ёстой." };
    }
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return { ok: false, message: "mapping нь объект байх ёстой." };
  const rec = value as Record<string, unknown>;
  const known = new Set<string>(fieldKeys);
  for (const key of Object.keys(rec)) {
    if (!known.has(key)) return { ok: false, message: `Тодорхойгүй талбар: ${key}` };
  }
  const out = {} as FieldMapping<K>;
  const used = new Map<number, K>();
  for (const key of fieldKeys) {
    const v = rec[key];
    if (v == null) {
      out[key] = null;
      continue;
    }
    if (typeof v !== "number" || !Number.isInteger(v) || v < 0 || v >= headerCount) {
      return { ok: false, message: `${key}: баганын индекс 0–${Math.max(0, headerCount - 1)} хооронд байх ёстой.` };
    }
    const other = used.get(v);
    if (other) return { ok: false, message: `${key} болон ${other} нэг баганыг (${v}) сонгосон байна.` };
    used.set(v, key);
    out[key] = v;
  }
  return { ok: true, mapping: out };
}
