import { cancelAppointmentFeeInvoiceById } from "@/lib/appointment-fee-invoice";
import { getFirebaseTokensForAccount } from "@/lib/devices";
import { prisma } from "@/lib/prisma";
import { notifyStaff } from "@/lib/notifications";
import { setBypassContext } from "@/lib/tenant-context";
import {
  buildAccountDeletionCancelNotificationBody,
  futureCancellableWhere,
} from "./appointment-cancellation";
import { notifyAccountClosed } from "./notify";
import { accountTombstone } from "./tombstone";

// Түр хаах: token-ууд getApiAccountFromRequest-д хүчингүй болно (deactivatedAt).
// Push илгээгдэхгүйн тулд device-уудыг устгана; дахин нэвтрэхэд апп дахин бүртгэнэ.
// Устгахаас өмнө token-уудыг уншиж аваад, transaction амжилттай болсны дараа
// нээлттэй апп-ыг шууд гаргах (sign out) зорилготой чимээгүй push илгээнэ.
export async function deactivateAccount(accountId: string): Promise<void> {
  const tokens = await getFirebaseTokensForAccount(accountId);
  await prisma.$transaction([
    prisma.account.update({ where: { id: accountId }, data: { deactivatedAt: new Date() } }),
    prisma.device.deleteMany({ where: { accountId } }),
  ]);
  await notifyAccountClosed(tokens, "deactivated");
}

// Бүрмөсөн устгах — буцаагдахгүй. Тенантын Customer бичлэг (гаражийн өөрийн
// CRM) хадгалагдаж, зөвхөн Account-аас салгагдана. Appointment/payment/feedback
// tombstone Account-той холбоотой үлдэнэ.
type CancelledBranchAppointment = {
  id: string;
  requestedAt: Date;
  paidUnrefunded: boolean;
};

type CancelledBranchGroup = {
  tenantId: string;
  branchId: string;
  appointments: CancelledBranchAppointment[];
};

export async function deleteAccount(accountId: string): Promise<void> {
  const tokens = await getFirebaseTokensForAccount(accountId);
  // Customer нь tenant-scoped (RLS) — Account-ийн Customer-ууд олон тенантад
  // тархсан байж болно тул энд bypass шаардлагатай (getApiAccountFromRequest
  // аль хэдийн bypass тавьсан ч дуудагч бие даан ачаалагдвал алга болно).
  setBypassContext();

  const now = new Date();

  const { cancelledGroups, cancelledIds } = await prisma.$transaction(async (tx) => {
    // Account устгагдахаас ӨМНӨ, ижил transaction дотор: капасити эзэлсээр
    // байгаа ирээдүйн PENDING/CONFIRMED захиалгуудыг цуцална — эс тэгвэл
    // branch-schedule-loader статусаар л тоолдог тул (accountId харгалзахгүй)
    // устгагдсан хэрэглэгчийн захиалга слот эзэлсэн хэвээр үлдэнэ, мөн
    // PENDING нь дараа нь баталгаажих боломжгүй болно (account алга болсноор
    // APPOINTMENT_NO_ACCOUNT).
    const cancellable = await tx.appointment.findMany({
      where: futureCancellableWhere(accountId, now),
      select: {
        id: true,
        tenantId: true,
        branchId: true,
        requestedAt: true,
        feeAmount: true,
        payment: { select: { status: true, refundedAt: true } },
      },
    });

    if (cancellable.length > 0) {
      await tx.appointment.updateMany({
        where: { id: { in: cancellable.map((a) => a.id) } },
        data: { status: "CANCELLED" },
      });
    }

    const groups = new Map<string, CancelledBranchGroup>();
    for (const appt of cancellable) {
      const key = `${appt.tenantId}:${appt.branchId}`;
      const group = groups.get(key) ?? {
        tenantId: appt.tenantId,
        branchId: appt.branchId,
        appointments: [],
      };
      // Төлбөр (AppointmentPayment) "PAID" бөгөөд буцаагдаагүй (refundedAt
      // null) бол гараар буцаах шаардлагатай — шинэ багана/migration
      // нэмэхгүй, зөвхөн ажилтны мэдэгдлийн текстээр л энэ шаардлагыг
      // дамжуулна (lib/appointment-payments.ts refund талбарууд аль хэдийн
      // "гараар буцаах" урсгалыг илэрхийлдэг).
      const paidUnrefunded = appt.payment?.status === "PAID" && !appt.payment.refundedAt;
      group.appointments.push({ id: appt.id, requestedAt: appt.requestedAt, paidUnrefunded });
      groups.set(key, group);
    }

    await tx.customer.updateMany({ where: { accountId }, data: { accountId: null } });
    // Appointment/Feedback-ийг Account-аас салгана — эс тэгвэл tombstone-ийн
    // "deleted:<id>" утас (null биш) гараж руу дэлгэц дээр гоожно.
    await tx.appointment.updateMany({ where: { accountId }, data: { accountId: null } });
    await tx.feedback.updateMany({ where: { accountId }, data: { accountId: null } });
    await tx.device.deleteMany({ where: { accountId } });
    await tx.notification.deleteMany({ where: { accountId } });
    await tx.accountVehicle.deleteMany({ where: { accountId } });
    await tx.account.update({ where: { id: accountId }, data: accountTombstone(accountId, now) });

    return {
      cancelledGroups: Array.from(groups.values()),
      cancelledIds: cancellable.map((a) => a.id),
    };
  });

  await notifyAccountClosed(tokens, "deleted");

  // Cancel the live QPay booking-fee QR of each cancelled appointment (best effort,
  // after the tx committed; never throws). Without this the QR stays payable on a
  // dead booking whose accountId is already nulled. Known limit: if QPay reports the
  // invoice already paid, confirm cannot record it (no account any more) and only a
  // warning is logged, so that money needs manual reconciliation.
  await Promise.allSettled(cancelledIds.map((id) => cancelAppointmentFeeInvoiceById(id)));

  // Transaction амжилттай commit хийсний ДАРАА, best-effort — мэдэгдэл
  // илгээх алдаа account устгалтад ямар ч байдлаар нөлөөлөх ёсгүй.
  for (const group of cancelledGroups) {
    try {
      const body = buildAccountDeletionCancelNotificationBody(group.appointments);
      // Яг НЭГ захиалга цуцлагдсан бол `cancelAppointmentByAccount`-ийн
      // notifyStaff дуудлагатай адил appointmentId дамжуулна — ажилтан
      // дарахад шууд тэр захиалга руу орно (NotificationRouter). Хэд хэдэн
      // захиалга нэг мэдэгдэлд нэгтгэгдсэн үед аль нэгийг нь оноож болохгүй
      // тул id-г орхино — апп үүнийг мэдэгдэл жагсаалт руу унагаах хэвийн
      // үйлдлээр зохицуулна (доорх тест/тайланд баталгаажуулсан).
      const appointmentId =
        group.appointments.length === 1 ? group.appointments[0].id : undefined;
      await notifyStaff({
        type: "appointment_cancelled",
        tenantId: group.tenantId,
        branchId: group.branchId,
        input: appointmentId ? { appointmentId, body } : { body },
      });
    } catch (e) {
      console.warn("[account-closure] notifyStaff (deleteAccount):", e);
    }
  }
}
