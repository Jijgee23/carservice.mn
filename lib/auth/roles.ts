import type { Prisma } from "@/app/generated/prisma/client";
import { ALL_BRANCHES } from "./session";
import type { PermissionCode, ResourceKey } from "./permissions";
import { orderEditScope, orderViewScope } from "./order-access";

// User-ийн эрхийн шалгалтын minimal shape — Prisma user object эсвэл API
// session payload-аас аль алин нь нийцэх ёстой.
export type RoleCheckUser = {
  isOwner: boolean;
  role?: { permissions: string[]; name?: string } | null;
};

/**
 * Тухайн permission code-той эсэхийг шалгана. OWNER (тенант админ) үргэлж true.
 */
export function hasPermission(
  user: RoleCheckUser,
  code: PermissionCode,
): boolean {
  if (user.isOwner) return true;
  if (!user.role || !user.role.permissions) return false;
  return user.role.permissions.includes(code);
}

export function canView(user: RoleCheckUser, resource: ResourceKey): boolean {
  if (resource === "orders") return orderViewScope(user) !== "none";
  return hasPermission(user, `${resource}.view`);
}

export function canCreate(user: RoleCheckUser, resource: ResourceKey): boolean {
  return hasPermission(user, `${resource}.create`);
}

export function canEdit(user: RoleCheckUser, resource: ResourceKey): boolean {
  if (resource === "orders") return orderEditScope(user) !== "none";
  return hasPermission(user, `${resource}.edit`);
}

export function canDelete(user: RoleCheckUser, resource: ResourceKey): boolean {
  return hasPermission(user, `${resource}.delete`);
}

/**
 * Хэрэглэгч тухайн нөөц дээр ямар нэг бичих эрхтэй эсэх — list page дээр "Add" /
 * "Засах" товчуудыг харуулах эсэхээс бусад coarse-grained gate-д.
 */
export function canManage(
  user: RoleCheckUser,
  resource?: ResourceKey,
): boolean {
  if (user.isOwner) return true;
  const perms = user.role?.permissions ?? [];
  if (!resource) {
    return perms.some(
      (p) => p.endsWith(".create") || p.endsWith(".edit") || p.endsWith(".delete"),
    );
  }
  return (
    perms.includes(`${resource}.create`) ||
    perms.includes(`${resource}.edit`) ||
    perms.includes(`${resource}.delete`)
  );
}

/**
 * UI дээр хэрэглэгчийн badge/label-д харуулах нэр.
 */
export function userRoleLabel(user: {
  isOwner: boolean;
  role?: { name: string } | null;
}): string {
  if (user.isOwner) return "Админ";
  return user.role?.name ?? "—";
}

/**
 * Салбараар хязгаарлах scope-ийн branchId.
 *
 * Админ (isOwner) бол null — бүх салбарын мэдээллийг хардаг. Админ биш ч салбар
 * оноогоогүй (branchId == null) ажилтан мөн null — бүх тенантын мэдээллийг хардаг.
 * Үүнээс бусад тохиолдолд ажилтны branchId-г буцаах ба ServiceOrder /
 * DiagnosticReport зэрэг салбартай холбоотой өгөгдлийг үүгээр шүүнэ.
 */
export function branchScopeId(user: {
  isOwner: boolean;
  branchId: string | null;
}): string | null {
  return !user.isOwner && user.branchId ? user.branchId : null;
}

/**
 * Тухайн хэрэглэгч нэвтрэх үедээ "Бүх салбар" сонгох боломжтой эсэх — admin
 * (isOwner) эсвэл тогтмол салбар оноогоогүй (branchId == null) ажилтан.
 * `branchScopeId`-ийн адил чиглэсэн нөхцөл — өөрөөр хэлбэл branchScopeId
 * null буцаадаг тохиолдол бүрд л "Бүх салбар" сонголт харагдана.
 */
export function canChooseAllBranches(user: {
  isOwner: boolean;
  branchId: string | null;
}): boolean {
  return user.isOwner || !user.branchId;
}

