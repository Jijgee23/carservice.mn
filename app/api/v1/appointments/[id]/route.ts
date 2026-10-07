import { Prisma } from "@/app/generated/prisma/client";
import { jsonError, jsonOk, requireApiUser, requirePermission } from "@/lib/api";
import { resolveWorkingBranch } from "@/lib/auth/api-branch";
import { APPOINTMENT_STATUS_TRANSITIONS, type AppointmentStatus } from "@/lib/appointments";
import { SUBSCRIPTION_LOCKED_MESSAGE } from "@/lib/subscription";
import { requireActiveSubscriptionApi } from "@/lib/subscription-server";
import {
  AppointmentCommandError,
  STAFF_SCOPE_MESSAGES,
  confirmAppointmentCommand,
  rejectAppointmentCommand,
  markAppointmentNoShowCommand,
  setAppointmentAssigneeCommand,
} from "@/lib/appointments/appointment-commands";
import { logAudit } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import { appointmentBookingPaymentStatus } from "@/lib/appointment-payment-status";

// AccountVehicle нь global Vehicle руу заадаг болсон тул хариунд хуучин хэлбэрээр
// (accountVehicle: { plate, make, model } | null) тэгшлэн буцаана.
function shapeAppointment<
  T extends {
    accountVehicle: {
      vehicle: { plate: string; make: string; model: string };
    } | null;
  } & BookingFeeFields,
>(a: T) {
  // Веб dashboard-тай ижил `paymentStatus` (NOT_REQUIRED/PENDING/UNDERPAID/
  // FAILED/PAID) — calendar route-ийн block-уудтай ижил нэр. Түүхий fee/QPay
  // талбаруудыг хариунаас хасна.
  const { feeAmount, feeQpayInvoiceId, feeUnderpaidAmount, payment, ...rest } = a;
  return {
    ...rest,
    accountVehicle: a.accountVehicle?.vehicle ?? null,
    paymentStatus: appointmentBookingPaymentStatus({
      feeAmount,
      feeQpayInvoiceId,
      feeUnderpaidAmount,
      payment,
    }),
  };
}

type BookingFeeFields = {
  feeAmount: unknown;
  feeQpayInvoiceId: string | null;
  feeUnderpaidAmount: unknown;
  payment: { status: string } | null;
};

const APPT_SELECT = {
  id: true,
  status: true,
  requestedAt: true,
  // Tenant app hides "Ирсэн" / shows the arrived row from this.
  arrivedAt: true,
  note: true,
  createdAt: true,
  branch: { select: { id: true, name: true } },
  category: { select: { id: true, name: true } },
  account: { select: { name: true, phone: true } },
  customer: { select: { id: true, fullName: true, phone: true } },
  accountVehicle: {
    select: { vehicle: { select: { plate: true, make: true, model: true } } },
  },
  vehicle: { select: { id: true, plate: true, make: true, model: true } },
  serviceOrder: { select: { id: true, number: true } },
  // QA #28: хариуцах мастер (идэвхгүй болсон ч хуучин оноолтыг харуулна).
  assignedToId: true,
  assignedTo: { select: { id: true, firstName: true, lastName: true } },
  // `paymentStatus`-г тооцоход (харах: shapeAppointment) — түүхий fee
  // талбарууд хариунд гарахгүй.
  feeAmount: true,
  feeQpayInvoiceId: true,
  feeUnderpaidAmount: true,
  payment: { select: { status: true } },
} satisfies Prisma.AppointmentSelect;

/**
 * CONFIRMED/REJECTED/NO_SHOW all delegate to the same P2-B1 commands the
 * named lifecycle routes (`[id]/confirm`, `reject`, `no-show`) call — see the
 * Phase 2 invariant in TENANT_MOBILE_SLICES.md: PATCH is an adapter over
 * those commands, never a second transition path. A command's rejection is
 * forwarded faithfully (same status/code), not re-coded.
 */
