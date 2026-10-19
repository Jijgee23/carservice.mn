// Framework-free employee business rules, moved from
// `app/_actions/employees.ts` (P6-B0). No `redirect`/`revalidatePath`/
// cookies/`"use server"`/`server-only` imports here — those, plus
// `enforceCountLimit` (needs the real global `prisma`, not the injected
// `db`) and `logAudit` for the single-entity mutations, stay in the action
// wrapper so this file works against an in-memory fake client in tests.
//
// Exception: `bulkUpdateEmployeeRoleBranch` calls `logAudit` itself (once
// per successfully-changed row, interleaved with that row's own guard
// checks) because splitting the per-row loop across a core/wrapper boundary
// would move business logic (which rows succeed/skip) into the wrapper.
// `logAudit` itself has no `server-only`/Next import and accepts an
// injectable client, so this stays framework-free and fake-able.

import { userTombstone } from "@/lib/account-closure/tombstone";
import { logAudit } from "@/lib/audit";
import { parseIdsJson } from "@/lib/bulk-action";
import { duplicateUserFields, ensureRoleBelongsToTenant, filterOwnBranchIds } from "./guards";
import type { EmployeeActor, EmployeeRow, EmployeesClient, ValidatedEmployee } from "./types";
import { s, validateCommon } from "./validate";

export type Noop = { ok: true; noop: true };

// Тенант админы (owner) бүртгэлийг зөвхөн өөр админ л удирдана — эс бөгөөс
// `employees.edit` эрхтэй ажилтан админы утсыг өөрийнхөөр сольж, «нууц үг
// сэргээх» OTP-оор админы эрхийг булааж авах боломжтой байв.
const OWNER_ONLY_ERROR = "Тенант админы бүртгэлийг зөвхөн админ өөрчилнө.";

export type CreatePrepared = {
  ok: true;
  data: ValidatedEmployee;
  wantsOwner: boolean;
};

export type FieldErr = {
  ok: false;
  code: "VALIDATION";
  error: string;
  fieldErrors: Record<string, string>;
};

export type MessageErr = {
  ok: false;
  code: "NOT_FOUND" | "OWNER_ROLE_LOCKED" | "OWNER_ONLY" | "SELF_ACTION" | "DUPLICATE" | "UNKNOWN";
  error: string;
  fieldErrors?: Record<string, string>;
};

// --- CREATE ---------------------------------------------------------------

/**
 * Validates the create form and resolves role/branch, but does not touch
 * `plan_limits` or write the row — the caller must run `enforceCountLimit`
 * (which needs the real global `prisma`, not this function's `db`) between
 * this and `createEmployee`, exactly where the original action ran it.
 */
export async function prepareCreateEmployee(
  db: EmployeesClient,
  actor: EmployeeActor,
  formData: FormData,
): Promise<CreatePrepared | FieldErr> {
  // Зөвхөн одоо байгаа админ (isOwner) шинэ хэрэглэгчийг мөн адил бүх
  // эрхтэй админаар үүсгэж болно — энгийн ажилтан бол (canCreate эрхтэй ч)
  // энэ flag-ийг үл тоомсорлоно, аюулгүй байдлын үүднээс.
  const wantsOwner = actor.isOwner && s(formData, "isOwner") === "on";

  const { data, errors } = validateCommon(formData, { requireRole: !wantsOwner });
  if (Object.keys(errors).length > 0) {
    return { ok: false, code: "VALIDATION", error: "Оруулсан мэдээлэл буруу.", fieldErrors: errors };
  }

  if (wantsOwner) {
    // Админ өөрөө permission системээс дээгүүр тул тусад нь Role хэрэггүй.
    data.roleId = null;
  } else if (data.roleId) {
    const r = await ensureRoleBelongsToTenant(db, actor.tenantId, data.roleId);
    if (!r.ok) {
      return {
        ok: false,
        code: "VALIDATION",
        error: "Оруулсан мэдээлэл буруу.",
        fieldErrors: { roleId: "Үүрэг олдсонгүй эсвэл идэвхгүй байна." },
      };
    }
  }

  if (data.branchId) {
    const branch = await db.branch.findFirst({
      where: { id: data.branchId, tenantId: actor.tenantId },
      select: { id: true },
    });
    if (!branch) {
      return {
        ok: false,
        code: "VALIDATION",
        error: "Оруулсан мэдээлэл буруу.",
        fieldErrors: { branchId: "Салбар олдсонгүй." },
      };
    }
  }
  data.assignableBranchIds = await filterOwnBranchIds(db, actor.tenantId, data.assignableBranchIds);

  return { ok: true, data, wantsOwner };
}

