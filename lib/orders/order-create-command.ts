import { Prisma } from "@/app/generated/prisma/client";
import { logAudit } from "@/lib/audit";
import { DEFAULT_SLOT_MINUTES } from "@/lib/appointment-slots";
import { validateScheduledOrderHours } from "@/lib/order-schedule-validation";
import { openOrderTimeBooking } from "@/lib/order-time-booking";
import { nextOrderNumber } from "@/lib/order-number";
import { PLAN_LIMIT_CODES } from "@/lib/plan-limits";
import { enforceCountLimit } from "@/lib/plan-limits-server";
import { INTAKE_PATH_CLAIMED_MESSAGE, type IntakeInput } from "@/lib/orders/order-intake-server";
import { prisma, withBookingTransaction, type PrismaTransactionClient } from "@/lib/prisma";
import { ensureTenantVehicle } from "@/lib/vehicles";
import { validateOrderAssignee, OrderCommandError } from "@/lib/orders/order-commands";
import {
  CARRIED_ASSIGNEE_INELIGIBLE_MESSAGE,
  isCarriedAssigneeIneligible,
} from "@/lib/appointments/appointment-assignee-label";
import { internalPostpaidConflict } from "@/lib/orders/order-internal";
import { resolveOrderIsPostpaid, validateOrderReferences } from "@/lib/orders/order-create-references";

export type CreateOrderCommandInput = {
  tenantId: string;
  actorId: string;
  branchId: string;
  customerId: string;
  vehicleId: string;
  assignedToId: string | null;
  scheduledAt: Date | null;
  notes: string | null;
  // QA #14: үүсгэх үед л бичигдэх хүлээн авах хэсэг (шалгагдсан staged замууд).
  intake?: IntakeInput | null;
  appointmentId?: string | null;
  estimatedDurationMinutes?: number | null;
  workingBranchId?: string | null;
  // Omitted -> TenantVehicle.isPostpaid.
  isPostpaid?: boolean;
  // Дотоод засвар: төлбөргүй, isPostpaid-тэй зэрэг байж болохгүй.
  isInternal?: boolean;
};

export type CreateOrderCommandResult = {
  id: string;
  number: string;
};

function branchSlotMinutes(value: number | null | undefined): number {
  return value && value > 0 ? value : DEFAULT_SLOT_MINUTES;
}

function todayStart(): Date {
  const value = new Date();
  value.setHours(0, 0, 0, 0);
  return value;
}

async function enforceCreateLimits(tenantId: string): Promise<void> {
  const daily = await enforceCountLimit(
    tenantId,
    PLAN_LIMIT_CODES.DAILY_ORDERS,
    () => prisma.serviceOrder.count({
      where: { tenantId, createdAt: { gte: todayStart() } },
    }),
  );
  if (!daily.allowed) {
    throw new OrderCommandError(daily.message ?? "Өдрийн захиалгын хязгаарт хүрсэн байна.", 422, "PLAN_LIMIT_REACHED");
  }

  const active = await enforceCountLimit(
    tenantId,
    PLAN_LIMIT_CODES.MAX_ACTIVE_ORDERS,
    () => prisma.serviceOrder.count({
      where: { tenantId, status: { in: ["SCHEDULED", "IN_PROGRESS"] } },
    }),
  );
  if (!active.allowed) {
    throw new OrderCommandError(active.message ?? "Идэвхтэй захиалгын хязгаарт хүрсэн байна.", 422, "PLAN_LIMIT_REACHED");
  }
}

