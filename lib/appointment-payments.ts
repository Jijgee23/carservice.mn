import "server-only";

import { revalidatePath } from "next/cache";
import { Prisma } from "@/app/generated/prisma/client";
import { formatWhen } from "@/lib/appointments";
import { isPendingAppointmentPaymentExpired } from "@/lib/appointment-payment-status";
import { isSlotAvailable } from "@/lib/category-duration";
import { DEFAULT_SLOT_MINUTES } from "@/lib/appointment-slots";
import { notifyStaff } from "@/lib/notifications";
import { getPlatformSettings } from "@/lib/platform-settings";
import { prisma } from "@/lib/prisma";
import { formatTugrik } from "@/lib/orders";
import { QPayService, type QPayBankUrl } from "@/lib/qpay";
import { getAppBaseUrl } from "@/lib/subscription-server";

/**
 * Цаг захиалгын хураамж — эцсийн хэрэглэгч (Account) захиалахдаа QPay-ээр
 * төлдөг, платформын (SuperAdmin) орлого. Дүн/идэвхтэй эсэхийг super admin
 * `/system/settings`-ээс тохируулна (PlatformSetting.appointmentFee*).
 *
 * Архитектур: явцад буй (төлөгдөөгүй) QPay checkout-ийг `Appointment.fee*`
 * талбарууд дээр хөтөлнө (`ensureAppointmentFeeCheckout`/
 * `retryAppointmentFeeCheckout`) — DB-д "Invoice" гэж тооцогдохгүй.
 * `AppointmentPayment` мөр (жинхэнэ Invoice) ЗӨВХӨН QPay-аас "PAID" гэж
 * баталгаажсаны дараа (`confirmAppointmentPayment`) л үүсч, тэр даруй тенант
 * рүү мэдэгдэл очно.
 */
export const BOOKING_FEE_CURRENCY = "MNT";
/** Statuses in which a booking fee may still be checked out (a dead booking must not get a payable QR). */
const FEE_CHECKOUT_LIVE_STATUSES = ["PENDING", "CONFIRMED"] as const;
/** Machine code returned (HTTP 409) when the fee can no longer be paid because the booking is dead. */
export const APPOINTMENT_NOT_PAYABLE_CODE = "APPOINTMENT_NOT_PAYABLE" as const;
export const FEE_CHECKOUT_DEAD_MESSAGE = "Энэ цаг цуцлагдсан тул хураамж төлөх боломжгүй.";
function isFeeCheckoutLive(status: string): boolean {
  return (FEE_CHECKOUT_LIVE_STATUSES as readonly string[]).includes(status);
}
export const FEE_CHECKOUT_ERROR_MESSAGE =
  "QPay нэхэмжлэх үүсгэхэд алдаа гарлаа. Түр хүлээгээд дахин оролдоно уу.";
export const DEAD_BOOKING_PAID_MESSAGE =
  "Төлбөр хүлээж авсан ч энэ цаг цуцлагдсан байсан тул захиалга идэвхжихгүй. " +
  "Байгууллагатай холбогдож буцаан олголт хийлгэнэ үү.";
export const FEE_CHECK_ERROR_MESSAGE =
  "Төлбөр шалгахад алдаа гарлаа. Түр хүлээгээд дахин оролдоно уу.";

type CheckoutResult =
  | { ok: true; required: false } // хураамж идэвхгүй — үнэгүй, checkout хэрэггүй
  | { ok: true; required: true } // QPay invoice амжилттай татагдсан (эсвэл өмнө нь бэлэн/төлөгдсөн)
  | { ok: false; required: true; error: string; code?: typeof APPOINTMENT_NOT_PAYABLE_CODE }; // invoice татахад алдаа гарсан; code = цаг идэвхгүй (цуцлагдсан)

/**
 * `REFUNDED` is an additive value (customer API contract): the fee was paid and
 * later refunded. Older clients show it as pending (harmless: retry is a no-op); see CUSTOMER_API_CONTRACT.md.
 */
