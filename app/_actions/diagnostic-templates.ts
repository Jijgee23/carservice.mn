"use server";


import type { ConfirmActionResult } from "@/lib/confirm-action";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { Prisma } from "@/app/generated/prisma/client";
import { logAudit } from "@/lib/audit";
import { requireUser } from "@/lib/auth";
import { canCreate, canDelete, canEdit } from "@/lib/auth/roles";
import { assertActiveSubscription } from "@/lib/subscription-server";
import { PLAN_LIMIT_CODES } from "@/lib/plan-limits";
import { enforceCountLimit, isFeatureEnabled } from "@/lib/plan-limits-server";
import {
  DIAGNOSTIC_TYPES,
  type DiagnosticType,
  type TemplateSchema,
  emptySchema,
  tenantVisibleTemplateWhere,
  validateSchema,
} from "@/lib/diagnostics";
import { prisma } from "@/lib/prisma";
import { parseNonNegativeDecimal } from "@/lib/decimal-input";

const parseDecimal = parseNonNegativeDecimal;

export type TemplateActionState = {
  ok: boolean;
  message?: string;
  fieldErrors?: Record<string, string>;
} | null;

function s(fd: FormData, key: string): string {
  const v = fd.get(key);
  return typeof v === "string" ? v.trim() : "";
}

async function authorize(action: "create" | "edit" | "delete") {
  const user = await requireUser();
  const ok =
    action === "create"
      ? canCreate(user, "diagnostics")
      : action === "edit"
        ? canEdit(user, "diagnostics")
        : canDelete(user, "diagnostics");
  if (!ok) {
    throw new Error("Танд оношилгооны загварт энэ үйлдэл хийх эрх байхгүй.");
  }
  await assertActiveSubscription(user.tenantId);
  return user;
}

type Parsed = {
  name: string;
  description: string | null;
  type: DiagnosticType;
  isActive: boolean;
  schema: TemplateSchema;
  price: Prisma.Decimal | null;
  durationMin: number | null;
  categoryId: string | null;
  errors: Record<string, string>;
};

function parse(fd: FormData): Parsed {
  const name = s(fd, "name");
  const description = s(fd, "description");
  const typeRaw = s(fd, "type");
  const isActive = fd.get("isActive") === "on";
  const schemaRaw = s(fd, "schema");
  const priceRaw = s(fd, "price");
  const durationRaw = s(fd, "durationMin");
  const categoryId = s(fd, "categoryId") || null;

  const errors: Record<string, string> = {};
  if (!name) errors.name = "Хуудасны нэрээ оруулна уу.";
  if (!DIAGNOSTIC_TYPES.includes(typeRaw as DiagnosticType))
    errors.type = "Төрлөө сонгоно уу.";
  if (!categoryId) errors.categoryId = "Ангилал сонгоно уу.";

  let schema: TemplateSchema = emptySchema();
  if (!schemaRaw) {
    errors.schema = "Хуудасны бүтэц алга байна.";
  } else {
    try {
      const parsed: unknown = JSON.parse(schemaRaw);
      schema = validateSchema(parsed);
    } catch (e) {
      errors.schema = e instanceof Error ? e.message : "Бүтэц JSON буруу.";
    }
  }

  let price: Prisma.Decimal | null = null;
  if (priceRaw) {
    price = parseDecimal(priceRaw);
    if (!price) errors.price = "Үнэ буруу.";
  }

  let durationMin: number | null = null;
  if (durationRaw) {
    const n = Number.parseInt(durationRaw, 10);
    if (!Number.isFinite(n) || n < 0) {
      errors.durationMin = "Хугацаа буруу.";
    } else {
      durationMin = n;
    }
  }

  return {
    name,
    description: description || null,
    type: typeRaw as DiagnosticType,
    isActive,
    schema,
    price,
    durationMin,
    categoryId,
    errors,
  };
}

