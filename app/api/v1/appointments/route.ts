import { Prisma } from "@/app/generated/prisma/client";
import { jsonError, jsonOk, requireApiUser, requirePermission } from "@/lib/api";
import { resolveWorkingBranch } from "@/lib/auth/api-branch";
import { APPOINTMENT_STATUSES, type AppointmentStatus } from "@/lib/appointments";
import { buildMeta, getApiPageInfo } from "@/lib/pagination";
import { prisma } from "@/lib/prisma";
import { appointmentBookingPaymentStatus } from "@/lib/appointment-payment-status";
import { requireActiveSubscriptionApi } from "@/lib/subscription-server";
import {
  AppointmentCommandError,
  type AppointmentCommandActor,
} from "@/lib/appointments/appointment-commands";
import { registerAppointmentByStaffCommand } from "@/lib/appointments/appointment-create-command";
import { parseCreateAppointmentBody } from "@/lib/appointments/appointment-create-request";
import {
  appointmentSearchWhere,
  parseAppointmentListQuery,
} from "@/lib/appointments/appointment-list-query";
import { bookingDateKey, bookingDayBounds } from "@/lib/booking-time";

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

// AccountVehicle нь global Vehicle руу заадаг болсон тул хариунд хуучин хэлбэрээр
// (accountVehicle: { plate, make, model } | null) тэгшлэн буцаана.
export function shapeAppointment<
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

/**
 * PURE — `X-Working-Branch` (resolved, validated `scope`) болон `?branchId=`
 * query param хоёул заасан атал өөр өөр салбар заавал "зөрчилдсөн" гэж үзнэ.
 * `scope` null (owner эсвэл "ALL") үед хэзээ ч зөрчилдөхгүй — тэр үед л
 * query param ганцаараа хүчинтэй шүүлт болно. Unit test-д зориулж тусад нь
 * гаргасан (харах: tests/api-branch-routes.test.ts) — DB хамааралгүй.
 */
export function branchFilterConflicts(
  scope: string | null,
  branchIdParam: string | undefined,
): boolean {
  return Boolean(scope && branchIdParam && branchIdParam !== scope);
}

// GET /api/v1/appointments
// Query: status?, date? (YYYY-MM-DD), month? (YYYY-MM), branchId?, page?, pageSize?
// month= → returns { dates: string[] } (per-appointment YYYY-MM-DD for dot counts)
// Permission: appointments.view
export async function GET(req: Request) {
  const auth = await requireApiUser(req);
  if (auth.response) return auth.response;
  const denied = requirePermission(auth.user, "appointments.view");
  if (denied) return denied;

  const url = new URL(req.url);
  const scopeResult = await resolveWorkingBranch(req, auth.user);
  if (scopeResult.response) return scopeResult.response;
  const scope = scopeResult.branchId;
  const branchIdParam = url.searchParams.get("branchId")?.trim() || undefined;

  // `X-Working-Branch` (→ `scope`) болон `?branchId=` query param хоёулаа
  // салбар шүүлт зааж болно, зөрчилдвөл HEADER ялна — учир нь энэ л
  // баталгаажсан (tenant/isActive/eligibility/roster-lock шалгасан) утга;
  // query param ямар ч серверийн шалгалтгүйгээр клиентээс ирдэг түүхий
  // утга. `scope` null (жишээ нь owner, эсвэл "ALL" илгээсэн) үед л
  // query param-ыг ашиглана — энэ өөрчлөгдөөгүй.
  //
  // Хоёул заасан БОЛОН ЗӨРЧИЛДВӨЛ (өөр өөр салбар) query param-ыг
  // чимээгүй үл тоомсорлохгүй, 422-оор татгалзана. Учир шалтгаан: клиент
  // тодорхой зорилготойгоор branchId дамжуулсан бол (жишээ нь өөр таб дээр
  // сонгосон салбарын өгөгдлийг хүсэх гэж), серверийн бодитоор буцаах өгөгдөл
  // түүнээс өөр (header-ийн) салбарынх байх нь чимээгүй буруу үр дүн олгож,
  // клиент кодыг тодорхой алдаа мэдэгдэлгүйгээр буруу зан төлөвт хүргэнэ.
  // Тодорхой татгалзал нь клиентэд асуудлыг шууд илрүүлэх боломж олгоно.
  if (branchFilterConflicts(scope, branchIdParam)) {
    return jsonError(422, "Query параметрийн branchId нь баталгаажсан ажлын салбартай зөрчилдөж байна.", {
      fieldErrors: { branchId: "Идэвхтэй ажлын салбараас өөр салбарын мэдээлэл хүсэх боломжгүй." },
    });
  }

  // ── Month counts mode ─────────────────────────────────────────────────────
  const monthParam = url.searchParams.get("month")?.trim();
  if (monthParam && /^\d{4}-(0[1-9]|1[0-2])$/.test(monthParam)) {
    // Month bounds and per-row date keys in Asia/Ulaanbaatar business time,
    // never the host's zone (a UTC server shifted every dot by 8 hours).
    const [y, m] = monthParam.split("-").map(Number);
    const nextKey = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
    const monthStart = bookingDayBounds(`${monthParam}-01`).start;
    const monthEnd = bookingDayBounds(`${nextKey}-01`).start;

    const rows = await prisma.appointment.findMany({
      where: {
        tenantId: auth.user.tenantId,
        requestedAt: { gte: monthStart, lt: monthEnd },
        ...(scope ? { branchId: scope } : branchIdParam ? { branchId: branchIdParam } : {}),
      },
      select: { requestedAt: true },
    });

    const dates = rows.map((r) => bookingDateKey(r.requestedAt));
    return jsonOk({ dates });
  }

  // ── Day list mode ─────────────────────────────────────────────────────────
  const statusParam = url.searchParams.get("status")?.trim();
  const status =
    statusParam &&
    (APPOINTMENT_STATUSES as readonly string[]).includes(statusParam)
      ? (statusParam as AppointmentStatus)
      : null;
  const dateParam = url.searchParams.get("date")?.trim();
  const { page, pageSize, skip, take } = getApiPageInfo(url.searchParams, {
    maxSize: 100,
  });
  const { q } = parseAppointmentListQuery(url.searchParams);
  const searchOr = appointmentSearchWhere(q);

  const where: Prisma.AppointmentWhereInput = {
    tenantId: auth.user.tenantId,
    ...(status ? { status } : {}),
    ...(scope
      ? { branchId: scope }
      : branchIdParam
        ? { branchId: branchIdParam }
        : {}),
    ...(searchOr ? { OR: searchOr } : {}),
  };

  if (dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam)) {
    // Business day (Asia/Ulaanbaatar), same bounds as calendar and slots.
    try {
      const { start, end } = bookingDayBounds(dateParam);
      where.requestedAt = { gte: start, lt: end };
    } catch {
      // Not a real calendar date — ignore the filter, as before.
    }
  }

  const [total, items] = await Promise.all([
    prisma.appointment.count({ where }),
    prisma.appointment.findMany({
      where,
      orderBy: { requestedAt: "asc" },
      skip,
      take,
      select: APPT_SELECT,
    }),
  ]);

  return jsonOk({
    appointments: items.map(shapeAppointment),
    pagination: buildMeta(total, page, pageSize),
  });
}

