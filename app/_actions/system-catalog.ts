"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { Prisma } from "@/app/generated/prisma/client";
import { createCatalogItemAdmin, loadSystemCategories, matchSystemCategory } from "@/lib/catalog/catalog-admin";
import {
  type CatalogImportRow,
  type CatalogRaw,
  type CatalogType,
  parseCatalogInput,
  parseCatalogType,
  sheetToCatalogRows,
} from "@/lib/catalog/catalog-input";
import { MAX_IMPORT_BYTES, MAX_IMPORT_ROWS } from "@/lib/import/mapping";
import { ImportParseError, parseImportWorkbook } from "@/lib/import/xlsx-server";
import { requireSuperAdmin } from "@/lib/auth/system";
import {
  cleanCatalogName,
  isValidBarcode,
  normalizeBarcode,
  normalizeCatalogCode,
  normalizeCatalogName,
} from "@/lib/catalog/normalize";
import { parseNonNegativeDecimal } from "@/lib/decimal-input";
import { prisma } from "@/lib/prisma";

export type SystemCatalogState = {
  ok: boolean;
  message?: string;
  fieldErrors?: Record<string, string>;
} | null;

function s(fd: FormData, key: string): string {
  const v = fd.get(key);
  return typeof v === "string" ? v.trim() : "";
}

const DUPLICATE_MESSAGE = "Ийм нэр/кодтой мөр санд аль хэдийн байна — «Нэгтгэх»-ийг ашиглана уу.";

/**
 * Сангийн мөрийн нэр/кодыг холбогдсон тенантуудын Service-д дамжуулна.
 * Тенант дотор код давхцвал (Service @@unique[tenantId,type,code]) тэр
 * service-ийн кодыг хэвээр үлдээж нэрийг л солино. Буцаах: код давхцсан тоо.
 */
async function syncLinkedServices(
  itemId: string,
  name: string,
  code: string | null,
  barcode: string | null,
): Promise<number> {
  const linked = await prisma.service.findMany({ where: { catalogItemId: itemId }, select: { id: true } });
  let codeConflicts = 0;
  for (const svc of linked) {
    try {
      await prisma.service.update({ where: { id: svc.id }, data: { name, code, barcode } });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        await prisma.service.update({ where: { id: svc.id }, data: { name, barcode } });
        codeConflicts++;
      } else {
        throw e;
      }
    }
  }
  return codeConflicts;
}

function revalidate(id?: string) {
  revalidatePath("/system/catalog");
  if (id) revalidatePath(`/system/catalog/${id}`);
  revalidatePath("/dashboard/services", "layout");
}

