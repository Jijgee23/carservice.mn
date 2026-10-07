import Link from "next/link";
import { notFound } from "next/navigation";
import { cancelAppointmentByAccount } from "@/app/_actions/appointments";
import { BtnLink, Btn } from "@/app/_components/landing-ops-ui";
import { ConfirmForm } from "@/app/_components/confirm-form";
import {
  APPOINTMENT_STATUS_BADGE,
  APPOINTMENT_STATUS_LABEL,
} from "@/lib/appointments";
import { requireAccount } from "@/lib/auth/account";
import { openWeekdaysOf } from "@/lib/branches";
import { AccountRescheduleControl } from "./reschedule-control";
import {
  ITEM_KIND_BADGE,
  ITEM_KIND_LABEL,
  ORDER_STATUS_BADGE,
  ORDER_STATUS_LABEL,
  PAYMENT_STATUS_BADGE,
  PAYMENT_STATUS_LABEL,
  SERVICE_ITEM_STATUS_BADGE,
  SERVICE_ITEM_STATUS_LABEL,
  formatTugrik,
  type ItemKind,
  type OrderStatus,
  type PaymentStatus,
  type ServiceItemStatus,
} from "@/lib/orders";
import { prisma } from "@/lib/prisma";
import {
  DIAGNOSTIC_TYPE_BADGE,
  DIAGNOSTIC_TYPE_LABEL,
  SEVERITY_BADGE,
  SEVERITY_LABEL,
  type DiagnosticType,
  type ReportSeverity,
} from "@/lib/diagnostics";

export const metadata = {
  title: "Цаг захиалгын дэлгэрэнгүй",
};

export const dynamic = "force-dynamic";

