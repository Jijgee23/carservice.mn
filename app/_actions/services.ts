"use server";


import type { ConfirmActionResult } from "@/lib/confirm-action";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { canCreate, canDelete, canEdit } from "@/lib/auth/roles";
import { assertActiveSubscription } from "@/lib/subscription-server";
import { type BulkActionState, parseIdsJson } from "@/lib/bulk-action";
import { PLAN_LIMIT_CODES } from "@/lib/plan-limits";
import { enforceCountLimit } from "@/lib/plan-limits-server";
import { prisma } from "@/lib/prisma";
import { SERVICE_KIND_SLUG, type ServiceKind } from "@/lib/services";
import {
  ServiceCommandError,
  adjustServiceStockCommand,
  bulkChangeServiceCategoryCommand,
  deleteServiceCommand,
  updateServiceCommand,
} from "@/lib/services/service-commands";
import { validateServiceCreate, type ServiceCreateRaw } from "@/lib/services/service-create-rules";
import { createServiceCommand, loadServiceRefs } from "@/lib/services/service-create";

export type ServiceActionState = {
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
      ? canCreate(user, "services")
      : action === "edit"
        ? canEdit(user, "services")
        : canDelete(user, "services");
  if (!ok) {
    throw new Error("Танд үйлчилгээ/бараанд энэ үйлдэл хийх эрх байхгүй.");
  }
  await assertActiveSubscription(user.tenantId);
  return user;
}

// Үүсгэх дүрэм нэг газар (вэб форм + Excel импорт): lib/services/service-create-rules.ts.
function rawFromForm(fd: FormData): ServiceCreateRaw {
  return {
    type: s(fd, "type"),
    name: s(fd, "name"),
    code: s(fd, "code"),
    unitId: s(fd, "unitId"),
    price: s(fd, "price"),
    costPrice: s(fd, "costPrice"),
    stock: s(fd, "stock"),
    durationValue: s(fd, "durationValue"),
    durationUnitId: s(fd, "durationUnitId"),
    reminderIntervalMonths: s(fd, "reminderIntervalMonths"),
    description: s(fd, "description"),
    categoryId: s(fd, "categoryId"),
    isActive: fd.get("isActive") === "on",
  };
}

function redirectAfter(type: ServiceKind): never {
  redirect(`/dashboard/services/${SERVICE_KIND_SLUG[type]}`);
}

export async function createServiceAction(
  _prev: ServiceActionState,
  formData: FormData,
): Promise<ServiceActionState> {
  let user;
  try {
    user = await authorize("create");
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Алдаа" };
  }

  const raw = rawFromForm(formData);
  const { values: data, errors } = validateServiceCreate(raw, await loadServiceRefs(user.tenantId, raw.type));
  if (!data) return { ok: false, fieldErrors: errors };

  // Багцын хязгаар: max_services
  const limit = await enforceCountLimit(
    user.tenantId,
    PLAN_LIMIT_CODES.MAX_SERVICES,
    () => prisma.service.count({ where: { tenantId: user.tenantId } }),
  );
  if (!limit.allowed) {
    return { ok: false, message: limit.message };
  }

  const created = await createServiceCommand(user, data);
  if (!created.ok) return { ok: false, fieldErrors: created.fieldErrors, message: created.message };

  revalidatePath("/dashboard/services", "layout");
  redirectAfter(data.type);
}

// P4-B1 — thin adapter over `updateServiceCommand`
// (`lib/services/service-commands.ts`). All validation, the type-conditional
// unit/duration/category rules, the stock-is-never-written-here behaviour and
// the P2002 code-conflict mapping now live only in the command module — see
// its doc comment for the whole-record-replace decision this slice made.
export async function updateServiceAction(
  id: string,
  _prev: ServiceActionState,
  formData: FormData,
): Promise<ServiceActionState> {
  let user;
  try {
    user = await authorize("edit");
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Алдаа" };
  }

  let updated;
  try {
    updated = await updateServiceCommand({
      actor: user,
      serviceId: id,
      data: {
        type: s(formData, "type"),
        name: s(formData, "name"),
        code: s(formData, "code").toUpperCase(),
        unitId: s(formData, "unitId"),
        price: s(formData, "price"),
        costPrice: s(formData, "costPrice"),
        stock: s(formData, "stock"),
        durationValue: s(formData, "durationValue"),
        durationUnitId: s(formData, "durationUnitId"),
        reminderIntervalMonths: s(formData, "reminderIntervalMonths"),
        description: s(formData, "description"),
        isActive: formData.get("isActive") === "on",
        categoryId: s(formData, "categoryId"),
      },
    });
  } catch (e) {
    if (e instanceof ServiceCommandError) {
      if (e.fieldErrors) return { ok: false, fieldErrors: e.fieldErrors };
      return { ok: false, message: e.message };
    }
    return {
      ok: false,
      message: e instanceof Error ? e.message : "Шинэчлэх явцад алдаа гарлаа.",
    };
  }

  revalidatePath("/dashboard/services", "layout");
  revalidatePath(`/dashboard/services/${id}`);
  redirectAfter(updated.type);
}

