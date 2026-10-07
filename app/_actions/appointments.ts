"use server";

import { revalidatePath } from "next/cache";
import { redirect, unstable_rethrow } from "next/navigation";
import { requireAccount } from "@/lib/auth/account";
import { requireUser } from "@/lib/auth";
import {
  ACTION_GENERIC_ERROR_MESSAGE,
  knownAuthorizationMessage,
  logUnexpectedActionError,
} from "@/lib/action-errors";
import { canCreate, canEdit } from "@/lib/auth/roles";
import { canEditOrder } from "@/lib/auth/order-access";
import { formatWhen } from "@/lib/appointments";
import { type BulkActionState, parseIdsJson } from "@/lib/bulk-action";
import { customerLabel } from "@/lib/customers";
import { ensureAppointmentFeeCheckout } from "@/lib/appointment-payments";
import {
  type DayAvailability,
} from "@/lib/appointment-slots";
import { resolvePublicAvailability } from "@/lib/public-availability";
import { logAudit } from "@/lib/audit";
import { notifyStaff } from "@/lib/notifications";
import { PLAN_LIMIT_CODES } from "@/lib/plan-limits";
import { isFeatureEnabled } from "@/lib/plan-limits-server";
import { prisma } from "@/lib/prisma";
import {
  reserveAppointment,
  ReservationError,
} from "@/lib/appointment-reservations";
import { parseBusinessLocalDateTime } from "@/lib/booking-time";
import { safeNext } from "@/lib/safe-redirect";
import { setBypassContext } from "@/lib/tenant-context";
import {
  AppointmentCommandError,
  STAFF_SCOPE_MESSAGES,
  cancelAppointmentByAccountCommand,
  confirmAppointmentCommand,
  markAppointmentArrivedCommand,
  markAppointmentNoShowCommand,
  rejectAppointmentCommand,
  rescheduleAppointmentByAccountCommand,
  rescheduleAppointmentCommand,
  setAppointmentAssigneeCommand,
  type AppointmentCommandActor,
} from "@/lib/appointments/appointment-commands";
import { registerAppointmentByStaffCommand } from "@/lib/appointments/appointment-create-command";
import {
  bulkChangeAppointmentCategoryCommand,
  MAX_BULK_APPOINTMENT_IDS,
} from "@/lib/appointments/appointment-bulk-commands";

export type AppointmentActionState = {
  ok: boolean;
  message?: string;
  fieldErrors?: Record<string, string>;
} | null;

function s(fd: FormData, key: string): string {
  const v = fd.get(key);
  return typeof v === "string" ? v.trim() : "";
}

function actorFrom(user: Awaited<ReturnType<typeof requireUser>>): AppointmentCommandActor {
  return user as unknown as AppointmentCommandActor;
}

function commandErrorMessage(error: unknown, fallback: string): string {
  return error instanceof AppointmentCommandError ? error.message : fallback;
}

/**
 * Тухайн салбар + өдрийн (YYYY-MM-DD) цагийн нүхнүүдийг буцаана — захиалгатай
 * (завгүй) болон сул цагуудтай. Хэрэглэгчийн booking-form-оос дуудна.
 *
 * Booking v2: `categoryIds` (заавал биш) өгвөл захиалгын нийт үргэлжлэх
 * хугацааг (branch override ?? category default ?? 30) тэдгээрийн нийлбэрээр
 * тооцож, slot-ийн "хаах цагт багтах уу" хилд ашиглана (mobile-ийн
 * `/branches/[branchId]/availability` endpoint-той адил дүрэм).
 */
export async function getBranchDaySlots(
  branchId: string,
  dateStr: string,
  categoryIds: string[] = [],
): Promise<DayAvailability> {
  // Нэвтрээгүй зочид ч дуудах нийтэд нээлттэй action (booking-form-оос) тул
  // bypass ашиглана — org/[slug]/page.tsx-ийн адил зарчим.
  setBypassContext();
  // S15-S16 (WEB_SCHEDULING_ASSESSMENT_2026-09-10.md): all boundary/eligibility
  // validation (date-before-Prisma ordering, branch isActive, tenant
  // suspended/online-booking-plan gates, category tenant/branch/active
  // scoping) now lives in the shared lib/public-availability.ts service —
  // see that file's doc comment for what it fixes and why.
  const result = await resolvePublicAvailability({ branchId, dateStr, categoryIds });
  if (!result.ok) {
    return { open: false, reason: result.message, slots: [] };
  }
  return result.availability;
}

// --- Хэрэглэгчийн тал (Account) -------------------------------------------

