// System талын эрх (мобайл system realm). PURE — DB/Request хамааралгүй.
//  - ROOT (платформын бүрэн админ): бүх эрх, ирээдүйд нэмэгдэх эрхийг ч (`*`).
//  - STAFF («System ажилтан»): харилцагч (tenant) бүртгэх, засах, түр хаах/нээх. Багц, захиалга, төлбөр, зээл,
//    устгах, ангилал/каталог, админ удирдах зэргээс ХАМААРАХГҮЙ.
// Эрхийг token-д БИШ, хүсэлт бүрд DB-ээс уншсан `kind`-аас тооцно (идэвхгүй болгосон ажилтан шууд хаагдана).

export const SYSTEM_PERMISSION_CODES = ["tenants.view", "tenants.create", "tenants.edit", "tenants.suspend"] as const;
export type SystemPermission = (typeof SYSTEM_PERMISSION_CODES)[number];

export type SystemAdminKind = "ROOT" | "STAFF";

const STAFF_PERMISSIONS: readonly SystemPermission[] = ["tenants.view", "tenants.create", "tenants.edit", "tenants.suspend"];

/** Тухайн төрлийн эрхүүд (ROOT = тодорхойлогдсон бүгд). Үргэлж шинэ массив. */
export function permissionsForKind(kind: SystemAdminKind): SystemPermission[] {
  return kind === "ROOT" ? [...SYSTEM_PERMISSION_CODES] : [...STAFF_PERMISSIONS];
}

/** Тодорхойгүй/буруу төрлийг STAFF гэж үзэхгүй, харин хамгийн бага эрхтэй (хоосон) — fail-closed. */
export function hasSystemPermission(kind: unknown, code: SystemPermission): boolean {
  if (kind !== "ROOT" && kind !== "STAFF") return false;
  return permissionsForKind(kind).includes(code);
}

/** ROOT-ийн мөн эсэх (вэб /system-д зөвхөн ROOT). */
export function isRootKind(kind: unknown): boolean {
  return kind === "ROOT";
}
