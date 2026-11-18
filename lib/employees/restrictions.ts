// Ажилтан тус бүрийн ХЯЗГААРЛАЛТ (User.deniedPermissions): ролиос зарим эрхийг хасна, ХЭЗЭЭ Ч нэмэхгүй.
// Вэб action (app/_actions/employee-restrictions.ts) болон мобайл API
// (PUT /api/v1/employees/[id]/restrictions) нэг логик. Томьёо: lib/auth/effective-permissions.ts.

import { sanitizeUserDenials } from "@/lib/auth/effective-permissions";
import { EFFECTIVE_ROLE_SELECT, resolveEffectiveRole } from "@/lib/auth/load-effective";
import { prisma } from "@/lib/prisma";
import { roleWithinActorPermissions } from "./guards";
import type { EmployeeActor } from "./types";

type Db = Pick<typeof prisma, "user" | "tenantRoleOverride">;

export type RestrictionView = {
  employeeId: string;
  /** Хязгаарлахаас ӨМНӨХ үр дүнтэй эрх (роль + байгууллагын override). */
  grantedPermissions: string[];
  /** Хасагдсан эрхүүд (хүчинтэй хэсэг). */
  denied: string[];
  /** Хязгаарлалтын дараах үр дүнтэй эрх. */
  effectivePermissions: string[];
};

export type RestrictionError =
  | { ok: false; code: "NOT_FOUND" | "OWNER_TARGET" | "SELF" | "SUPERIOR_TARGET" | "VALIDATION"; error: string; fieldErrors?: Record<string, string> };

export const OWNER_TARGET_ERROR = "Байгууллагын эзний эрхийг хязгаарлах боломжгүй.";
export const SELF_RESTRICT_ERROR = "Та өөрийн эрхийг хязгаарлах боломжгүй.";
export const SUPERIOR_RESTRICT_ERROR = "Таны эрхээс илүү эрхтэй ажилтныг хязгаарлах боломжгүй.";

const TARGET_SELECT = {
  id: true,
  tenantId: true,
  isOwner: true,
  deletedAt: true,
  deniedPermissions: true,
  role: { select: EFFECTIVE_ROLE_SELECT },
} as const;

async function loadTarget(db: Db, tenantId: string, employeeId: string) {
  const target = await db.user.findFirst({ where: { id: employeeId, tenantId }, select: TARGET_SELECT });
  if (!target || target.deletedAt) return null;
  return target;
}

async function viewFor(
  db: Db,
  target: NonNullable<Awaited<ReturnType<typeof loadTarget>>>,
  denied: string[],
): Promise<RestrictionView> {
  // Хязгаарлахаас өмнөх эрх = denied-гүй effective.
  const before = await resolveEffectiveRole({ ...target, deniedPermissions: [] }, db);
  const after = await resolveEffectiveRole({ ...target, deniedPermissions: denied }, db);
  const granted = before?.permissions ?? [];
  const has = new Set(granted);
  return {
    employeeId: target.id,
    grantedPermissions: granted,
    denied: denied.filter((c) => has.has(c)),
    effectivePermissions: after?.permissions ?? [],
  };
}

/** Одоогийн хязгаарлалт (харах). Олдохгүй → null. */
export async function getEmployeeRestrictions(
  actor: Pick<EmployeeActor, "tenantId">,
  employeeId: string,
  db: Db = prisma,
): Promise<RestrictionView | null> {
  const target = await loadTarget(db, actor.tenantId, employeeId);
  if (!target) return null;
  return viewFor(db, target, target.deniedPermissions ?? []);
}

export type SaveRestrictionResult =
  | { ok: true; view: RestrictionView; summary: string; before: { denied: string[] }; after: { denied: string[] } }
  | RestrictionError;

/**
 * Дуудагч `employees.edit` эрхээ болон идэвхтэй захиалгыг өөрөө шалгасан байх ёстой; энд бизнес дүрэм:
 *  - эзнийг хязгаарлахгүй (эзэн бүх шалгалтыг тойрдог тул утгагүй + түгжигдэх эрсдэл),
 *  - өөрийгөө хязгаарлахгүй (санамсаргүй түгжигдэхээс сэргийлнэ),
 *  - эзэн биш дуудагч өөрөөсөө илүү эрхтэй ажилтныг хязгаарлахгүй (roleWithinActorPermissions),
 *  - зөвхөн ажилтанд ОДОО байгаа эрхийг хасна (sanitizeUserDenials).
 */
export async function saveEmployeeRestrictions(
  db: Db,
  actor: EmployeeActor,
  employeeId: string,
  input: unknown,
): Promise<SaveRestrictionResult> {
  const target = await loadTarget(db, actor.tenantId, employeeId);
  if (!target) return { ok: false, code: "NOT_FOUND", error: "Ажилтан олдсонгүй." };
  if (target.isOwner) return { ok: false, code: "OWNER_TARGET", error: OWNER_TARGET_ERROR };
  if (target.id === actor.id) return { ok: false, code: "SELF", error: SELF_RESTRICT_ERROR };

  const before = await resolveEffectiveRole({ ...target, deniedPermissions: [] }, db);
  const granted = before?.permissions ?? [];
  if (!roleWithinActorPermissions(actor, granted)) {
    return { ok: false, code: "SUPERIOR_TARGET", error: SUPERIOR_RESTRICT_ERROR };
  }

  const parsed = sanitizeUserDenials(granted, input);
  if (!parsed.ok) {
    return { ok: false, code: "VALIDATION", error: "Оруулсан мэдээлэл буруу.", fieldErrors: parsed.fieldErrors };
  }

  const previous = (target.deniedPermissions ?? []).filter((c) => granted.includes(c));
  await db.user.updateMany({
    where: { id: target.id, tenantId: actor.tenantId },
    data: { deniedPermissions: parsed.denied },
  });

  const view = await viewFor(db, target, parsed.denied);
  return {
    ok: true,
    view,
    summary: `Ажилтны хязгаарлалт · ${parsed.denied.length} эрх хассан`,
    before: { denied: previous },
    after: { denied: parsed.denied },
  };
}

/**
 * Нэг эрхийг шууд асаах/унтраах (switch): allowed=false → хязгаарлана (хасна), true → сэргээнэ.
 * Одоогийн хязгаарлалт дээр ЗӨВХӨН энэ кодыг өөрчилж saveEmployeeRestrictions-оор дамжуулна
 * (ижил guard, tenant scope, sanitize).
 */
export async function toggleEmployeeRestriction(
  db: Db,
  actor: EmployeeActor,
  employeeId: string,
  code: unknown,
  allowed: unknown,
): Promise<SaveRestrictionResult> {
  if (typeof code !== "string" || typeof allowed !== "boolean") {
    return { ok: false, code: "VALIDATION", error: "Хүсэлт буруу.", fieldErrors: { code: "Эрхийн код, төлөв шаардлагатай." } };
  }
  const current = await getEmployeeRestrictions(actor, employeeId, db);
  if (!current) return { ok: false, code: "NOT_FOUND", error: "Ажилтан олдсонгүй." };
  const denied = new Set(current.denied);
  if (allowed) denied.delete(code);
  else denied.add(code);
  return saveEmployeeRestrictions(db, actor, employeeId, [...denied]);
}