// POST /api/v1/appointments — Staff phone-in registration.
// Delegates to the shared P2-B1 command (registerAppointmentByStaffCommand),
// which itself runs reserveAppointment inside a row-locked transaction — the
// only place capacity/hours/branch/customer existence are actually enforced.
// Permission: appointments.create
export async function POST(req: Request) {
  const auth = await requireApiUser(req);
  if (auth.response) return auth.response;
  const denied = requirePermission(auth.user, "appointments.create");
  if (denied) return denied;
  const locked = await requireActiveSubscriptionApi(auth.user);
  if (locked) return locked;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError(400, "JSON body шаардлагатай.");
  }

  const parsed = parseCreateAppointmentBody(body);
  if (!parsed.ok) {
    return jsonError(parsed.status, parsed.message, parsed.fieldErrors ? { fieldErrors: parsed.fieldErrors } : undefined);
  }
  const { branchId, customerId, vehicleId, requestedAt, note, categoryIds, confirmed, assignedToId } = parsed.value;

  const scopeResult = await resolveWorkingBranch(req, auth.user);
  if (scopeResult.response) return scopeResult.response;

  // `registerAppointmentByStaffCommand` enforces scope via
  // `workingBranchScopeId(actor)`, which — per its own doc comment — reads
  // `actor.workingBranchId` (the web-session field). For a token-based API
  // actor that field does not otherwise exist, so the resolved header scope
  // is threaded through explicitly here; `null` (owner / "ALL") leaves it
  // unset, matching workingBranchScopeId's own null-means-unscoped contract.
  const actor: AppointmentCommandActor = {
    ...auth.user,
    ...(scopeResult.branchId ? { workingBranchId: scopeResult.branchId } : {}),
  };

  try {
    const created = await registerAppointmentByStaffCommand({
      actor,
      branchId,
      customerId,
      vehicleId,
      requestedAt,
      note,
      categoryIds,
      confirmed,
      assignedToId,
    });
    const appointment = await prisma.appointment.findFirst({
      where: { id: created.appointmentId, tenantId: auth.user.tenantId },
      select: APPT_SELECT,
    });
    if (!appointment) return jsonError(500, "Цаг захиалга үүссэн боловч буцааж уншиж чадсангүй.");
    return jsonOk({ appointment: shapeAppointment(appointment) }, { status: 201 });
  } catch (error) {
    if (error instanceof AppointmentCommandError) {
      return jsonError(error.status, error.message, {
        code: error.code,
        ...(error.fieldErrors ? { fieldErrors: error.fieldErrors } : {}),
      });
    }
    return jsonError(500, "Серверийн алдаа гарлаа. Дахин оролдоно уу.");
  }
}