export type AppointmentFeeStatus =
  | "PENDING"
  | "PAID"
  | "UNDERPAID"
  | "FAILED"
  | "REFUNDED";

export type AppointmentFeeInfo = {
  status: AppointmentFeeStatus;
  amount: number;
  currency: string;
  qrImage: string | null;
  qrText: string | null;
  urls: QPayBankUrl[];
  underpaidAmount: number | null;
} | null;

/**
 * Appointment.fee* (явцад буй checkout) + payment (эцсийн Invoice)-ийг нэг
 * API-д ойлгомжтой хэлбэрт (`AppointmentFeeInfo`) хувиргана. Web (pay page,
 * account list) болон mobile API (/api/v1/app/appointments*) хоёулаа
 * ашиглана — хураамжийн UI логикийг нэг цэгт төвлөрүүлнэ.
 */
export function serializeAppointmentFee(appt: {
  feeAmount: Prisma.Decimal | null;
  feeCurrency: string | null;
  feeQpayInvoiceId: string | null;
  feeQrImage: string | null;
  feeQrText: string | null;
  feeQpayUrls: Prisma.JsonValue | null;
  feeUnderpaidAmount: Prisma.Decimal | null;
  payment: { amount: Prisma.Decimal; currency: string; status: string } | null;
}): AppointmentFeeInfo {
  if (appt.payment) {
    return {
      status: appt.payment.status === "REFUNDED" ? "REFUNDED" : "PAID",
      amount: Number.parseFloat(appt.payment.amount.toString()),
      currency: appt.payment.currency,
      qrImage: null,
      qrText: null,
      urls: [],
      underpaidAmount: null,
    };
  }
  if (!appt.feeAmount) return null; // хураамж шаардлагагүй (үнэгүй/идэвхгүй үед захиалсан)

  const amount = Number.parseFloat(appt.feeAmount.toString());
  const currency = appt.feeCurrency ?? BOOKING_FEE_CURRENCY;
  const urls = Array.isArray(appt.feeQpayUrls)
    ? (appt.feeQpayUrls as unknown as QPayBankUrl[])
    : [];

  if (appt.feeUnderpaidAmount != null) {
    return {
      status: "UNDERPAID",
      amount,
      currency,
      qrImage: appt.feeQrImage,
      qrText: appt.feeQrText,
      urls,
      underpaidAmount: Number.parseFloat(appt.feeUnderpaidAmount.toString()),
    };
  }
  if (appt.feeQpayInvoiceId) {
    return {
      status: "PENDING",
      amount,
      currency,
      qrImage: appt.feeQrImage,
      qrText: appt.feeQrText,
      urls,
      underpaidAmount: null,
    };
  }
  // feeAmount тавигдсан ч invoice татагдаагүй (эсвэл алдаа өгсөн) — дахин оролдоно.
  return {
    status: "FAILED",
    amount,
    currency,
    qrImage: null,
    qrText: null,
    urls: [],
    underpaidAmount: null,
  };
}

