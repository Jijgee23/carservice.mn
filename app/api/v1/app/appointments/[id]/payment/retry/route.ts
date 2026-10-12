import { jsonError, jsonOk } from "@/lib/api";
import {
  APPOINTMENT_NOT_PAYABLE_CODE,
  retryAppointmentFeeCheckout,
  serializeAppointmentFee,
} from "@/lib/appointment-payments";
import { getApiAccountFromRequest } from "@/lib/auth/account-api-token";
import { prisma } from "@/lib/prisma";

// POST /api/v1/app/appointments/[id]/payment/retry — invoice татах үед
// QPay доголдож (FAILED) checkout эхлээгүй тохиолдолд дахин оролдоно.
export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const account = await getApiAccountFromRequest(req);
  if (!account) return jsonError(401, "Нэвтрэх шаардлагатай.");

  const { id } = await ctx.params;
  const appt = await prisma.appointment.findFirst({
    where: { id, accountId: account.id },
    select: { id: true },
  });
  if (!appt) return jsonError(404, "Цаг олдсонгүй.");

  const result = await retryAppointmentFeeCheckout(appt.id);
  if (!result.ok) {
    if (result.code === APPOINTMENT_NOT_PAYABLE_CODE) {
      return jsonError(409, result.error, { code: APPOINTMENT_NOT_PAYABLE_CODE });
    }
    return jsonError(502, result.error);
  }

  const withFee = await prisma.appointment.findUnique({
    where: { id: appt.id },
    select: {
      feeAmount: true,
      feeCurrency: true,
      feeQpayInvoiceId: true,
      feeQrImage: true,
      feeQrText: true,
      feeQpayUrls: true,
      feeUnderpaidAmount: true,
      payment: { select: { amount: true, currency: true, status: true } },
    },
  });
  return jsonOk({ payment: withFee ? serializeAppointmentFee(withFee) : null });
}
