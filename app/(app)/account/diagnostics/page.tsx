import Link from "next/link";
import { redirect } from "next/navigation";
import { Prisma } from "@/app/generated/prisma/client";
import {
  BackLink,
  Chevron,
  DateTile,
  FilterBar,
  PageHero,
} from "@/app/(app)/_components/consumer-ui";
import { EmptyState } from "@/app/_components/empty-state";
import { requireAccount } from "@/lib/auth/account";
import {
  DIAGNOSTIC_TYPE_BADGE,
  DIAGNOSTIC_TYPE_LABEL,
  SEVERITY_BADGE,
  SEVERITY_LABEL,
  type DiagnosticType,
  type ReportSeverity,
} from "@/lib/diagnostics";
import { prisma } from "@/lib/prisma";
import { customerOwnershipFilters } from "@/lib/vehicles";
import { SearchBox } from "@/app/_components/list-filters";
import { YearChips } from "@/app/_components/segmented-filter";

export const metadata = {
  title: "Оношилгооны түүх",
};

export const dynamic = "force-dynamic";

function formatDate(d: Date): string {
  return d.toLocaleDateString("mn-MN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}

// Миний бүх машины оношилгооны тайлангийн түүх (cross-tenant) — эзэмшлийн
// машины БАТАЛГААЖСАН холбоос эсвэл account-той шууд холбоотой Customer-ийн
// тайлангууд. Зарчим `account/history`-тэй ижил (харах: тэнд байгаа тайлбар).
export default async function AccountDiagnosticsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; year?: string }>;
}) {
  const account = await requireAccount();
  const { q: rawQuery, year: rawYear } = await searchParams;
  const query = (rawQuery ?? "").trim();
  // "Бүх он" сонголт байхгүй — Түүхийн жилийн шүүлттэй ижил зарчим (харах:
  // account/history/page.tsx-ийн тайлбар).
  if (!rawYear) {
    const params = new URLSearchParams();
    if (rawQuery) params.set("q", rawQuery);
    params.set("year", String(new Date().getFullYear()));
    redirect(`/account/diagnostics?${params.toString()}`);
  }
  const parsedYear = Number.parseInt(rawYear, 10);
  const year = Number.isInteger(parsedYear) ? parsedYear : new Date().getFullYear();


  const ownershipWhere: Prisma.DiagnosticReportWhereInput = {
    OR: customerOwnershipFilters(account.id, account.phone),
  };

  // Шүүлтүүр — mobile-ийн Оношилгоо табтай ижил: текст хайлт (загвар, машин,
  // салбар), ноцтой байдал (maxSeverity), он (createdAt).
  const filters: Prisma.DiagnosticReportWhereInput[] = [];
  if (query) {
    filters.push({
      OR: [
        { template: { name: { contains: query, mode: "insensitive" } } },
        { branch: { name: { contains: query, mode: "insensitive" } } },
        { vehicle: { plate: { contains: query, mode: "insensitive" } } },
        { vehicle: { make: { contains: query, mode: "insensitive" } } },
        { vehicle: { model: { contains: query, mode: "insensitive" } } },
      ],
    });
  }
  filters.push({
    createdAt: { gte: new Date(year, 0, 1), lt: new Date(year + 1, 0, 1) },
  });

  const where: Prisma.DiagnosticReportWhereInput = filters.length
    ? { ...ownershipWhere, AND: filters }
    : ownershipWhere;

  const reports = await prisma.diagnosticReport.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: 100,
    select: {
      id: true,
      mileageAtReport: true,
      maxSeverity: true,
      createdAt: true,
      template: { select: { name: true, type: true } },
      vehicle: { select: { plate: true, make: true, model: true } },
      branch: { select: { name: true } },
    },
  });

  // Зөвхөн бодитоор тайлантай онууд (mobile-тай ижил).
  const reportDates = await prisma.diagnosticReport.findMany({
    where: ownershipWhere,
    select: { createdAt: true },
  });
  const availableYears = [
    ...new Set([year, ...reportDates.map((r) => r.createdAt.getFullYear())]),
  ].sort((a, b) => b - a);

  const hasFilter = Boolean(query);
  const vehicleCount = new Set(reports.map((r) => r.vehicle.plate)).size;
  const attentionCount = reports.filter((r) => r.maxSeverity === "WARN" || r.maxSeverity === "BAD").length;

  return (
    <div className="w-full flex flex-col gap-5">
      <BackLink href="/account">Миний захиалгууд</BackLink>

      <PageHero
        eyebrow={`${year} он`}
        title="Оношилгооны түүх"
        description="Таны машинд хийгдсэн бүх оношилгоо, үзлэгийн тайлан"
        stats={[
          { label: "Тайлан", value: reports.length },
          { label: "Машин", value: vehicleCount },
          { label: "Анхаарах", value: attentionCount, tone: attentionCount > 0 ? "warn" : undefined },
        ]}
      />

      {/* Шүүлтүүр — mobile-ийн Оношилгоо табтай ижил: хайлт + он (ноцтой
          байдлын шүүлт хассан — доор дэлгэрэнгүй хуудсанд тона тус бүрийн
          тоотой сегмент байгаа тул давхацна). */}
      <FilterBar>
        <SearchBox placeholder="Тайлан, машин, салбараар хайх" paramName="q" />
        <YearChips years={availableYears} showAll={false} />
      </FilterBar>

      {reports.length === 0 ? (
        <EmptyState>
          {hasFilter
            ? "Сонгосон нөхцөлд тохирох тайлан алга."
            : "Одоогоор оношилгооны тайлан алга. Үйлчилгээ хийгдэж, тайлан бөглөгдсөний дараа энд харагдана."}
        </EmptyState>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {reports.map((r) => {
            const tp = r.template.type as DiagnosticType;
            const sev = r.maxSeverity as ReportSeverity | null;
            return (
              <Link
                key={r.id}
                href={`/account/diagnostics/${r.id}`}
                className="group relative flex items-start gap-4 overflow-hidden rounded-2xl border border-[var(--oc-line)] bg-[var(--oc-panel)] p-4 shadow-sm transition-all hover:border-[var(--oc-accent)]/50 hover:shadow-md"
              >
                <span
                  aria-hidden
                  className={`absolute inset-y-0 left-0 w-1 ${
                    sev === "BAD" ? "bg-red-500" : sev === "WARN" ? "bg-amber-400" : sev === "GOOD" ? "bg-emerald-500" : "bg-[var(--oc-line)]"
                  }`}
                />
                <DateTile date={r.createdAt} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <span className="font-semibold leading-snug text-[var(--oc-ink)] group-hover:text-[var(--oc-accent)] transition-colors">
                      {r.template.name}
                    </span>
                    {sev ? (
                      <span className={`shrink-0 text-[11px] px-2 py-0.5 rounded-full border ${SEVERITY_BADGE[sev]}`}>
                        {SEVERITY_LABEL[sev]}
                      </span>
                    ) : null}
                  </div>
                  <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-[var(--oc-muted)]">
                    <span className="rounded-md border border-[var(--oc-line)] bg-[var(--oc-panel2)] px-1.5 py-px font-plex-mono text-xs font-semibold text-[var(--oc-ink2)]">
                      {r.vehicle.plate}
                    </span>
                    <span className="truncate">
                      {r.vehicle.make} {r.vehicle.model}
                    </span>
                  </div>
                  <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-[var(--oc-muted3)] tabular-nums">
                    <span className={`text-[11px] px-2 py-0.5 rounded-full ${DIAGNOSTIC_TYPE_BADGE[tp]}`}>
                      {DIAGNOSTIC_TYPE_LABEL[tp]}
                    </span>
                    <span>{r.branch.name}</span>
                    {r.mileageAtReport != null ? (
                      <span>· {r.mileageAtReport.toLocaleString("mn-MN")} км</span>
                    ) : null}
                    <span>· {formatDate(r.createdAt)}</span>
                  </div>
                </div>
                <div className="self-center">
                  <Chevron />
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