/**
 * Account вэб/аппаас цаг хүсэх. Branch-аас тенантыг тодорхойлж PENDING үүсгэнэ.
 * (Consumer UI нь Phase 3-д; энэ action бэлэн байна.)
 */
export async function createAppointment(
  _prev: AppointmentActionState,
  formData: FormData,
): Promise<AppointmentActionState> {
  const account = await requireAccount();

  const branchId = s(formData, "branchId");
  const requestedRaw = s(formData, "requestedAt");
  const note = s(formData, "note");
  const vehicleId = s(formData, "vehicleId") || null;

  const fieldErrors: Record<string, string> = {};
  if (!branchId) fieldErrors.branchId = "Салбараа сонгоно уу.";

  let requestedAt: Date | null = null;
  if (!requestedRaw) {
    fieldErrors.requestedAt = "Цагаа сонгоно уу.";
  } else {
    const d = new Date(requestedRaw);
    if (!Number.isFinite(d.getTime())) {
      fieldErrors.requestedAt = "Огноо буруу.";
    } else if (d.getTime() < Date.now()) {
      fieldErrors.requestedAt = "Өнгөрсөн цаг сонгох боломжгүй.";
    } else {
      requestedAt = d;
    }
  }

  if (Object.keys(fieldErrors).length > 0) {
    return { ok: false, fieldErrors };
  }

  const branch = await prisma.branch.findUnique({
    where: { id: branchId },
    select: {
      id: true,
      tenantId: true,
      tenant: { select: { acceptsOnlineBooking: true, suspended: true } },
    },
  });
  if (!branch) {
    return { ok: false, fieldErrors: { branchId: "Салбар олдсонгүй." } };
  }
  if (!branch.tenant.acceptsOnlineBooking || branch.tenant.suspended) {
    return {
      ok: false,
      message: "Энэ байгууллага онлайн цаг захиалга хүлээн авахгүй байна.",
    };
  }
  // Багц дэмжихгүй болсон (downgrade) тохиолдолд блоклоно.
  const bookingEnabled = await isFeatureEnabled(
    branch.tenantId,
    PLAN_LIMIT_CODES.ONLINE_BOOKING,
  );
  if (!bookingEnabled) {
    return {
      ok: false,
      message: "Энэ байгууллага онлайн цаг захиалга хүлээн авахгүй байна.",
    };
  }

  // Membership and duration are rechecked together inside the reservation transaction.
  const requestedCategoryIds = [...new Set(formData.getAll("categoryIds").map(String).filter(Boolean))];
  // Машин сонгосон бол (global Vehicle id) энэ хэрэглэгчийнх мөн эсэхийг
  // шалгана: өөрөө нэмсэн (AccountVehicle) ЭСВЭЛ сервисээс бүртгэгдэж
  // холбогдсон (TenantVehicle → Customer, account/утсаар). Хоёр дахь
  // тохиолдолд AccountVehicle холбоос үүсгэж appointment-д ашиглана.
  let accountVehicleId: string | null = null;
  if (vehicleId) {
    const link = await prisma.accountVehicle.findUnique({
      where: { accountId_vehicleId: { accountId: account.id, vehicleId } },
      select: { id: true },
    });
    if (link) {
      accountVehicleId = link.id;
    } else {
      const owned = await prisma.tenantVehicle.findFirst({
        where: {
          vehicleId,
          OR: [
            { customer: { accountId: account.id } },
            { customer: { phone: { endsWith: account.phone } } },
          ],
        },
        select: { id: true },
      });
      if (!owned) {
        return { ok: false, fieldErrors: { vehicleId: "Машин олдсонгүй." } };
      }
      const created = await prisma.accountVehicle.upsert({
        where: { accountId_vehicleId: { accountId: account.id, vehicleId } },
        create: { accountId: account.id, vehicleId },
        update: {},
        select: { id: true },
      });
      accountVehicleId = created.id;
    }
  }

  let created;
  try {
    created = await reserveAppointment({
      tenantId: branch.tenantId, branchId: branch.id, accountId: account.id,
      accountVehicleId, categoryIds: requestedCategoryIds, requestedAt: requestedAt!, note: note || null,
    });
  } catch (error) {
    if (error instanceof ReservationError) return { ok: false, message: error.message };
    throw error;
  }

  // Цаг захиалгын хураамж — идэвхтэй бол QPay invoice татаж, хэрэглэгчийг
  // шууд төлбөрийн хуудас руу чиглүүлнэ. QPay доголдвол ч захиалга үүсэхийг
  // тасалдуулахгүй (payment мөр FAILED-ээр үлдэж дараа дахин оролдоно).
  let requiresPayment = false;
  try {
    const result = await ensureAppointmentFeeCheckout(created.id);
    requiresPayment = result.required;
  } catch (e) {
    console.warn("[payment] createAppointment:", e);
  }

  // Холбогдох ажилтнуудад шинэ цаг захиалга ирсэн тухай мэдэгдэнэ — гэхдээ
  // хураамж шаардлагатай бол хэрэглэгч төлөх хүртэл хүлээнэ (мэдэгдэл
  // `confirmAppointmentPayment`-аас, төлбөр баталгаажсаны дараа очно).
  if (!requiresPayment) {
    try {
      const who = account.name?.trim() || account.phone;
      await notifyStaff({
        type: "appointment_created",
        tenantId: branch.tenantId,
        branchId: branch.id,
        input: {
          appointmentId: created.id,
          body: `${who} — ${formatWhen(requestedAt!)} цагт цаг захиаллаа.`,
        },
      });
    } catch (e) {
      console.warn("[notify] createAppointment:", e);
    }
  }

  revalidatePath("/account");
  if (requiresPayment) {
    redirect(`/account/appointments/${created.id}/pay`);
  }
  redirect("/account");
}