// Ангилал тенантынх мөн эсэхийг шалгана (parse нь sync тул тусад нь).
async function assertCategory(
  tenantId: string,
  categoryId: string | null,
): Promise<boolean> {
  if (!categoryId) return false;
  const cat = await prisma.category.findFirst({
    // Оношилгооны загварт — «Оношилгоо» эсвэл «Бүх төрөлд» ангилал.
    where: { id: categoryId, tenantId, OR: [{ kind: "DIAGNOSTIC" as const }, { kind: null }] },
    select: { id: true },
  });
  return Boolean(cat);
}

export async function createTemplateAction(
  _prev: TemplateActionState,
  formData: FormData,
): Promise<TemplateActionState> {
  let user;
  try {
    user = await authorize("create");
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Алдаа" };
  }

  const { name, description, type, isActive, schema, price, durationMin, categoryId, errors } =
    parse(formData);
  if (Object.keys(errors).length > 0) {
    return { ok: false, fieldErrors: errors };
  }
  if (!(await assertCategory(user.tenantId, categoryId))) {
    return { ok: false, fieldErrors: { categoryId: "Сонгосон ангилал олдсонгүй." } };
  }

  // Багц boolean: оношилгооны модуль нээгдсэн эсэх
  if (!(await isFeatureEnabled(user.tenantId, PLAN_LIMIT_CODES.ENABLE_DIAGNOSTICS))) {
    return {
      ok: false,
      message: "Таны багц дээр оношилгооны модуль нээгдээгүй байна.",
    };
  }
  const limit = await enforceCountLimit(
    user.tenantId,
    PLAN_LIMIT_CODES.MAX_DIAGNOSTIC_TEMPLATES,
    () => prisma.diagnosticTemplate.count({ where: { tenantId: user.tenantId } }),
  );
  if (!limit.allowed) {
    return { ok: false, message: limit.message };
  }

  let created;
  try {
    created = await prisma.diagnosticTemplate.create({
      data: {
        name,
        description,
        type,
        isActive,
        schema,
        price,
        durationMin,
        categoryId,
        version: 1,
        tenantId: user.tenantId,
        createdById: user.id,
      },
      select: { id: true },
    });
  } catch (e) {
    return {
      ok: false,
      message: e instanceof Error ? e.message : "Үүсгэхэд алдаа гарлаа.",
    };
  }

  await logAudit({
    tenantId: user.tenantId,
    userId: user.id,
    entity: "DiagnosticTemplate",
    entityId: created.id,
    action: "CREATE",
    summary: `[${type}] ${name}`,
    after: { name, type, isActive, price: price?.toString() ?? null },
  });

  revalidatePath("/dashboard/services/diagnostics");
  redirect("/dashboard/services/diagnostics");
}

export async function updateTemplateAction(
  id: string,
  _prev: TemplateActionState,
  formData: FormData,
): Promise<TemplateActionState> {
  let user;
  try {
    user = await authorize("edit");
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Алдаа" };
  }

  const { name, description, type, isActive, schema, price, durationMin, categoryId, errors } =
    parse(formData);
  if (Object.keys(errors).length > 0) {
    return { ok: false, fieldErrors: errors };
  }
  if (!(await assertCategory(user.tenantId, categoryId))) {
    return { ok: false, fieldErrors: { categoryId: "Сонгосон ангилал олдсонгүй." } };
  }

  // Бөглөгдсөн тайлантай бол schema өөрчилбөл version-г өсгөнө
  const existing = await prisma.diagnosticTemplate.findFirst({
    where: { id, tenantId: user.tenantId },
    select: {
      schema: true,
      version: true,
      isSystemDefault: true,
      _count: { select: { reports: true } },
    },
  });
  if (!existing) return { ok: false, message: "Загвар олдсонгүй." };
  if (existing.isSystemDefault) {
    return {
      ok: false,
      message: "Системийн үндсэн загварыг засах боломжгүй.",
    };
  }

  const schemaChanged =
    JSON.stringify(existing.schema) !== JSON.stringify(schema);
  const bump = schemaChanged && existing._count.reports > 0;

  try {
    await prisma.diagnosticTemplate.update({
      where: { id },
      data: {
        name,
        description,
        type,
        isActive,
        schema,
        price,
        durationMin,
        categoryId,
        version: bump ? existing.version + 1 : existing.version,
      },
    });
  } catch (e) {
    return {
      ok: false,
      message: e instanceof Error ? e.message : "Шинэчлэхэд алдаа гарлаа.",
    };
  }

  await logAudit({
    tenantId: user.tenantId,
    userId: user.id,
    entity: "DiagnosticTemplate",
    entityId: id,
    action: "UPDATE",
    summary: `[${type}] ${name}${bump ? ` · v${existing.version + 1}` : ""}`,
    after: { name, type, isActive, price: price?.toString() ?? null, schemaChanged },
  });

  revalidatePath("/dashboard/services/diagnostics");
  revalidatePath(`/dashboard/services/diagnostics/${id}`);
  redirect("/dashboard/services/diagnostics");
}

