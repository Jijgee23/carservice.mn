import { canAssignOrders } from "@/lib/auth/order-access";
import { OrderCommandError, validateOrderAssignee } from "@/lib/orders/order-commands";
import type { PrismaTransactionClient } from "@/lib/prisma";
import { AppointmentCommandError, type AppointmentCommandActor } from "@/lib/appointments/appointment-commands";
import type { AssigneeRuleRejection } from "@/lib/appointments/appointment-assignee-rule";

export function throwAssigneeRejection(rule: AssigneeRuleRejection): never {
  throw new AppointmentCommandError(rule.message, 422, rule.code, rule.fieldErrors);
}

const ASSIGNEE_FIELD = "assignedToId";

/**
 * QA #28: assigning a master to an appointment mirrors the orders module —
 * the `orders.assign` permission governs who may pick someone else; anyone
 * with appointment access may pick themselves (subject to eligibility).
 * `current` is the stored value, so re-sending an unchanged assignee (e.g. an
 * edit that leaves the master alone) is never a permission error.
 */
export function assertCanSetAppointmentAssignee(
  actor: AppointmentCommandActor,
  requestedAssigneeId: string | null | undefined,
  currentAssigneeId: string | null = null,
): void {
  // Clearing (null) is rejected earlier (ASSIGNEE_REQUIRED) by appointment-assignee-rule.
  if (requestedAssigneeId === undefined || requestedAssigneeId === null) return;
  if (requestedAssigneeId === currentAssigneeId) return;
  if (!canAssignOrders(actor) && requestedAssigneeId !== actor.id) {
    throw new AppointmentCommandError(
      "Зөвхөн өөрийгөө хариуцагчаар оноож болно.",
      403,
      "APPOINTMENT_ASSIGN_FORBIDDEN",
    );
  }
}

/**
 * Same eligibility rules as an order's master (`validateOrderAssignee`:
 * tenant, active, verified, not expired, role + `orders.assignable`, branch).
 * Reused, not duplicated — only the error type is translated so appointment
 * callers keep a single error class.
 */
export async function validateAppointmentAssignee(
  tx: unknown,
  input: { tenantId: string; assigneeId: string; branchId: string },
): Promise<void> {
  try {
    await validateOrderAssignee(tx as PrismaTransactionClient, {
      tenantId: input.tenantId,
      assigneeId: input.assigneeId,
      orderBranchId: input.branchId,
    });
  } catch (error) {
    if (error instanceof OrderCommandError) {
      throw new AppointmentCommandError(error.message, error.status, error.code, {
        [ASSIGNEE_FIELD]: error.message,
      });
    }
    throw error;
  }
}
