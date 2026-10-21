// Ангиллын төрөл (Category.kind) ба системийн ангиллын нийтлэг дүрэм.
//   kind = LABOR | GOODS | DIAGNOSTIC — зөвхөн тухайн төрлийн Service/загварт;
//   kind = null — бүх төрөлд (хуучин ангиллууд).
//   tenantId = null — СИСТЕМИЙН ангилал: бүх тенантад харагдана, тенант засахгүй.
// Client-safe (Prisma импортгүй — where объект нь энгийн JSON).

export type CategoryKind = "LABOR" | "GOODS" | "DIAGNOSTIC";

export const CATEGORY_KINDS: readonly CategoryKind[] = ["LABOR", "GOODS", "DIAGNOSTIC"];

export const CATEGORY_KIND_LABEL: Record<CategoryKind | "ANY", string> = {
  LABOR: "Ажил үйлчилгээ",
  GOODS: "Сэлбэг / бараа",
  DIAGNOSTIC: "Оношилгоо",
  ANY: "Бүх төрөлд",
};

export function categoryKindLabel(kind: CategoryKind | null | undefined): string {
  return CATEGORY_KIND_LABEL[kind ?? "ANY"];
}

/** Тухайн төрлийн Service/загварт энэ ангиллыг ашиглаж болох эсэх. */
export function categoryAllowsKind(categoryKind: CategoryKind | null | undefined, type: CategoryKind): boolean {
  return categoryKind == null || categoryKind === type;
}

export function isSystemCategory(c: { tenantId: string | null }): boolean {
  return c.tenantId === null;
}

/**
 * Тухайн төрөлд сонгож болох ангиллууд: тенантын өөрийнх + системийнх,
 * төрөл таарсан эсвэл «бүх төрөлд». (`isActive`-ийг дуудагч өөрөө нэмнэ.)
 */
export function categoriesForKindWhere(tenantId: string, type: CategoryKind) {
  return {
    AND: [
      { OR: [{ tenantId }, { tenantId: null }] },
      { OR: [{ kind: type }, { kind: null }] },
    ],
  };
}

/** Онлайн цаг захиалгад (discover, book, day-availability) — зөвхөн ажил үйлчилгээ. */
export const BOOKABLE_CATEGORY_WHERE = { OR: [{ kind: "LABOR" as const }, { kind: null }] };