/**
 * Хэрэглэгч өөрийн PENDING/CONFIRMED цагаа цуцлах.
 */
export async function cancelAppointmentByAccount(
  formData: FormData,
): Promise<void> {
  const account = await requireAccount();
  const id = s(formData, "id");
  if (!id) return;

  const appt = await prisma.appointment.findFirst({
    where: { id, accountId: account.id },
    select: { status: true, tenantId: true, branchId: true, requestedAt: true },
  });

  const result = await cancelAppointmentByAccountCommand({ account, appointmentId: id });
  if (!result.cancelled || !appt) return;

  // Холбогдох ажилтнуудад цуцалсан тухай мэдэгдэнэ.
  try {
    const who = account.name?.trim() || account.phone;
    await notifyStaff({
      type: "appointment_cancelled",
      tenantId: appt.tenantId,
      branchId: appt.branchId,
      input: {
        appointmentId: id,
        body: `${who} — ${formatWhen(appt.requestedAt)} цагийн захиалгаа цуцаллаа.`,
      },
    });
  } catch (e) {
    console.warn("[notify] cancelAppointmentByAccount:", e);
  }

  revalidatePath("/account");
}

/**
 * Хэрэглэгч өөрийн PENDING/CONFIRMED цагаа өөр хугацаанд шилжүүлнэ — цуцлаад
 * дахин захиалахын оронд. Захиалга (ServiceOrder) аль хэдийн үүссэн бол
 * (ажилтан аль хэдийн ажилд авсан) энд зөвшөөрөхгүй — байгууллагатай шууд
 * холбогдох ёстой. Хугацааны хязгаарлалт (жишээ нь "N цагийн өмнө")
 * одоогоор алга — цуцлах үйлдэлтэй адил (2026-09-08 шийдвэр).
 */
export async function rescheduleAppointmentByAccount(
  _prev: AppointmentActionState,
  formData: FormData,
): Promise<AppointmentActionState> {
  const account = await requireAccount();
  const id = s(formData, "id");
  const requestedRaw = s(formData, "requestedAt");
  if (!id || !requestedRaw) return { ok: false, message: "Буруу хүсэлт." };

  // Слот сонгогч `toISOString()` (…Z) илгээдэг — createAppointment болон
  // мобайл reschedule route-тэй адил бүрэн ISO хугацааг задлана.
  const requestedAt = new Date(requestedRaw);
  if (!Number.isFinite(requestedAt.getTime())) {
    return { ok: false, fieldErrors: { requestedAt: "Огноо буруу." } };
  }
  return rescheduleAppointmentByAccountCore(account, id, requestedAt);
}

/**
 * `rescheduleAppointmentByAccount`-ийн цөм логик — FormData-аас тусгаарласан,
 * учир нь мобайл апп (`/api/v1/app/appointments/[id]/reschedule`) ч мөн адил
 * үйлдлийг дуудах шаардлагатай (server action шууд дуудагдахгүй, JSON API
 * хэрэгтэй). Аль аль газраас нэг л газрын логикийг (одоо
 * `rescheduleAppointmentByAccountCommand`) ашиглана — audit/staff мэдэгдэл
 * хоёуланд адил ажиллана.
 */