export type CreateResult =
  | {
      ok: true;
      id: string;
      roleName: string | null;
      summary: string;
      after: Record<string, unknown>;
    }
  | FieldErr
  | MessageErr;

/** Writes the row (assumes `prepareCreateEmployee` + the plan-limit check already ran). */
export async function createEmployee(
  db: EmployeesClient,
  actor: EmployeeActor,
  data: ValidatedEmployee,
  wantsOwner: boolean,
): Promise<CreateResult> {
  let created;
  try {
    created = await db.user.create({
      data: {
        firstName: data.firstName,
        lastName: data.lastName,
        email: data.email,
        phone: data.phone,
        roleId: data.roleId,
        isOwner: wantsOwner,
        // Нууц үггүй, баталгаажаагүй — ажилтан анхны нэвтрэлтэд өөрөө үүсгэнэ.
        passwordHash: null,
        verified: false,
        tenantId: actor.tenantId,
        branchId: data.branchId,
        assignableBranchIds: data.assignableBranchIds,
        isActive: data.isActive,
        activeUntil: data.activeUntil,
      },
      select: { id: true, role: { select: { name: true } } },
    });
  } catch (e) {
    if (isP2002(e)) {
      const dup = await duplicateUserFields(db, data.email, data.phone);
      const fe: Record<string, string> = {};
      if (dup.phone) fe.phone = "Энэ утасны дугаар аль хэдийн бүртгэгдсэн байна.";
      if (dup.email) fe.email = "Энэ имэйл хаяг аль хэдийн бүртгэгдсэн байна.";
      if (!fe.phone && !fe.email) {
        fe.phone = "Энэ утас эсвэл имэйл аль хэдийн бүртгэгдсэн байна.";
      }
      return { ok: false, code: "DUPLICATE", error: "Давхцал байна.", fieldErrors: fe };
    }
    return {
      ok: false,
      code: "UNKNOWN",
      error: e instanceof Error ? e.message : "Үүсгэх явцад алдаа гарлаа.",
    };
  }

  return {
    ok: true,
    id: created.id,
    roleName: created.role?.name ?? null,
    summary: `${data.lastName} ${data.firstName} · ${wantsOwner ? "Админ" : (created.role?.name ?? "—")}`,
    after: {
      firstName: data.firstName,
      lastName: data.lastName,
      email: data.email,
      roleId: data.roleId,
      isOwner: wantsOwner,
      branchId: data.branchId,
      assignableBranchIds: data.assignableBranchIds,
    },
  };
}

// --- UPDATE ---------------------------------------------------------------

export type UpdateResult =
  | {
      ok: true;
      id: string;
      roleName: string | null;
      summary: string;
      before: Record<string, unknown>;
      after: Record<string, unknown>;
    }
  | FieldErr
  | MessageErr;