function commandErrorResponse(error: unknown) {
  if (error instanceof AppointmentCommandError) {
    return jsonError(error.status, error.message, {
      code: error.code,
      ...(error.fieldErrors ? { fieldErrors: error.fieldErrors } : {}),
    });
  }
  if (error instanceof Error && (STAFF_SCOPE_MESSAGES as readonly string[]).includes(error.message)) {
    return jsonError(403, error.message);
  }
  if (error instanceof Error && error.message === SUBSCRIPTION_LOCKED_MESSAGE) {
    return jsonError(403, error.message, { code: "SUBSCRIPTION_EXPIRED" });
  }
  console.error("[appointments/patch]", error instanceof Error ? error.name : "UnknownError");
  return jsonError(500, "Серверийн алдаа гарлаа. Дахин оролдоно уу.");
}

// GET /api/v1/appointments/[id]
// Permission: appointments.view
// Нэг цагийг жагсаалтын хэлбэрээр буцаана (tenant апп-ын мэдэгдлээс шууд
// дэлгэрэнгүй нээхэд). `X-Working-Branch` scope-ийг жагсаалттай адил мөрдөнө —
// өөр салбарын цаг 404.
export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const auth = await requireApiUser(req);
  if (auth.response) return auth.response;
  const denied = requirePermission(auth.user, "appointments.view");
  if (denied) return denied;
  const scopeResult = await resolveWorkingBranch(req, auth.user);
  if (scopeResult.response) return scopeResult.response;
  const scope = scopeResult.branchId;

  const { id } = await ctx.params;
  const appointment = await prisma.appointment.findFirst({
    where: {
      id,
      tenantId: auth.user.tenantId,
      ...(scope ? { branchId: scope } : {}),
    },
    select: APPT_SELECT,
  });
  if (!appointment) return jsonError(404, "Цаг захиалга олдсонгүй.");
  return jsonOk({ appointment: shapeAppointment(appointment) });
}

