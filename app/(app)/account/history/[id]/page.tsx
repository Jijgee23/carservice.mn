import { notFound } from "next/navigation";
import Link from "next/link";
import { BtnLink } from "@/app/_components/landing-ops-ui";
import { EmptyState } from "@/app/_components/empty-state";
import { requireAccount } from "@/lib/auth/account";
import {
  ITEM_KIND_BADGE,
  ITEM_KIND_LABEL,
  ORDER_STATUS_BADGE,
  ORDER_STATUS_LABEL,
  PAYMENT_STATUS_BADGE,
  PAYMENT_STATUS_LABEL,
  formatTugrik,
  type ItemKind,
  type OrderStatus,
  type PaymentStatus,
} from "@/lib/orders";
import { prisma } from "@/lib/prisma";
import { customerOwnershipFilters } from "@/lib/vehicles";
import { OrderIntakeView } from "@/app/(app)/account/_components/order-intake-view";
import { INTAKE_VIEW_SELECT, toIntakeView } from "@/lib/orders/order-intake-view";
import {
  DIAGNOSTIC_TYPE_BADGE,
  DIAGNOSTIC_TYPE_LABEL,
  SEVERITY_BADGE,
  SEVERITY_LABEL,
  type DiagnosticType,
  type ReportSeverity,
} from "@/lib/diagnostics";

export const metadata = {
  title: "Үйлчилгээний дэлгэрэнгүй",
};

export const dynamic = "force-dynamic";

function fmtDateTime(d: Date | null): string {
  return d
    ? d.toLocaleString("mn-MN", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    })
    : "—";
}

