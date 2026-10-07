import Link from "next/link";
import { redirect } from "next/navigation";
import { Prisma } from "@/app/generated/prisma/client";
import { Chip } from "@/app/_components/landing-ops-ui";
import { FilterSelect, ResetFilters } from "@/app/_components/list-filters";
import { EmptyState } from "@/app/_components/page-header";
import { Pagination } from "@/app/_components/pagination";
import { requireUser } from "@/lib/auth";
import { hasPermission } from "@/lib/auth/roles";
import { effectiveBranchScope } from "@/lib/cash/scope";
import { bookingDateKey } from "@/lib/booking-time";
import { CashError } from "@/lib/cash/rules";
import { getCurrentSession, listSessions } from "@/lib/cash/session";
import { formatTugrik } from "@/lib/orders";
import { prisma } from "@/lib/prisma";
import { CashRangeFilter } from "../cash-range-filter";
import { methodRowLabel, sessionTotals, withCashRow } from "./method-breakdown";
import { CloseSessionButton, OpenSessionButton } from "./session-dialogs";

export const metadata = {
  title: "Кассын ээлж",
};

type SearchParams = {
  dateFrom?: string;
  dateTo?: string;
  branchId?: string;
  status?: string;
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

/** Total takings of a shift: income summed over every method (CASH row synthesised when there are no cash entries). */
function totalIncome(s: Parameters<typeof withCashRow>[0]): string {
  return withCashRow(s).reduce((sum, r) => sum.plus(r.income), new Prisma.Decimal(0)).toString();
}

function diffClass(difference: string | null): string {
  const n = Number(difference ?? 0);
  if (!Number.isFinite(n) || n === 0) return "text-[var(--oc-ink)]";
  return n > 0 ? "text-[var(--oc-ok)]" : "text-red-400 light:text-red-600";
}

function fmtDiff(difference: string | null): string {
  if (difference == null) return "—";
  const n = Number(difference);
  return `${n > 0 ? "+" : ""}${formatTugrik(difference)}`;
}

export default async function CashSessionsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const user = await requireUser();
  if (!hasPermission(user, "cash.manage")) redirect("/dashboard");
  const sp = await searchParams;

  // Same range contract as the other cash lists: explicit dateFrom/dateTo or range=all; otherwise default to this month.
  const today = bookingDateKey(new Date());
  const hasRange = sp.dateFrom !== undefined || sp.dateTo !== undefined || sp.range === "all";
  if (!hasRange) {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(sp)) if (typeof v === "string" && v) qs.set(k, v);
    qs.set("dateFrom", `${today.slice(0, 8)}01`);
    qs.set("dateTo", today);
    redirect(`/dashboard/cash/sessions?${qs.toString()}`);
  }
  const dateFrom = sp.dateFrom ?? "";
  const dateTo = sp.dateTo ?? "";
  const pageNum = Math.max(1, Number.parseInt(sp.page ?? "1", 10) || 1);
  // Server-pinned scope ignores ?branchId, so the selector is only for all-branch users.
  const scopeBranchId = effectiveBranchScope(user, undefined);
  const status = sp.status === "OPEN" || sp.status === "CLOSED" ? sp.status : null;

  const branches = await prisma.branch.findMany({
    where: { tenantId: user.tenantId, isActive: true, ...(scopeBranchId ? { id: scopeBranchId } : {}) },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });
  const [result, currents] = await Promise.all([
    listSessions({
      actor: user,
      filters: { from: dateFrom || null, to: dateTo || null, branchId: sp.branchId || null, status },
      skip: (pageNum - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }).catch((error: unknown) => {
      // A hand-edited ?dateFrom=2026-02-31 must show a message, not the error boundary.
      if (error instanceof CashError && error.code === "CASH_DATE_INVALID") return null;
      throw error;
    }),
    Promise.all(branches.map((b) => getCurrentSession({ actor: user, branchId: b.id }))),
  ]);
  if (!result) {
    return (
      <div className="p-4 sm:p-6 max-w-full flex-1 flex flex-col min-h-0 w-full">
        <EmptyState title="Огноо буруу байна" description="Шүүлтүүрийн огноог YYYY-MM-DD хэлбэрээр зөв оруулна уу." />
      </div>
    );
  }
  const rows = result.sessions;
  const totalPages = Math.max(1, Math.ceil(result.total / PAGE_SIZE));

  return (
    <div className="p-4 sm:p-6 max-w-full flex-1 flex flex-col min-h-0 w-full">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-[var(--oc-ink)]">Кассын ээлж</h1>
        <p className="text-sm text-[var(--oc-muted3)] mt-1">
          Салбар бүрт нэг удаад нэг ээлж нээлттэй байна. Ээлж нээлттэй үед бүртгэсэн бүх төлбөрийн аргын (бэлэн, карт, данс, QPay) бичлэг тухайн ээлжид хамаарна.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 mb-6">
        {branches.map((b, i) => {
          const s = currents[i];
          const totals = s ? sessionTotals(s) : null;
          return (
            <div key={b.id} className="rounded-[10px] border border-[var(--oc-line)] bg-[var(--oc-panel)] p-4 flex flex-col gap-3">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-[var(--oc-ink)]">{b.name}</span>
                  {s ? <Chip tone="ok">Нээлттэй</Chip> : <Chip tone="neutral">Хаалттай</Chip>}
                </div>
                {s ? (
                  <CloseSessionButton sessionId={s.id} />
                ) : (
                  <OpenSessionButton branchId={b.id} branchName={b.name} />
                )}
              </div>
              {s ? (
                <>
                  <p className="text-xs text-[var(--oc-muted3)]">
                    Нээсэн: {s.openedBy?.name ?? "—"} · {fmtDateTime(s.openedAt)}
                    {s.note ? ` · ${s.note}` : ""}
                  </p>
                  {totals ? (
                    <dl className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
                      <div>
                        <dt className="text-xs text-[var(--oc-muted3)]">Нийт орлого</dt>
                        <dd className="tabular-nums text-[var(--oc-ink)]">{formatTugrik(totals.income)}</dd>
                      </div>
                      <div>
                        <dt className="text-xs text-[var(--oc-muted3)]">Нийт зарлага</dt>
                        <dd className="tabular-nums text-[var(--oc-ink)]">{formatTugrik(totals.expense)}</dd>
                      </div>
                      <div>
                        <dt className="text-xs text-[var(--oc-muted3)]">Цэвэр</dt>
                        <dd className="tabular-nums font-semibold text-[var(--oc-ink)]">{formatTugrik(totals.net)}</dd>
                      </div>
                      <div>
                        <dt className="text-xs text-[var(--oc-muted3)]">Бичлэг</dt>
                        <dd className="tabular-nums text-[var(--oc-ink)]">{totals.count}</dd>
                      </div>
                    </dl>
                  ) : null}
                  <div className="text-xs font-semibold text-[var(--oc-ink2)] -mb-1">Бэлэн мөнгө</div>
                  <dl className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
                    <div>
                      <dt className="text-xs text-[var(--oc-muted3)]">Эхний үлдэгдэл</dt>
                      <dd className="tabular-nums text-[var(--oc-ink)]">{formatTugrik(s.openingCash)}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-[var(--oc-muted3)]">Бэлэн орлого</dt>
                      <dd className="tabular-nums text-[var(--oc-ink)]">{formatTugrik(s.cashIn)}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-[var(--oc-muted3)]">Бэлэн зарлага</dt>
                      <dd className="tabular-nums text-[var(--oc-ink)]">{formatTugrik(s.cashOut)}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-[var(--oc-muted3)]">Тооцоолсон үлдэгдэл</dt>
                      <dd className="tabular-nums font-semibold text-[var(--oc-ink)]">{formatTugrik(s.expectedCash)}</dd>
                    </div>
                  </dl>
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-xs text-[var(--oc-muted3)]">
                        <th className="text-left font-normal py-1">Арга</th>
                        <th className="text-right font-normal py-1">Орлого</th>
                        <th className="text-right font-normal py-1">Зарлага</th>
                        <th className="text-right font-normal py-1">Цэвэр</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--oc-line)]">
                      {withCashRow(s).map((r) => (
                        <tr key={`${r.method}:${r.bank ?? ""}`}>
                          <td className="py-1 text-[var(--oc-ink2)]">{methodRowLabel(r)}</td>
                          <td className="py-1 text-right tabular-nums text-[var(--oc-ink)]">{formatTugrik(r.income)}</td>
                          <td className="py-1 text-right tabular-nums text-[var(--oc-ink)]">{formatTugrik(r.expense)}</td>
                          <td className="py-1 text-right tabular-nums text-[var(--oc-ink)]">{formatTugrik(r.net)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <Link
                    href={`/dashboard/cash/sessions/${s.id}`}
                    className="text-sm text-[var(--oc-accent)] hover:text-[var(--oc-accent-hi)] transition-colors self-start"
                  >
                    Дэлгэрэнгүй ({s.totalEntryCount ?? 0} бичлэг)
                  </Link>
                </>
              ) : (
                <p className="text-sm text-[var(--oc-muted3)]">Касс нээгдээгүй байна.</p>
              )}
            </div>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-4">
        <CashRangeFilter />
        {scopeBranchId ? null : (
          <FilterSelect paramName="branchId" placeholder="Бүх салбар" options={branches.map((b) => ({ value: b.id, label: b.name }))} />
        )}
        <FilterSelect
          paramName="status"
          placeholder="Бүх төлөв"
          options={[
            { value: "OPEN", label: "Нээлттэй" },
            { value: "CLOSED", label: "Хаагдсан" },
          ]}
        />
        <ResetFilters paramNames={["dateFrom", "dateTo", "range", "branchId", "status"]} />
      </div>

      {rows.length === 0 ? (
        <>
          <EmptyState title="Ээлж олдсонгүй" description="Шүүлтүүрээ өөрчилж үзнэ үү." />
          {/* ?page beyond the last page: keep the pager so the user can navigate back. */}
          {result.total > 0 ? (
            <Pagination
              page={pageNum}
              totalPages={totalPages}
              total={result.total}
              params={{ dateFrom: dateFrom || undefined, dateTo: dateTo || undefined, range: sp.range, branchId: sp.branchId, status: sp.status }}
            />
          ) : null}
        </>
      ) : (
        <div className="rounded-[10px] border border-[var(--oc-line)] bg-[var(--oc-panel)] overflow-hidden flex-1 min-h-0 flex flex-col">
          <div className="px-5 py-3 border-b border-[var(--oc-line)] font-plex-mono text-xs text-[var(--oc-muted3)]">
            Нийт {result.total.toLocaleString("mn-MN")} ээлж · {pageNum}/{totalPages} хуудас
          </div>
          <div className="overflow-auto flex-1 min-h-0">
            <table className="w-full min-w-[1100px]">
              <thead>
                <tr className="border-b border-[var(--oc-line)]">
                  {["Нээсэн", "Хаасан", "Салбар", "Нээсэн ажилтан", "Эхний", "Нийт орлого", "Тооцоолсон", "Тоолсон", "Зөрүү", "Төлөв", ""].map((h, i) => (
                    <th
                      key={`${h}-${i}`}
                      className={`font-plex-mono text-[10.5px] uppercase tracking-[0.08em] text-[var(--oc-muted3)] font-medium px-4 py-3 ${
                        ["Эхний", "Нийт орлого", "Тооцоолсон", "Тоолсон", "Зөрүү"].includes(h) ? "text-right" : "text-left"
                      }`}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--oc-line)]">
                {rows.map((r) => {
                  const closed = r.status === "CLOSED";
                  return (
                    <tr key={r.id} className="hover:bg-white/[0.02] transition-colors">
                      <td className="px-4 py-3 font-plex-mono text-xs text-[var(--oc-muted2)] whitespace-nowrap">{fmtDateTime(r.openedAt)}</td>
                      <td className="px-4 py-3 font-plex-mono text-xs text-[var(--oc-muted2)] whitespace-nowrap">
                        {r.closedAt ? fmtDateTime(r.closedAt) : "—"}
                      </td>
                      <td className="px-4 py-3 text-sm text-[var(--oc-ink2)]">{r.branch.name}</td>
                      <td className="px-4 py-3 text-sm text-[var(--oc-ink2)]">{r.openedBy?.name ?? "—"}</td>
                      <td className="px-4 py-3 text-right text-sm tabular-nums text-[var(--oc-ink)] whitespace-nowrap">{formatTugrik(r.openingCash)}</td>
                      <td className="px-4 py-3 text-right text-sm tabular-nums text-[var(--oc-ink)] whitespace-nowrap">{formatTugrik(totalIncome(r))}</td>
                      <td className="px-4 py-3 text-right text-sm tabular-nums text-[var(--oc-ink)] whitespace-nowrap">{formatTugrik(r.expectedCash)}</td>
                      <td className="px-4 py-3 text-right text-sm tabular-nums text-[var(--oc-ink)] whitespace-nowrap">
                        {closed ? formatTugrik(r.countedCash) : "—"}
                      </td>
                      <td className={`px-4 py-3 text-right text-sm tabular-nums whitespace-nowrap ${diffClass(r.difference)}`}>
                        {closed ? fmtDiff(r.difference) : "—"}
                      </td>
                      <td className="px-4 py-3 text-sm">{closed ? <Chip tone="neutral">Хаагдсан</Chip> : <Chip tone="ok">Нээлттэй</Chip>}</td>
                      <td className="px-4 py-3 text-right">
                        <Link
                          href={`/dashboard/cash/sessions/${r.id}`}
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
              status: sp.status,
            }}
          />
        </div>
      )}
    </div>
  );
}