export async function rescheduleAppointmentByAccountCore(
  account: { id: string; name: string | null; phone: string },
  id: string,
  requestedAt: Date,
): Promise<AppointmentActionState> {
  const before = await prisma.appointment.findFirst({
    where: { id, accountId: account.id },
    select: { tenantId: true, branchId: true },
  });

  try {
    await rescheduleAppointmentByAccountCommand({ account, appointmentId: id, requestedAt });
  } catch (error) {
    if (error instanceof AppointmentCommandError) {
      return { ok: false, message: error.message, fieldErrors: error.fieldErrors };
    }
    if (error instanceof ReservationError) return { ok: false, message: error.message };
    throw error;
  }

  if (before) {
    try {
      const who = account.name?.trim() || account.phone;
      await notifyStaff({
        type: "appointment_rescheduled_by_account",
        tenantId: before.tenantId,
        branchId: before.branchId,
        input: {
          appointmentId: id,
          body: `${who} — цагаа ${formatWhen(requestedAt)} болгож шилжүүллээ.`,
        },
      });
    } catch (e) {
      console.warn("[notify] rescheduleAppointmentByAccount:", e);
    }
  }

  revalidatePath("/account");
  revalidatePath("/dashboard/appointments");
  revalidatePath("/dashboard/appointments/calendar");
  return { ok: true, message: "Цаг шилжлээ." };
}

// --- Ажилтны тал (User) ---------------------------------------------------

/**
 * Ажилтан утсаар орж ирсэн цаг захиалгыг гараар бүртгэнэ. Account-гүй (phone-in)
 * тул тенантын Customer-ыг шууд оноож, CONFIRMED-ээр үүсгэнэ. Захиалга (order)
 * нь дараа нь "Захиалга үүсгэх" холбоосоор үүснэ.
 */
export async function registerAppointmentByStaff(
  _prev: AppointmentActionState,
  formData: FormData,
): Promise<AppointmentActionState> {
  const user = await requireUser();
  if (!canCreate(user, "appointments")) {
    return { ok: false, message: "Танд цаг захиалга бүртгэх эрх байхгүй." };
  }

  const branchId = s(formData, "branchId");
  const customerId = s(formData, "customerId");
  const vehicleId = s(formData, "vehicleId") || null;
  // QA #28: хариуцах мастер заавал (orders.assign-гүй бол өөрөө) — шалгалтыг command хийнэ.
  const assignedToId = s(formData, "assignedToId") || null;
  const requestedRaw = s(formData, "requestedAt");
  const note = s(formData, "note");

  const fieldErrors: Record<string, string> = {};
  if (!branchId) fieldErrors.branchId = "Салбараа сонгоно уу.";
  if (!customerId) fieldErrors.customerId = "Үйлчлүүлэгчээ сонгоно уу.";

  let requestedAt: Date | null = null;
  if (!requestedRaw) {
    fieldErrors.requestedAt = "Цагаа сонгоно уу.";
  } else {
    const d = new Date(requestedRaw);
    if (!Number.isFinite(d.getTime())) fieldErrors.requestedAt = "Огноо буруу.";
    else requestedAt = d;
  }
  if (Object.keys(fieldErrors).length > 0) return { ok: false, fieldErrors };

  const requestedCategoryIds = [...new Set(formData.getAll("categoryIds").map(String).filter(Boolean))];
  const confirmed = s(formData, "confirmed") === "true";

  try {
    await registerAppointmentByStaffCommand({
      actor: actorFrom(user),
      branchId,
      customerId,
      vehicleId,
      requestedAt: requestedAt!,
      note: note || null,
      categoryIds: requestedCategoryIds,
      confirmed,
      assignedToId,
    });
  } catch (error) {
    if (error instanceof AppointmentCommandError) {
      return { ok: false, message: error.message, fieldErrors: error.fieldErrors };
    }
    throw error;
  }

  revalidatePath("/dashboard/appointments");
  // Хуваарийн (calendar) хуудаснаас "next"-тэй ирсэн бол тэр рүү буцна.
  redirect(safeNext(s(formData, "next"), "/dashboard/appointments"));
}

/**
 * Calendar recovery for an appointment whose service-order link cannot be
 * resolved in the current tenant/branch scope. This deliberately does not
 * create an order: repairing a historical relationship must never create a
 * duplicate repair record by accident.
 */
