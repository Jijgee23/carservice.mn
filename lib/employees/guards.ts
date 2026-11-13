// Framework-free tenant/role/branch guards — moved verbatim from
// `app/_actions/employees.ts`.

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

export async function ensureRoleBelongsToTenant(
  db: EmployeesClient,
  tenantId: string,
  roleId: string,
): Promise<{ ok: boolean; name?: string; permissions?: string[] }> {
  const role: RoleRow | null = await db.role.findFirst({
    where: { id: roleId, tenantId },
    select: { id: true, name: true, isActive: true, permissions: true },
  });
  if (!role || !role.isActive) return { ok: false };
  return { ok: true, name: role.name, permissions: role.permissions ?? [] };
}

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
