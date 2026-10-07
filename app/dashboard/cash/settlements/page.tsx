import Link from "next/link";
import { redirect } from "next/navigation";
import { Chip } from "@/app/_components/landing-ops-ui";
import { FilterSelect, ResetFilters } from "@/app/_components/list-filters";
import { EmptyState } from "@/app/_components/page-header";
import { Pagination } from "@/app/_components/pagination";
import { requireUser } from "@/lib/auth";
import { hasPermission } from "@/lib/auth/roles";
import { effectiveBranchScope } from "@/lib/cash/scope";
import { bookingDateKey } from "@/lib/booking-time";
import { listSettlements } from "@/lib/cash/settlement";
import { formatTugrik } from "@/lib/orders";
import { prisma } from "@/lib/prisma";
import { orgRegnumLabel } from "@/lib/customers";
import { CashRangeFilter } from "../cash-range-filter";

export const metadata = {
  title: "Тооцоо нийлэлт",
};

type SearchParams = {
  dateFrom?: string;
  dateTo?: string;
  branchId?: string;
  customerId?: string;
  voided?: string;
  range?: string;
  page?: string;
};

const PAGE_SIZE = 50;

function fmtDateTime(iso: string): string {
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

export default async function SettlementsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const user = await requireUser();
  if (!hasPermission(user, "cash.manage")) redirect("/dashboard");
  const sp = await searchParams;

  // Same range contract as the cash lists: explicit dateFrom/dateTo or range=all; otherwise default to this month.
  const today = bookingDateKey(new Date());
  const hasRange = sp.dateFrom !== undefined || sp.dateTo !== undefined || sp.range === "all";
  if (!hasRange) {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(sp)) if (typeof v === "string" && v) qs.set(k, v);
    qs.set("dateFrom", `${today.slice(0, 8)}01`);
    qs.set("dateTo", today);
    redirect(`/dashboard/cash/settlements?${qs.toString()}`);
  }
  const dateFrom = sp.dateFrom ?? "";
  const dateTo = sp.dateTo ?? "";
  const pageNum = Math.max(1, Number.parseInt(sp.page ?? "1", 10) || 1);
  // Server-pinned scope ignores ?branchId: no selector (and no branches query) for pinned users.
  const scopeBranchId = effectiveBranchScope(user, undefined);

  const [result, branches, customers] = await Promise.all([
    listSettlements({
      actor: user,
      filters: {
        from: dateFrom || null,
        to: dateTo || null,
        branchId: sp.branchId || null,
        customerId: sp.customerId || null,
        includeVoided: sp.voided === "1",
      },
      skip: (pageNum - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    scopeBranchId
      ? Promise.resolve([] as { id: string; name: string }[])
      : prisma.branch.findMany({
          where: { tenantId: user.tenantId },
          orderBy: { name: "asc" },
          select: { id: true, name: true },
        }),
    prisma.customer.findMany({
      where: { tenantId: user.tenantId, postpaidSettlements: { some: {} } },
      orderBy: { fullName: "asc" },
      take: 500,
      select: { id: true, fullName: true, orgName: true, isOrganization: true, orgRegnum: true },
    }),
  ]);
  const rows = result.settlements;
  const totalPages = Math.max(1, Math.ceil(result.total / PAGE_SIZE));

  return (
    <div className="p-4 sm:p-6 max-w-full flex-1 flex flex-col min-h-0 w-full">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-[var(--oc-ink)]">Тооцоо нийлэлт</h1>
        <p className="text-sm text-[var(--oc-muted3)] mt-1">
          Дараа төлбөрт захиалгуудыг нэг удаагийн төлбөрөөр нийлүүлсэн тооцоо. Шинэ тооцоог «Дараа төлбөрт» хуудаснаас бүртгэнэ.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-4">
        <CashRangeFilter />
        {scopeBranchId ? null : (
          <FilterSelect
            paramName="branchId"
            placeholder="Бүх салбар"
            options={branches.map((b) => ({ value: b.id, label: b.name }))}
          />
        )}
        <FilterSelect
          paramName="customerId"
          placeholder="Бүх үйлчлүүлэгч"
          searchable
          options={customers.map((c) => ({
            value: c.id,
            label: c.isOrganization && c.orgName ? c.orgName : c.fullName,
            hint: orgRegnumLabel(c) ?? undefined,
          }))}
        />
        <FilterSelect
          paramName="voided"
          placeholder="Хүчингүйг нуух"
          options={[{ value: "1", label: "Хүчингүйг харуулах" }]}
        />
        <ResetFilters paramNames={["dateFrom", "dateTo", "range", "branchId", "customerId", "voided"]} />
      </div>

      {rows.length === 0 ? (
        <EmptyState title="Тооцоо олдсонгүй" description="Шүүлтүүрээ өөрчилж үзнэ үү." />
      ) : (
        <div className="rounded-[10px] border border-[var(--oc-line)] bg-[var(--oc-panel)] overflow-hidden flex-1 min-h-0 flex flex-col">
          <div className="px-5 py-3 border-b border-[var(--oc-line)] font-plex-mono text-xs text-[var(--oc-muted3)]">
            Нийт {result.total.toLocaleString("mn-MN")} тооцоо · {pageNum}/{totalPages} хуудас
          </div>
          <div className="overflow-auto flex-1 min-h-0">
            <table className="w-full min-w-[900px]">
              <thead>
                <tr className="border-b border-[var(--oc-line)]">
                  {["Огноо", "Үйлчлүүлэгч", "Салбар", "Захиалга", "Дүн", "Арга", "Төлөв", ""].map((h, i) => (
                    <th
                      key={`${h}-${i}`}
                      className={`font-plex-mono text-[10.5px] uppercase tracking-[0.08em] text-[var(--oc-muted3)] font-medium px-4 py-3 ${
                        h === "Дүн" ? "text-right" : "text-left"
                      }`}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--oc-line)]">
                {rows.map((r) => {
                  const voided = r.voidedAt != null;
                  return (
                    <tr key={r.id} className={`hover:bg-white/[0.02] transition-colors ${voided ? "opacity-60" : ""}`}>
                      <td className="px-4 py-3 font-plex-mono text-xs text-[var(--oc-muted2)] whitespace-nowrap">
                        {fmtDateTime(r.occurredAt)}
                      </td>
                      <td className="px-4 py-3 text-sm text-[var(--oc-ink2)]">{r.customer.name}</td>
                      <td className="px-4 py-3 text-sm text-[var(--oc-ink2)]">{r.branch.name}</td>
                      <td className="px-4 py-3 text-sm text-[var(--oc-ink2)] tabular-nums">{r.orderCount}</td>
                      <td className="px-4 py-3 text-right text-sm tabular-nums text-[var(--oc-ink)] whitespace-nowrap">
                        <span className={voided ? "line-through" : ""}>{formatTugrik(r.amount)}</span>
                      </td>
                      <td className="px-4 py-3 text-sm text-[var(--oc-ink2)] whitespace-nowrap">
                        {r.methodLabel}
                        {r.bankLabel ? <span className="text-[var(--oc-muted4)]"> · {r.bankLabel}</span> : null}
                      </td>
                      <td className="px-4 py-3 text-sm">
                        <div className="flex flex-wrap items-center gap-1.5">
                          {voided ? <Chip tone="danger">Хүчингүй</Chip> : null}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Link
                          href={`/dashboard/cash/settlements/${r.id}`}
                          className="text-sm text-[var(--oc-accent)] hover:text-[var(--oc-accent-hi)] transition-colors"
                        >
                          Дэлгэрэнгүй
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <Pagination
            page={pageNum}
            totalPages={totalPages}
            total={result.total}
            params={{
              dateFrom: dateFrom || undefined,
              dateTo: dateTo || undefined,
              range: sp.range,
              branchId: sp.branchId,
              customerId: sp.customerId,
              voided: sp.voided,
            }}
          />
        </div>
      )}
    </div>
  );
}