export async function repairAppointmentOrderLinkAction(
  _prev: AppointmentActionState,
  formData: FormData,
): Promise<AppointmentActionState> {
  const id = s(formData, "appointmentId");
  const mode = s(formData, "mode");
  const orderId = s(formData, "orderId");
  if (!id || (mode !== "detach" && mode !== "relink")) {
    return { ok: false, message: "Буруу хүсэлт." };
  }

  let user;
  try {
    user = await requireUser();
  } catch (e) {
    unstable_rethrow(e);
    return { ok: false, message: e instanceof Error ? e.message : "Алдаа" };
  }

  const appointment = await prisma.appointment.findUnique({
    where: { id },
    select: {
      id: true,
      tenantId: true,
      branchId: true,
      status: true,
      customerId: true,
      vehicleId: true,
      serviceOrderId: true,
    },
  });
  if (!appointment) return { ok: false, message: "Цаг захиалга олдсонгүй." };

  if (!canEdit(user, "appointments")) {
    return { ok: false, message: "Танд цаг захиалга удирдах эрх байхгүй." };
  }
  if (user.tenantId !== appointment.tenantId || !canEdit(user, "orders")) {
    return { ok: false, message: "Танд энэ холбоосыг засах эрх байхгүй." };
  }
  if (appointment.status !== "PENDING" && appointment.status !== "CONFIRMED") {
    return { ok: false, message: "Энэ цагийн захиалга одоо идэвхгүй байна." };
  }
  if (!appointment.serviceOrderId) {
    return { ok: false, message: "Энэ цагт засварын хуудас холбогдоогүй байна." };
  }

  const linkedOrder = await prisma.serviceOrder.findFirst({
    where: {
      id: appointment.serviceOrderId,
      tenantId: appointment.tenantId,
    },
    select: { id: true, branchId: true, assignedToId: true },
  });
  if (linkedOrder && !canEditOrder(user, linkedOrder)) {
    return { ok: false, message: "Танд холбогдсон засварын хуудсыг засах эрх байхгүй." };
  }
  if (linkedOrder && linkedOrder.branchId === appointment.branchId) {
    return {
      ok: false,
      message: "Холболт зөв байна. Календарийг дахин ачаална уу.",
    };
  }

  if (mode === "relink") {
    if (!orderId) return { ok: false, message: "Засварын хуудсаа сонгоно уу." };
    if (!appointment.customerId || !appointment.vehicleId) {
      return {
        ok: false,
        message: "Үйлчлүүлэгч болон машин тодорхойгүй тул автоматаар холбох боломжгүй.",
      };
    }

    const replacement = await prisma.serviceOrder.findFirst({
      where: {
        id: orderId,
        tenantId: appointment.tenantId,
        branchId: appointment.branchId,
        customerId: appointment.customerId,
        vehicleId: appointment.vehicleId,
        status: { in: ["SCHEDULED", "IN_PROGRESS"] },
        appointment: { is: null },
      },
      select: { id: true, number: true, assignedToId: true },
    });
    if (!replacement) {
      return {
        ok: false,
        message: "Сонгосон засварын хуудас энэ үйлчлүүлэгч, машин, салбарт тохирохгүй эсвэл аль хэдийн холбогдсон байна.",
      };
    }
    if (!canEditOrder(user, replacement)) return { ok: false, message: "Танд сонгосон засварын хуудсыг засах эрх байхгүй." };

    try {
      await prisma.$transaction(async (tx) => {
        const updated = await tx.appointment.updateMany({
          where: {
            id: appointment.id,
            tenantId: appointment.tenantId,
            serviceOrderId: appointment.serviceOrderId,
          },
          data: { serviceOrderId: replacement.id },
        });
        if (updated.count !== 1) throw new Error("Цагийн захиалга өөрчлөгдсөн байна.");
        await logAudit(
          {
            tenantId: appointment.tenantId,
            userId: user.id,
            branchId: appointment.branchId,
            entity: "Appointment",
            entityId: appointment.id,
            action: "UPDATE",
            summary: "Цаг захиалгын засварын хуудасны холбоосыг сэргээв",
            before: { serviceOrderId: appointment.serviceOrderId },
            after: { serviceOrderId: replacement.id, orderNumber: replacement.number },
          },
          tx,
        );
      });
    } catch (e) {
      return {
        ok: false,
        message: e instanceof Error ? e.message : "Холбоос сэргээхэд алдаа гарлаа.",
      };
    }

    revalidatePath("/dashboard/appointments");
    revalidatePath("/dashboard/appointments/calendar");
    revalidatePath(`/dashboard/orders/${replacement.id}`);
    return { ok: true, message: "Цаг захиалгын холбоосыг сэргээлээ." };
  }

  try {
    await prisma.$transaction(async (tx) => {
      const updated = await tx.appointment.updateMany({
        where: {
          id: appointment.id,
          tenantId: appointment.tenantId,
          serviceOrderId: appointment.serviceOrderId,
        },
        data: { serviceOrderId: null },
      });
      if (updated.count !== 1) throw new Error("Цагийн захиалга өөрчлөгдсөн байна.");
      await logAudit(
        {
          tenantId: appointment.tenantId,
          userId: user.id,
          branchId: appointment.branchId,
          entity: "Appointment",
          entityId: appointment.id,
          action: "UPDATE",
          summary: "Цаг захиалгын эвдэрсэн засварын хуудасны холбоосыг салгав",
          before: { serviceOrderId: appointment.serviceOrderId },
          after: { serviceOrderId: null },
        },
        tx,
      );
    });
  } catch (e) {
    return {
      ok: false,
      message: e instanceof Error ? e.message : "Холбоос салгахад алдаа гарлаа.",
    };
  }

  revalidatePath("/dashboard/appointments");
  revalidatePath("/dashboard/appointments/calendar");
  return { ok: true, message: "Эвдэрсэн холбоосыг салгалаа." };
}