function fmtDateTime(d: Date): string {
  return d.toLocaleString("mn-MN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function qtyText(q: string): string {
  const n = Number.parseFloat(q);
  return Number.isFinite(n) ? n.toLocaleString("mn-MN", { maximumFractionDigits: 3 }) : q;
}

export default async function AccountAppointmentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const account = await requireAccount();
  const { id } = await params;

  const apptRaw = await prisma.appointment.findFirst({
    where: { id, accountId: account.id },
    include: {
      tenant: { select: { name: true, slug: true } },
      branch: {
        select: {
          id: true,
          name: true,
          phone: true,
          openTime: true,
          closeTime: true,
          schedules: { select: { weekday: true, isOpen: true } },
        },
      },
      category: { select: { id: true, name: true } },
      categories: { select: { category: { select: { id: true, name: true } } } },
      payment: { select: { amount: true, currency: true } },
      accountVehicle: {
        select: { vehicle: { select: { plate: true, make: true, model: true, year: true } } },
      },
      serviceOrder: {
        select: {
          isInternal: true,
          id: true,
          number: true,
          status: true,
          paymentStatus: true,
          scheduledAt: true,
          startedAt: true,
          completedAt: true,
          totalAmount: true,
          paidAmount: true,
          vehicle: { select: { plate: true, make: true, model: true, year: true } },
          items: {
            orderBy: { createdAt: "asc" },
            select: {
              id: true,
              kind: true,
              description: true,
              status: true,
              quantity: true,
              unitPrice: true,
              total: true,
            },
          },
          // Ажил дуусахаас өмнө ч (жиш: захиалга гараад дараа нь оношилгоо
          // хийгдвэл) тайлан бэлэн болмогц шууд харагдана — history/[id]-тэй
          // ижил, захиалгын төлвөөр шүүхгүй.
          reports: {
            orderBy: { createdAt: "desc" },
            select: {
              id: true,
              createdAt: true,
              mileageAtReport: true,
              maxSeverity: true,
              template: { select: { name: true, type: true } },
            },
          },
        },
      },
    },
  });
  if (!apptRaw) notFound();
  // Дотоод засвар үйлчлүүлэгчид харагдахгүй.
  const appt = apptRaw.serviceOrder?.isInternal ? { ...apptRaw, serviceOrder: null } : apptRaw;

  // Засварын хуудас холбогдсон бол цуцлахгүй (апп-тай ижил, server ч шалгана).
  const canCancel = (appt.status === "PENDING" || appt.status === "CONFIRMED") && !appt.serviceOrderId;
  // Захиалга (ServiceOrder) аль хэдийн үүссэн бол онлайнаар шилжүүлэхийг
  // зөвшөөрөхгүй (харах: app/_actions/appointments.ts-ийн
  // rescheduleAppointmentByAccount тайлбар).
  const canReschedule = canCancel && !appt.serviceOrderId;
  const categoryIds = appt.categories.length
    ? appt.categories.map((c) => c.category.id)
    : appt.category
      ? [appt.category.id]
      : [];
  const feeAmount = appt.payment?.amount ?? appt.feeAmount;
  const feeLabel = appt.payment
    ? "Хураамж төлөгдсөн ✓"
    : appt.feeQpayInvoiceId
      ? `Хураамж төлөх · ${formatTugrik(feeAmount!.toString())}`
      : null;
  const categoryNames = appt.categories.length
    ? appt.categories.map((c) => c.category.name)
    : appt.category
      ? [appt.category.name]
      : [];
  // Дууссан + бүрэн төлөгдсөн ажлын дэлгэрэнгүйг Үйлчилгээний түүхэнд харуулна
  // (харах: app/account/history — тэнд зөвхөн status COMPLETED-г шүүнэ).
  const settled =
    appt.serviceOrder?.status === "COMPLETED" &&
    appt.serviceOrder?.paymentStatus === "PAID";
  // Тооцоолсон дуусах хугацаанаас хэтэрсэн ч ажил хараахан дуусаагүй эсэх —
  // Захиалга үүссэний дараа тэнд snapshot хийгдсэн машиныг тэргүүн ээлжид
  // харуулна (баталгаажсаны дараа өөрчлөгдсөн байж болзошгүй тул) — байхгүй
  // бол (захиалга хараахан үүсээгүй) хэрэглэгчийн сонгосон accountVehicle.
  const vehicle = appt.serviceOrder?.vehicle ?? appt.accountVehicle?.vehicle ?? null;

  return (
    <div className="w-full max-w-full flex flex-col gap-5">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold truncate">{appt.tenant.name}</h1>
          <p className="text-[var(--oc-muted)] text-sm mt-0.5">
            {appt.branch.name}
            {appt.branch.phone ? ` · ${appt.branch.phone}` : ""}
          </p>
          {vehicle ? (
            <p className="text-[var(--oc-muted2)] text-sm mt-0.5">
              {vehicle.plate} · {vehicle.make} {vehicle.model}
              {vehicle.year ? ` · ${vehicle.year}` : ""}
            </p>
          ) : null}
        </div>
        <BtnLink href="/account" variant="ghost" className="shrink-0">
          ← Буцах
        </BtnLink>
      </div>

      {/* Товч мэдээлэл */}
      <div className="rounded-[10px] border border-[var(--oc-line)] bg-[var(--oc-panel)] p-5 grid gap-3 sm:grid-cols-2">
        <Info label="Төлөв">
          <span
            className={`font-plex-mono text-[11px] px-2.5 py-1 rounded-full ${APPOINTMENT_STATUS_BADGE[appt.status]}`}
          >
            {APPOINTMENT_STATUS_LABEL[appt.status]}
          </span>
        </Info>
        <Info label="Цаг">
          <span className="text-sm text-[var(--oc-ink2)] tabular-nums">
            {fmtDateTime(appt.requestedAt)}
          </span>
        </Info>
        {categoryNames.length ? (
          <Info label="Үйлчилгээ">
            <span className="text-sm text-[var(--oc-ink2)]">
              {categoryNames.join(", ")}
            </span>
          </Info>
        ) : null}
        {appt.note ? (
          <Info label="Тэмдэглэл">
            <span className="text-sm text-[var(--oc-ink2)] whitespace-pre-wrap">
              {appt.note}
            </span>
          </Info>
        ) : null}
      </div>

      {/* Ажлын явц — зөвхөн захиалга (ServiceOrder) үүссэн үед */}
      {appt.serviceOrder ? (
        <div>
          <h2 className="font-semibold text-[var(--oc-ink2)] text-sm mb-2">
            Ажлын явц
          </h2>
          <div className="rounded-[10px] border border-[var(--oc-line)] bg-[var(--oc-panel)] p-5 flex flex-col gap-3">
            <div className="flex items-center gap-2 flex-wrap">
              <span
                className={`font-plex-mono text-[11px] px-2.5 py-1 rounded-full ${ORDER_STATUS_BADGE[appt.serviceOrder.status as OrderStatus]}`}
              >
                {ORDER_STATUS_LABEL[appt.serviceOrder.status as OrderStatus]}
              </span>
              {/* Захиалгын өөрийн төлбөрийн төлөв — доорх цаг захиалгын
                  хураамжаас (feeLabel) тусдаа ойлголт. */}
              <span
                className={`font-plex-mono text-[11px] px-2.5 py-1 rounded-full ${PAYMENT_STATUS_BADGE[appt.serviceOrder.paymentStatus as PaymentStatus]}`}
              >
                {PAYMENT_STATUS_LABEL[appt.serviceOrder.paymentStatus as PaymentStatus]}
              </span>
              <span className="text-xs text-[var(--oc-muted3)] font-plex-mono">
                №{appt.serviceOrder.number}
              </span>
            </div>
            {appt.serviceOrder.status === "SCHEDULED" && appt.serviceOrder.scheduledAt ? (
              <span className="text-xs text-[var(--oc-muted2)]">
                Товлосон огноо: {fmtDateTime(appt.serviceOrder.scheduledAt)}
              </span>
            ) : null}
            {appt.serviceOrder.items.length ? (
              <div className="flex flex-col divide-y divide-[var(--oc-line)]">
                {appt.serviceOrder.items.map((it) => (
                  <div key={it.id} className="flex items-start gap-3 py-2.5">
                    <span
                      className={`shrink-0 mt-0.5 font-plex-mono text-[10px] px-1.5 py-0.5 rounded-full ${ITEM_KIND_BADGE[it.kind as ItemKind]}`}
                    >
                      {ITEM_KIND_LABEL[it.kind as ItemKind]}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm text-[var(--oc-ink2)]">
                          {it.description}
                        </span>
                        <span
                          className={`shrink-0 font-plex-mono text-[10px] px-1.5 py-0.5 rounded-full ${SERVICE_ITEM_STATUS_BADGE[it.status as ServiceItemStatus]}`}
                        >
                          {SERVICE_ITEM_STATUS_LABEL[it.status as ServiceItemStatus]}
                        </span>
                      </div>
                      <div className="text-xs text-[var(--oc-muted3)] mt-0.5 tabular-nums">
                        {qtyText(it.quantity.toString())} × {formatTugrik(it.unitPrice.toString())}
                      </div>
                    </div>
                    <div className="shrink-0 text-sm font-medium text-[var(--oc-ink)] tabular-nums">
                      {formatTugrik(it.total.toString())}
                    </div>
                  </div>
                ))}
              </div>
            ) : null}
            {appt.serviceOrder.totalAmount != null ? (
              <div className="rounded-lg bg-[var(--oc-panel2)] border border-[var(--oc-line)] p-3 flex flex-col gap-1.5">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-[var(--oc-muted)]">Нийт дүн</span>
                  <span className="font-bold text-[var(--oc-ink)] tabular-nums">
                    {formatTugrik(appt.serviceOrder.totalAmount.toString())}
                  </span>
                </div>
                {appt.serviceOrder.paidAmount != null ? (
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-[var(--oc-muted)]">Төлсөн</span>
                    <span className="text-[var(--oc-ink2)] tabular-nums">
                      {formatTugrik(appt.serviceOrder.paidAmount.toString())}
                    </span>
                  </div>
                ) : null}
              </div>
            ) : null}
            {settled ? (
              <Link
                href={`/account/history/${appt.serviceOrder.id}`}
                className="text-sm text-[var(--oc-accent)] hover:text-[var(--oc-accent-hi)] transition-colors w-fit"
              >
                Дэлгэрэнгүй түүхэнд харах →
              </Link>
            ) : null}
          </div>
        </div>
      ) : null}

      {appt.serviceOrder && appt.serviceOrder.reports.length > 0 ? (
        <div>
          <h2 className="font-semibold text-[var(--oc-ink2)] text-sm mb-2">
            Оношилгооны тайлан
            <span className="text-[var(--oc-muted3)] font-normal">
              {" "}· {appt.serviceOrder.reports.length}
            </span>
          </h2>
          <div className="rounded-[10px] border border-[var(--oc-line)] bg-[var(--oc-panel)] overflow-hidden divide-y divide-[var(--oc-line)]">
            {appt.serviceOrder.reports.map((report) => {
              const type = report.template.type as DiagnosticType;
              return (
                <Link
                  key={report.id}
                  href={`/account/diagnostics/${report.id}`}
                  className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-[var(--oc-panel2)] transition-colors"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium text-[var(--oc-ink2)] truncate">
                        {report.template.name}
                      </span>
                      <span
                        className={`shrink-0 text-[10px] px-2 py-0.5 rounded-full ${DIAGNOSTIC_TYPE_BADGE[type]}`}
                      >
                        {DIAGNOSTIC_TYPE_LABEL[type]}
                      </span>
                      {report.maxSeverity ? (
                        <span
                          className={`shrink-0 text-[10px] px-2 py-0.5 rounded-full border ${SEVERITY_BADGE[report.maxSeverity as ReportSeverity]}`}
                        >
                          {SEVERITY_LABEL[report.maxSeverity as ReportSeverity]}
                        </span>
                      ) : null}
                    </div>
                    <div className="text-xs text-[var(--oc-muted3)] mt-1 tabular-nums">
                      {fmtDateTime(report.createdAt)}
                      {report.mileageAtReport != null
                        ? ` · ${report.mileageAtReport.toLocaleString("mn-MN")} км`
                        : ""}
                    </div>
                  </div>
                  <span className="shrink-0 text-[var(--oc-muted3)]" aria-hidden="true">
                    →
                  </span>
                </Link>
              );
            })}
          </div>
        </div>
      ) : null}

      {/* Хураамж / цуцлах */}
      <div className="flex items-center gap-3 flex-wrap">
        {feeLabel ? (
          <Link
            href={`/account/appointments/${appt.id}/pay`}
            className={`font-plex-mono text-[11px] px-2.5 py-1 rounded-full whitespace-nowrap transition-colors ${
              appt.payment
                ? "bg-emerald-500/15 text-emerald-400 light:bg-emerald-100 light:text-emerald-700"
                : "bg-[var(--oc-warn)]/15 text-[var(--oc-warn)] hover:bg-[var(--oc-warn)]/25"
            }`}
          >
            {feeLabel}
          </Link>
        ) : null}
        {canReschedule ? (
          <AccountRescheduleControl
            appointmentId={appt.id}
            branchId={appt.branch.id}
            openWeekdays={openWeekdaysOf(appt.branch)}
            categoryIds={categoryIds}
          />
        ) : null}
        {canCancel ? (
          <ConfirmForm
            action={cancelAppointmentByAccount}
            message={`\"${appt.tenant.name}\" — ${appt.branch.name} дахь ${fmtDateTime(appt.requestedAt)} цагийг цуцлах уу?`}
            title="Захиалга цуцлах"
            confirmLabel="Тийм, цуцлах"
          >
            <input type="hidden" name="id" value={appt.id} />
            <Btn variant="danger" size="sm" type="submit">
              Цуцлах
            </Btn>
          </ConfirmForm>
        ) : null}
      </div>
    </div>
  );
}

function Info({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <span className="font-plex-mono text-[10.5px] uppercase tracking-[0.1em] text-[var(--oc-muted3)] w-20 shrink-0">
        {label}
      </span>
      {children}
    </div>
  );
}