export async function updateCatalogItemAction(
  _prev: SystemCatalogState,
  formData: FormData,
): Promise<SystemCatalogState> {
  await requireSuperAdmin();
  const id = s(formData, "id");
  const name = cleanCatalogName(s(formData, "name"));
  const code = normalizeCatalogCode(s(formData, "code"));
  const barcode = normalizeBarcode(s(formData, "barcode"));
  const unitName = s(formData, "unitName");
  const price = parseNonNegativeDecimal(s(formData, "price"));
  const categoryId = s(formData, "categoryId") || null;
  const description = s(formData, "description") || null;
  const isActive = formData.get("isActive") === "on";

  const fieldErrors: Record<string, string> = {};
  if (!name) fieldErrors.name = "Нэр оруулна уу.";
  if (name.length > 200) fieldErrors.name = "Хэт урт байна.";
  if (!unitName) fieldErrors.unitName = "Нэгж оруулна уу.";
  if (!price) fieldErrors.price = "Үнэ буруу.";
  if (barcode && !isValidBarcode(barcode)) fieldErrors.barcode = "Баркод буруу (4–64 тэмдэгт: тоо, үсэг, - .).";
  if (Object.keys(fieldErrors).length > 0) return { ok: false, fieldErrors };

  const item = await prisma.catalogItem.findUnique({ where: { id }, select: { id: true, type: true } });
  if (!item) return { ok: false, message: "Мөр олдсонгүй." };
  if (categoryId) {
    const cat = await prisma.category.findFirst({
      where: { id: categoryId, tenantId: null, OR: [{ kind: item.type }, { kind: null }] },
      select: { id: true },
    });
    if (!cat) return { ok: false, fieldErrors: { categoryId: "Системийн ангилал биш байна." } };
  }

  try {
    await prisma.catalogItem.update({
      where: { id },
      data: {
        name,
        nameKey: normalizeCatalogName(name),
        code,
        codeKey: code,
        barcode: item.type === "GOODS" ? barcode : null,
        unitName,
        price: price!,
        categoryId,
        description,
        isActive,
      },
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return { ok: false, message: DUPLICATE_MESSAGE };
    }
    throw e;
  }

  const conflicts = await syncLinkedServices(id, name, code, item.type === "GOODS" ? barcode : null);
  revalidate(id);
  return {
    ok: true,
    message: conflicts
      ? `Хадгалагдлаа. ${conflicts} байгууллагад код давхцсан тул кодыг хэвээр үлдээв.`
      : "Хадгалагдлаа — холбогдсон бүх байгууллагад шинэчлэгдлээ.",
  };
}

/**
 * Давхардсан мөрийг (source) зорилтот мөрөнд (target) нэгтгэнэ: холбогдсон
 * service-үүдийг target руу шилжүүлж, нэр/кодыг sync хийгээд source-ийг
 * устгана. Аль нэг байгууллага хоёуланг нь холбосон бол хориглоно.
 */
export async function mergeCatalogItemAction(
  _prev: SystemCatalogState,
  formData: FormData,
): Promise<SystemCatalogState> {
  await requireSuperAdmin();
  const sourceId = s(formData, "sourceId");
  const targetId = s(formData, "targetId");
  if (!sourceId || !targetId || sourceId === targetId) return { ok: false, message: "Нэгтгэх мөрөө сонгоно уу." };

  const [source, target] = await Promise.all([
    prisma.catalogItem.findUnique({ where: { id: sourceId }, select: { id: true, type: true } }),
    prisma.catalogItem.findUnique({ where: { id: targetId }, select: { id: true, type: true, name: true, code: true, barcode: true } }),
  ]);
  if (!source || !target) return { ok: false, message: "Мөр олдсонгүй." };
  if (source.type !== target.type) return { ok: false, message: "Ажил ба сэлбэгийг хооронд нь нэгтгэх боломжгүй." };

  const [sourceTenants, targetTenants] = await Promise.all([
    prisma.service.findMany({ where: { catalogItemId: sourceId }, select: { tenantId: true } }),
    prisma.service.findMany({ where: { catalogItemId: targetId }, select: { tenantId: true } }),
  ]);
  const targetSet = new Set(targetTenants.map((t) => t.tenantId));
  const both = [...new Set(sourceTenants.map((t) => t.tenantId).filter((t) => targetSet.has(t)))];
  if (both.length > 0) {
    const tenants = await prisma.tenant.findMany({ where: { id: { in: both } }, select: { name: true } });
    return {
      ok: false,
      message: `Дараах байгууллага хоёуланг нь бүртгэсэн тул нэгтгэх боломжгүй: ${tenants.map((t) => t.name).join(", ")}.`,
    };
  }

  await prisma.service.updateMany({ where: { catalogItemId: sourceId }, data: { catalogItemId: targetId } });
  const conflicts = await syncLinkedServices(targetId, target.name, target.code, target.barcode);
  await prisma.catalogItem.delete({ where: { id: sourceId } });

  revalidate(targetId);
  return {
    ok: true,
    message: conflicts
      ? `Нэгтгэлээ. ${conflicts} байгууллагад код давхцсан тул кодыг хэвээр үлдээв.`
      : "Нэгтгэлээ.",
  };
}

// --- Шинээр бүртгэх / Excel импорт ------------------------------------------

export type CatalogCreateState = {
  ok: boolean;
  message?: string;
  fieldErrors?: Record<string, string>;
  existingId?: string;
} | null;

/** Super admin гараар санд шинэ ажил/сэлбэг нэмнэ → амжилттай бол мөрийн хуудас руу. */
export async function createCatalogItemAction(
  _prev: CatalogCreateState,
  formData: FormData,
): Promise<CatalogCreateState> {
  await requireSuperAdmin();
  const type = parseCatalogType(s(formData, "type"));
  if (!type) return { ok: false, fieldErrors: { type: "Төрөл сонгоно уу." } };
  const parsed = parseCatalogInput(type, {
    name: s(formData, "name"),
    code: s(formData, "code"),
    barcode: s(formData, "barcode"),
    unitName: s(formData, "unitName"),
    price: s(formData, "price"),
    category: s(formData, "categoryId"),
    durationValue: s(formData, "durationValue"),
    durationUnitName: s(formData, "durationUnitName"),
    description: s(formData, "description"),
  });
  if (!parsed.ok) return { ok: false, fieldErrors: parsed.errors as Record<string, string> };

  const outcome = await createCatalogItemAdmin(parsed.values, await loadSystemCategories(type));
  if (!outcome.ok) {
    if (outcome.reason === "category") return { ok: false, fieldErrors: { categoryId: "Системийн ангилал олдсонгүй." } };
    return {
      ok: false,
      message: `Ийм ${parsed.values.code ? "кодтой" : "нэртэй"} мөр санд аль хэдийн байна: ${outcome.existing.name}${outcome.existing.code ? ` (${outcome.existing.code})` : ""}.`,
      existingId: outcome.existing.id,
    };
  }
  revalidatePath("/system/catalog");
  redirect(`/system/catalog/${outcome.id}`);
}

export type CatalogPreviewRow = {
  excelRow: number;
  raw: CatalogRaw;
  status: "ok" | "error" | "exists" | "duplicate";
  message: string | null;
};

export type CatalogPreviewResult =
  | { ok: true; type: CatalogType; fileName: string; rows: CatalogPreviewRow[] }
  | { ok: false; message: string };

function previewKey(type: CatalogType, v: { name: string; code: string | null }): string {
  return v.code ? `${type}|c|${v.code}` : `${type}|n|${normalizeCatalogName(v.name)}`;
}

/** Excel файлыг уншиж мөр бүрийг шалгана (алдаа, санд байгаа, файлд давхардсан). Юу ч бичихгүй. */
export async function previewCatalogImportAction(formData: FormData): Promise<CatalogPreviewResult> {
  await requireSuperAdmin();
  const type = parseCatalogType(s(formData, "type"));
  if (!type) return { ok: false, message: "Төрөл сонгоно уу." };
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { ok: false, message: "Excel файлаа сонгоно уу." };
  if (!/\.xlsx$/i.test(file.name)) return { ok: false, message: "Зөвхөн .xlsx файл оруулна." };
  if (file.size > MAX_IMPORT_BYTES) return { ok: false, message: "Файл 2MB-аас хэтэрсэн байна." };

  let sheet;
  try {
    sheet = await parseImportWorkbook(await file.arrayBuffer());
  } catch (e) {
    if (e instanceof ImportParseError) return { ok: false, message: e.message };
    console.error("[catalog-import] parse failed:", e);
    return { ok: false, message: "Файлыг уншиж чадсангүй." };
  }
  const { rows, missingColumns } = sheetToCatalogRows(type, sheet);
  if (missingColumns.length > 0) {
    return { ok: false, message: `Заавал баганууд олдсонгүй: ${missingColumns.join(", ")}. Загвар файлыг ашиглана уу.` };
  }
  if (rows.length === 0) return { ok: false, message: "Файлд мөр алга." };
  if (rows.length > MAX_IMPORT_ROWS) return { ok: false, message: `Нэг удаад ${MAX_IMPORT_ROWS} мөр хүртэл.` };

  const categories = await loadSystemCategories(type);
  const parsed = rows.map((r) => ({ r, p: parseCatalogInput(type, r.raw) }));
  const valid = parsed.flatMap(({ p }) => (p.ok ? [p.values] : []));
  const existing = await prisma.catalogItem.findMany({
    where: {
      type,
      OR: [
        { codeKey: { in: valid.flatMap((v) => (v.code ? [v.code] : [])) } },
        { codeKey: null, nameKey: { in: valid.filter((v) => !v.code).map((v) => normalizeCatalogName(v.name)) } },
      ],
    },
    select: { codeKey: true, nameKey: true },
  });
  const existingKeys = new Set(existing.map((e) => (e.codeKey ? `${type}|c|${e.codeKey}` : `${type}|n|${e.nameKey}`)));
  const barcodes = valid.flatMap((v) => (v.barcode ? [v.barcode] : []));
  const existingBarcodes = new Set(
    barcodes.length
      ? (await prisma.catalogItem.findMany({ where: { barcode: { in: barcodes } }, select: { barcode: true } })).map((e) => e.barcode)
      : [],
  );
  const seen = new Map<string, number>();
  const seenBarcode = new Map<string, number>();

  const out: CatalogPreviewRow[] = parsed.map(({ r, p }) => {
    if (!p.ok) return { excelRow: r.excelRow, raw: r.raw, status: "error", message: Object.values(p.errors).join(" ") };
    if (type === "GOODS" && matchSystemCategory(categories, p.values.category) === undefined) {
      return { excelRow: r.excelRow, raw: r.raw, status: "error", message: `«${p.values.category}» системийн ангилал олдсонгүй.` };
    }
    const key = previewKey(type, p.values);
    if (existingKeys.has(key) || (p.values.barcode && existingBarcodes.has(p.values.barcode))) {
      return { excelRow: r.excelRow, raw: r.raw, status: "exists", message: "Санд аль хэдийн байна — алгасна." };
    }
    const firstBc = p.values.barcode ? seenBarcode.get(p.values.barcode) : undefined;
    if (firstBc != null) {
      return { excelRow: r.excelRow, raw: r.raw, status: "duplicate", message: `Файлын ${firstBc}-р мөртэй ижил баркод — алгасна.` };
    }
    if (p.values.barcode) seenBarcode.set(p.values.barcode, r.excelRow);
    const first = seen.get(key);
    if (first != null) {
      return { excelRow: r.excelRow, raw: r.raw, status: "duplicate", message: `Файлын ${first}-р мөртэй давхардсан — алгасна.` };
    }
    seen.set(key, r.excelRow);
    return { excelRow: r.excelRow, raw: r.raw, status: "ok", message: null };
  });
  return { ok: true, type, fileName: file.name, rows: out };
}

export type CatalogImportResult =
  | { ok: true; created: number; skipped: number; failed: { excelRow: number; message: string }[] }
  | { ok: false; message: string };

/** Урьдчилан харсан мөрүүдийг санд нэмнэ (server дээр дахин шалгана; давхардлыг алгасна). */
export async function importCatalogRowsAction(type: unknown, rows: unknown): Promise<CatalogImportResult> {
  await requireSuperAdmin();
  const t = parseCatalogType(type);
  if (!t) return { ok: false, message: "Төрөл буруу." };
  if (!Array.isArray(rows) || rows.length === 0 || rows.length > MAX_IMPORT_ROWS) {
    return { ok: false, message: "Оруулах мөр алга эсвэл хэт олон." };
  }
  const categories = await loadSystemCategories(t);
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  let created = 0;
  let skipped = 0;
  const failed: { excelRow: number; message: string }[] = [];
  for (const item of rows as Partial<CatalogImportRow>[]) {
    const raw = (item?.raw ?? null) as Record<string, unknown> | null;
    const excelRow = Number(item?.excelRow) || 0;
    if (!raw || typeof raw !== "object") {
      failed.push({ excelRow, message: "Мөр буруу." });
      continue;
    }
    const parsed = parseCatalogInput(t, {
      name: str(raw.name),
      code: str(raw.code),
      barcode: str(raw.barcode),
      unitName: str(raw.unitName),
      price: str(raw.price),
      category: str(raw.category),
      durationValue: str(raw.durationValue),
      durationUnitName: str(raw.durationUnitName),
      description: str(raw.description),
    });
    if (!parsed.ok) {
      failed.push({ excelRow, message: Object.values(parsed.errors).join(" ") });
      continue;
    }
    const outcome = await createCatalogItemAdmin(parsed.values, categories);
    if (outcome.ok) created++;
    else if (outcome.reason === "exists") skipped++;
    else failed.push({ excelRow, message: "Системийн ангилал олдсонгүй." });
  }
  revalidatePath("/system/catalog");
  return { ok: true, created, skipped, failed };
}
