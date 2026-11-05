import Link from "next/link";
import { Prisma } from "@/app/generated/prisma/client";
import { FilterSelect, ResetFilters, SearchBox } from "@/app/_components/list-filters";
import { EmptyState, PageHeader } from "@/app/_components/page-header";
import { Pagination } from "@/app/_components/pagination";
import { requireSuperAdmin } from "@/lib/auth/system";
import { buildMeta, getPageInfo } from "@/lib/pagination";
import { formatPhone } from "@/lib/phone";
import { prisma } from "@/lib/prisma";
import { QUOTE_STATUS_LABEL, QUOTE_STATUS_VALUES, isQuoteStatus } from "@/lib/quote-requests";
import { QUOTE_STATUS_BADGE, fmtDateTime } from "./shared";

export const metadata = { title: "Үнийн саналын хүсэлт" };

export const dynamic = "force-dynamic";

type Search = { q?: string; status?: string; page?: string };

export default async function SystemQuoteRequestsPage({
  searchParams,
}: {
  searchParams: Promise<Search>;
}) {
  await requireSuperAdmin();
  const sp = await searchParams;
  const q = sp.q ?? "";
  const status = sp.status ?? "";
  const { page, pageSize, skip, take } = getPageInfo(sp.page);

  const where: Prisma.QuoteRequestWhereInput = {};
  if (isQuoteStatus(status)) where.status = status;
  if (q) {
    where.OR = [
      { orgName: { contains: q, mode: "insensitive" } },
      { contactName: { contains: q, mode: "insensitive" } },
      { phone: { contains: q.replace(/\D+/g, "") || q } },
      { email: { contains: q, mode: "insensitive" } },
    ];
  }

  const [rows, total] = await Promise.all([
    prisma.quoteRequest.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take,
      select: {
        id: true,
        orgName: true,
        contactName: true,
        phone: true,
        email: true,
        modules: true,
        status: true,
        createdAt: true,
        tenant: { select: { name: true } },
        _count: { select: { replies: { where: { ok: true } } } },
      },
    }),
    prisma.quoteRequest.count({ where }),
  ]);
  const meta = buildMeta(total, page, pageSize);

  return (
    <div className="p-4 sm:p-6 max-w-full flex-1 flex flex-col min-h-0 w-full">
      <PageHeader
        title="Үнийн саналын хүсэлт"
        description="Энтерпрайз багцын үнийн саналын хүсэлтүүд — хариу (SMS/имейл) илгээж, тохирсон үнээр subscription үүсгэнэ."
      />

      <div className="flex flex-wrap items-center gap-2 mb-4">
        <SearchBox placeholder="Байгууллага, нэр, утас, имейлээр хайх..." />
        <FilterSelect
          paramName="status"
          placeholder="Бүх төлөв"
          options={QUOTE_STATUS_VALUES.map((v) => ({ value: v, label: QUOTE_STATUS_LABEL[v] }))}
        />
        <ResetFilters paramNames={["q", "status"]} />
      </div>

      {rows.length === 0 ? (
        <EmptyState title="Хүсэлт алга" description="Энэ шүүлтэд тохирох үнийн саналын хүсэлт байхгүй байна." />
      ) : (
        <div className="rounded-[10px] border border-[var(--oc-line)] bg-[var(--oc-panel)] overflow-x-auto">
          <table className="w-full min-w-[920px]">
            <thead>
              <tr className="border-b border-[var(--oc-line2)]">
                {["Огноо", "Байгууллага", "Холбогдох", "Модуль", "Хариу", "Төлөв", ""].map((h) => (
                  <th key={h} className="text-left text-xs text-[var(--oc-muted4)] font-medium px-5 py-3">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-[var(--oc-line2)] last:border-0 hover:bg-white/[0.02]">
                  <td className="px-5 py-3 text-xs text-[var(--oc-muted)] tabular-nums whitespace-nowrap">
                    {fmtDateTime(r.createdAt)}
                  </td>
                  <td className="px-5 py-3 text-sm">
                    <Link href={`/system/quote-requests/${r.id}`} className="text-[var(--oc-ink2)] hover:underline">
                      {r.orgName}
                    </Link>
                    {r.tenant ? (
                      <div className="text-[11px] text-[var(--oc-muted3)]">Бүртгэлтэй: {r.tenant.name}</div>
                    ) : null}
                  </td>
                  <td className="px-5 py-3 text-sm text-[var(--oc-muted)]">
                    <div>{r.contactName}</div>
                    <div className="text-[11px] text-[var(--oc-muted3)] font-plex-mono">
                      {formatPhone(r.phone)}
                      {r.email ? ` · ${r.email}` : ""}
                    </div>
                  </td>
                  <td className="px-5 py-3 text-sm text-[var(--oc-muted)] tabular-nums">{r.modules.length}</td>
                  <td className="px-5 py-3 text-sm text-[var(--oc-muted)] tabular-nums">
                    {r._count.replies > 0 ? `${r._count.replies} илгээсэн` : "—"}
                  </td>
                  <td className="px-5 py-3">
                    <span className={`text-xs px-2.5 py-1 rounded-full ${QUOTE_STATUS_BADGE[r.status]}`}>
                      {QUOTE_STATUS_LABEL[r.status]}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-right">
                    <Link
                      href={`/system/quote-requests/${r.id}#reply`}
                      className="text-xs text-[var(--oc-accent)] hover:text-[var(--oc-accent-hi)] whitespace-nowrap"
                    >
                      Хариу илгээх →
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Pagination
        page={meta.page}
        totalPages={meta.totalPages}
        total={meta.total}
        params={{ q, status }}
        tone="danger"
      />
    </div>
  );
}