export async function updateEmployee(
  db: EmployeesClient,
  actor: EmployeeActor,
  id: string,
  formData: FormData,
): Promise<UpdateResult> {
  const { data, errors } = validateCommon(formData);
  // Админ нууц үг өөрчлөхгүй — ажилтан өөрөө "Нууц үг сэргээх" урсгалаар солино.
  if (Object.keys(errors).length > 0) {
    return { ok: false, code: "VALIDATION", error: "Оруулсан мэдээлэл буруу.", fieldErrors: errors };
  }

  const target = await db.user.findFirst({
    where: { id, tenantId: actor.tenantId },
    include: { role: { select: { id: true, name: true } } },
  });
  if (!target || target.deletedAt) return { ok: false, code: "NOT_FOUND", error: "Ажилтан олдсонгүй." };

  // OWNER (тенант админ)-ын үүрэг солих, эсвэл хасах боломжгүй — гэхдээ нэр,
  // утас, имэйл зэрэг профайлыг засах боломжтой. Өмнө нь ямар ч PATCH-ийг
  // 409 болгодог байсан тул owner-ийн нэр ч засагдахгүй байв. Үүрэг болон
  // идэвхтэй/хугацааг owner-д хэвээр нь үлдээнэ (эдгээрийг toggle-active /
  // owner шилжүүлэх урсгал удирдана).
  if (target.isOwner && !actor.isOwner) {
    return { ok: false, code: "OWNER_ONLY", error: OWNER_ONLY_ERROR };
  }
  // Өөрийн үүргийг өөрчилж эрхээ дээшлүүлэхээс сэргийлнэ (үүрэг удирдах нь
  // owner-ийн эрх — app/_actions/roles.ts).
  if (target.id === actor.id && !actor.isOwner && data.roleId !== target.roleId) {
    return {
      ok: false,
      code: "SELF_ACTION",
      error: "Та өөрийн үүргийг өөрчлөх боломжгүй.",
      fieldErrors: { roleId: "Та өөрийн үүргийг өөрчлөх боломжгүй." },
    };
  }

  if (target.isOwner) {
    if (data.roleId && data.roleId !== target.roleId) {
      return {
        ok: false,
        code: "OWNER_ROLE_LOCKED",
        error: "Тенант админы үүргийг өөрчилж болохгүй.",
        fieldErrors: { roleId: "Тенант админы үүргийг өөрчилж болохгүй." },
      };
    }
    data.roleId = target.roleId;
    data.isActive = target.isActive;
    data.activeUntil = target.activeUntil;
  }

  if (data.roleId) {
    const r = await ensureRoleBelongsToTenant(db, actor.tenantId, data.roleId);
    if (!r.ok) {
      return {
        ok: false,
        code: "VALIDATION",
        error: "Оруулсан мэдээлэл буруу.",
        fieldErrors: { roleId: "Үүрэг олдсонгүй эсвэл идэвхгүй байна." },
      };
    }
  }

  if (data.branchId) {
    const branch = await db.branch.findFirst({
      where: { id: data.branchId, tenantId: actor.tenantId },
      select: { id: true },
    });
    if (!branch) {
      return {
        ok: false,
        code: "VALIDATION",
        error: "Оруулсан мэдээлэл буруу.",
        fieldErrors: { branchId: "Салбар олдсонгүй." },
      };
    }
  }
  data.assignableBranchIds = await filterOwnBranchIds(db, actor.tenantId, data.assignableBranchIds);

  let updated;
  try {
    updated = await db.user.update({
      where: { id: target.id },
      data: {
        firstName: data.firstName,
        lastName: data.lastName,
        email: data.email,
        phone: data.phone,
        roleId: data.roleId,
        branchId: data.branchId,
        assignableBranchIds: data.assignableBranchIds,
        isActive: data.isActive,
        activeUntil: data.activeUntil,
      },
      select: { id: true, role: { select: { name: true } } },
    });
  } catch (e) {
    if (isP2002(e)) {
      const dup = await duplicateUserFields(db, data.email, data.phone, target.id);
      const fe: Record<string, string> = {};
      if (dup.phone) fe.phone = "Энэ утас өөр хэрэглэгчид ашиглагдсан байна.";
      if (dup.email) fe.email = "Энэ имэйл өөр хэрэглэгчид ашиглагдсан байна.";
      if (!fe.phone && !fe.email) {
        fe.phone = "Энэ утас эсвэл имэйл өөр хэрэглэгчид ашиглагдсан байна.";
      }
      return { ok: false, code: "DUPLICATE", error: "Давхцал байна.", fieldErrors: fe };
    }
    return {
      ok: false,
      code: "UNKNOWN",
      error: e instanceof Error ? e.message : "Шинэчлэх явцад алдаа гарлаа.",
    };
  }

  return {
    ok: true,
    id: target.id,
    roleName: updated.role?.name ?? null,
    summary: `${data.lastName} ${data.firstName} · ${updated.role?.name ?? "—"}`,
    before: {
      firstName: target.firstName,
      lastName: target.lastName,
      email: target.email,
      roleId: target.roleId,
      branchId: target.branchId,
      assignableBranchIds: target.assignableBranchIds,
    },
    after: {
      firstName: data.firstName,
      lastName: data.lastName,
      email: data.email,
      roleId: data.roleId,
      branchId: data.branchId,
      assignableBranchIds: data.assignableBranchIds,
    },
  };
}

