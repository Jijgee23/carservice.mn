import { BOOKABLE_CATEGORY_WHERE } from "@/lib/categories";
import { resolveCategoryDurations } from "@/lib/category-duration";
import { logAudit } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import {
  assertStaffScope,
  AppointmentCommandError,
  type AppointmentCommandActor,
} from "@/lib/appointments/appointment-commands";

export const MAX_BULK_APPOINTMENT_IDS = 100;

export type BulkAppointmentFailure = {
  appointmentId: string;
  code: string;
  message: string;
};

export type BulkAppointmentResult = {
  succeeded: string[];
  failed: BulkAppointmentFailure[];
};

/**
 * Category change is forbidden once a ServiceOrder exists (the category set
 * becomes historical record at that point — see D-076), and re-derives
 * `estimatedDurationMinutes` because it feeds slot capacity.
 */
export async function changeAppointmentCategoryCommand(input: {
  actor: AppointmentCommandActor;
  appointmentId: string;
  categoryIds: string[];
}): Promise<{ appointmentId: string }> {
  const { actor, appointmentId, categoryIds } = input;
  const appt = await prisma.appointment.findUnique({
    where: { id: appointmentId },
    select: {
      id: true,
      tenantId: true,
      branchId: true,
      serviceOrderId: true,
      categories: { select: { category: { select: { name: true } } } },
    },
  });
  if (!appt) throw new AppointmentCommandError("Цаг захиалга олдсонгүй.", 404, "APPOINTMENT_NOT_FOUND");
  if (actor.tenantId !== appt.tenantId) {
    throw new AppointmentCommandError("Танд энэ цагийг удирдах эрх байхгүй.", 403, "APPOINTMENT_OUT_OF_SCOPE");
  }
  await assertStaffScope(actor, appt.branchId);
  if (appt.serviceOrderId) {
    throw new AppointmentCommandError(
      "Засварын хуудас үүссэн тул ажлын төрлийг энд өөрчлөх боломжгүй.",
      422,
      "LINKED_ORDER_EXISTS",
    );
  }

  const uniqueIds = [...new Set(categoryIds)];
  if (uniqueIds.length === 0) {
    throw new AppointmentCommandError("Дор хаяж нэг ажлын төрөл сонгоно уу.", 422, "CATEGORY_REQUIRED");
  }

  const categories = await prisma.category.findMany({
    where: {
      id: { in: uniqueIds },
      tenantId: actor.tenantId,
      isActive: true,
      // Match reservation/create eligibility: a category is valid for this
      // appointment's branch only when it is assigned there or is global.
      OR: [{ branches: { some: { id: appt.branchId } } }, { branches: { none: {} } }],
      AND: [BOOKABLE_CATEGORY_WHERE],
    },
    select: { id: true, name: true },
  });
  if (categories.length !== uniqueIds.length) {
    throw new AppointmentCommandError("Сонгосон ажлын төрөл олдсонгүй.", 422, "CATEGORY_NOT_FOUND");
  }

  const beforeNames = appt.categories.map((c) => c.category.name);
  const afterNames = categories.map((c) => c.name);

  await prisma.$transaction(async (tx) => {
    await tx.appointmentCategory.deleteMany({ where: { appointmentId: appt.id } });
    await tx.appointmentCategory.createMany({
      data: uniqueIds.map((categoryId) => ({ appointmentId: appt.id, categoryId })),
    });
    const { totalMinutes } = await resolveCategoryDurations(tx, uniqueIds);
    await tx.appointment.update({ where: { id: appt.id }, data: { estimatedDurationMinutes: totalMinutes } });
    await logAudit({
      tenantId: appt.tenantId,
      userId: actor.id,
      branchId: appt.branchId,
      entity: "Appointment",
      entityId: appt.id,
      action: "UPDATE",
      summary: `Ажлын төрөл: ${beforeNames.join(", ") || "—"} → ${afterNames.join(", ")}`,
      after: { categoryIds: uniqueIds },
    });
  });

  return { appointmentId: appt.id };
}

function failureFor(appointmentId: string, error: unknown): BulkAppointmentFailure {
  if (error instanceof AppointmentCommandError) {
    return { appointmentId, code: error.code, message: error.message };
  }
  return {
    appointmentId,
    code: "INTERNAL_ERROR",
    message: error instanceof Error ? error.message : "Серверийн алдаа гарлаа.",
  };
}

/**
 * Bulk category change: partial success, each target locked independently
 * (via `changeAppointmentCategoryCommand`'s own scope/existence checks), and
 * one failure never aborts the rest of the batch — matching
 * `bulkChangeAppointmentCategoryAction`'s original all-or-nothing-per-row
 * (not all-or-nothing-per-batch) semantics.
 */
export async function bulkChangeAppointmentCategoryCommand(input: {
  actor: AppointmentCommandActor;
  appointmentIds: readonly string[];
  categoryIds: string[];
}): Promise<BulkAppointmentResult> {
  const succeeded: string[] = [];
  const failed: BulkAppointmentFailure[] = [];
  for (const appointmentId of input.appointmentIds) {
    try {
      await changeAppointmentCategoryCommand({ actor: input.actor, appointmentId, categoryIds: input.categoryIds });
      succeeded.push(appointmentId);
    } catch (error) {
      failed.push(failureFor(appointmentId, error));
    }
  }
  return { succeeded, failed };
}
