"use server";


import type { ConfirmActionResult } from "@/lib/confirm-action";
import { revalidatePath } from "next/cache";
import { Prisma } from "@/app/generated/prisma/client";
import { logAudit } from "@/lib/audit";
import { requireUser } from "@/lib/auth";
import { type BulkActionState, parseIdsJson } from "@/lib/bulk-action";
import { parseDurationInput } from "@/lib/category-duration";
import { prisma } from "@/lib/prisma";
import { CATEGORY_KINDS, categoryKindLabel, type CategoryKind } from "@/lib/categories";

export type CategoryActionState = {
  ok: boolean;
  message?: string;
  fieldErrors?: Record<string, string>;
} | null;

function s(fd: FormData, key: string): string {
  const v = fd.get(key);
  return typeof v === "string" ? v.trim() : "";
}

async function authorizeOwner() {
  const user = await requireUser();
  if (!user.isOwner) {
    throw new Error("Зөвхөн админ ангилал удирдана.");
  }
  return user;
}

const MAX_CONCURRENT_CAPACITY = 50;

function validate(fd: FormData): {
  data: {
    name: string;
    description: string | null;
    isActive: boolean;
    branchIds: string[];
    durationMinutes: number | null;
    systemServiceKeyId: string | null;
    concurrentCapacity: number;
    kind: CategoryKind | null;
  } | null;
  errors: Record<string, string>;
} {
  const name = s(fd, "name");
  const description = s(fd, "description");
  const isActive = fd.get("isActive") === "on";
  const branchIds = fd
    .getAll("branchIds")
    .filter((v): v is string => typeof v === "string" && v.length > 0);
  const systemServiceKeyId = s(fd, "systemServiceKeyId") || null;
  // Төрөл: "" = бүх төрөлд (хуучин), эсвэл зөвхөн ажил / сэлбэг / оношилгоо.
  const kindRaw = s(fd, "kind");
  const kind = (CATEGORY_KINDS as readonly string[]).includes(kindRaw) ? (kindRaw as CategoryKind) : null;
  const errors: Record<string, string> = {};
  if (kindRaw && !kind) errors.kind = "Төрөл буруу.";

  // Онлайн захиалга/discover-т (ажил үйлчилгээ) системийн түлхүүр хэрэгтэй;
  // зөвхөн сэлбэг/оношилгооны ангилалд заавал биш.
  if (!systemServiceKeyId && (kind === null || kind === "LABOR"))
    errors.systemServiceKeyId = "Системийн ангилал сонгоно уу.";

  if (!name) errors.name = "Ангилалын нэрээ оруулна уу.";
  else if (name.length > 60) errors.name = "Нэр 60 тэмдэгтээс хэтрэхгүй.";

  if (description && description.length > 200)
    errors.description = "Тайлбар 200 тэмдэгтээс хэтрэхгүй.";

  // Онлайн захиалгын үргэлжлэх хугацаа (default). Цаг+минут-аар оруулж, минут
  // болгон хадгална. Хоосон → null (салбарын override, эсвэл 30 мин руу шатлана).
  const durationParse = parseDurationInput(
    s(fd, "durationHours"),
    s(fd, "durationMinutes"),
  );
  let durationMinutes: number | null = null;
  if (durationParse.ok) durationMinutes = durationParse.minutes;
  else errors.durationMinutes = durationParse.error;

  // Ажил дээр нэг зэрэг хэдэн захиалга авч болохыг заана. Хоосон бол 1
  // (форм дээр анхны утга 1-ээр урьдчилан бөглөгддөг тул бодит практикт
  // үргэлж утгатай ирнэ — энд зөвхөн шууд API дуудлагаас хамгаална).
  const capacityRaw = s(fd, "concurrentCapacity");
  const concurrentCapacity = capacityRaw ? Number.parseInt(capacityRaw, 10) : 1;
  if (
    !Number.isFinite(concurrentCapacity) ||
    concurrentCapacity < 1 ||
    concurrentCapacity > MAX_CONCURRENT_CAPACITY
  ) {
    errors.concurrentCapacity = `1-${MAX_CONCURRENT_CAPACITY} хооронд байх ёстой.`;
  }

  if (Object.keys(errors).length > 0) return { data: null, errors };

  return {
    data: {
      name,
      description: description || null,
      isActive,
      branchIds,
      durationMinutes,
      systemServiceKeyId,
      concurrentCapacity,
      kind,
    },
    errors,
  };
}