// --- BULK UPDATE (role / main branch) --------------------------------------

export type BulkRoleBranchResult = {
  ok: boolean;
  message?: string;
  succeeded: number;
  failed: number;
  errors: string[];
};

// Жагсаалтаас олноор сонгож үүрэг болон/эсвэл үндсэн салбарыг зэрэг солих
// (харах: bulkChangeServiceCategoryAction app/_actions/services.ts — адил
// all-or-nothing БИШ загвар: мөр бүр тусдаа боловсруулагдана). Аль нэг
// талбарыг л сонгосон ч болно (заавал хоёуланг зэрэг сонгох албагүй).
export async function bulkUpdateEmployeeRoleBranch(
  db: EmployeesClient,
  actor: EmployeeActor,
  formData: FormData,
): Promise<BulkRoleBranchResult | { ok: false; message: string }> {
  const roleId = s(formData, "roleId");
  const branchId = s(formData, "branchId");
  if (!roleId && !branchId) {
    return { ok: false, message: "Үүрэг эсвэл салбарын аль нэгийг сонгоно уу." };
  }

  let roleName = "";
  if (roleId) {
    const r = await ensureRoleBelongsToTenant(db, actor.tenantId, roleId);
    if (!r.ok) return { ok: false, message: "Сонгосон үүрэг олдсонгүй эсвэл идэвхгүй байна." };
    roleName = r.name ?? "";
  }

  let branchName = "";
  if (branchId) {
    const branch = await db.branch.findFirst({
      where: { id: branchId, tenantId: actor.tenantId },
      select: { name: true },
    });
    if (!branch) return { ok: false, message: "Сонгосон салбар олдсонгүй." };
    branchName = branch.name ?? "";
  }

  const ids = parseIdsJson(s(formData, "employeeIdsJson"));
  if (ids.length === 0) return { ok: false, message: "Дор хаяж нэг ажилтан сонгоно уу." };

  const employees: EmployeeRow[] = await db.user.findMany({
    where: { id: { in: ids }, tenantId: actor.tenantId, deletedAt: null },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      isOwner: true,
      roleId: true,
      branchId: true,
    },
  });
  const byId = new Map(employees.map((e) => [e.id, e] as const));

  const changeSummary = [roleName && `үүрэг: ${roleName}`, branchName && `салбар: ${branchName}`]
    .filter(Boolean)
    .join(", ");

  let succeeded = 0;
  const errors: string[] = [];
  for (const id of ids) {
    const emp = byId.get(id);
    const label = emp ? `${emp.lastName} ${emp.firstName}` : id;
    try {
      if (!emp) throw new Error("Олдсонгүй.");
      // OWNER (тенант админ)-ын үүрэг/салбарыг олноор ч сольж болохгүй —
      // updateEmployeeAction-тэй ижил дүрэм.
      if (emp.isOwner) throw new Error("Тенант админыг өөрчлөх боломжгүй.");
      if (emp.id === actor.id && !actor.isOwner && roleId && emp.roleId !== roleId) {
        throw new Error("Та өөрийн үүргийг өөрчлөх боломжгүй.");
      }

      const data: { roleId?: string; branchId?: string } = {};
      if (roleId && emp.roleId !== roleId) data.roleId = roleId;
      if (branchId && emp.branchId !== branchId) data.branchId = branchId;

      if (Object.keys(data).length > 0) {
        await db.user.update({ where: { id: emp.id }, data });
        await logAudit(
          {
            tenantId: actor.tenantId,
            userId: actor.id,
            entity: "User",
            entityId: emp.id,
            action: "UPDATE",
            summary: `${label} · олноор ${changeSummary}`,
            before: { roleId: emp.roleId, branchId: emp.branchId },
            after: { roleId: data.roleId ?? emp.roleId, branchId: data.branchId ?? emp.branchId },
          },
          db as unknown as Parameters<typeof logAudit>[1],
        );
      }
      succeeded++;
    } catch (e) {
      errors.push(`${label}: ${e instanceof Error ? e.message : "алдаа"}`);
    }
  }

  if (succeeded === 0) {
    return {
      ok: false,
      message: errors[0] ?? "Шинэчлэх явцад алдаа гарлаа.",
      succeeded,
      failed: errors.length,
      errors,
    };
  }
  return {
    ok: true,
    message: `${succeeded}/${ids.length} ажилтан шинэчлэгдлээ.${errors.length ? ` (${errors.length} амжилтгүй)` : ""}`,
    succeeded,
    failed: errors.length,
    errors,
  };
}

