// Ажил / сэлбэг (Service) ҮҮСГЭХ дүрэм — client + server safe (Prisma-гүй).
// Нэг газар: вэб форм (createServiceAction) болон Excel импорт (client дээр
// урьдчилан, server дээр дахин) хоёулаа энэ функцээр шалгана. Мессежүүд
// өмнөх createServiceAction-ийн validate()-тэй ижил.

import { SERVICE_KINDS, type ServiceKind } from "@/lib/services";

/** Формын/Excel-ийн түүхий утгууд (бүгд string). */
export type ServiceCreateRaw = {
  type: string;
  name: string;
  code: string;
  unitId: string;
  price: string;
  costPrice: string;
  stock: string;
  durationValue: string;
  durationUnitId: string;
  reminderIntervalMonths: string;
  description: string;
  categoryId: string;
  isActive: boolean;
};

/** Шалгасан утгууд — тоонууд нормчлогдсон decimal string (server Decimal болгоно). */
export type ServiceCreateValues = {
  type: ServiceKind;
  name: string;
  code: string | null;
  unitId: string | null;
  price: string;
  costPrice: string | null;
  stock: string | null;
  durationValue: string | null;
  durationUnitId: string | null;
  reminderIntervalMonths: number | null;
  description: string | null;
  isActive: boolean;
  categoryId: string;
};

/** Тенантын эзэмшдэг нэгж/ангиллын id-ууд (null = шалгахгүй, зөвхөн хэлбэр). */
export type ServiceRefs = { unitIds: ReadonlySet<string>; categoryIds: ReadonlySet<string> } | null;

/** parseNonNegativeDecimal-тэй ижил дүрэм: мянгатын таслал/зай хасна, «10ш», «1e5» буруу. */
export function normalizeDecimalString(raw: string): string | null {
  const cleaned = raw.replace(/[,\s]/g, "");
  return cleaned && /^\d+(?:\.\d+)?$/.test(cleaned) ? cleaned : null;
}

export function validateServiceCreate(
  raw: ServiceCreateRaw,
  refs: ServiceRefs,
): { values: ServiceCreateValues | null; errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  const type = raw.type as ServiceKind;
  if (!SERVICE_KINDS.includes(type)) errors.type = "Төрлийг сонгоно уу.";

  const name = raw.name.trim();
  if (!name) errors.name = "Нэр оруулна уу.";
  const price = normalizeDecimalString(raw.price.trim());
  if (!price) errors.price = "Үнэ буруу.";

  const owns = (set: ReadonlySet<string> | undefined, id: string) => !set || set.has(id);

  let unitId: string | null = null;
  if (type === "LABOR" || type === "GOODS") {
    const id = raw.unitId.trim();
    if (!id) errors.unitId = "Хэмжих нэгж сонгоно уу.";
    else if (!owns(refs?.unitIds, id)) errors.unitId = "Сонгосон нэгж олдсонгүй.";
    else unitId = id;
  }

  let costPrice: string | null = null;
  let stock: string | null = null;
  if (type === "GOODS") {
    if (raw.costPrice.trim()) {
      costPrice = normalizeDecimalString(raw.costPrice.trim());
      if (!costPrice) errors.costPrice = "Өртөг үнэ буруу.";
    }
    stock = normalizeDecimalString(raw.stock.trim() || "0");
    if (!stock) errors.stock = "Үлдэгдэл буруу.";
  }

  let durationValue: string | null = null;
  let durationUnitId: string | null = null;
  if (type !== "GOODS") {
    const valueRaw = raw.durationValue.trim();
    const unitRaw = raw.durationUnitId.trim();
    if (valueRaw || unitRaw) {
      if (!valueRaw) errors.durationValue = "Хугацааны утгаа оруулна уу.";
      else {
        const d = normalizeDecimalString(valueRaw);
        if (!d || Number(d) <= 0) errors.durationValue = "Хугацаа эерэг тоо байх ёстой.";
        else durationValue = d;
      }
      if (!unitRaw) errors.durationUnitId = "Хугацааны нэгжээ сонгоно уу.";
      else if (!owns(refs?.unitIds, unitRaw)) errors.durationUnitId = "Сонгосон нэгж олдсонгүй.";
      else durationUnitId = unitRaw;
    }
  }

  let reminderIntervalMonths: number | null = null;
  const remRaw = raw.reminderIntervalMonths.trim();
  if (remRaw) {
    const n = /^\d+$/.test(remRaw) ? Number.parseInt(remRaw, 10) : Number.NaN;
    if (!Number.isFinite(n) || n <= 0) errors.reminderIntervalMonths = "Сар эерэг бүхэл тоо байх ёстой.";
    else reminderIntervalMonths = n;
  }

  const categoryId = raw.categoryId.trim();
  if (!categoryId) errors.categoryId = "Ангилал сонгоно уу.";
  else if (!owns(refs?.categoryIds, categoryId)) errors.categoryId = "Сонгосон ангилал олдсонгүй.";

  if (Object.keys(errors).length > 0) return { values: null, errors };
  return {
    values: {
      type,
      name,
      code: raw.code.trim().toUpperCase() || null,
      unitId,
      price: price!,
      costPrice,
      stock,
      durationValue,
      durationUnitId,
      reminderIntervalMonths,
      description: raw.description.trim() || null,
      isActive: raw.isActive,
      categoryId,
    },
    errors,
  };
}