/** QPay-аас invoice татаж Appointment.fee* талбарт хадгална (checkout — Invoice биш). */
async function requestFeeCheckout(
  appointmentId: string,
  accountId: string,
  amount: number,
  tenantName: string,
): Promise<CheckoutResult> {
  const inv = await QPayService.createInvoice({
    senderInvoiceNo: appointmentId,
    invoiceReceiverCode: accountId,
    invoiceDescription: `Цаг захиалгын хураамж · ${tenantName}`,
    amount,
    callbackUrl: `${getAppBaseUrl()}/api/v1/appointments/qpay/callback?appointment_id=${appointmentId}`,
  });

  if ("error" in inv) {
    // A concurrent caller may already have persisted a successful invoice.
    // Never clear that winner when this provider call loses or returns an
    // error; QPay requires sender_invoice_no to be unique, so this is the
    // bounded no-schema race guard available to the current model.
    await prisma.appointment.updateMany({
      where: { id: appointmentId, feeQpayInvoiceId: null, payment: { is: null } },
      data: {
        feeAmount: amount,
        feeCurrency: BOOKING_FEE_CURRENCY,
        feeQpayInvoiceId: null,
        feeQrImage: null,
        feeQrText: null,
        feeQpayUrls: Prisma.JsonNull,
      },
    });
    // Provider text can carry upstream bodies/config hints — log it, never return it.
    console.error("[appointment-fee] QPay createInvoice failed:", appointmentId, inv.error);
    return { ok: false, required: true, error: FEE_CHECKOUT_ERROR_MESSAGE };
  }

  const persisted = await prisma.appointment.updateMany({
    where: {
      id: appointmentId,
      feeQpayInvoiceId: null,
      payment: { is: null },
      status: { in: [...FEE_CHECKOUT_LIVE_STATUSES] },
    },
    data: {
      feeAmount: amount,
      feeCurrency: BOOKING_FEE_CURRENCY,
      feeQpayInvoiceId: inv.invoice_id,
      feeQrText: inv.qr_text,
      feeQrImage: inv.qr_image,
      feeQpayUrls: inv.urls ?? Prisma.JsonNull,
    },
  });
  if (persisted.count !== 1) {
    // The appointment may have been cancelled/rejected while the provider call was
    // in flight: the just-created invoice would be a payable QR on a dead booking.
    const current = await prisma.appointment.findUnique({
      where: { id: appointmentId },
      select: { status: true, feeQpayInvoiceId: true, payment: { select: { id: true } } },
    });
    if (current && !isFeeCheckoutLive(current.status)) {
      const cancelled = await QPayService.cancelInvoice(inv.invoice_id);
      if (!cancelled.ok && cancelled.reason !== "not_found") {
        console.warn("[appointment-fee] could not cancel orphan invoice for dead booking:", appointmentId, cancelled.reason);
      }
      return { ok: false, required: true, error: FEE_CHECKOUT_DEAD_MESSAGE, code: APPOINTMENT_NOT_PAYABLE_CODE };
    }
    // Another request won the local claim while this provider call was in
    // flight. Cancel THIS call's now-redundant invoice (paying it would not be
    // matched to the booking) and return the existing one; the persisted row is
    // the source of truth for the caller's next read.
    if (current && (current.payment || (current.feeQpayInvoiceId && current.feeQpayInvoiceId !== inv.invoice_id))) {
      try {
        const cancelled = await QPayService.cancelInvoice(inv.invoice_id);
        if (!cancelled.ok && cancelled.reason !== "not_found") {
          console.warn("[appointment-fee] could not cancel duplicate invoice:", appointmentId, cancelled.reason);
        }
      } catch (e) {
        console.warn("[appointment-fee] duplicate invoice cancel threw:", appointmentId, e instanceof Error ? e.name : "UnknownError");
      }
    }
    // Nothing is attached to the booking (no invoice, no payment): this call's invoice
    // would be an orphan. Cancel it (best-effort) and report failure so the caller retries.
    if (!current || (!current.payment && !current.feeQpayInvoiceId)) {
      try {
        const cancelled = await QPayService.cancelInvoice(inv.invoice_id);
        if (!cancelled.ok && cancelled.reason !== "not_found") {
          console.warn("[appointment-fee] could not cancel orphan invoice:", appointmentId, cancelled.reason);
        }
      } catch (e) {
        console.warn("[appointment-fee] orphan invoice cancel threw:", appointmentId, e instanceof Error ? e.name : "UnknownError");
      }
      return { ok: false, required: true, error: FEE_CHECKOUT_ERROR_MESSAGE };
    }
    return { ok: true, required: true };
  }
  return { ok: true, required: true };
}

