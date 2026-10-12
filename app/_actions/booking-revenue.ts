"use server";

import { revalidatePath } from "next/cache";
import { requireSuperAdmin } from "@/lib/auth/system";
import { logAudit } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import {
  claimAppointmentRefund,
  finalizeAppointmentRefundWithRetry,
  isDefiniteRefundRejection,
  markAppointmentRefundVerified,
  REFUND_AMBIGUOUS_MESSAGE,
  REFUND_VERIFY_MESSAGE,
  REFUND_REJECTION_MESSAGE,
  releaseAppointmentRefundClaim,
  type AppointmentRefundDb,
} from "@/lib/appointment-refund";
import { QPayService } from "@/lib/qpay";

export type RefundActionState = {
  ok: boolean;
  message?: string;
} | null;

function s(fd: FormData, key: string): string {
  const v = fd.get(key);
  return typeof v === "string" ? v.trim() : "";
}

/**
 * SuperAdmin цаг захиалгын хураамжийг буцаана. QPay-ийн refund/cancel API нь
 * ЗӨВХӨН картын гүйлгээнд ажилладаг тул `paymentType === "CARD"` бол QPay-аар
 * бодитоор буцаана; бусад тохиолдолд (P2P — банкны шилжүүлэг/QR, өнөөдрийн
 * платформ дээрх гол хэлбэр) API дуудахгүй — гараар (банкны шилжүүлгээр)
 * буцаасныг л DB-д тэмдэглэнэ.
 */
export async function refundAppointmentPaymentAction(
  _prev: RefundActionState,
  formData: FormData,
): Promise<RefundActionState> {
  const admin = await requireSuperAdmin();

  const paymentId = s(formData, "paymentId");
  const note = s(formData, "note");
  if (!paymentId) return { ok: false, message: "ID шаардлагатай." };
  if (!note) {
    return { ok: false, message: "Буцаах шалтгаан/тэмдэглэл заавал бөглөнө." };
  }

  const db = prisma.appointmentPayment as unknown as AppointmentRefundDb;

  // 1) Claim: conditional PAID -> "refund in progress". Concurrent submits
  //    (double click, two admins) cannot both pass; no QPay call before this.
  const claim = await claimAppointmentRefund(db, { paymentId });
  if (!claim.claimed) {
    return { ok: false, message: REFUND_REJECTION_MESSAGE[claim.reason] };
  }
  const payment = claim.payment;
  const token = claim.token;

  // 2) Provider call (CARD only), outside any transaction.
  if (payment.paymentType === "CARD" && payment.qpayPaymentId) {
    const result = await QPayService.refundPayment(payment.qpayPaymentId, note).catch(
      (e: unknown) => ({ error: e instanceof Error ? e.name : "UnknownError" }),
    );
    if ("error" in result) {
      console.error("[booking-revenue] QPay refund failed:", payment.id, result.error);
      if (claim.reclaimed) {
        // A takeover of an earlier ambiguous attempt: a 4xx here may just be QPay
        // refusing a REPEAT refund, so keep the claim for «Буцаасан гэж тэмдэглэх».
        return { ok: false, message: REFUND_VERIFY_MESSAGE };
      }
      if (isDefiniteRefundRejection(result.error)) {
        // Definite provider rejection (4xx) on a FRESH claim: nothing was refunded; allow retry.
        await releaseAppointmentRefundClaim(db, payment.id, token);
        return {
          ok: false,
          message: "QPay буцаалтыг татгалзлаа. Мэдээллээ шалгаад дахин оролдоно уу.",
        };
      }
      // Ambiguous (timeout/network/5xx/unknown): KEEP the claim; money may have moved.
      return { ok: false, message: REFUND_AMBIGUOUS_MESSAGE };
    }
  }

  // 3) Finalize on its own (+ one retry); no audit transaction can roll it back.
  const finalized = await finalizeAppointmentRefundWithRetry(db, {
    paymentId: payment.id,
    token,
    refundNote: note,
    refundedById: admin.id,
  });
  if (!finalized) {
    return {
      ok: false,
      message: `Буцаалтын төлөв хадгалагдсангүй (төлбөр ${payment.id}). QPay дээр шалгаад гараар тохируулна уу.`,
    };
  }

  revalidatePath("/system/booking-revenue");
  return {
    ok: true,
    message:
      payment.paymentType === "CARD"
        ? "QPay-аар амжилттай буцаагдлаа."
        : "Гараар буцаасан гэж тэмдэглэгдлээ.",
  };
}

/**
 * SuperAdmin-only: a refund attempt ended ambiguously (timeout/5xx/network) and the
 * payment still holds its refund claim. After verifying at QPay that the money was
 * returned, the admin marks it REFUNDED here. Only rows holding a claim qualify.
 */
export async function markAppointmentRefundVerifiedAction(
  _prev: RefundActionState,
  formData: FormData,
): Promise<RefundActionState> {
  const admin = await requireSuperAdmin();

  const paymentId = s(formData, "paymentId");
  const note = s(formData, "note");
  if (!paymentId) return { ok: false, message: "ID шаардлагатай." };
  if (!note) {
    return { ok: false, message: "QPay дээр шалгасан тэмдэглэл заавал бөглөнө." };
  }

  const db = prisma.appointmentPayment as unknown as AppointmentRefundDb;
  const ok = await markAppointmentRefundVerified(db, {
    paymentId,
    refundNote: `[QPay дээр шалгасан] ${note}`,
    refundedById: admin.id,
  });
  if (!ok) {
    return { ok: false, message: "Буцаалтын түгжээтэй төлбөр олдсонгүй (аль хэдийн шийдэгдсэн байж магадгүй)." };
  }

  const row = await prisma.appointmentPayment.findUnique({
    where: { id: paymentId },
    select: { tenantId: true, appointmentId: true, amount: true },
  });
  if (row) {
    // The row is already REFUNDED: an audit failure must not show the admin an error.
    try {
      await logAudit({
        tenantId: row.tenantId,
        entity: "Appointment",
        entityId: row.appointmentId,
        action: "PAYMENT_CHANGE",
        summary: `Цаг захиалгын хураамжийн буцаалтыг QPay дээр шалгаж баталгаажуулав (SuperAdmin ${admin.id}) · ${row.amount.toString()}`,
        after: { paymentId, status: "REFUNDED", verifiedAtProvider: true, superAdminId: admin.id },
      });
    } catch (error) {
      console.error("markAppointmentRefundVerifiedAction: audit failed", error);
    }
  }

  revalidatePath("/system/booking-revenue");
  return { ok: true, message: "Буцаагдсан гэж тэмдэглэгдлээ." };
}
