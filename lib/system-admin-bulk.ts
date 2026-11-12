/**
 * Super admin-ы лавлах жагсаалтуудын (нэгдсэн сан, сэлбэгийн ангилал,
 * системийн ангилал) олноор идэвхжүүлэх / идэвхгүй болгох / устгах нийтлэг
 * логик. Ашиглагдаж буй мөрийг устгахгүй — оронд нь идэвхгүй болгоно
 * (тенантын өгөгдөл, түүх тасрахгүй; шинэ сонголтоос л нуугдана).
 */

export type AdminBulkOp = "activate" | "deactivate" | "delete";

export type AdminBulkResult =
  | { ok: true; updated: number; deleted: number; deactivated: number; notFound: number }
  | { ok: false; message: string };

export const ADMIN_BULK_MAX = 500;

export function parseAdminBulkInput(ids: unknown, op: unknown): { ids: string[]; op: AdminBulkOp } | { error: string } {
  if (op !== "activate" && op !== "deactivate" && op !== "delete") return { error: "Үйлдэл буруу." };
  if (!Array.isArray(ids)) return { error: "Мөр сонгоно уу." };
  const clean = [...new Set(ids.filter((x): x is string => typeof x === "string" && x.length > 0 && x.length <= 64))];
  if (clean.length === 0) return { error: "Мөр сонгоно уу." };
  if (clean.length > ADMIN_BULK_MAX) return { error: `Нэг удаад ${ADMIN_BULK_MAX} мөр хүртэл.` };
  return { ids: clean, op };
}

export type AdminBulkStore = {
  /** Энэ төрлийн бодитоор байгаа id-ууд. */
  existing: (ids: string[]) => Promise<string[]>;
  /** Устгах боломжгүй (ашиглагдаж буй) id-ууд. */
  inUse: (ids: string[]) => Promise<Set<string>>;
  setActive: (ids: string[], isActive: boolean) => Promise<number>;
  remove: (ids: string[]) => Promise<number>;
};

export async function runAdminBulk(store: AdminBulkStore, ids: string[], op: AdminBulkOp): Promise<AdminBulkResult> {
  const found = await store.existing(ids);
  const notFound = ids.length - found.length;
  if (found.length === 0) return { ok: true, updated: 0, deleted: 0, deactivated: 0, notFound };

  if (op !== "delete") {
    const updated = await store.setActive(found, op === "activate");
    return { ok: true, updated, deleted: 0, deactivated: 0, notFound };
  }

  const used = await store.inUse(found);
  const free = found.filter((id) => !used.has(id));
  const busy = found.filter((id) => used.has(id));
  const deleted = free.length ? await store.remove(free) : 0;
  const deactivated = busy.length ? await store.setActive(busy, false) : 0;
  return { ok: true, updated: 0, deleted, deactivated, notFound };
}