/**
 * Хэрэглэгч (Account) онлайн цаг захиалахад дуудагдана (`createAppointment`).
 * Super admin хураамжийг идэвхгүй болгосон бол (`appointmentFeeEnabled=false`)
 * үнэгүй — checkout эхлүүлэхгүй. Идэвхтэй бол одоогийн тохируулсан дүнгээр
 * QPay invoice татаж Appointment.fee*-д хадгална. QPay доголдвол ч энэ функц
 * алдаа шидэхгүй — дуудагч тал try/catch-аар аль хэдийн хамгаалсан (захиалга
 * үүсэхийг тасалдуулахгүйн тулд); fee талбарууд invoice-гүйгээр үлдэж дараа
 * дахин оролдох боломжтой.
 */
export async function ensureAppointmentFeeCheckout(
  appointmentId: string,
): Promise<CheckoutResult> {
  const settings = await getPlatformSettings();
  if (!settings.appointmentFeeEnabled || settings.appointmentFeeAmount <= 0) {
    return { ok: true, required: false };
  }

  const appt = await prisma.appointment.findUnique({
    where: { id: appointmentId },
    select: {
      id: true,
      status: true,
      accountId: true,
      tenant: { select: { name: true } },
      feeQpayInvoiceId: true,
      payment: { select: { id: true } },
    },
  });
  if (!appt || !appt.accountId) {
    return { ok: false, required: true, error: "Онлайн цаг захиалга олдсонгүй." };
  }
  if (appt.payment || appt.feeQpayInvoiceId) {
    return { ok: true, required: true }; // idempotent — аль хэдийн төлөгдсөн/QR бэлэн
  }
  if (!isFeeCheckoutLive(appt.status)) {
    return { ok: false, required: true, error: FEE_CHECKOUT_DEAD_MESSAGE, code: APPOINTMENT_NOT_PAYABLE_CODE };
  }

  return requestFeeCheckout(
    appt.id,
    appt.accountId,
    settings.appointmentFeeAmount,
    appt.tenant.name,
  );
}

/**
 * Account-аас дахин оролдох (invoice татах үед доголдсон тохиолдолд). Одоо
 * тохируулсан дүнгээр (тохиргоо солигдсон байж болзошгүй тул анхныхаар биш)
 * дахин QPay invoice татна.
 */
export async function retryAppointmentFeeCheckout(
  appointmentId: string,
): Promise<CheckoutResult> {
  const settings = await getPlatformSettings();
  if (!settings.appointmentFeeEnabled || settings.appointmentFeeAmount <= 0) {
    return { ok: true, required: false };
  }

  const appt = await prisma.appointment.findUnique({
    where: { id: appointmentId },
    select: {
      id: true,
      status: true,
      accountId: true,
      tenant: { select: { name: true } },
      payment: { select: { id: true } },
      feeQpayInvoiceId: true,
    },
  });
  if (!appt || !appt.accountId) {
    return { ok: false, required: true, error: "Онлайн цаг захиалга олдсонгүй." };
  }
  if (appt.payment) return { ok: true, required: true }; // аль хэдийн төлөгдсөн
  if (appt.feeQpayInvoiceId) return { ok: true, required: true };
  if (!isFeeCheckoutLive(appt.status)) {
    return { ok: false, required: true, error: FEE_CHECKOUT_DEAD_MESSAGE, code: APPOINTMENT_NOT_PAYABLE_CODE };
  }

  // There is no separate persisted checkout-claim column in the current
  // schema. Do not hold a database row lock across QPay I/O: if the provider
  // succeeds and the transaction then rolls back, QPay has an invoice that
  // the database cannot name. QPay's unique sender_invoice_no (the
  // appointment id) plus requestFeeCheckout's conditional writes keep this
  // bounded and preserve a successful concurrent writer.
  return requestFeeCheckout(
    appt.id,
    appt.accountId,
    settings.appointmentFeeAmount,
    appt.tenant.name,
  );
}

