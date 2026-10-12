import { jsonError, jsonOk } from "@/lib/api";
import { serializeAppointmentFee } from "@/lib/appointment-payments";
import { getApiAccountFromRequest } from "@/lib/auth/account-api-token";
import { prisma } from "@/lib/prisma";

// GET /api/v1/app/appointments/[id]/payment — тухайн цагийн хураамжийн
// одоогийн төлөв (checkout QR эсвэл төлөгдсөн Invoice). "Төлбөр" дэлгэц
// нээх бүрд дуудна.
export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const account = await getApiAccountFromRequest(req);
  if (!account) return jsonError(401, "Нэвтрэх шаардлагатай.");

  const { id } = await ctx.params;
  const appt = await prisma.appointment.findFirst({
    where: { id, accountId: account.id },
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
  if (!appt) return jsonError(404, "Цаг олдсонгүй.");

  return jsonOk({ payment: serializeAppointmentFee(appt) });
}
