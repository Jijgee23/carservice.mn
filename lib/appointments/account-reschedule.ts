import { revalidatePath } from "next/cache";
import { formatWhen } from "@/lib/appointments";
import { ReservationError } from "@/lib/appointment-reservations";
import {
  AppointmentCommandError,
  rescheduleAppointmentByAccountCommand,
} from "@/lib/appointments/appointment-commands";
import { notifyStaff } from "@/lib/notifications";
import { prisma } from "@/lib/prisma";

// "use server" файлд БАЙЛГАЖ БОЛОХГҮЙ: `account`-ыг дуудагч өгдөг тул server
// action болж export хийгдвэл клиент дурын account.id-аар шууд POST хийж
// бусдын цагийг шилжүүлэх боломжтой болно. Зөвхөн нэвтрэлтээ шалгасан
// дуудагчид (web action `requireAccount()`, мобайл route token) ашиглана.

export type AccountRescheduleResult = {
  ok: boolean;
  message?: string;
  fieldErrors?: Record<string, string>;
};

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
): Promise<AccountRescheduleResult> {
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