/**
 * Ажилтны сонгож болох салбаруудын id-нүүд — тогтмол `branchId` + нэмэлт
 * `assignableBranchIds` (өмнө нь зөвхөн "Хариуцах мастер" сонголтод
 * ашиглагддаг байсан ч, олон салбарт дамжиж ажилладаг ажилтныг илэрхийлдэг
 * тул нэвтрэх үеийн ажиллах салбар сонгуулахад ч ашиглана). Owner-д
 * хамаарахгүй (owner тенантын БҮХ салбарыг сонгож болно — харах
 * app/page/choose-branch/page.tsx). Давхардлыг арилгана.
 */
export function eligibleBranchIds(user: {
  branchId: string | null;
  assignableBranchIds: string[];
}): string[] {
  const ids = new Set<string>();
  if (user.branchId) ids.add(user.branchId);
  for (const id of user.assignableBranchIds) ids.add(id);
  return [...ids];
}

/**
 * Нэвтрэх үед JWT-д шигтгэх эхлэлийн `workingBranchId` (harах:
 * lib/auth/session.ts). Owner эсвэл 2+ салбарт ажилладаг ажилтныг
 * тодорхойгүй үлдээж (undefined) — proxy.ts-ийн middleware дараагийн
 * /dashboard хүсэлт дээр /page/choose-branch руу чиглүүлнэ. Яг 1 сонголттой
 * ажилтныг шууд тэр салбарт нь оноож, сонгуулах шаардлагагүй болгоно.
 */
export function seedWorkingBranchId(user: {
  isOwner: boolean;
  branchId: string | null;
  assignableBranchIds: string[];
}): string | undefined {
  if (user.isOwner) return undefined;
  const eligible = eligibleBranchIds(user);
  return eligible.length === 1 ? eligible[0] : undefined;
}

/**
 * Web dashboard-ийн жагсаалт/үүсгэлтийн scope — session-д нэвтрэх үедээ
 * сонгосон ажиллах салбар (`workingBranchId`, harах: lib/auth/session.ts)
 * дээр суурилна. `branchScopeId`-ээс ялгаатай нь: энд isOwner эсэх биш,
 * тухайн НЭВТРЭЛТЭД юу сонгосон нь л чухал (owner ч тодорхой салбар сонговол
 * хязгаарлагдана). "Бүх салбар" (ALL_BRANCHES) сонгосон бол null (branchScopeId
 * owner-ийн хувьд null буцаадагтай адил) — өөрчлөлт шаардлагагүйгээр одоо
 * байгаа `scope ? {...} : {}` where-clause-уудтай шууд нийцнэ.
 *
 * ЗӨВХӨН web dashboard-д (session/cookie auth) ашиглана. Мобайл tenant-staff
 * API (requireApiUser/api-token, session-гүй) `branchScopeId`-ийг хэвээр
 * ашиглана — үүнийг ОРЛУУЛАХГҮЙ.
 */
export function workingBranchScopeId(user: {
  workingBranchId?: string;
}): string | null {
  return user.workingBranchId && user.workingBranchId !== ALL_BRANCHES
    ? user.workingBranchId
    : null;
}

/**
 * Захиалгад хариуцагч болж болох хэрэглэгчдийн filter (Prisma where-д).
 * isOwner=true бүх админ + `orders.assignable` permission-той Role-той ажилтнууд.
 * Ажлаас гарсан (isActive=false / устгагдсан) шүүлтийг дуудагч `isActive: true`-ээр
 * нэмнэ; энд өөрөө хаасан болон хугацаа (activeUntil) дууссан ажилтныг хасна.
 * `now`-оос хамаарах тул тогтмол биш функц — дуудах бүрт шинэ огноо.
 */
export function orderAssignableWhere(now: Date = new Date()) {
  return {
    // Өөрөө хаасан ажилтан isActive=true хэвээр (админ блокоос тусдаа) тул
    // тусад нь хасна — эс бөгөөс нэвтэрч чадахгүй хүнд захиалга оноогдоно.
    deactivatedAt: null,
    // Идэвхжүүлээгүй (урилга хүлээж буй) ажилтан мастераар сонгогдохгүй.
    verified: true,
    // Түр ажилтны хугацаа дууссан бол нэвтэрч чадахгүй (lib/auth/active.ts).
    AND: [{ OR: [{ activeUntil: null }, { activeUntil: { gt: now } }] }],
    OR: [
      { isOwner: true },
      { role: { permissions: { has: "orders.assignable" } } },
    ],
  } satisfies Prisma.UserWhereInput;
}
