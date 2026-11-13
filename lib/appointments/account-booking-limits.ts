import { prisma } from "@/lib/prisma";

/**
 * Хэрэглэгчийн (Account) онлайн цаг захиалгын хамгаалалт — нэг данснаас
 * олон салбарын багтаамжийг хуурамч захиалгаар дүүргэхээс сэргийлнэ.
 * Mobile (`POST /api/v1/app/appointments`) болон веб (`createAppointment`)
 * хоёулаа ашиглана.
 */

/** Нэг дансны захиалга үүсгэх хурд: 10 удаа / 10 минут. */
export const ACCOUNT_BOOKING_RATE_LIMIT = { limit: 10, windowMs: 10 * 60_000 } as const;
export const ACCOUNT_BOOKING_RATE_BUCKET = "app-appointment-create";

/** Нэгэн зэрэг идэвхтэй (ирээдүйн PENDING/CONFIRMED) захиалгын дээд тоо. */
export const MAX_OPEN_ACCOUNT_APPOINTMENTS = 5;

export const OPEN_APPOINTMENTS_LIMIT_MESSAGE =
  `Идэвхтэй цаг захиалга ${MAX_OPEN_ACCOUNT_APPOINTMENTS}-аас хэтрэх боломжгүй. ` +
  "Өмнөх цагаа ашигласан эсвэл цуцалсны дараа дахин захиална уу.";

export async function countOpenAccountAppointments(
  accountId: string,
  now: Date = new Date(),
): Promise<number> {
  return await prisma.appointment.count({
    where: {
      accountId,
      status: { in: ["PENDING", "CONFIRMED"] },
      requestedAt: { gte: now },
    },
  });
}

export function hasReachedOpenAppointmentLimit(openCount: number): boolean {
  return openCount >= MAX_OPEN_ACCOUNT_APPOINTMENTS;
}