// PATCH /api/v1/appointments/[id]
// Body: { status?: AppointmentStatus, assignedToId?: string | null }
//   status       — шилжилт (өмнөх адил). assignedToId-тэй хамт зөвхөн CONFIRMED-д зөвшөөрнө.
//   assignedToId — QA #28: хариуцах мастер солих (status-гүй бол зөвхөн мастер солино).
//                  null (арилгах) боломжгүй: мастертай цагт 422 ASSIGNEE_REQUIRED.
//                  Мастергүй цагийг CONFIRMED болгоход мастер заавал (orders.assign-гүй бол өөрөө).
// Permission: appointments.edit (өөр хүнийг оноох бол orders.assign мөн)
// CONFIRMED шилжилт нь Account → Customer resolve + Vehicle snapshot хийнэ.
export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const auth = await requireApiUser(req);
  if (auth.response) return auth.response;
  const denied = requirePermission(auth.user, "appointments.edit");
  if (denied) return denied;

  const { id } = await ctx.params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError(400, "JSON body шаардлагатай.");
  }
  const newStatus =
    typeof (body as { status?: unknown }).status === "string"
      ? ((body as { status: string }).status as AppointmentStatus)
      : null;
  const rawAssignee = (body as { assignedToId?: unknown }).assignedToId;
  if (rawAssignee !== undefined && rawAssignee !== null && typeof rawAssignee !== "string") {
    return jsonError(400, "assignedToId нь string эсвэл null байна.");
  }
  const assignedToId: string | null | undefined =
    typeof rawAssignee === "string" ? rawAssignee.trim() || null : rawAssignee;
  if (!newStatus && assignedToId === undefined) return jsonError(400, "status шаардлагатай.");
  if (newStatus && assignedToId !== undefined && newStatus !== "CONFIRMED") {
    return jsonError(400, "assignedToId-г зөвхөн CONFIRMED шилжилттэй эсвэл тусад нь илгээнэ.");
  }

  if (!newStatus) {
    // Assignee-only update. The command re-checks scope, subscription and
    // eligibility; the working-branch header is threaded through as elsewhere.
    const scopeResult = await resolveWorkingBranch(req, auth.user);
    if (scopeResult.response) return scopeResult.response;
    try {
      await setAppointmentAssigneeCommand({
        actor: { ...auth.user, workingBranchId: scopeResult.branchId ?? undefined },
        appointmentId: id,
        assignedToId: assignedToId as string | null,
      });
    } catch (error) {
      return commandErrorResponse(error);
    }
    const updatedAssignee = await prisma.appointment.findFirst({
      where: { id, tenantId: auth.user.tenantId },
      select: APPT_SELECT,
    });
    if (!updatedAssignee) return jsonError(404, "Цаг захиалга олдсонгүй.");
    return jsonOk({ appointment: shapeAppointment(updatedAssignee) });
  }

  // PATCH still owns the legacy CONFIRMED -> CANCELLED adapter. Keep its
  // subscription gate aligned with the named mutation commands; otherwise a
  // locked tenant could cancel appointments through this one remaining inline
  // write path.
  const locked = await requireActiveSubscriptionApi(auth.user);
  if (locked) return locked;

  const appt = await prisma.appointment.findFirst({
    where: { id, tenantId: auth.user.tenantId },
    include: {
      account: { select: { id: true, phone: true, name: true, email: true } },
      accountVehicle: { select: { vehicleId: true } },
    },
  });
  if (!appt) return jsonError(404, "Цаг захиалга олдсонгүй.");

  // Салбараар хязгаарлагдсан ажилтан зөвхөн өөрийнхийг засна.
  const scopeResult = await resolveWorkingBranch(req, auth.user);
  if (scopeResult.response) return scopeResult.response;
  const scope = scopeResult.branchId;
  if (scope && appt.branchId !== scope) {
    return jsonError(403, "Зөвхөн өөрийн салбарын цаг захиалгыг удирдана.");
  }

  const allowed =
    APPOINTMENT_STATUS_TRANSITIONS[appt.status as AppointmentStatus] ?? [];
  if (!allowed.includes(newStatus)) {
    return jsonError(
      409,
      `${appt.status} → ${newStatus} шилжилт боломжгүй.`,
    );
  }

  if (newStatus === "CONFIRMED") {
    // Онлайн захиалга (Account-той) л баталгаажуулна.
    // Phone-in захиалга CONFIRMED-ээр үүсдэг тул энд хүрэхгүй.
    if (!appt.account) {
      return jsonError(400, "Онлайн бус захиалгыг энэ замаар баталгаажуулах боломжгүй.");
    }
    try {
      await confirmAppointmentCommand({
        actor: { ...auth.user, workingBranchId: scope ?? undefined },
        appointmentId: appt.id,
        ...(assignedToId !== undefined ? { assignedToId } : {}),
      });
    } catch (error) {
      return commandErrorResponse(error);
    }
  } else if (newStatus === "REJECTED") {
    try {
      await rejectAppointmentCommand({
        actor: { ...auth.user, workingBranchId: scope ?? undefined },
        appointmentId: appt.id,
      });
    } catch (error) {
      return commandErrorResponse(error);
    }
  } else if (newStatus === "NO_SHOW") {
    try {
      await markAppointmentNoShowCommand({
        actor: { ...auth.user, workingBranchId: scope ?? undefined },
        appointmentId: appt.id,
      });
    } catch (error) {
      return commandErrorResponse(error);
    }
  } else {
    // Одоогоор зөвхөн CANCELLED (CONFIRMED -> CANCELLED) энд ирнэ. Үүнд
    // зориулсан P2-B1 command алга тул хуучин шууд бичих логикоо хэвээр
    // үлдээв — энэ нь named lifecycle route-той давхцахгүй (тийм route
    // байхгүй тул зэрэгцээ шилжилтийн зам биш).
    const cancelled = await prisma.appointment.updateMany({
      where: {
        id: appt.id,
        tenantId: appt.tenantId,
        status: appt.status,
        branchId: appt.branchId,
      },
      data: {
        status: newStatus,
        respondedAt: new Date(),
        respondedById: auth.user.id,
      },
    });
    if (cancelled.count !== 1) {
      return jsonError(409, `${appt.status} → ${newStatus} шилжилт боломжгүй.`);
    }
    await logAudit({
      tenantId: appt.tenantId,
      userId: auth.user.id,
      branchId: appt.branchId,
      entity: "Appointment",
      entityId: appt.id,
      action: "STATUS_CHANGE",
      summary: `Цаг → ${newStatus} (мобайл)`,
      after: { status: newStatus },
    });
  }

  const updated = await prisma.appointment.findUnique({
    where: { id },
    select: APPT_SELECT,
  });
  return jsonOk({ appointment: updated ? shapeAppointment(updated) : null });
}
