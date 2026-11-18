// Framework-free tenant/role/branch guards — moved verbatim from
// `app/_actions/employees.ts`.

import { EFFECTIVE_ROLE_SELECT, resolveEffectiveRole } from "@/lib/auth/load-effective";
import type { BranchRow, EmployeeActor, EmployeesClient, RoleRow } from "./types";

/**
 * P2002 (давхцал) гарсан үед ЯГ аль unique талбар давхцсаныг тогтооно.
 *
 * `e.meta.target`-д найдаж болохгүй: pg драйвер адаптер нь PostgreSQL-ийн
 * `error.detail` ("Key (phone)=(...) ...")-ыг англи хэлний regex-ээр задалдаг
 * тул серверийн `lc_messages` англи биш бол талбарын нэр олдохгүй →
 * `meta.target` undefined болж буруу талбарт (имэйл) алдаа заадаг байсан.
 * Иймд утас/имэйл аль аль нь өөр хэрэглэгчид байгаа эсэхийг шууд лавлана.
 * Утас, имэйл хоёул глобал unique тул tenant-аар шүүхгүй.
 */
export async function duplicateUserFields(
  db: EmployeesClient,
  email: string,
  phone: string,
  excludeUserId?: string,
): Promise<{ phone: boolean; email: boolean }> {
  const not = excludeUserId ? { id: { not: excludeUserId } } : {};
  const [phoneTaken, emailTaken] = await Promise.all([
    db.user.findFirst({ where: { phone, ...not }, select: { id: true } }),
    db.user.findFirst({ where: { email, ...not }, select: { id: true } }),
  ]);
  return { phone: Boolean(phoneTaken), email: Boolean(emailTaken) };
}

// Илгээсэн id-үүдээс зөвхөн тухайн tenant-д хамаарах салбаруудыг л үлдээнэ
// (checkbox жагсаалт сервэрээс өөрөө tenant-ийн салбаруудаас бүрддэг тул энэ нь
// зөвхөн хуучирсан/зохиомол хүсэлтээс хамгаалах defense-in-depth шүүлт).
export async function filterOwnBranchIds(
  db: EmployeesClient,
  tenantId: string,
  branchIds: string[],
): Promise<string[]> {
  if (branchIds.length === 0) return [];
  const owned: BranchRow[] = await db.branch.findMany({
    where: { tenantId, isActive: true, id: { in: branchIds } },
    select: { id: true },
  });
  const ownedSet = new Set(owned.map((b) => b.id));
  return branchIds.filter((id) => ownedSet.has(id));
}

/**
 * Роль системийн (глобал) тул tenant шүүлтгүй — зөвхөн байгаа, идэвхтэй эсэхийг
 * шалгана (идэвхгүй ролийг шинээр оноохгүй). `tenantId` өгвөл буцаах `permissions` нь
 * тухайн байгууллагын override-той ҮР ДҮНТЭЙ эрх — оноогч өөрөөсөө илүү эрхтэй ролийг
 * (байгууллагын нэмсэн эрхийг оруулаад) өгөхөөс сэргийлэх шалгалтад.
 */
export async function ensureRoleAssignable(
  db: EmployeesClient,
  roleId: string,
  tenantId?: string,
): Promise<{ ok: boolean; name?: string; permissions?: string[] }> {
  const role: (RoleRow & { tenantEditablePermissions?: string[] }) | null = await db.role.findFirst({
    where: { id: roleId },
    select: { id: true, name: true, isActive: true, permissions: true, tenantEditablePermissions: true },
  });
  if (!role || !role.isActive) return { ok: false };
  const rolePerms = role.permissions ?? [];
  let permissions = rolePerms;
  if (tenantId && db.tenantRoleOverride && (role.tenantEditablePermissions?.length ?? 0) > 0) {
    const eff = await resolveEffectiveRole(
      {
        isOwner: false,
        tenantId,
        deniedPermissions: [],
        role: {
          id: role.id,
          name: role.name ?? "",
          isActive: true,
          permissions: rolePerms,
          tenantEditablePermissions: role.tenantEditablePermissions ?? [],
        },
      },
      db as never,
    );
    permissions = eff?.permissions ?? rolePerms;
  }
  return { ok: true, name: role.name, permissions };
}

/** Үйлдлийн объект болох ажилтны ҮР ДҮНТЭЙ эрх (роль + байгууллагын override − хязгаарлалт). Эзэн/роль-гүй → []. */
export async function targetEffectivePermissions(
  db: EmployeesClient,
  tenantId: string,
  target: {
    isOwner?: boolean;
    deniedPermissions?: string[];
    role?: (Partial<RoleRow> & { tenantEditablePermissions?: string[] }) | null;
  },
): Promise<string[]> {
  const role = target.role;
  if (!role) return [];
  const rolePerms = role.permissions ?? [];
  // Override-ийн нөлөөг уншихад db.tenantRoleOverride хэрэгтэй (fake/хуучин client-д байхгүй бол алгасна).
  const eff = await resolveEffectiveRole(
    {
      isOwner: Boolean(target.isOwner),
      tenantId,
      deniedPermissions: target.deniedPermissions ?? [],
      role: {
        id: role.id ?? "",
        name: role.name ?? "",
        isActive: role.isActive !== false,
        permissions: rolePerms,
        tenantEditablePermissions: db.tenantRoleOverride ? (role.tenantEditablePermissions ?? []) : [],
      },
    },
    db as never,
  );
  return eff?.permissions ?? rolePerms;
}

export { EFFECTIVE_ROLE_SELECT };

/**
 * Owner биш actor зөвхөн өөрт байгаа эрхүүдийн дэд олонлог болох үүргийг л
 * оноож болно — эс бөгөөс `employees.edit` эрхтэй ажилтан өөр ажилтанд (эсвэл
 * хамсаатандаа) бүх эрхтэй үүрэг өгч эрхээ дээшлүүлэх боломжтой. Owner
 * хязгааргүй.
 */
export function roleWithinActorPermissions(
  actor: EmployeeActor,
  rolePermissions: readonly string[] | undefined,
): boolean {
  if (actor.isOwner) return true;
  const own = new Set(actor.role?.permissions ?? []);
  return (rolePermissions ?? []).every((p) => own.has(p));
}