/**
 * Ажилтан цаг баталгаажуулна:
 *   - утсаар тенантын Customer-ыг resolve/create (гүүр)
 *   - appointment-ийг CONFIRMED болгож, тухайн Customer-той холбоно
 * Захиалга (ServiceOrder) нь дараа нь order урсгалаар үүснэ.
 */
export async function confirmAppointment(
  _prev: AppointmentActionState,
  formData: FormData,
): Promise<AppointmentActionState> {
  const id = s(formData, "id");
  if (!id) return { ok: false, message: "Буруу хүсэлт." };

  // Tenant context-ийг ЗААВАЛ эхлээд (доорх Prisma дуудлагаас өмнө)
  // тохируулна — эс бөгөөс "Tenant context тохируулагдаагүй" алдаа шидэгдэнэ.
  let user;
  try {
    user = await requireUser();
  } catch (e) {
    unstable_rethrow(e);
    return { ok: false, message: e instanceof Error ? e.message : "Алдаа" };
  }

  try {
    await confirmAppointmentCommand({
      actor: actorFrom(user),
      appointmentId: id,
      // QA #28: мастергүй цагийг батлахад мастер заавал (command шийднэ); хоосон = өгөөгүй.
      ...(s(formData, "assignedToId") ? { assignedToId: s(formData, "assignedToId") } : {}),
    });
  } catch (e) {
    const known = knownAuthorizationMessage(e, STAFF_SCOPE_MESSAGES);
    if (known) return { ok: false, message: known };
    return { ok: false, message: commandErrorMessage(e, "Баталгаажуулахад алдаа гарлаа.") };
  }

  revalidatePath("/dashboard/appointments");
  revalidatePath("/account");
  return { ok: true, message: "Цаг баталгаажлаа." };
}

/**
 * QA #28: цагийн хариуцах мастер солих (арилгах боломжгүй — хоосон = ASSIGNEE_REQUIRED).
 * Шалгалт, эрх, audit бүгд setAppointmentAssigneeCommand-д.
 */
export async function setAppointmentAssigneeAction(
  _prev: AppointmentActionState,
  formData: FormData,
): Promise<AppointmentActionState> {
  const id = s(formData, "id");
  if (!id) return { ok: false, message: "Буруу хүсэлт." };
  try {
    let user;
    try {
      user = await requireUser();
    } catch (e) {
      unstable_rethrow(e);
      return { ok: false, message: e instanceof Error ? e.message : "Алдаа" };
    }
    await setAppointmentAssigneeCommand({
      actor: actorFrom(user),
      appointmentId: id,
      assignedToId: s(formData, "assignedToId") || null,
    });
  } catch (e) {
    unstable_rethrow(e);
    const known = knownAuthorizationMessage(e, STAFF_SCOPE_MESSAGES);
    if (known) return { ok: false, message: known };
    if (e instanceof AppointmentCommandError) {
      return { ok: false, message: e.message, fieldErrors: e.fieldErrors };
    }
    logUnexpectedActionError("appointments:set-assignee", e);
    return { ok: false, message: ACTION_GENERIC_ERROR_MESSAGE };
  }
  revalidatePath("/dashboard/appointments");
  revalidatePath("/dashboard/appointments/calendar");
  return { ok: true, message: "Хариуцах мастер шинэчлэгдлээ." };
}

