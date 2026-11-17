import Link from "next/link";
import { notFound } from "next/navigation";
import { EmptyState } from "@/app/_components/empty-state";
import { requireAccount } from "@/lib/auth/account";
import { prisma } from "@/lib/prisma";
import type { QPayBankUrl } from "@/lib/qpay";
import { AppointmentPaymentPanel } from "./payment-panel";
import { PENDING_APPOINTMENT_PAYMENT_TTL_MINUTES } from "@/lib/appointment-payment-status";

export const metadata = {
  title: "Цаг захиалгын хураамж",
};

export const dynamic = "force-dynamic";

export default async function AppointmentPayPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const account = await requireAccount();

  const appt = await prisma.appointment.findFirst({
    where: { id, accountId: account.id },
    include: {
      tenant: { select: { name: true } },
      branch: { select: { name: true } },
      payment: { select: { amount: true, currency: true } },
    },
  });
  if (!appt) notFound();

  const paid = appt.payment != null;
  const amount = appt.payment?.amount ?? appt.feeAmount;
  const currency = appt.payment?.currency ?? appt.feeCurrency ?? "MNT";
  // Төлбөрийн эцсийн хугацаа — хугацаа хэтэрвэл цаг чөлөөлөгдөнө (cron).
  const payBy = new Date(appt.createdAt.getTime() + PENDING_APPOINTMENT_PAYMENT_TTL_MINUTES * 60_000);
  const payByLabel = payBy.toLocaleTimeString("mn-MN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Ulaanbaatar",
  });
  const showDeadline = !paid && appt.status === "PENDING" && payBy.getTime() > Date.now();

  return (
    <div className="w-full flex flex-col gap-4">
      <Link
        href="/account"
        className="text-xs text-[var(--oc-muted3)] hover:text-[var(--oc-ink2)] transition-colors w-fit"
      >
        ← Миний захиалгууд
      </Link>

      <div>
        <h1 className="font-semibold text-[var(--oc-ink2)] text-sm">
          Цаг захиалгын хураамж
        </h1>
        <p className="text-xs text-[var(--oc-muted3)] mt-0.5">
          {appt.tenant.name} · {appt.branch.name}
        </p>
      </div>

      {showDeadline ? (
        <div className="rounded-xl border border-amber-400/40 bg-amber-400/10 px-4 py-3 text-sm text-[var(--oc-ink2)]">
          <span className="font-semibold">{payByLabel}</span>-аас өмнө төлнө үү
          (захиалснаас хойш {PENDING_APPOINTMENT_PAYMENT_TTL_MINUTES} минут). Хугацаа хэтэрвэл
          цаг чөлөөлөгдөнө.
        </div>
      ) : null}

      {amount ? (
        <AppointmentPaymentPanel
          appointmentId={appt.id}
          paid={paid}
          amount={amount.toString()}
          currency={currency}
          qrImage={appt.feeQrImage}
          urls={
            Array.isArray(appt.feeQpayUrls)
              ? (appt.feeQpayUrls as unknown as QPayBankUrl[])
              : []
          }
          underpaidAmount={appt.feeUnderpaidAmount?.toString() ?? null}
        />
      ) : (
        <EmptyState padding="p-6">
          Төлбөрийн invoice хараахан үүсээгүй байна. Түр хүлээгээд дахин
          нээнэ үү.
        </EmptyState>
      )}
    </div>
  );
}
