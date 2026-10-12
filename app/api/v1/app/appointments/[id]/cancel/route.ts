import { jsonError, jsonOk } from "@/lib/api";
import { getApiAccountFromRequest } from "@/lib/auth/account-api-token";
import { cancelAppointmentFeeInvoiceById } from "@/lib/appointment-fee-invoice";
import { prisma } from "@/lib/prisma";

// POST /api/v1/app/appointments/[id]/cancel — өөрийн цагаа цуцлах (auth).
export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const account = await getApiAccountFromRequest(req);
  if (!account) return jsonError(401, "Нэвтрэх шаардлагатай.");

  const { id } = await ctx.params;
  const appt = await prisma.appointment.findFirst({
    where: { id, accountId: account.id },
    select: { id: true, status: true, serviceOrderId: true },
  });
  if (!appt) return jsonError(404, "Цаг олдсонгүй.");
  if (appt.status !== "PENDING" && appt.status !== "CONFIRMED") {
    return jsonError(409, "Энэ цагийг цуцлах боломжгүй.");
  }
  // Засварын хуудас холбогдсон бол цуцлахгүй — ServiceOrder хөндөгдөхгүй тул
  // ажил үргэлжилсээр байна (web + апп-ын UI ч мөн нуудаг).
  if (appt.serviceOrderId) {
    return jsonError(409, "Засвар эхэлсэн тул энэ цагийг цуцлах боломжгүй.");
  }

  const updated = await prisma.appointment.updateMany({
    where: { id: appt.id, accountId: account.id, status: { in: ["PENDING", "CONFIRMED"] }, serviceOrderId: null },
    data: { status: "CANCELLED" },
  });
  if (updated.count !== 1) return jsonError(409, "Энэ цагийг цуцлах боломжгүй.");
  // Төлөгдөөгүй хураамжийн QR-г QPay дээр цуцална — дараа нь төлөгдөхөөс сэргийлнэ.
  const feeOutcome = await cancelAppointmentFeeInvoiceById(appt.id);
  // Additive: the QR was already paid when cancelled — the fee is recorded and a refund follows.
  // Also when the fee was already recorded (PAID row) before the cancel.
  let refundPending = feeOutcome === "paid";
  if (!refundPending) {
    try {
      const paid = await prisma.appointmentPayment.findFirst({
        where: { appointmentId: appt.id, status: "PAID" },
        select: { id: true },
      });
      refundPending = paid != null;
    } catch {
      // best effort: the cancel already succeeded; the row is in the super-admin refund panel regardless
    }
  }
  return jsonOk(refundPending ? { ok: true, refundPending: true } : { ok: true });
}
