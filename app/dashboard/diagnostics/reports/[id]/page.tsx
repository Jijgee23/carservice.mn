import Link from "next/link";
import { notFound } from "next/navigation";
import { deleteReportAction } from "@/app/_actions/diagnostic-reports";
import { Btn, BtnLink } from "@/app/_components/landing-ops-ui";
import { ConfirmForm } from "@/app/_components/confirm-form";
import { AdvancedPDFButton } from "./pdf-generator";
import { requireUser } from "@/lib/auth";
import { getBranchVisibility } from "@/lib/branch-visibility";
import { workingBranchScopeId } from "@/lib/auth/roles";
import { customerLabel } from "@/lib/customers";
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
import { ReportAnswers } from "./report-answers";

export const metadata = {
  title: "Оношилгооны тайлан",
};

export default async function ReportDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireUser();
  // Энгийн багц (ганц салбар): салбарыг дэлгэц, PDF-д харуулахгүй.
  const { hideBranches } = await getBranchVisibility(user);
  const { id } = await params;
  const scopeBranchId = workingBranchScopeId(user);

  const report = await prisma.diagnosticReport.findFirst({
    where: {
      id,
      tenantId: user.tenantId,
      ...(scopeBranchId ? { branchId: scopeBranchId } : {}),
    },
    include: {
      template: { select: { id: true, name: true, schema: true, type: true } },
      filledBy: { select: { firstName: true, lastName: true } },
      order: { select: { id: true, number: true, status: true } },
      customer: { select: { id: true, fullName: true, phone: true } },
      vehicle: { select: { id: true, plate: true, make: true, model: true, year: true } },
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

  return (
    <div id="print-root" className="p-4 sm:p-6 max-w-full flex-1 flex flex-col min-h-0 w-full">
      <nav className="no-print flex items-center gap-1.5 text-[13px] text-[var(--oc-muted3)] mb-3">
        <Link href="/dashboard/diagnostics/reports" className="hover:text-[var(--oc-accent-hi)] transition-colors">
          Оношилгооны тайлангууд
        </Link>
        <span>/</span>
        <span className="text-[var(--oc-muted)]">{report.template.name}</span>
      </nav>

      <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-[var(--oc-ink)]">{report.template.name}</h1>
          <p className="text-sm text-[var(--oc-muted3)] mt-1">
            v{report.templateVersion} · {report.createdAt.toLocaleString("mn-MN", { hour12: false })}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span
            className={`text-xs px-2.5 py-1 rounded-full ${DIAGNOSTIC_TYPE_BADGE[tp]}`}
          >
            {DIAGNOSTIC_TYPE_LABEL[tp]}
          </span>
          {report.maxSeverity ? (
            <span
              className={`text-xs px-2.5 py-1 rounded-full border ${SEVERITY_BADGE[report.maxSeverity as ReportSeverity]}`}
            >
              {SEVERITY_LABEL[report.maxSeverity as ReportSeverity]}
            </span>
          ) : null}
          <AdvancedPDFButton
            report={{
              reportId: report.id,
              templateName: report.template.name,
              templateVersion: report.templateVersion,
              createdAt: report.createdAt,
              customerName: customerLabel(report.customer),
              customerPhone: report.customer.phone,
              vehicleMake: report.vehicle.make,
              vehicleModel: report.vehicle.model,
              vehiclePlate: report.vehicle.plate,
              vehicleYear: report.vehicle.year ?? undefined,
              branchName: hideBranches ? undefined : report.branch.name,
              filledByName: report.filledBy
                ? `${report.filledBy.lastName} ${report.filledBy.firstName}`
                : undefined,
              mileageAtReport: report.mileageAtReport ?? undefined,
              notes: report.notes ?? undefined,
              signatureUrl: report.signatureUrl ?? undefined,
              sections: schema.sections,
              data,
            }}
          />
        </div>
      </div>

      <div className="rounded-[10px] border border-[var(--oc-line)] bg-[var(--oc-panel)] p-5 mb-6 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3 text-sm">
        <Row label="Үйлчлүүлэгч">
          <Link
            href={`/dashboard/customers/${report.customer.id}`}
            className="text-[var(--oc-accent)] hover:text-[var(--oc-accent-hi)]"
          >
            {customerLabel(report.customer)}
          </Link>
          <div className="text-xs text-[var(--oc-muted3)]">{report.customer.phone}</div>
        </Row>
        <Row label="Машин">
          <Link
            href={`/dashboard/vehicles/${report.vehicle.id}`}
            className="text-[var(--oc-accent)] hover:text-[var(--oc-accent-hi)]"
          >
            {report.vehicle.make} {report.vehicle.model}
          </Link>
          <div className="font-plex-mono text-xs text-[var(--oc-muted3)]">
            {report.vehicle.plate}
            {report.vehicle.year ? ` · ${report.vehicle.year}` : ""}
          </div>
        </Row>
        {hideBranches ? null : <Row label="Салбар">{report.branch.name}</Row>}
        <Row label="Бөглөсөн">
          {report.filledBy
            ? `${report.filledBy.lastName} ${report.filledBy.firstName}`
            : "—"}
        </Row>
        {report.order ? (
          <Row label="Засварын хуудас">
            <Link
              href={`/dashboard/orders/${report.order.id}`}
              className="text-[var(--oc-accent)] hover:text-[var(--oc-accent-hi)]"
            >
              #{report.order.number}
            </Link>
            {report.order.status === "CANCELLED" ? (
              <span className="ml-2 text-[9px] px-1.5 py-0.5 rounded-full bg-white/[0.06] text-[var(--oc-muted2)] border border-[var(--oc-line2)] light:bg-zinc-100 light:border-zinc-300 light:text-zinc-600">
                Цуцлагдсан
              </span>
            ) : null}
          </Row>
        ) : null}
        {report.mileageAtReport !== null ? (
          <Row label="Гүйлт">
            {report.mileageAtReport.toLocaleString("mn-MN")} км
          </Row>
        ) : null}
        {report.notes ? (
          <div className="sm:col-span-2">
            <dt className="text-xs text-[var(--oc-muted3)]">Тэмдэглэл</dt>
            <dd className="text-[var(--oc-ink2)] whitespace-pre-wrap">
              {report.notes}
            </dd>
          </div>
        ) : null}
      </div>

      <div className="flex flex-col gap-5">
        <ReportAnswers schema={schema} data={data} />

        {report.signatureUrl ? (
          <section className="rounded-[10px] border border-[var(--oc-line)] bg-[var(--oc-panel)] p-5">
            <h2 className="font-semibold text-[var(--oc-ink)] text-sm mb-3">
              Үйлчлүүлэгчийн гарын үсэг
            </h2>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={report.signatureUrl}
              alt="Гарын үсэг"
              className="w-64 h-32 object-contain rounded-lg border border-[var(--oc-line)] bg-[var(--oc-panel2)]"
            />
          </section>
        ) : null}
      </div>

      <div className="no-print flex items-center justify-between mt-6">
        <BtnLink href="/dashboard/diagnostics/reports" variant="ghost" size="sm">
          ← Жагсаалт руу буцах
        </BtnLink>
        <ConfirmForm
          action={deleteReportAction}
          message="Энэ оношилгооны тайланг устгах уу? Энэ үйлдлийг буцаах боломжгүй."
        >
          <input type="hidden" name="id" value={report.id} />
          <Btn type="submit" variant="danger" size="sm">
            Тайланг устгах
          </Btn>
        </ConfirmForm>
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-[var(--oc-muted3)]">{label}</dt>
      <dd className="text-[var(--oc-ink2)]">{children}</dd>
    </div>
  );
}