/**
 * QPay-аас тухайн appointment-ийн checkout (Appointment.feeQpayInvoiceId)
 * төлөгдсөн эсэхийг шалгана. Бүрэн төлөгдсөн бол ЗӨВХӨН ЭНД —
 * `AppointmentPayment` (Invoice) мөр анх удаа үүсч, тенант рүү мэдэгдэл
 * очно. Callback-ийн агуулгад найдахгүй — үргэлж QPay.checkPayment-ээр бие
 * даан баталгаажуулна (subscription-payments-тэй адил зарчим). Дахин
 * дуудсан ч idempotent (unique appointmentId constraint дээр тулгуурлана —
 * webhook + polling зэрэг ирсэн ч давхар Invoice/мэдэгдэл үүсэхгүй).
 */
export async function confirmAppointmentPayment(
  appointmentId: string,
): Promise<{
  ok: boolean;
  paid: boolean;
  message?: string;
  underpaidAmount?: number;
}> {
  const appt = await prisma.appointment.findUnique({
    where: { id: appointmentId },
    select: {
      id: true,
      tenantId: true,
      branchId: true,
      accountId: true,
      status: true,
      createdAt: true,
      estimatedDurationMinutes: true,
      feeAmount: true,
      feeCurrency: true,
      feeQpayInvoiceId: true,
      feeUnderpaidAmount: true,
      requestedAt: true,
      note: true,
      payment: { select: { id: true, status: true } },
      account: { select: { name: true, phone: true } },
    },
  });
  if (!appt) return { ok: false, paid: false, message: "Цаг захиалга олдсонгүй." };
  if (appt.payment?.status === "REFUNDED") {
    // Буцаагдсан хураамжийг "төлөгдсөн" гэж үзэхгүй, шинээр invoice-д ч хүрэхгүй.
    return { ok: true, paid: false, message: "Энэ хураамж буцаагдсан байна." };
  }
  if (appt.payment) return { ok: true, paid: true }; // idempotent — аль хэдийн Invoice үүссэн
  if (!appt.feeQpayInvoiceId || !appt.accountId || !appt.feeAmount) {
    return { ok: false, paid: false, message: "QPay invoice байхгүй." };
  }

  const expectedAmount = Number.parseFloat(appt.feeAmount.toString());
  const check = await QPayService.checkPayment(
    appt.feeQpayInvoiceId,
    expectedAmount,
  );
  if ("error" in check) {
    console.error("[appointment-fee] QPay checkPayment failed:", appointmentId, check.error);
    return { ok: false, paid: false, message: FEE_CHECK_ERROR_MESSAGE };
  }

  if (!check.paid) {
    if (check.underpaidAmount != null) {
      // S05: a late partial payment must not silently re-mark an expired,
      // now-taken hold as reserved (isPendingAppointmentPaymentExpired
      // excludes any row with feeUnderpaidAmount set). Re-check under the
      // branch lock before writing the underpaid marker.
      const outcome = await recordLatePaymentUnderLock({ ...appt, accountId: appt.accountId! }, {
        kind: "underpaid",
        underpaidAmount: check.underpaidAmount,
      });
      if (outcome.capacityLost) {
        return {
          ok: true,
          paid: false,
          underpaidAmount: check.underpaidAmount,
          message:
            `Дутуу төлбөр (${formatTugrik(check.underpaidAmount)} / ${formatTugrik(expectedAmount)}) хүлээж авсан ч энэ цаг аль хэдийн эзлэгдсэн тул захиалга цуцлагдлаа. ` +
            "Байгууллагатай холбогдож цаг дахин товлох/буцаан олголт хийлгэнэ үү.",
        };
      }
      return {
        ok: true,
        paid: false,
        underpaidAmount: check.underpaidAmount,
        message: `Дутуу төлбөр: ${formatTugrik(check.underpaidAmount)} / ${formatTugrik(expectedAmount)} ирсэн. Үлдэгдлийг нөхөж төлнө үү.`,
      };
    }
    return { ok: true, paid: false };
  }

  let capacityLostOnFullPayment = false;
  let paidOnDeadBooking = false;
  try {
    const outcome = await recordLatePaymentUnderLock({ ...appt, accountId: appt.accountId! }, {
      kind: "paid",
      qpayPaymentId: check.paymentId,
      paymentType: check.paymentType,
      paidAt: check.paidAt ?? new Date(),
    });
    capacityLostOnFullPayment = outcome.capacityLost;
    paidOnDeadBooking = outcome.deadBooking;
  } catch (e) {
    // Unique(appointmentId) зөрчил — webhook + polling зэрэг ирж өөр
    // transaction нь аль хэдийн үүсгэсэн. Idempotent-ээр амжилттай гэж үзнэ.
    if (
      e instanceof Prisma.PrismaClientKnownRequestError &&
      e.code === "P2002"
    ) {
      revalidatePath("/account");
      return { ok: true, paid: true };
    }
    throw e;
  }

  // Тенант рүү шинэ цаг захиалгын мэдэгдэл — хураамж шаардлагатай захиалгад
  // үүсгэх үед биш, яг ЭНД (төлбөр баталгаажсаны дараа) л явна (харах:
  // createAppointment). Зөвхөн Invoice-ийг ЭНД шинээр үүсгэсэн дуудалт дээр
  // л илгээнэ (давхар мэдэгдэхгүй, дээрх P2002 замд орохгүй). Хугацаа
  // хэтэрч, цаг аль хэдийн эзлэгдсэн бол (capacityLostOnFullPayment) энэ
  // мэдэгдлийн оронд "цуцлагдсан" гэсэн doorstop-г доор буцаана.
  if (!capacityLostOnFullPayment && !paidOnDeadBooking) {
    try {
      const who = appt.account?.name?.trim() || appt.account?.phone || "Хэрэглэгч";
      await notifyStaff({
        type: "appointment_created",
        tenantId: appt.tenantId,
        branchId: appt.branchId,
        input: {
          appointmentId: appt.id,
          body: `${who} — ${formatWhen(appt.requestedAt)} цагт цаг захиаллаа.`,
        },
      });
    } catch (e) {
      console.warn("[notify] confirmAppointmentPayment:", e);
    }
  }

  revalidatePath("/account");
  revalidatePath("/dashboard/appointments");
  if (paidOnDeadBooking) {
    return { ok: true, paid: true, message: DEAD_BOOKING_PAID_MESSAGE };
  }
  if (capacityLostOnFullPayment) {
    return {
      ok: true,
      paid: true,
      message:
        "Төлбөр хүлээж авсан ч энэ цаг аль хэдийн эзлэгдсэн тул захиалга цуцлагдлаа. " +
        "Байгууллагатай холбогдож цаг дахин товлох/буцаан олголт хийлгэнэ үү.",
    };
  }
  return { ok: true, paid: true };
}

