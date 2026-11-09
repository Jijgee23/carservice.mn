import { ClickableRow } from "@/app/_components/clickable-row";
import { AddLinkButton } from "@/app/_components/landing-ops-ui";
import { EmptyState } from "@/app/_components/page-header";
import { Pagination } from "@/app/_components/pagination";
import { buildMeta, getPageInfo } from "@/lib/pagination";
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
  type ReportSeverity,
} from "@/lib/diagnostics";
import { prisma } from "@/lib/prisma";
import { FilterSelect } from "@/app/_components/list-filters";

export const metadata = {
  title: "Оношилгооны тайлангууд",
};

const SEVERITY_VALUES: ReportSeverity[] = ["BAD", "WARN", "GOOD"];

function isSeverity(v: string | undefined): v is ReportSeverity {
  return !!v && (SEVERITY_VALUES as string[]).includes(v);
}

export default async function ReportsListPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; severity?: string }>;
}) {
  const user = await requireUser();
  // Энгийн багц (ганц салбар): «Салбар» баганыг нууна.
  const { hideBranches } = await getBranchVisibility(user);

  const { page: pageParam, severity: severityParam } = await searchParams;
  const severity = isSeverity(severityParam) ? severityParam : undefined;
  const scopeBranchId = workingBranchScopeId(user);
  const where = {
    tenantId: user.tenantId,
    ...(scopeBranchId ? { branchId: scopeBranchId } : {}),
    ...(severity ? { maxSeverity: severity } : {}),
  };
  const { page, pageSize, skip, take } = getPageInfo(pageParam);
  const [reports, total] = await Promise.all([
    prisma.diagnosticReport.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take,
      include: {
        template: { select: { name: true, type: true } },
        customer: { select: { fullName: true, phone: true } },
        vehicle: { select: { plate: true, make: true, model: true } },
        branch: { select: { name: true } },
        filledBy: { select: { firstName: true, lastName: true } },
        order: { select: { number: true, status: true } },
      },
    }),
    prisma.diagnosticReport.count({ where }),
  ]);
  const meta = buildMeta(total, page, pageSize);

  return (
    <div className="p-4 sm:p-6 max-w-full flex-1 flex flex-col min-h-0 w-full">
      <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-[var(--oc-ink)]">Оношилгооны тайлангууд</h1>
          <p className="text-sm text-[var(--oc-muted3)] mt-1">
            Бөглөгдсөн оношилгооны тайлангуудын жагсаалт · {total} тайлан
          </p>
        </div>
        <div className="flex items-center gap-2">
          <FilterSelect
            paramName="severity"
            placeholder="Бүх түвшин"
            options={SEVERITY_VALUES.map((v) => ({
              value: v,
              label: SEVERITY_LABEL[v],
            }))}
          />
          <AddLinkButton href="/dashboard/diagnostics/new">Шинэ тайлан</AddLinkButton>
        </div>
      </div>

      {reports.length === 0 ? (
        <EmptyState
          title="Тайлан алга байна"
          description="Шинэ оношилгоо хийж эхлээрэй. Машин, үйлчлүүлэгчээ сонгож, загвараа бөглөнө."
          cta={
            <AddLinkButton href="/dashboard/diagnostics/new">Эхний тайлан үүсгэх</AddLinkButton>
          }
        />
      ) : (
        <div className="rounded-[10px] border border-[var(--oc-line)] bg-[var(--oc-panel)] overflow-hidden flex-1 min-h-0 flex flex-col">
          <div className="overflow-auto flex-1 min-h-0">
            <table className="w-full min-w-[800px]">
              <thead>
                <tr className="border-b border-[var(--oc-line)]">
                  {[
                    "Огноо",
                    "Загвар",
                    "Түвшин",
                    "Үйлчлүүлэгч",
                    "Машин",
                    "Салбар",
                    "Бөглөсөн",
                    "Засварын хуудас",
                  ]
                    .filter((h) => !(hideBranches && h === "Салбар"))
                    .map((h) => (
                    <th
                      key={h}
                      className="text-left font-plex-mono text-[10.5px] uppercase tracking-[0.08em] text-[var(--oc-muted3)] font-medium px-5 py-3"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--oc-line)]">
                {reports.map((r) => {
                  const tp = r.template.type as DiagnosticType;
                  return (
                    <ClickableRow key={r.id} href={`/dashboard/diagnostics/reports/${r.id}`}>
                      <td className="px-5 py-3 font-plex-mono text-xs text-[var(--oc-muted3)] whitespace-nowrap">
                        {r.createdAt.toLocaleString("mn-MN", {
                          year: "numeric",
                          month: "short",
                          day: "2-digit",
                          hour: "2-digit",
                          minute: "2-digit",
                          hour12: false,
                        })}
                      </td>
                      <td className="px-5 py-3">
                        <div className="flex flex-col gap-1">
                          <span
                            className={`text-[10px] self-start px-2 py-0.5 rounded-full ${DIAGNOSTIC_TYPE_BADGE[tp]}`}
                          >
                            {DIAGNOSTIC_TYPE_LABEL[tp]}
                          </span>
                          <span className="text-sm text-[var(--oc-ink)]">
                            {r.template.name}
                          </span>
                        </div>
                      </td>
                      <td className="px-5 py-3">
                        {r.maxSeverity ? (
                          <span
                            className={`text-[10px] px-2 py-0.5 rounded-full border ${SEVERITY_BADGE[r.maxSeverity as ReportSeverity]}`}
                          >
                            {SEVERITY_LABEL[r.maxSeverity as ReportSeverity]}
                          </span>
                        ) : (
                          <span className="text-[var(--oc-muted4)] text-xs">—</span>
                        )}
                      </td>
                      <td className="px-5 py-3 text-sm text-[var(--oc-muted2)]">
                        {customerLabel(r.customer)}
                      </td>
                      <td className="px-5 py-3 text-sm">
                        <div className="text-[var(--oc-muted2)]">
                          {r.vehicle.make} {r.vehicle.model}
                        </div>
                        <div className="font-plex-mono text-xs text-[var(--oc-muted3)]">
                          {r.vehicle.plate}
                        </div>
                      </td>
                      {hideBranches ? null : (
                        <td className="px-5 py-3 text-sm text-[var(--oc-muted2)]">
                          {r.branch.name}
                        </td>
                      )}
                      <td className="px-5 py-3 text-sm text-[var(--oc-muted2)]">
                        {r.filledBy
                          ? `${r.filledBy.lastName} ${r.filledBy.firstName}`
                          : "—"}
                      </td>
                      <td className="px-5 py-3 font-plex-mono text-sm text-[var(--oc-muted2)]">
                        {r.order ? (
                          <span className="inline-flex items-center gap-1.5">
                            #{r.order.number}
                            {r.order.status === "CANCELLED" ? (
                              <span className="font-sans text-[9px] px-1.5 py-0.5 rounded-full bg-white/[0.06] text-[var(--oc-muted2)] border border-[var(--oc-line2)] light:bg-zinc-100 light:border-zinc-300 light:text-zinc-600">
                                Цуцлагдсан
                              </span>
                            ) : null}
                          </span>
                        ) : (
                          "—"
                        )}
                      </td>
                    </ClickableRow>
                  );
                })}
              </tbody>
            </table>
          </div>
          <Pagination
            page={meta.page}
            totalPages={meta.totalPages}
            total={meta.total}
            params={{ severity }}
          />
        </div>
      )}
    </div>
  );
}