/**
 * Төрлийн нэмэлт шалгалт: (1) системийн сэлбэгийн ангилалтай ижил нэр
 * хориглоно (сонголтод хоёр ижил нэр гарахгүй), (2) засахдаа тухайн ангиллыг
 * ашиглаж буй үйлчилгээ/загварын төрөлтэй зөрчилдөх төрөл сонгохгүй.
 */
async function kindFieldErrors(
  tenantId: string,
  data: { name: string; kind: CategoryKind | null },
  categoryId: string | null,
): Promise<Record<string, string>> {
  const errors: Record<string, string> = {};
  if (data.kind === null || data.kind === "GOODS") {
    const clash = await prisma.category.findFirst({
      where: { tenantId: null, name: { equals: data.name, mode: "insensitive" } },
      select: { id: true },
    });
    if (clash) errors.name = "Ийм нэртэй системийн сэлбэгийн ангилал бий — түүнийг ашиглана уу.";
  }
  if (categoryId && data.kind) {
    const [badServices, diagTemplates] = await Promise.all([
      prisma.service.count({ where: { tenantId, categoryId, type: { not: data.kind } } }),
      data.kind === "DIAGNOSTIC"
        ? Promise.resolve(0)
        : prisma.diagnosticTemplate.count({ where: { tenantId, categoryId } }),
    ]);
    if (badServices > 0 || diagTemplates > 0) {
      errors.kind = `Энэ ангиллыг өөр төрлийн ${badServices + diagTemplates} мөр ашиглаж байна — «${categoryKindLabel(data.kind)}» болгох боломжгүй.`;
    }
  }
  return errors;
}

/** Системийн түлхүүр: заавал бол шалгана; сэлбэг/оношилгоонд хоосон байж болно. */
async function resolveServiceKey(data: { systemServiceKeyId: string | null; kind: CategoryKind | null }) {
  const optional = data.kind === "GOODS" || data.kind === "DIAGNOSTIC";
  if (!data.systemServiceKeyId) return optional ? { ok: true as const, id: null } : { ok: false as const };
  const id = await validServiceKeyId(data.systemServiceKeyId);
  return id ? { ok: true as const, id } : { ok: false as const };
}

// Систем admin-аас үүсгэсэн, идэвхтэй ажлын түлхүүр мөн эсэхийг шалгана
// (тенант-хамааралгүй, глобал тул tenantId-аар шүүхгүй).
async function validServiceKeyId(id: string | null): Promise<string | null> {
  if (!id) return null;
  const key = await prisma.systemServiceKey.findFirst({
    where: { id, isActive: true },
    select: { id: true },
  });
  return key ? key.id : null;
}

// Өгөгдсөн branchId-ууд дотроос ЭНЭ тенантынхыг л шүүж буцаана (хууль бус
// branch холбохоос сэргийлнэ).
async function validBranchIds(
  tenantId: string,
  branchIds: string[],
): Promise<string[]> {
  if (branchIds.length === 0) return [];
  const rows = await prisma.branch.findMany({
    where: { tenantId, id: { in: branchIds } },
    select: { id: true },
  });
  return rows.map((b) => b.id);
}