/**
 * S05: records money received (AppointmentPayment or the underpaid marker)
 * under the branch lock, but re-verifies the hold hasn't already expired AND
 * been given to someone else before letting this appointment count toward
 * capacity again. `isPendingAppointmentPaymentExpired`/occupancy resolution
 * (lib/category-duration.ts) treat any PAID or underpaid row as "not
 * expired" — i.e. reserved — so a late payment after the 15-minute TTL can
 * otherwise silently revive a slot someone else already took. When capacity
 * is genuinely gone, the payment is still recorded (money already changed
 * hands) but the appointment is explicitly CANCELLED instead of being left
 * to look reserved — staff/support then handles reschedule or refund
 * manually; this deliberately does not implement that workflow itself.
 */
async function recordLatePaymentUnderLock(
  appt: {
    id: string;
    tenantId: string;
    branchId: string;
    // Caller has already verified this is non-null before calling in.
    accountId: string;
    status: string;
    createdAt: Date;
    estimatedDurationMinutes: number | null;
    requestedAt: Date;
    feeAmount: Prisma.Decimal | null;
    feeCurrency: string | null;
    feeQpayInvoiceId: string | null;
    note?: string | null;
  },
  write:
    | { kind: "underpaid"; underpaidAmount: number }
    | {
        kind: "paid";
        qpayPaymentId: string | null | undefined;
        paymentType: string | null | undefined;
        paidAt: Date;
      },
): Promise<{ capacityLost: boolean; deadBooking: boolean }> {
  const { withBookingTransaction } = await import("@/lib/prisma");
  return withBookingTransaction(appt.tenantId, async (tx) => {
    await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM "Branch" WHERE id = ${appt.branchId} AND "tenantId" = ${appt.tenantId} FOR UPDATE
    `;
    const now = new Date();
    // Re-read status/note under the lock: the appointment may have been
    // cancelled/rejected/expired between the caller's read and this lock.
    const live = await tx.appointment.findUnique({
      where: { id: appt.id },
      select: { status: true, note: true },
    });
    const currentStatus = live?.status ?? appt.status;
    const currentNote = live ? live.note : (appt.note ?? null);
    // Late payment on a booking that is no longer live (I1): record the money
    // so it is not lost, but never revive or notify the booking.
    const deadBooking = currentStatus === "CANCELLED" || currentStatus === "REJECTED";
    const wasExpired =
      currentStatus === "PENDING" &&
      isPendingAppointmentPaymentExpired(
        { feeAmount: appt.feeAmount, feeUnderpaidAmount: null, payment: null, createdAt: appt.createdAt },
        now,
      );
    const capacityLost =
      !deadBooking &&
      wasExpired &&
      !(await isSlotAvailable(
        tx,
        appt.branchId,
        appt.requestedAt,
        appt.estimatedDurationMinutes ?? DEFAULT_SLOT_MINUTES,
        appt.id,
      ));

    if (write.kind === "underpaid") {
      await tx.appointment.update({
        where: { id: appt.id },
        data: capacityLost
          ? {
              feeUnderpaidAmount: write.underpaidAmount,
              feeUnderpaidAt: now,
              status: "CANCELLED",
              note: appendCapacityLostNote(),
            }
          : { feeUnderpaidAmount: write.underpaidAmount, feeUnderpaidAt: now },
      });
      return { capacityLost, deadBooking };
    }

    if (!appt.feeAmount) return { capacityLost: false, deadBooking: false };
    await tx.appointmentPayment.create({
      data: {
        appointmentId: appt.id,
        tenantId: appt.tenantId,
        accountId: appt.accountId,
        amount: appt.feeAmount,
        currency: appt.feeCurrency ?? BOOKING_FEE_CURRENCY,
        status: "PAID",
        qpayInvoiceId: appt.feeQpayInvoiceId,
        qpayPaymentId: write.qpayPaymentId,
        paymentType: write.paymentType,
        paidAt: write.paidAt,
      },
    });
    await tx.appointment.update({
      where: { id: appt.id },
      data: deadBooking
        ? {
            // Status stays CANCELLED/REJECTED. The PAID AppointmentPayment row on
            // a dead booking IS the refund-needed flag: it is listed in the
            // super-admin booking-revenue "refund needed" panel, and the note
            // below tells staff/support. No schema change.
            feeUnderpaidAmount: null,
            feeUnderpaidAt: null,
            note: appendDeadBookingNote(currentNote),
          }
        : capacityLost
          ? { feeUnderpaidAmount: null, feeUnderpaidAt: null, status: "CANCELLED", note: appendCapacityLostNote() }
          : { feeUnderpaidAmount: null, feeUnderpaidAt: null },
    });
    return { capacityLost, deadBooking };
  });

  function appendDeadBookingNote(existing: string | null): string {
    const line =
      "[Автомат] Цуцлагдсан/татгалзсан цагт хураамж төлөгдсөн. Буцаан олголт шаардлагатай.";
    return existing ? `${existing}
${line}` : line;
  }

  function appendCapacityLostNote(): string {
    return "[Автомат] Хугацаа хэтэрсний дараа төлбөр ирсэн ч энэ цаг өөр захиалгад эзлэгдсэн тул цуцлагдав. Буцаан олголт/дахин товлолт шаардлагатай.";
  }
}