// --- ACTIVATE / DEACTIVATE -----------------------------------------------

export type ToggleActiveResult =
  | Noop
  | {
      ok: true;
      id: string;
      summary: string;
      before: { isActive: boolean };
      after: { isActive: boolean };
    }
  | { ok: false; code: "SELF_DEACTIVATE" | "LAST_OWNER" | "OWNER_ONLY"; error: string };

export async function toggleEmployeeActive(
  db: EmployeesClient,
  actor: EmployeeActor,
  formData: FormData,
): Promise<ToggleActiveResult> {
  const id = s(formData, "id");
  const next = formData.get("isActive") === "on";
  if (!id) return { ok: true, noop: true };
  if (id === actor.id && !next) {
    return { ok: false, code: "SELF_DEACTIVATE", error: "Та өөрийгөө идэвхгүй болгох боломжгүй." };
  }

  const target = await db.user.findFirst({
    where: { id, tenantId: actor.tenantId },
    select: { isOwner: true, isActive: true, firstName: true, lastName: true, deletedAt: true },
  });
  if (!target || target.deletedAt) return { ok: true, noop: true };
  if (target.isOwner && !actor.isOwner) {
    return { ok: false, code: "OWNER_ONLY", error: OWNER_ONLY_ERROR };
  }
  if (target.isOwner && !next) {
    const activeOwners = await db.user.count({
      where: { tenantId: actor.tenantId, isOwner: true, isActive: true, deactivatedAt: null, deletedAt: null },
    });
    if (activeOwners <= 1) {
      return { ok: false, code: "LAST_OWNER", error: "Сүүлийн админыг идэвхгүй болгох боломжгүй." };
    }
  }

  await db.user.update({ where: { id }, data: { isActive: next } });

  return {
    ok: true,
    id,
    summary: `${target.lastName} ${target.firstName} · ${next ? "идэвхжүүлэв" : "идэвхгүй болгов"}`,
    before: { isActive: Boolean(target.isActive) },
    after: { isActive: next },
  };
}

// --- DELETE ---------------------------------------------------------------

export type DeleteResult =
  | Noop
  | { ok: true; id: string; summary: string }
  | { ok: false; code: "SELF_ACTION" | "LAST_OWNER" | "OPEN_ORDERS" | "OWNER_ONLY"; error: string };