export async function createCategoryAction(
  _prev: CategoryActionState,
  formData: FormData,
): Promise<CategoryActionState> {
  let user;
  try {
    user = await authorizeOwner();
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Алдаа" };
  }

  const { data, errors } = validate(formData);
  if (!data) return { ok: false, fieldErrors: errors };

  const kindErrors = await kindFieldErrors(user.tenantId, data, null);
  if (Object.keys(kindErrors).length > 0) return { ok: false, fieldErrors: kindErrors };
  const branchIds = await validBranchIds(user.tenantId, data.branchIds);
  const key = await resolveServiceKey(data);
  if (!key.ok) {
    return {
      ok: false,
      fieldErrors: { systemServiceKeyId: "Сонгосон системийн ангилал олдсонгүй." },
    };
  }
  const systemServiceKeyId = key.id;

  let created;
  try {
    created = await prisma.category.create({
      data: {
        tenantId: user.tenantId,
        name: data.name,
        description: data.description,
        isActive: data.isActive,
        durationMinutes: data.durationMinutes,
        concurrentCapacity: data.concurrentCapacity,
        systemServiceKeyId,
        kind: data.kind,
        branches: { connect: branchIds.map((id) => ({ id })) },
      },
      select: { id: true },
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return {
        ok: false,
        fieldErrors: { name: "Энэ нэртэй ангилал бүртгэгдсэн байна." },
      };
    }
    return {
      ok: false,
      message: e instanceof Error ? e.message : "Үүсгэх явцад алдаа гарлаа.",
    };
  }

  await logAudit({
    tenantId: user.tenantId,
    userId: user.id,
    entity: "Category",
    entityId: created.id,
    action: "CREATE",
    summary: data.name,
    after: { ...data, branchIds },
  });

  revalidatePath("/dashboard/services/categories");
  revalidatePath("/dashboard/services", "layout");
  return { ok: true, message: "Ангилал нэмэгдлээ." };
}

export async function updateCategoryAction(
  id: string,
  _prev: CategoryActionState,
  formData: FormData,
): Promise<CategoryActionState> {
  let user;
  try {
    user = await authorizeOwner();
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Алдаа" };
  }

  const { data, errors } = validate(formData);
  if (!data) return { ok: false, fieldErrors: errors };

  const kindErrors = await kindFieldErrors(user.tenantId, data, id);
  if (Object.keys(kindErrors).length > 0) return { ok: false, fieldErrors: kindErrors };
  const branchIds = await validBranchIds(user.tenantId, data.branchIds);
  const key = await resolveServiceKey(data);
  if (!key.ok) {
    return {
      ok: false,
      fieldErrors: { systemServiceKeyId: "Сонгосон системийн ангилал олдсонгүй." },
    };
  }
  const systemServiceKeyId = key.id;

  // Тенантынх мөн эсэхийг шалгана (set-д хэрэгтэй). Системийн ангилал (tenantId
  // null) энд олдохгүй тул тенант хэзээ ч засахгүй.
  const existing = await prisma.category.findFirst({
    where: { id, tenantId: user.tenantId },
    select: { id: true },
  });
  if (!existing) return { ok: false, message: "Ангилал олдсонгүй." };

  try {
    await prisma.category.update({
      where: { id },
      data: {
        name: data.name,
        description: data.description,
        isActive: data.isActive,
        durationMinutes: data.durationMinutes,
        concurrentCapacity: data.concurrentCapacity,
        systemServiceKeyId,
        kind: data.kind,
        branches: { set: branchIds.map((bid) => ({ id: bid })) },
      },
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return {
        ok: false,
        fieldErrors: { name: "Энэ нэртэй ангилал бүртгэгдсэн байна." },
      };
    }
    return {
      ok: false,
      message: e instanceof Error ? e.message : "Шинэчлэх явцад алдаа гарлаа.",
    };
  }

  await logAudit({
    tenantId: user.tenantId,
    userId: user.id,
    entity: "Category",
    entityId: id,
    action: "UPDATE",
    summary: data.name,
    after: { ...data, branchIds },
  });

  revalidatePath("/dashboard/services/categories");
  revalidatePath("/dashboard/services", "layout");
  return { ok: true, message: "Хадгалагдлаа." };
}

export async function deleteCategoryAction(formData: FormData): Promise<ConfirmActionResult> {
  const user = await authorizeOwner();
  const id = s(formData, "id");
  if (!id) return;

  const target = await prisma.category.findFirst({
    where: { id, tenantId: user.tenantId },
    select: { name: true },
  });

  const usedCount = await prisma.service.count({
    where: { tenantId: user.tenantId, categoryId: id },
  });

  if (usedCount > 0) {
    // Үйлчилгээнд ашиглагдсан бол устгахгүй — архивлана.
    await prisma.category.updateMany({
      where: { id, tenantId: user.tenantId },
      data: { isActive: false },
    });
  } else {
    await prisma.category.deleteMany({
      where: { id, tenantId: user.tenantId },
    });
  }

  await logAudit({
    tenantId: user.tenantId,
    userId: user.id,
    entity: "Category",
    entityId: id,
    action: usedCount > 0 ? "UPDATE" : "DELETE",
    summary: target ? `${target.name}${usedCount > 0 ? " (архивлав)" : ""}` : null,
  });

  revalidatePath("/dashboard/services/categories");
  revalidatePath("/dashboard/services", "layout");
}

// Жагсаалтаас олноор сонгож системийн түлхүүрийг нэг зэрэг солих (харах:
// bulkChangeServiceCategoryAction app/_actions/services.ts — адил
// all-or-nothing БИШ загвар). Түлхүүр бүх ангилалд заавал тул хоослож болохгүй.
export async function bulkChangeCategorySystemKeyAction(
  _prev: BulkActionState,
  formData: FormData,
): Promise<BulkActionState> {
  let user;
  try {
    user = await authorizeOwner();
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Алдаа" };
  }

  const systemServiceKeyId = await validServiceKeyId(s(formData, "systemServiceKeyId"));
  if (!systemServiceKeyId) {
    return { ok: false, message: "Системийн ангилал сонгоно уу." };
  }
  const key = await prisma.systemServiceKey.findUnique({
    where: { id: systemServiceKeyId },
    select: { name: true },
  });

  const ids = parseIdsJson(s(formData, "categoryIdsJson"));
  if (ids.length === 0) return { ok: false, message: "Дор хаяж нэг ангилал сонгоно уу." };

  const categories = await prisma.category.findMany({
    where: { id: { in: ids }, tenantId: user.tenantId },
    select: { id: true, name: true, systemServiceKeyId: true },
  });
  const byId = new Map(categories.map((c) => [c.id, c]));

  let succeeded = 0;
  const errors: string[] = [];
  for (const id of ids) {
    const cat = byId.get(id);
    try {
      if (!cat) throw new Error("Олдсонгүй.");
      if (cat.systemServiceKeyId !== systemServiceKeyId) {
        await prisma.category.update({
          where: { id: cat.id },
          data: { systemServiceKeyId },
        });
        await logAudit({
          tenantId: user.tenantId,
          userId: user.id,
          entity: "Category",
          entityId: cat.id,
          action: "UPDATE",
          summary: `Системийн ангилал: ${key?.name ?? systemServiceKeyId}`,
          after: { systemServiceKeyId },
        });
      }
      succeeded++;
    } catch (e) {
      errors.push(`${cat?.name ?? id}: ${e instanceof Error ? e.message : "алдаа"}`);
    }
  }

  revalidatePath("/dashboard/services/categories");
  revalidatePath("/dashboard/services", "layout");

  if (succeeded === 0) {
    return {
      ok: false,
      message: errors[0] ?? "Түлхүүр солиход алдаа гарлаа.",
      succeeded,
      failed: errors.length,
      errors,
    };
  }
  return {
    ok: true,
    message: `${succeeded}/${ids.length} ангиллын системийн түлхүүр шинэчлэгдлээ.${
      errors.length ? ` (${errors.length} амжилтгүй)` : ""
    }`,
    succeeded,
    failed: errors.length,
    errors: errors.length ? errors : undefined,
  };
}
