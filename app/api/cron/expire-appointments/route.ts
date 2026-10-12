import { NextResponse } from "next/server";
import { cancelAppointmentFeeInvoicesBounded } from "@/lib/appointment-fee-invoice";
import { logAudit } from "@/lib/audit";
import { verifyCronSecret } from "@/lib/cron-auth";
import { createNotification } from "@/lib/notifications";
import { prisma } from "@/lib/prisma";
import { setBypassContext } from "@/lib/tenant-context";

/**
 * Хугацаа нь хэтэрсэн (requestedAt < now) боловч ажилтан хараахан хариу
 * өгөөгүй (PENDING) цаг захиалгуудыг автоматаар CANCELLED болгоно.
 *
 * Баталгаажсан (CONFIRMED) захиалгыг хөндөхгүй — тэдгээрийг ажилтан өөрөө
 * "Ирээгүй" эсвэл "Цуцлах"-аар шийднэ.
 *
 * Мөр бүрт: (1) статус → CANCELLED, (2) AuditLog (систем — userId=null, "яагаад"
 * тодорхой харагдана), (3) онлайн захиалга (Account-той) бол мэдэгдэл.
 *
 * Cron гадуурх (Vercel cron, QStash, cron-job.org) дуудна. Bearer secret
 * шалгаж нэвтрэхгүй бол 401.
 *
 * Setup: env-д `CRON_SECRET=<random>` тогтоо. Vercel Cron-аас дуудаж байгаа бол
 * `Authorization: Bearer <CRON_SECRET>` нэмж тавина.
 */
export async function POST(req: Request) {
  return run(req);
}

// GET-ыг бас зөвшөөрөв (зарим cron service зөвхөн GET дэмждэг — secret нь
// GET-д ч Authorization header-ээр ирнэ, URL-ээр биш, S17-аас хойш).
export async function GET(req: Request) {
  return run(req);
}

const MAX_BATCH = 200;

async function run(req: Request) {
  const denied = verifyCronSecret(req);
  if (denied) return denied;
  // Бүх tenant дундуур scan хийдэг cron тул RLS-г тойрч гарна.
  setBypassContext();

  const now = new Date();

  const due = await prisma.appointment.findMany({
    where: {
      status: "PENDING",
      requestedAt: { lt: now },
    },
    orderBy: { requestedAt: "asc" },
    take: MAX_BATCH,
    select: { id: true, tenantId: true, branchId: true, accountId: true, requestedAt: true },
  });

  let notified = 0;
  const cancelledIds: string[] = [];
  try {
  for (const a of due) {
    // S17 Phase A: conditional update instead of a blind single-row write —
    // only proceed with the audit/notification side effects if THIS
    // invocation actually flipped the row (still PENDING and still expired
    // at write time). If another concurrent run (or a staff action) already
    // changed it, `count` is 0 and we skip — no double-cancel, no stale
    // audit/notification for a row we didn't touch.
    // Нэг мөрийн DB алдаа үлдсэн batch-ийг зогсоохгүй.
    let result: { count: number };
    try {
      result = await prisma.appointment.updateMany({
        where: { id: a.id, status: "PENDING", requestedAt: { lt: now } },
        data: { status: "CANCELLED" },
      });
    } catch (e) {
      console.warn("[cron] expire-appointments update failed:", a.id, e);
      continue;
    }
    if (result.count !== 1) continue;

    // QPay дээрх QR цуцлалтыг мөр бүрийг хүлээлгүй, доор хязгаартай зэрэгцээгээр хийнэ.
    cancelledIds.push(a.id);

    try {
      await logAudit({
        tenantId: a.tenantId,
        branchId: a.branchId,
        entity: "Appointment",
        entityId: a.id,
        action: "STATUS_CHANGE",
        summary: "Цаг → CANCELLED (хугацаа хэтэрснээр систем автоматаар цуцалсан)",
        after: { status: "CANCELLED", reason: "expired" },
      });
    } catch (e) {
      console.error("[cron] expire-appointments audit failed:", a.id, e instanceof Error ? e.name : e);
    }

    // Онлайн захиалга (Account-той) бол хэрэглэгчид мэдэгдэнэ.
    if (a.accountId) {
      try {
        await createNotification({
          type: "appointment_expired",
          recipient: { accountId: a.accountId },
          tenantId: a.tenantId,
          input: { appointmentId: a.id },
        });
        notified++;
      } catch (e) {
        console.warn("[notify] expireAppointment:", e);
      }
    }
  }
  } finally {
    // Хугацаа дууссан захиалгын төлөгдөөгүй хураамжийн QR-г QPay дээр цуцална
    // (5 зэрэг, нийт хугацааны хязгаартай; хэзээ ч throw хийхгүй). Аль хэдийн
    // CANCELLED болсон мөр бүрийн QR заавал цуцлагдана.
    await cancelAppointmentFeeInvoicesBounded(cancelledIds, { concurrency: 5, budgetMs: 45_000 });
  }

  return NextResponse.json({
    ok: true,
    expiredAppointments: due.length,
    notified,
    ranAt: now.toISOString(),
  });
}