export async function deleteEmployee(
  db: EmployeesClient,
  actor: EmployeeActor,
  formData: FormData,
): Promise<DeleteResult> {
  const id = s(formData, "id");
  if (!id) return { ok: true, noop: true };
  if (id === actor.id) {
    return { ok: false, code: "SELF_ACTION", error: "Та өөрийгөө устгах боломжгүй." };
  }

  const target = await db.user.findFirst({
    where: { id, tenantId: actor.tenantId },
    include: { role: { select: { name: true } } },
  });
  if (!target || target.deletedAt) return { ok: true, noop: true };

  if (target.isOwner && !actor.isOwner) {
    return { ok: false, code: "OWNER_ONLY", error: OWNER_ONLY_ERROR };
  }
  if (target.isOwner) {
    const ownerCount = await db.user.count({
      where: { tenantId: actor.tenantId, isOwner: true, isActive: true, deactivatedAt: null, deletedAt: null },
    });
    if (ownerCount <= 1) {
      return { ok: false, code: "LAST_OWNER", error: "Сүүлийн админыг устгах боломжгүй." };
    }
  }

  // assignedToId нь SetNull тул устгавал нээлттэй захиалга чимээгүй хуваарилалтгүй
  // үлдэнэ — эхлээд өөр ажилтанд шилжүүлэхийг шаардана.
  const openOrders = await db.serviceOrder.count({
    where: { tenantId: actor.tenantId, assignedToId: target.id, status: { in: ["SCHEDULED", "IN_PROGRESS"] } },
  });
  if (openOrders > 0) {
    return {
      ok: false,
      code: "OPEN_ORDERS",
      error: `Энэ ажилтанд ${openOrders} нээлттэй захиалга хуваарилагдсан байна. Эхлээд өөр ажилтанд шилжүүлнэ үү.`,
    };
  }

  // Хатуу DELETE хийхгүй — өөрөө устгах урсгалтай (lib/account-closure/staff.ts)
  // ижил tombstone: захиалга, онош, цагийн FK хадгалагдаж "Устгагдсан ажилтан"
  // гэж харагдана, утас/имэйл чөлөөлөгдөнө. Session/device цэвэрлэгээ, silent
  // push-ийг дуудагч талд purgeStaffAccess() хийнэ.
  await db.user.update({ where: { id: target.id }, data: userTombstone(target.id, new Date()) });

  return {
    ok: true,
    id,
    summary: `${target.lastName} ${target.firstName} · ${target.role?.name ?? (target.isOwner ? "Админ" : "—")}`,
  };
}

// --- RESET PASSWORD ---------------------------------------------------------

export type ResetPasswordResult =
  | Noop
  | { ok: true; id: string; summary: string }
  | { ok: false; code: "SELF_ACTION" | "OWNER_ONLY"; error: string };

/**
 * Ажилтны нууц үгийг хүчингүй болгоно (шинэ ажилтан үүсгэхтэй ижил
 * passwordHash=null, verified=false төлөв) — дараагийн удаа нэвтрэхдээ
 * checkLoginEmailAction автоматаар «анх удаа нэвтрэх» (OTP + шинэ нууц үг)
 * урсгал руу оруулна. Одоогийн нэвтэрсэн session хүчинтэй хэвээр үлдэнэ.
 */
export async function resetEmployeePassword(
  db: EmployeesClient,
  actor: EmployeeActor,
  formData: FormData,
): Promise<ResetPasswordResult> {
  const id = s(formData, "id");
  if (!id) return { ok: true, noop: true };
  if (id === actor.id) {
    return { ok: false, code: "SELF_ACTION", error: "Та өөрийн нууц үгээ энд шинэчлэх боломжгүй." };
  }

  const target = await db.user.findFirst({
    where: { id, tenantId: actor.tenantId },
    select: { firstName: true, lastName: true, deletedAt: true, isOwner: true },
  });
  if (!target || target.deletedAt) return { ok: true, noop: true };
  if (target.isOwner && !actor.isOwner) {
    return { ok: false, code: "OWNER_ONLY", error: OWNER_ONLY_ERROR };
  }

  // Нууц үгийг сервер огт үүсгэдэггүй — зөвхөн хүчингүй болгоод OTP
  // урсгал руу оруулна.
  await db.user.update({ where: { id }, data: { passwordHash: null, verified: false } });

  return {
    ok: true,
    id,
    summary: `${target.lastName} ${target.firstName} · нууц үг хүчингүй болгов`,
  };
}

// --- helpers ---------------------------------------------------------------

function isP2002(e: unknown): boolean {
  return isPrismaErrorCode(e, "P2002");
}

function isPrismaErrorCode(e: unknown, code: string): boolean {
  return (
    typeof e === "object" &&
    e !== null &&
    "code" in e &&
    (e as { code?: unknown }).code === code &&
    // Prisma's PrismaClientKnownRequestError also has a `clientVersion` field;
    // check for it structurally instead of `instanceof` so a fake thrown by
    // tests (`{ code: "P2002" }`) is recognized the same as the real class.
    "clientVersion" in e
  );
}