// Хүлээн авах бүртгэлийн огноо — server дээр UB цагаар форматлана.
function fmtIntakeTime(iso: string): string {
  return new Date(iso).toLocaleString("mn-MN", {
    timeZone: "Asia/Ulaanbaatar",
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

export default async function AccountHistoryDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const account = await requireAccount();
  const { id } = await params;


  // Зөвшөөрөл: захиалга нь account-тай холбоотой Customer-ийнх ЭСВЭЛ эзэмшлийн
  // машины захиалга байх ёстой. Өөр хэрэглэгчийн захиалгыг харах боломжгүй.
  const order = await prisma.serviceOrder.findFirst({
    where: {
      id,
      isInternal: false,
      OR: customerOwnershipFilters(account.id, account.phone),
    },
    select: {
      number: true,
      status: true,
      paymentStatus: true,
      scheduledAt: true,
      completedAt: true,
      createdAt: true,
      notes: true,
      totalAmount: true,
      paidAmount: true,
      ...INTAKE_VIEW_SELECT,
      tenant: { select: { name: true } },
      branch: { select: { name: true, phone: true } },
      vehicle: { select: { plate: true, make: true, model: true, year: true } },
      items: {
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          kind: true,
          description: true,
          quantity: true,
          unitPrice: true,
          total: true,
        },
      },
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
  });

  if (!order) notFound();
  const intake = toIntakeView(order, { includeRecordedBy: false });

  return (
    <div className="w-full max-w-full flex flex-col gap-5">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-2xl font-bold truncate">{order.tenant.name}</h1>
            <span className="text-xs text-[var(--oc-muted3)] font-plex-mono">
              №{order.number}
            </span>
          </div>
          <p className="text-[var(--oc-muted)] text-sm mt-0.5">
            {order.vehicle.plate} · {order.vehicle.make} {order.vehicle.model}
            {order.vehicle.year ? ` · ${order.vehicle.year}` : ""}
          </p>
        </div>
        <BtnLink href="/account/history" variant="ghost" className="shrink-0">
          ← Буцах
        </BtnLink>
      </div>

      {/* Товч мэдээлэл */}
      <div className="rounded-[10px] border border-[var(--oc-line)] bg-[var(--oc-panel)] p-5 grid gap-3 sm:grid-cols-2">
        <Info label="Төлөв">
          <span
            className={`font-plex-mono text-[11px] px-2.5 py-1 rounded-full ${ORDER_STATUS_BADGE[order.status as OrderStatus]}`}
          >
            {ORDER_STATUS_LABEL[order.status as OrderStatus]}
          </span>
        </Info>
        <Info label="Төлбөр">
          <span
            className={`font-plex-mono text-[11px] px-2.5 py-1 rounded-full ${PAYMENT_STATUS_BADGE[order.paymentStatus as PaymentStatus]}`}
          >
            {PAYMENT_STATUS_LABEL[order.paymentStatus as PaymentStatus]}
          </span>
        </Info>
        <Info label="Салбар">
          <span className="text-sm text-[var(--oc-ink2)]">
            {order.branch.name}
            {order.branch.phone ? (
              <span className="text-[var(--oc-muted3)]"> · {order.branch.phone}</span>
            ) : null}
          </span>
        </Info>
        <Info label="Огноо">
          <span className="text-sm text-[var(--oc-ink2)] tabular-nums">
            {fmtDateTime(
              order.completedAt ?? order.scheduledAt ?? order.createdAt,
            )}
          </span>
        </Info>
      </div>

      {intake ? (
        <OrderIntakeView
          notes={intake.notes}
          photos={intake.photos}
          signatureUrl={intake.signatureUrl}
          mileageKm={intake.mileageKm}
          recordedAtLabel={fmtIntakeTime(intake.recordedAt)}
        />
      ) : null}

      {/* Үйлчилгээний мөрүүд */}
      <div>
        <h2 className="font-semibold text-[var(--oc-ink2)] text-sm mb-2">
          Хийгдсэн ажил, сэлбэг
          {order.items.length > 0 ? (
            <span className="text-[var(--oc-muted3)] font-normal">
              {" "}
              · {order.items.length}
            </span>
          ) : null}
        </h2>

        {order.items.length === 0 ? (
          <EmptyState padding="p-8">
            Мөр бүртгэгдээгүй байна.
          </EmptyState>
        ) : (
          <div className="rounded-[10px] border border-[var(--oc-line)] bg-[var(--oc-panel)] overflow-hidden divide-y divide-[var(--oc-line)]">
            {order.items.map((it) => (
              <div key={it.id} className="flex items-start gap-3 px-4 py-3">
                <span
                  className={`shrink-0 mt-0.5 font-plex-mono text-[10px] px-1.5 py-0.5 rounded-full ${ITEM_KIND_BADGE[it.kind as ItemKind]}`}
                >
                  {ITEM_KIND_LABEL[it.kind as ItemKind]}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-sm text-[var(--oc-ink2)]">{it.description}</div>
                  <div className="text-xs text-[var(--oc-muted3)] mt-0.5 tabular-nums">
                    {qtyText(it.quantity.toString())} ×{" "}
                    {formatTugrik(it.unitPrice.toString())}
                  </div>
                </div>
                <div className="shrink-0 text-sm font-medium text-[var(--oc-ink)] tabular-nums">
                  {formatTugrik(it.total.toString())}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {order.reports.length > 0 ? (
        <div>
          <h2 className="font-semibold text-[var(--oc-ink2)] text-sm mb-2">
            Оношилгооны тайлан
            <span className="text-[var(--oc-muted3)] font-normal">
              {" "}· {order.reports.length}
            </span>
          </h2>
          <div className="rounded-[10px] border border-[var(--oc-line)] bg-[var(--oc-panel)] overflow-hidden divide-y divide-[var(--oc-line)]">
            {order.reports.map((report) => {
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
                  <span
                    className="shrink-0 text-[var(--oc-muted3)]"
                    aria-hidden="true"
                  >
                    →
                  </span>
                </Link>
              );
            })}
          </div>
        </div>
      ) : null}

      {/* Дүн */}
      <div className="rounded-[10px] border border-[var(--oc-line)] bg-[var(--oc-panel)] p-5 flex flex-col gap-2">
        <div className="flex items-center justify-between text-sm">
          <span className="text-[var(--oc-muted)]">Нийт дүн</span>
          <span className="font-bold text-[var(--oc-ink)] tabular-nums text-base">
            {formatTugrik(order.totalAmount?.toString() ?? null)}
          </span>
        </div>
        {order.paidAmount != null ? (
          <div className="flex items-center justify-between text-sm">
            <span className="text-[var(--oc-muted)]">Төлсөн</span>
            <span className="text-[var(--oc-ink2)] tabular-nums">
              {formatTugrik(order.paidAmount.toString())}
            </span>
          </div>
        ) : null}
      </div>

      {order.notes ? (
        <div className="rounded-[10px] border border-[var(--oc-line)] bg-[var(--oc-panel)] p-5">
          <div className="font-plex-mono text-[10.5px] uppercase tracking-[0.1em] text-[var(--oc-muted3)] mb-1">
            Тэмдэглэл
          </div>
          <p className="text-sm text-[var(--oc-ink2)] whitespace-pre-wrap">
            {order.notes}
          </p>
        </div>
      ) : null}
    </div>
  );
}

function Info({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="font-plex-mono text-[10.5px] uppercase tracking-[0.1em] text-[var(--oc-muted3)] w-20 shrink-0">
        {label}
      </span>
      {children}
    </div>
  );
}
