import { notFound } from "next/navigation";
import { BackLink } from "@/app/(app)/_components/consumer-ui";
import { AdvancedPDFButton } from "@/app/dashboard/diagnostics/reports/[id]/pdf-generator";
import { ReportCustomerView } from "@/app/dashboard/diagnostics/reports/[id]/report-customer-view";
import { requireAccount } from "@/lib/auth/account";
import {
  DIAGNOSTIC_TYPE_BADGE,
  DIAGNOSTIC_TYPE_LABEL,
  SEVERITY_BADGE,
  SEVERITY_LABEL,
  type DiagnosticType,
  type ReportData,
  type ReportSeverity,
  type TemplateSchema,
  emptySchema,
} from "@/lib/diagnostics";
import { prisma } from "@/lib/prisma";
import { customerOwnershipFilters } from "@/lib/vehicles";

export const metadata = {
  title: "Оношилгооны тайлан",
};

export const dynamic = "force-dynamic";

// Нэг оношилгооны тайланг унших (customer, read-only) — worker талын дэлгэрэнгүй
// хуудастай ижил render хийнэ (харах: app/dashboard/diagnostics/reports/[id]),
// зөвшөөрлийн зарчим account/orders/[id]-тэй ижил: account-тай холбоотой
// Customer-ийн ЭСВЭЛ эзэмшлийн машины тайлан байх ёстой. Засах/устгах
// боломжгүй; PDF нь энэ зөвшөөрөгдсөн тайлангийн өгөгдлөөс browser дээр
// үүснэ.
export default async function AccountDiagnosticDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const account = await requireAccount();
  const { id } = await params;

  const report = await prisma.diagnosticReport.findFirst({
    where: {
      id,
      OR: customerOwnershipFilters(account.id, account.phone),
    },
    select: {
      id: true,
      templateVersion: true,
      data: true,
      maxSeverity: true,
      signatureUrl: true,
      mileageAtReport: true,
      notes: true,
      createdAt: true,
      template: { select: { name: true, type: true, schema: true } },
      vehicle: { select: { plate: true, make: true, model: true, year: true } },
      branch: { select: { name: true } },
    },
  });
  if (!report) notFound();

  let schema: TemplateSchema;
  try {
    schema = report.template.schema as unknown as TemplateSchema;
    if (!schema.sections) schema = emptySchema();
  } catch {
    schema = emptySchema();
  }
  const data = (report.data ?? {}) as ReportData;
  const tp = report.template.type as DiagnosticType;

  const sev = report.maxSeverity as ReportSeverity | null;

  return (
    <div className="w-full max-w-full flex flex-col gap-5">
      <BackLink href="/account/diagnostics">Оношилгооны түүх</BackLink>

      <div className="relative overflow-hidden rounded-2xl border border-[var(--oc-line)] bg-[var(--oc-panel)] p-5 sm:p-6">
        <div
          aria-hidden
          className="pointer-events-none absolute -right-16 -top-20 h-56 w-56 rounded-full bg-[var(--oc-accent)]/10 blur-2xl"
        />
        <div className="relative flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className={`text-[11px] px-2.5 py-0.5 rounded-full ${DIAGNOSTIC_TYPE_BADGE[tp]}`}>
                {DIAGNOSTIC_TYPE_LABEL[tp]}
              </span>
              {sev ? (
                <span className={`text-[11px] px-2.5 py-0.5 rounded-full border ${SEVERITY_BADGE[sev]}`}>
                  {SEVERITY_LABEL[sev]}
                </span>
              ) : null}
            </div>
            <h1 className="mt-2 text-2xl font-bold leading-tight text-[var(--oc-ink)]">{report.template.name}</h1>
            <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-[var(--oc-muted)]">
              <span className="rounded-md border border-[var(--oc-line)] bg-[var(--oc-panel2)] px-1.5 py-px font-plex-mono text-xs font-semibold text-[var(--oc-ink2)]">
                {report.vehicle.plate}
              </span>
              <span>
                {report.vehicle.make} {report.vehicle.model}
                {report.vehicle.year ? ` · ${report.vehicle.year}` : ""}
              </span>
            </div>
            <dl className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs">
              <div className="flex gap-1.5">
                <dt className="text-[var(--oc-muted3)]">Огноо</dt>
                <dd className="tabular-nums text-[var(--oc-ink2)]">
                  {report.createdAt.toLocaleString("mn-MN", { hour12: false })}
                </dd>
              </div>
              <div className="flex gap-1.5">
                <dt className="text-[var(--oc-muted3)]">Салбар</dt>
                <dd className="text-[var(--oc-ink2)]">{report.branch.name}</dd>
              </div>
              {report.mileageAtReport != null ? (
                <div className="flex gap-1.5">
                  <dt className="text-[var(--oc-muted3)]">Гүйлт</dt>
                  <dd className="tabular-nums text-[var(--oc-ink2)]">
                    {report.mileageAtReport.toLocaleString("mn-MN")} км
                  </dd>
                </div>
              ) : null}
            </dl>
          </div>
          <AdvancedPDFButton
            label="PDF татах"
            report={{
              reportId: report.id,
              templateName: report.template.name,
              templateVersion: report.templateVersion,
              createdAt: report.createdAt,
              customerName: account.name ?? "—",
              customerPhone: account.phone,
              vehicleMake: report.vehicle.make,
              vehicleModel: report.vehicle.model,
              vehiclePlate: report.vehicle.plate,
              vehicleYear: report.vehicle.year ?? undefined,
              branchName: report.branch.name,
              mileageAtReport: report.mileageAtReport ?? undefined,
              notes: report.notes ?? undefined,
              signatureUrl: report.signatureUrl ?? undefined,
              sections: schema.sections,
              data,
            }}
          />
        </div>
        {report.notes ? (
          <div className="relative mt-4 rounded-xl border-l-2 border-[var(--oc-accent)] bg-[var(--oc-panel2)] px-4 py-3 text-sm text-[var(--oc-ink2)]">
            <div className="mb-0.5 text-xs font-semibold text-[var(--oc-muted)]">Мастерын тэмдэглэл</div>
            <p className="whitespace-pre-wrap">{report.notes}</p>
          </div>
        ) : null}
      </div>

      <ReportCustomerView schema={schema} data={data} />
    </div>
  );
}