/** Ажилтан цаг татгалзах. */
export async function rejectAppointment(
  _prev: AppointmentActionState,
  formData: FormData,
): Promise<AppointmentActionState> {
  const id = s(formData, "id");
  if (!id) return { ok: false, message: "Буруу хүсэлт." };

  // Tenant context-ийг ЗААВАЛ эхлээд (доорх Prisma дуудлагаас өмнө)
  // тохируулна — эс бөгөөс "Tenant context тохируулагдаагүй" алдаа шидэгдэнэ.
  let user;
  try {
    user = await requireUser();
  } catch (e) {
    unstable_rethrow(e);
    return { ok: false, message: e instanceof Error ? e.message : "Алдаа" };
  }

  try {
    await rejectAppointmentCommand({ actor: actorFrom(user), appointmentId: id });
  } catch (e) {
    const known = knownAuthorizationMessage(e, STAFF_SCOPE_MESSAGES);
    if (known) return { ok: false, message: known };
    return { ok: false, message: commandErrorMessage(e, "Татгалзахад алдаа гарлаа.") };
  }

  revalidatePath("/dashboard/appointments");
  return { ok: true, message: "Цаг татгалзлаа." };
}

/** Ажилтан "ирээгүй" гэж тэмдэглэх (зөвхөн CONFIRMED-аас). */
export async function markAppointmentNoShow(
  _prev: AppointmentActionState,
  formData: FormData,
): Promise<AppointmentActionState> {
  const id = s(formData, "id");
  if (!id) return { ok: false, message: "Буруу хүсэлт." };

  // Tenant context-ийг ЗААВАЛ эхлээд (доорх Prisma дуудлагаас өмнө)
  // тохируулна — эс бөгөөс "Tenant context тохируулагдаагүй" алдаа шидэгдэнэ.
  let user;
  try {
    user = await requireUser();
  } catch (e) {
    unstable_rethrow(e);
    return { ok: false, message: e instanceof Error ? e.message : "Алдаа" };
  }

  try {
    await markAppointmentNoShowCommand({ actor: actorFrom(user), appointmentId: id });
  } catch (e) {
    const known = knownAuthorizationMessage(e, STAFF_SCOPE_MESSAGES);
    if (known) return { ok: false, message: known };
    return { ok: false, message: commandErrorMessage(e, "Тэмдэглэхэд алдаа гарлаа.") };
  }

  revalidatePath("/dashboard/appointments");
  return { ok: true, message: "Ирээгүй гэж тэмдэглэлээ." };
}

/**
 * Ажилтан CONFIRMED цагийг өөр хугацаанд шилжүүлнэ — "ирээгүй" гэж
 * тэмдэглэхийн оронд, алдсан цагийг сэргээх боломж (2026-09-08: "ирц
 * алдсан" цагийг NO_SHOW болгохоос гадна дахин товлож болох байх ёстой
 * гэсэн шийдвэрээр нэмэгдсэн). PENDING цагийг энд шилжүүлдэггүй — тэр
 * баталгаажаагүй хүсэлт тул `confirmAppointment`/`rejectAppointment`-ээр
 * шийднэ, эсвэл хугацаа хэтэрвэл cron (`appointment_expired`) цуцална.
 */
export async function rescheduleAppointmentAction(
  _prev: AppointmentActionState,
  formData: FormData,
): Promise<AppointmentActionState> {
  const id = s(formData, "id");
  const requestedRaw = s(formData, "requestedAt");
  const confirmed = s(formData, "confirmed") === "true";
  if (!id || !requestedRaw) return { ok: false, message: "Буруу хүсэлт." };

  const requestedAt = parseBusinessLocalDateTime(requestedRaw);
  if (!Number.isFinite(requestedAt.getTime())) {
    return { ok: false, fieldErrors: { requestedAt: "Огноо буруу." } };
  }
  if (requestedAt.getTime() < Date.now()) {
    return { ok: false, fieldErrors: { requestedAt: "Өнгөрсөн цаг сонгох боломжгүй." } };
  }

  try {
    let user;
    try {
      user = await requireUser();
    } catch (e) {
      unstable_rethrow(e);
      logUnexpectedActionError("appointments:reschedule-auth", e);
      return { ok: false, message: ACTION_GENERIC_ERROR_MESSAGE };
    }

    const result = await rescheduleAppointmentCommand({
      actor: actorFrom(user),
      appointmentId: id,
      requestedAt,
      confirmed,
    });

    if (result.linked) {
      revalidatePath("/dashboard/appointments");
      revalidatePath("/dashboard/appointments/calendar");
      revalidatePath("/dashboard/orders");
      revalidatePath(`/dashboard/orders/${result.orderId}`);
      revalidatePath("/account");
      return { ok: true, message: "Цаг болон холбогдсон захиалгын огноо шилжлээ." };
    }

    revalidatePath("/dashboard/appointments");
    revalidatePath("/dashboard/appointments/calendar");
    revalidatePath("/account");
    return { ok: true, message: "Цаг шилжлээ." };
  } catch (error) {
    unstable_rethrow(error);
    if (error instanceof AppointmentCommandError) {
      return { ok: false, message: error.message, fieldErrors: error.fieldErrors };
    }
    if (error instanceof ReservationError) return { ok: false, message: error.message };
    const known = knownAuthorizationMessage(error, STAFF_SCOPE_MESSAGES);
    if (known) return { ok: false, message: known };
    logUnexpectedActionError("appointments:reschedule", error);
    return { ok: false, message: ACTION_GENERIC_ERROR_MESSAGE };
  }
}