// P4-B1 — thin adapter over `deleteServiceCommand`. The command decides
// archive-vs-hard-delete; this adapter only swallows the not-found case, same
// as the original inline `if (!svc) return;`.
export async function deleteServiceAction(formData: FormData): Promise<ConfirmActionResult> {
  const user = await authorize("delete");
  const id = s(formData, "id");
  if (!id) return;

  try {
    await deleteServiceCommand({ actor: user, serviceId: id });
  } catch (e) {
    if (e instanceof ServiceCommandError && e.code === "SERVICE_NOT_FOUND") return;
    if (e instanceof ServiceCommandError) return { error: e.message };
    throw e;
  }

  revalidatePath("/dashboard/services", "layout");
}

// P4-B1 — thin adapter over `adjustServiceStockCommand`.
export async function adjustServiceStockAction(
  id: string,
  _prev: ServiceActionState,
  formData: FormData,
): Promise<ServiceActionState> {
  let user;
  try {
    user = await authorize("edit");
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Алдаа" };
  }

  try {
    await adjustServiceStockCommand({
      actor: user,
      serviceId: id,
      data: {
        direction: s(formData, "direction"),
        amount: s(formData, "amount"),
      },
    });
  } catch (e) {
    if (e instanceof ServiceCommandError) {
      if (e.fieldErrors) return { ok: false, fieldErrors: e.fieldErrors };
      return { ok: false, message: e.message };
    }
    return {
      ok: false,
      message: e instanceof Error ? e.message : "Алдаа гарлаа.",
    };
  }

  revalidatePath("/dashboard/services/goods");
  revalidatePath(`/dashboard/services/${id}`);
  return { ok: true, message: "Үлдэгдэл шинэчлэгдлээ." };
}

// Жагсаалтаас олноор сонгож ангилал солих (харах:
// bulkChangeOrderStatusAction/bulkAssignOrderAction app/_actions/orders.ts,
// bulkChangeAppointmentCategoryAction app/_actions/appointments.ts — адил
// all-or-nothing БИШ загвар). Ангилал бүх Service-д заавал тул хоослож
// болохгүй.
//
// P4-B1 — thin adapter over `bulkChangeServiceCategoryCommand`. The three
// whole-request rejections (missing categoryId, unknown categoryId, empty
// selection) surface as plain `{ok:false,message}` — same shape as the
// original inline early-returns, no succeeded/failed/errors keys attached.
export async function bulkChangeServiceCategoryAction(
  _prev: BulkActionState,
  formData: FormData,
): Promise<BulkActionState> {
  let user;
  try {
    user = await authorize("edit");
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Алдаа" };
  }

  const categoryId = s(formData, "categoryId");
  const ids = parseIdsJson(s(formData, "serviceIdsJson"));

  let result;
  try {
    result = await bulkChangeServiceCategoryCommand({
      actor: user,
      categoryId,
      serviceIds: ids,
    });
  } catch (e) {
    if (e instanceof ServiceCommandError) return { ok: false, message: e.message };
    return {
      ok: false,
      message: e instanceof Error ? e.message : "Ангилал солиход алдаа гарлаа.",
    };
  }

  revalidatePath("/dashboard/services", "layout");

  const { succeeded, failed, errors } = result;
  if (succeeded === 0) {
    return {
      ok: false,
      message: errors[0] ?? "Ангилал солиход алдаа гарлаа.",
      succeeded,
      failed,
      errors,
    };
  }
  return {
    ok: true,
    message: `${succeeded}/${ids.length} мөрийн ангилал шинэчлэгдлээ.${
      failed ? ` (${failed} амжилтгүй)` : ""
    }`,
    succeeded,
    failed,
    errors: errors.length ? errors : undefined,
  };
}