export async function deleteTemplateAction(formData: FormData): Promise<ConfirmActionResult> {
  const user = await authorize("delete");
  const id = s(formData, "id");
  if (!id) return;

  // Тайлантай бол устгахгүй, зөвхөн идэвхгүй болгоно
  const t = await prisma.diagnosticTemplate.findFirst({
    where: { id, tenantId: user.tenantId },
    select: {
      name: true,
      isSystemDefault: true,
      _count: { select: { reports: true } },
    },
  });
  if (!t) return;
  // UI-д товч харагдахгүй байх ёстой — энэ зөвхөн шууд POST илгээх гэх мэт
  // UI-г тойрсон оролдлогоос хамгаалах сүүлчийн хамгаалалт.
  if (t.isSystemDefault) return;

  const archived = t._count.reports > 0;
  if (archived) {
    await prisma.diagnosticTemplate.update({
      where: { id },
      data: { isActive: false },
    });
  } else {
    await prisma.diagnosticTemplate.delete({ where: { id } });
  }

  await logAudit({
    tenantId: user.tenantId,
    userId: user.id,
    entity: "DiagnosticTemplate",
    entityId: id,
    action: archived ? "UPDATE" : "DELETE",
    summary: `${t.name}${archived ? " (архивлав)" : ""}`,
  });

  revalidatePath("/dashboard/services/diagnostics");
}

export async function duplicateTemplateAction(formData: FormData): Promise<void> {
  const user = await authorize("create");
  const id = s(formData, "id");
  if (!id) return;

  // Өөрийн загвар эсвэл систем admin-аас олгосон хуваалцсан загвар (tenantId
  // NULL) аль алиныг нь хуулж болно — сүүлийнхийг тохируулахыг хүсвэл эхлээд
  // хуулбарлаж, дараа нь тухайн хуулбарыг чөлөөтэй засна.
  const src = await prisma.diagnosticTemplate.findFirst({
    where: { id, ...tenantVisibleTemplateWhere(user.tenantId) },
  });
  if (!src) return;

  // Системийн загварын ангилал өөр tenant-ынх байж болзошгүй — зөвхөн
  // энэ tenant-ын ангилал бол хадгална.
  const categoryId = src.categoryId
    ? (await prisma.category.findFirst({
        where: { id: src.categoryId, tenantId: user.tenantId, OR: [{ kind: "DIAGNOSTIC" as const }, { kind: null }] },
        select: { id: true },
      }))?.id ?? null
    : null;

  const copy = await prisma.diagnosticTemplate.create({
    data: {
      name: `${src.name} (хуулбар)`,
      description: src.description,
      type: src.type,
      isActive: src.isActive,
      schema: src.schema as object,
      categoryId,
      price: src.price,
      durationMin: src.durationMin,
      version: 1,
      tenantId: user.tenantId,
      createdById: user.id,
    },
    select: { id: true, name: true },
  });

  await logAudit({
    tenantId: user.tenantId,
    userId: user.id,
    entity: "DiagnosticTemplate",
    entityId: copy.id,
    action: "CREATE",
    summary: `${copy.name} (${src.name}-ээс хуулбарлав)`,
  });

  revalidatePath("/dashboard/services/diagnostics");
}