// Үйлчлүүлэгч биечлэн ирснийг тэмдэглэнэ (arrivedAt) — ажил эхэлсэн гэсэн үг
// БИШ, зөвхөн ирц. markAppointmentNoShow-той бараг ижил бүтэцтэй.
export async function markAppointmentArrived(
  _prev: AppointmentActionState,
  formData: FormData,
): Promise<AppointmentActionState> {
  const id = s(formData, "id");
  if (!id) return { ok: false, message: "Буруу хүсэлт." };

  let user;
  try {
    user = await requireUser();
  } catch (e) {
    unstable_rethrow(e);
    return { ok: false, message: e instanceof Error ? e.message : "Алдаа" };
  }

  try {
    await markAppointmentArrivedCommand({ actor: actorFrom(user), appointmentId: id });
  } catch (e) {
    const known = knownAuthorizationMessage(e, STAFF_SCOPE_MESSAGES);
    if (known) return { ok: false, message: known };
    return { ok: false, message: commandErrorMessage(e, "Тэмдэглэхэд алдаа гарлаа.") };
  }

  revalidatePath("/dashboard/appointments");
  return { ok: true, message: "Ирсэн гэж тэмдэглэлээ." };
}

// Жагсаалтаас олноор сонгож ажлын төрлийг нэг зэрэг солих (харах:
// bulkChangeOrderStatusAction/bulkAssignOrderAction, app/_actions/orders.ts —
// адил all-or-nothing БИШ загвар).
export async function bulkChangeAppointmentCategoryAction(
  _prev: BulkActionState,
  formData: FormData,
): Promise<BulkActionState> {
  let user;
  try {
    user = await requireUser();
  } catch (e) {
    unstable_rethrow(e);
    return { ok: false, message: e instanceof Error ? e.message : "Алдаа" };
  }
  if (!canEdit(user, "appointments")) {
    return { ok: false, message: "Танд цаг захиалга удирдах эрх байхгүй." };
  }

  const categoryIds = formData
    .getAll("categoryIds")
    .filter((x): x is string => typeof x === "string" && x.length > 0);
  if (categoryIds.length === 0) {
    return { ok: false, message: "Дор хаяж нэг ажлын төрөл сонгоно уу." };
  }

  const ids = parseIdsJson(s(formData, "appointmentIdsJson"));
  if (ids.length === 0) return { ok: false, message: "Дор хаяж нэг цаг захиалга сонгоно уу." };
  if (ids.length > MAX_BULK_APPOINTMENT_IDS) {
    return { ok: false, message: `Нэг хүсэлтэд хамгийн ихдээ ${MAX_BULK_APPOINTMENT_IDS} цаг захиалга сонгоно уу.` };
  }

  const appointments = await prisma.appointment.findMany({
    where: { id: { in: ids }, tenantId: user.tenantId },
    select: {
      id: true,
      account: { select: { name: true, phone: true } },
      customer: { select: { fullName: true, phone: true } },
    },
  });
  const labelById = new Map(
    appointments.map((a) => [
      a.id,
      customerLabel({
        fullName: a.account?.name ?? a.customer?.fullName,
        phone: a.account?.phone ?? a.customer?.phone,
      }),
    ]),
  );

  const result = await bulkChangeAppointmentCategoryCommand({
    actor: actorFrom(user),
    appointmentIds: ids,
    categoryIds,
  });
  const errors = result.failed.map((f) => `${labelById.get(f.appointmentId) ?? f.appointmentId}: ${f.message}`);
  const succeeded = result.succeeded.length;

  revalidatePath("/dashboard/appointments");
  revalidatePath("/dashboard/appointments/calendar");

  if (succeeded === 0) {
    return {
      ok: false,
      message: errors[0] ?? "Ажлын төрөл солиход алдаа гарлаа.",
      succeeded,
      failed: errors.length,
      errors,
    };
  }
  return {
    ok: true,
    message: `${succeeded}/${ids.length} цаг захиалгын ажлын төрөл шинэчлэгдлээ.${
      errors.length ? ` (${errors.length} амжилтгүй)` : ""
    }`,
    succeeded,
    failed: errors.length,
    errors: errors.length ? errors : undefined,
  };
}