export async function createOrderCommand(
  input: CreateOrderCommandInput,
): Promise<CreateOrderCommandResult> {
  // Хариуцах мастер заавал — web, mobile бүх замд. QA #28: цаг захиалгаас
  // үүсгэж байгаа бол мастер нь цагийн хариуцагчаас (доор) дамжиж болох тул
  // тэр тохиолдолд шалгалтыг цагийг уншсаны дараа хийнэ.
  if (!input.assignedToId && !input.appointmentId) {
    throw new OrderCommandError(
      "Хариуцах мастер сонгоно уу.",
      422,
      "ASSIGNEE_REQUIRED",
      { assignedToId: "Хариуцах мастер сонгоно уу." },
    );
  }
  if (input.workingBranchId && input.workingBranchId !== "ALL" && input.branchId !== input.workingBranchId) {
    throw new OrderCommandError(
      "Зөвхөн өөрийн салбарт засварын хуудас үүсгэх боломжтой.",
      422,
      "ORDER_OUT_OF_SCOPE",
      { branchId: "Зөвхөн өөрийн салбарт засварын хуудас үүсгэх боломжтой." },
    );
  }

  const conflict = internalPostpaidConflict(input.isInternal, input.isPostpaid);
  if (conflict) {
    throw new OrderCommandError(conflict.message, conflict.status, conflict.code, {
      isInternal: conflict.message,
      isPostpaid: conflict.message,
    });
  }

  await enforceCreateLimits(input.tenantId);

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await withBookingTransaction(input.tenantId, async (tx) => {
        const [branch, customer, vehicle, appointment] = await Promise.all([
          tx.branch.findFirst({
            where: { id: input.branchId, tenantId: input.tenantId },
            select: { id: true, slotMinutes: true, isActive: true },
          }),
          tx.customer.findFirst({
            where: { id: input.customerId, tenantId: input.tenantId },
            select: { id: true },
          }),
          tx.tenantVehicle.findUnique({
            where: {
              tenantId_vehicleId: { tenantId: input.tenantId, vehicleId: input.vehicleId },
            },
            select: { vehicleId: true, customerId: true, isPostpaid: true, vehicle: { select: { plate: true, vin: true } } },
          }),
          input.appointmentId
            ? tx.appointment.findFirst({
                where: { id: input.appointmentId, tenantId: input.tenantId },
                select: {
                  id: true,
                  customerId: true,
                  accountId: true,
                  vehicleId: true,
                  serviceOrderId: true,
                  branchId: true,
                  estimatedDurationMinutes: true,
                  arrivedAt: true,
                  assignedToId: true,
                  categoryId: true,
                  category: { select: { name: true } },
                  categories: {
                    orderBy: { createdAt: "asc" },
                    select: { categoryId: true, category: { select: { name: true } } },
                  },
                },
              })
            : Promise.resolve(null),
        ]);

        // QA #28 carry-over: an explicit master wins; otherwise the
        // appointment's master is carried into the order. It goes through the
        // same validateOrderAssignee below, so a no-longer-eligible stored
        // master is rejected with the standard assignee error, never silently
        // written.
        const assignedToId = input.assignedToId ?? appointment?.assignedToId ?? null;
        if (!assignedToId) {
          throw new OrderCommandError(
            "Хариуцах мастер сонгоно уу.",
            422,
            "ASSIGNEE_REQUIRED",
            { assignedToId: "Хариуцах мастер сонгоно уу." },
          );
        }

        let accountVehicleToLink = false;
        if (!vehicle && appointment?.accountId && appointment.customerId === input.customerId) {
          const accountVehicle = await tx.accountVehicle.findFirst({
            where: { accountId: appointment.accountId, vehicleId: input.vehicleId },
            select: { vehicleId: true },
          });
          accountVehicleToLink = Boolean(accountVehicle);
        }

        const fieldErrors = validateOrderReferences({
          branchId: input.branchId,
          customerId: input.customerId,
          vehicleId: input.vehicleId,
          appointmentId: input.appointmentId,
          branch,
          customer,
          vehicle,
          appointment,
          accountVehicleToLink,
        });
        if (Object.keys(fieldErrors).length > 0) {
          throw new OrderCommandError("Хүсэлт буруу.", 422, "ORDER_CREATE_INVALID", fieldErrors);
        }

        const scopedTx = tx as unknown as PrismaTransactionClient;
        const slotMinutes = branchSlotMinutes(branch?.slotMinutes);
        const durationMinutes = input.appointmentId
          ? appointment?.estimatedDurationMinutes ?? (input.scheduledAt ? slotMinutes : null)
          : input.estimatedDurationMinutes ?? (input.scheduledAt ? slotMinutes : null);
        const scheduledHoursError = await validateScheduledOrderHours(
          scopedTx,
          input.tenantId,
          input.branchId,
          input.scheduledAt,
          durationMinutes ?? slotMinutes,
        );
        if (scheduledHoursError) {
          throw new OrderCommandError(scheduledHoursError, 422, "SCHEDULED_OUTSIDE_BUSINESS_HOURS", {
            scheduledAt: scheduledHoursError,
          });
        }

        const number = await nextOrderNumber(tx, input.tenantId);
        await validateOrderAssignee(scopedTx, {
          tenantId: input.tenantId,
          assigneeId: assignedToId,
          orderBranchId: input.branchId,
        }).catch((assigneeError: unknown) => {
          // The master came only from the appointment and is no longer
          // eligible: ask for another one (no self fallback, no master-less order).
          if (isCarriedAssigneeIneligible(assigneeError, !input.assignedToId)) {
            throw new OrderCommandError(
              CARRIED_ASSIGNEE_INELIGIBLE_MESSAGE,
              422,
              "ASSIGNEE_REQUIRED",
              { assignedToId: CARRIED_ASSIGNEE_INELIGIBLE_MESSAGE },
            );
          }
          throw assigneeError;
        });
        if (accountVehicleToLink) {
          await ensureTenantVehicle(scopedTx, {
            tenantId: input.tenantId,
            vehicleId: input.vehicleId,
            customerId: input.customerId,
          });
        }

        // Vehicle not yet linked to the tenant (appointment account vehicle path)
        // has no TenantVehicle row to read the snapshot from.
        const snapshotVehicle = vehicle?.vehicle
          ?? await tx.vehicle.findUnique({ where: { id: input.vehicleId }, select: { plate: true, vin: true } });
        const bookingStartAt = input.scheduledAt ?? new Date();
        const created = await tx.serviceOrder.create({
          data: {
            number,
            status: "SCHEDULED",
            tenantId: input.tenantId,
            branchId: input.branchId,
            customerId: input.customerId,
            vehicleId: input.vehicleId,
            assignedToId,
            scheduledAt: input.scheduledAt,
            notes: input.notes,
            ...(input.intake
              ? {
                  intakeNotes: input.intake.notes,
                  intakeSignaturePath: input.intake.signaturePath,
                  intakeMileageKm: input.intake.mileageKm,
                  intakeRecordedAt: new Date(),
                  intakeRecordedById: input.actorId,
                  intakePhotos: input.intake.photoPaths.length > 0
                    ? { create: input.intake.photoPaths.map((path) => ({ tenantId: input.tenantId, path })) }
                    : undefined,
                }
              : {}),
            isInternal: input.isInternal === true,
            // Дотоод захиалга хэзээ ч дараа тооцоотой биш (DB CHECK).
            isPostpaid: resolveOrderIsPostpaid(input.isPostpaid, vehicle?.isPostpaid) && input.isInternal !== true,
            plateSnapshot: snapshotVehicle?.plate ?? null,
            vinSnapshot: snapshotVehicle?.vin ?? null,
            estimatedDurationMinutes: durationMinutes,
            categories: appointment && (appointment.categories.length > 0 || (appointment.categoryId && appointment.category))
              ? {
                  create: (appointment.categories.length > 0
                    ? appointment.categories.map((entry) => ({ categoryId: entry.categoryId, name: entry.category.name }))
                    : [{ categoryId: appointment.categoryId as string, name: appointment.category?.name as string }]
                  ).map((category) => ({ tenantId: input.tenantId, ...category })),
                }
              : undefined,
          },
          select: { id: true, number: true },
        });

        await openOrderTimeBooking(scopedTx, {
          tenantId: input.tenantId,
          orderId: created.id,
          branchId: input.branchId,
          kind: "SCHEDULED",
          startAt: bookingStartAt,
          endAt: durationMinutes != null
            ? new Date(bookingStartAt.getTime() + durationMinutes * 60000)
            : null,
          createdById: input.actorId,
        });

        if (input.appointmentId) {
          const linked = await tx.appointment.updateMany({
            where: {
              id: input.appointmentId,
              tenantId: input.tenantId,
              branchId: input.branchId,
              customerId: input.customerId,
              ...(appointment?.accountId ? { accountId: appointment.accountId } : {}),
              serviceOrderId: null,
            },
            data: {
              serviceOrderId: created.id,
              status: "CONFIRMED",
              ...(accountVehicleToLink ? { vehicleId: input.vehicleId } : {}),
              ...(appointment && !appointment.arrivedAt ? { arrivedAt: new Date() } : {}),
            },
          });
          if (linked.count !== 1) {
            throw new OrderCommandError("Цаг захиалгыг засварын хуудастай холбож чадсангүй.", 422, "APPOINTMENT_LINK_FAILED");
          }
          await logAudit({
            tenantId: input.tenantId,
            userId: input.actorId,
            entity: "Appointment",
            entityId: input.appointmentId,
            action: "STATUS_CHANGE",
            summary: "Цаг захиалга засварын хуудастай холбогдов",
            after: { serviceOrderId: created.id, status: "CONFIRMED" },
          },
          scopedTx);
        }

        await logAudit({
          tenantId: input.tenantId,
          userId: input.actorId,
          entity: "ServiceOrder",
          entityId: created.id,
          action: "CREATE",
          summary: "Засварын хуудас үүсгэсэн",
          after: {
            branchId: input.branchId,
            customerId: input.customerId,
            vehicleId: input.vehicleId,
            assignedToId,
            scheduledAt: input.scheduledAt?.toISOString() ?? null,
            ...(input.isInternal ? { isInternal: true } : {}),
          },
        }, scopedTx);

        return created;
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        // Intake зургийн зам давхардсан (race) — дугаарын retry биш, 422.
        const target = String(error.meta?.target ?? error.message);
        if (input.intake && /ServiceOrderIntakePhoto|path/.test(target)) {
          throw new OrderCommandError(INTAKE_PATH_CLAIMED_MESSAGE, 422, "INTAKE_PATH_CLAIMED", {
            intake: INTAKE_PATH_CLAIMED_MESSAGE,
          });
        }
        continue;
      }
      throw error;
    }
  }

  throw new OrderCommandError("Засварын хуудасны дугаар үүсгэж чадсангүй. Дахин оролдоно уу.", 500, "ORDER_NUMBER_UNAVAILABLE");
}
