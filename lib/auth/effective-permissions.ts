// Ажилтны ҮР ДҮНТЭЙ эрх (effective permissions) — 3 давхарга:
//   1. Систем админ роль бүрийн эрх тус бүрд «байгууллага өөрчилж болно» гэж тэмдэглэнэ
//      (Role.tenantEditablePermissions).
//   2. Байгууллага (эзэн) нийтийн роль дээр ЗӨВХӨН тэр өөрчилж болох эрхээр нэмэлт/хасалт хийнэ
//      (TenantRoleOverride.addPermissions / removePermissions).
//   3. Ажилтан тус бүр дээр ЗӨВХӨН хязгаарлана (User.deniedPermissions) — илүү эрх өгөхгүй.
//
//   effective = ((role ∪ add) ∖ remove) ∖ denied,  add/remove ∈ editable
//
// PURE — DB/Request хамааралгүй (unit тест). isOwner-ийг энд хөндөхгүй: хэрэглэгч
// lib/auth/roles.ts hasPermission-д «owner = бүгд» хэвээр.

import { isValidPermissionCode } from "@/lib/auth/permissions";

export type EffectiveInput = {
  rolePerms: readonly string[];
  /** Систем админ байгууллагад өөрчлөхийг зөвшөөрсөн кодууд. */
  editable?: readonly string[];
  add?: readonly string[];
  remove?: readonly string[];
  denied?: readonly string[];
};

const ORDER_EDIT = ["orders.edit", "orders.editOwn"] as const;

/**
 * Засах эрх нь харах эрхгүйгээр байж болохгүй (lib/roles/validate.ts validateOrderScopes-тэй
 * ижил дүрэм): харах эрх алга бол засах, салбарын харах алга бол салбарын засах эрхийг хасна.
 * Хасалт/хязгаарлалт нь «харах»-ыг авсан ч «засах» үлдэж, боломжгүй төлөв үүсгэхээс сэргийлнэ.
 */
function normalizeOrderScopes(perms: Set<string>): void {
  const view = perms.has("orders.view") || perms.has("orders.viewOwn");
  if (!view) {
    for (const c of ORDER_EDIT) perms.delete(c);
    return;
  }
  if (perms.has("orders.edit") && !perms.has("orders.view")) perms.delete("orders.edit");
}

function intersect(codes: readonly string[] | undefined, allowed: ReadonlySet<string>): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const c of codes ?? []) {
    if (typeof c !== "string" || seen.has(c)) continue;
    if (!isValidPermissionCode(c) || !allowed.has(c)) continue;
    seen.add(c);
    out.push(c);
  }
  return out;
}

/**
 * Үр дүнтэй эрх. Override/хязгаарлалт байхгүй бол роль-ын эрхийг ЯГ хэвээр (шүүлт, эрэмбэ
 * өөрчлөхгүй) буцаана — хуучин зан төлөв хадгалагдана.
 * Хуучирсан override (систем админ дараа нь түгжсэн/устгасан код) `∩ editable`-ээр автоматаар
 * үл тоогдоно — хэзээ ч түгжигдсэн эрхийг өөрчилж чадахгүй.
 */
export function computeEffectivePermissions(input: EffectiveInput): string[] {
  const editable = new Set(input.editable ?? []);
  const add = intersect(input.add, editable);
  const remove = intersect(input.remove, editable);
  const denied = (input.denied ?? []).filter((c): c is string => typeof c === "string");

  if (add.length === 0 && remove.length === 0 && denied.length === 0) {
    return [...input.rolePerms];
  }

  const perms = new Set<string>(input.rolePerms);
  for (const c of add) perms.add(c);
  for (const c of remove) perms.delete(c);
  for (const c of denied) perms.delete(c);
  normalizeOrderScopes(perms);
  return [...perms];
}

export class PermissionDelegationError extends Error {
  constructor(
    message: string,
    public readonly fieldErrors: Record<string, string>,
  ) {
    super(message);
    this.name = "PermissionDelegationError";
  }
}

function asStringArray(v: unknown, field: string, errors: Record<string, string>): string[] {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v) || v.some((x) => typeof x !== "string")) {
    errors[field] = "Эрхийн кодын жагсаалт байх ёстой.";
    return [];
  }
  return [...new Set(v as string[])];
}

export type OverrideInput = { add?: unknown; remove?: unknown };
export type OverrideResult =
  | { ok: true; add: string[]; remove: string[] }
  | { ok: false; fieldErrors: Record<string, string> };

/**
 * Байгууллагын роль-ийн override хүсэлтийг шалгана. Зөвхөн систем админ зөвшөөрсөн (editable)
 * кодыг өөрчилнэ: нэмэлт нь роль-д ЕГЧ байхгүй, хасалт нь роль-д БАЙГАА кодод л утгатай —
 * бусдыг чимээгүй цэвэрлэнэ (клиент ижил жагсаалтыг дахин илгээхэд алдаа гарахгүй).
 * Түгжигдсэн/буруу код → алдаа.
 */
export function sanitizeOverride(
  ctx: { rolePerms: readonly string[]; editable: readonly string[] },
  input: OverrideInput,
): OverrideResult {
  const errors: Record<string, string> = {};
  const addIn = asStringArray(input.add, "add", errors);
  const removeIn = asStringArray(input.remove, "remove", errors);
  const editable = new Set(ctx.editable);
  const role = new Set(ctx.rolePerms);

  for (const [field, list] of [["add", addIn], ["remove", removeIn]] as const) {
    if (errors[field]) continue;
    const invalid = list.find((c) => !isValidPermissionCode(c));
    if (invalid) {
      errors[field] = `Тодорхойгүй эрхийн код: ${invalid}`;
      continue;
    }
    const locked = list.find((c) => !editable.has(c));
    if (locked) errors[field] = `Энэ эрхийг өөрчлөх боломжгүй (түгжигдсэн): ${locked}`;
  }
  const both = addIn.find((c) => removeIn.includes(c));
  if (both && !errors.add) errors.add = `Нэг эрхийг нэмэх, хасахыг зэрэг сонгох боломжгүй: ${both}`;
  if (Object.keys(errors).length) return { ok: false, fieldErrors: errors };

  return {
    ok: true,
    add: addIn.filter((c) => !role.has(c)),
    remove: removeIn.filter((c) => role.has(c)),
  };
}

export type DenialResult =
  | { ok: true; denied: string[] }
  | { ok: false; fieldErrors: Record<string, string> };

/**
 * Ажилтны хязгаарлалт: зөвхөн тухайн ажилтанд ОДОО байгаа (хязгаарлахаас өмнөх) эрхийг хасна.
 * Байхгүй эрх дээр хязгаарлалт тавих нь утгагүй (дараа роль өөрчлөгдвөл гэнэт хасагдана) тул
 * эрх байхгүй код → алдаа биш, чимээгүй цэвэрлэнэ; буруу код → алдаа.
 */
export function sanitizeUserDenials(
  effectiveBeforeDenial: readonly string[],
  input: unknown,
): DenialResult {
  const errors: Record<string, string> = {};
  const list = asStringArray(input, "denied", errors);
  if (!errors.denied) {
    const invalid = list.find((c) => !isValidPermissionCode(c));
    if (invalid) errors.denied = `Тодорхойгүй эрхийн код: ${invalid}`;
  }
  if (Object.keys(errors).length) return { ok: false, fieldErrors: errors };
  const has = new Set(effectiveBeforeDenial);
  return { ok: true, denied: list.filter((c) => has.has(c)) };
}
