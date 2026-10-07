import Link from "next/link";
import { redirect } from "next/navigation";
import { Chip } from "@/app/_components/landing-ops-ui";
import { FilterSelect, ResetFilters } from "@/app/_components/list-filters";
import { EmptyState } from "@/app/_components/page-header";
import { Pagination } from "@/app/_components/pagination";
import { requireUser } from "@/lib/auth";
import { canCreate, hasPermission } from "@/lib/auth/roles";
import { bookingDateKey } from "@/lib/booking-time";
import { listCashEntries } from "@/lib/cash/ledger";
import { effectiveBranchScope } from "@/lib/cash/scope";
import { CashError } from "@/lib/cash/rules";
import { listCashTypes, serializeCashType } from "@/lib/cash/types";
import { ORDER_PAYMENT_METHOD_LABEL, formatTugrik } from "@/lib/orders";
import { prisma } from "@/lib/prisma";
import { getTenantBanks } from "@/lib/tenant-banks";
import { CashRangeFilter } from "./cash-range-filter";
import { CashCreateButton } from "./cash-entry-dialog";
import { openSessionBranchIds } from "./open-sessions";
import { CashVoidButton } from "./cash-void-dialog";
import { NoOpenSessionNotice } from "./session-warning";

export type CashListSearchParams = {
  dateFrom?: string;
  dateTo?: string;
  branchId?: string;
  typeId?: string;
  method?: string;
  bank?: string;
  voided?: string;
  /** "outside" -> «Ээлжээс гадуур» (any method, no session). */
  session?: string;
  range?: string;
  page?: string;
};

const PAGE_SIZE = 50;
const FILTER_METHODS = ["CASH", "BANK_TRANSFER", "CARD", "QPAY", "OTHER"];

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

/** Shared income / expense list (server component). */
export async function CashListPage({
  direction,
  searchParams,
}: {
  direction: "INCOME" | "EXPENSE";
  searchParams: Promise<CashListSearchParams>;
}) {
  const user = await requireUser();
  if (!hasPermission(user, "cash.manage")) redirect("/dashboard");
  const isIncome = direction === "INCOME";
  const sp = await searchParams;

  // The URL always carries an explicit range (dateFrom/dateTo or range=all). With none, redirect to this month
  // (Asia/Ulaanbaatar business days) so the picker shows it; clearing the dates yields range=all (all time).
  const today = bookingDateKey(new Date());
  const hasRange = sp.dateFrom !== undefined || sp.dateTo !== undefined || sp.range === "all";
  if (!hasRange) {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(sp)) if (typeof v === "string" && v) qs.set(k, v);
    qs.set("dateFrom", `${today.slice(0, 8)}01`);
    qs.set("dateTo", today);
    redirect(`/dashboard/cash/${isIncome ? "income" : "expense"}?${qs.toString()}`);
  }
  const dateFrom = sp.dateFrom ?? "";
  const dateTo = sp.dateTo ?? "";
  const pageNum = Math.max(1, Number.parseInt(sp.page ?? "1", 10) || 1);
  const includeVoided = sp.voided === "1";
  const outsideSession = sp.session === "outside";
  const scopeBranchId = effectiveBranchScope(user, undefined);

  // One branch query feeds the filter, the create dialogs and the open-session lookup below.
  const branchesPromise = (async () =>
    prisma.branch.findMany({
      where: { tenantId: user.tenantId, ...(scopeBranchId ? { id: scopeBranchId } : {}) },
      orderBy: { name: "asc" },
      select: { id: true, name: true, isActive: true },
    }))();
  const [result, typeRows, branches, tenantBanks, openBranchIds] = await Promise.all([
    listCashEntries({
      actor: user,
      filters: {
        from: dateFrom || null,
        to: dateTo || null,
        branchId: sp.branchId || null,
        direction,
        typeId: sp.typeId || null,
        // «Ээлжээс гадуур» covers every method now, so it combines freely with the method filter.
        method: FILTER_METHODS.includes(sp.method ?? "") ? sp.method : null,
        outsideSession,
        bank: sp.bank || null,
        includeVoided,
      },
      skip: (pageNum - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }).catch((error: unknown) => {
      // A hand-edited ?dateFrom=2026-02-31 must show a message, not the error boundary.
      if (error instanceof CashError && error.code === "CASH_DATE_INVALID") return null;
      throw error;
    }),
    listCashTypes({ actor: user, direction, includeInactive: true }),
    branchesPromise,
    getTenantBanks(user.tenantId),
    branchesPromise.then((rows) => openSessionBranchIds(user.tenantId, rows.map((r) => r.id))),
  ]);

  if (!result) {
    return (
      <div className="p-4 sm:p-6 max-w-full flex-1 flex flex-col min-h-0 w-full">
        <EmptyState title="Огноо буруу байна" description="Шүүлтүүрийн огноог YYYY-MM-DD хэлбэрээр зөв оруулна уу." />
      </div>
    );
  }
  const types = typeRows.map(serializeCashType);
  const entries = result.entries;
  const totalPages = Math.max(1, Math.ceil(result.total / PAGE_SIZE));
  const totalAmount = isIncome ? result.totals.income : result.totals.expense;
  const totalCount = isIncome ? result.totals.incomeCount : result.totals.expenseCount;
  const title = isIncome ? "орлого" : "зарлага";
  // The ledger rejects inactive branches: offer only active ones in the create dialogs (the filter keeps all).
  const activeBranches = branches.filter((b) => b.isActive);
  const defaultBranchId = activeBranches.find((b) => b.id === scopeBranchId)?.id ?? activeBranches[0]?.id ?? "";
  const paginationParams = {
    dateFrom: dateFrom || undefined,
    dateTo: dateTo || undefined,
    range: sp.range,
    branchId: sp.branchId,
    typeId: sp.typeId,
    method: sp.method,
    bank: sp.bank,
    voided: sp.voided,
    session: sp.session,
  };
  // One notice per page (not per row) when a listed entry's branch has no open register.
  const hasClosedRegisterRow = entries.some((e) => !e.isSystem && e.voidedAt == null && !openBranchIds.includes(e.branch.id));
  const bankLabelByCode = new Map(tenantBanks.banks.map((b) => [b.code, b.label] as const));

  return (
    <div className="p-4 sm:p-6 max-w-full flex-1 flex flex-col min-h-0 w-full">
      <div className="mb-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-[var(--oc-ink)]">Кассын {title}</h1>
          <p className="text-sm text-[var(--oc-muted3)] mt-1">
            {isIncome
              ? "Төлбөрийн орлого автоматаар бүртгэгдэнэ; бусад орлогыг гараар нэмнэ."
              : "Дотоод засварын зардал автоматаар бүртгэгдэнэ; бусад зардлыг гараар нэмнэ."}
          </p>
        </div>
        <CashCreateButton
          direction={direction}
          types={types.filter((t) => t.isActive && !t.isSystem).map((t) => ({ id: t.id, name: t.name }))}
          branches={activeBranches.map((b) => ({ id: b.id, name: b.name }))}
          defaultBranchId={defaultBranchId}
          banks={tenantBanks.enabledBanks.map((code) => ({ code, label: bankLabelByCode.get(code) ?? code }))}
          today={today}
          openBranchIds={openBranchIds}
          branchPinned={Boolean(scopeBranchId)}
          canRecordOrderPayments={isIncome && canCreate(user, "payments")}
        />
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
          paramName="typeId"
          placeholder="Бүх ангилал"
          options={types.map((t) => ({ value: t.id, label: t.isActive ? t.name : `${t.name} (идэвхгүй)` }))}
        />
        <FilterSelect
          paramName="method"
          placeholder="Бүх арга"
          options={FILTER_METHODS.map((m) => ({ value: m, label: ORDER_PAYMENT_METHOD_LABEL[m] ?? m }))}
        />
        <FilterSelect
          paramName="bank"
          placeholder="Бүх банк"
          options={tenantBanks.banks.map((b) => ({ value: b.code, label: b.label }))}
        />
        <FilterSelect
          paramName="session"
          placeholder="Бүх ээлж"
          options={[{ value: "outside", label: "Ээлжээс гадуур" }]}
        />
        <FilterSelect
          paramName="voided"
          placeholder="Хүчингүйг нуух"
          options={[{ value: "1", label: "Хүчингүйг харуулах" }]}
        />
        <ResetFilters paramNames={["dateFrom", "dateTo", "range", "branchId", "typeId", "method", "bank", "voided", "session"]} />
      </div>

      <div className="grid grid-cols-2 gap-3 mb-4 max-w-md">
        <div className="rounded-[10px] border border-[var(--oc-line)] bg-[var(--oc-panel)] px-4 py-3">
          <div className="text-xs text-[var(--oc-muted3)]">Нийт {title}</div>
          <div className="text-lg font-semibold tabular-nums text-[var(--oc-ink)]">{formatTugrik(totalAmount)}</div>
        </div>
        <div className="rounded-[10px] border border-[var(--oc-line)] bg-[var(--oc-panel)] px-4 py-3">
          <div className="text-xs text-[var(--oc-muted3)]">Бичлэгийн тоо</div>
          <div className="text-lg font-semibold tabular-nums text-[var(--oc-ink)]">{totalCount}</div>
        </div>
      </div>

      {hasClosedRegisterRow ? <NoOpenSessionNotice className="mb-3" /> : null}

      {entries.length === 0 ? (
        <>
          <EmptyState title="Бичлэг олдсонгүй" description="Шүүлтүүрээ өөрчилж үзнэ үү эсвэл шинэ бичлэг нэмнэ үү." />
          {/* ?page beyond the last page: keep the pager so the user can navigate back. */}
          {result.total > 0 ? <Pagination page={pageNum} totalPages={totalPages} total={result.total} params={paginationParams} /> : null}
        </>
      ) : (
        <div className="rounded-[10px] border border-[var(--oc-line)] bg-[var(--oc-panel)] overflow-hidden flex-1 min-h-0 flex flex-col">
          <div className="px-5 py-3 border-b border-[var(--oc-line)] font-plex-mono text-xs text-[var(--oc-muted3)]">
            Нийт {result.total.toLocaleString("mn-MN")} бичлэг · {pageNum}/{totalPages} хуудас
          </div>
          <div className="overflow-auto flex-1 min-h-0">
            <table className="w-full min-w-[1100px]">
              <thead>
                <tr className="border-b border-[var(--oc-line)]">
                  {["Огноо", "Ангилал", "Салбар", "Дүн", "Арга", "Харилцагч", "Тайлбар", "Хавсралт", "Бүртгэсэн", ""].map(
                    (h, i) => (
                      <th
                        key={`${h}-${i}`}
                        className={`font-plex-mono text-[10.5px] uppercase tracking-[0.08em] text-[var(--oc-muted3)] font-medium px-4 py-3 ${
                          h === "Дүн" ? "text-right" : "text-left"
                        }`}
                      >
                        {h || <span className="sr-only">Үйлдэл</span>}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--oc-line)]">
                {entries.map((e) => {
                  const voided = e.voidedAt != null;
                  return (
                    <tr key={e.id} className={`hover:bg-white/[0.02] transition-colors ${voided ? "opacity-60" : ""}`}>
                      <td className="px-4 py-3 font-plex-mono text-xs text-[var(--oc-muted2)] whitespace-nowrap">
                        {fmtDateTime(e.occurredAt)}
                      </td>
                      <td className="px-4 py-3 text-sm text-[var(--oc-ink2)]">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span>{e.type.name}</span>
                          {e.isSystem ? <Chip tone="neutral">Систем</Chip> : null}
                          {voided ? <Chip tone="danger">Хүчингүй</Chip> : null}
                        </div>
                        {voided ? (
                          <div className="text-xs text-[var(--oc-muted4)] mt-1">
                            {e.voidReason}
                            {e.voidedBy ? ` · ${e.voidedBy.name}` : ""}
                          </div>
                        ) : null}
                      </td>
                      <td className="px-4 py-3 text-sm text-[var(--oc-ink2)]">{e.branch.name}</td>
                      <td className="px-4 py-3 text-right text-sm tabular-nums text-[var(--oc-ink)] whitespace-nowrap">
                        <span className={voided ? "line-through" : ""}>{formatTugrik(e.amount)}</span>
                        {e.taxIncluded ? (
                          <div className="text-xs text-[var(--oc-muted4)]">Татвар (туршилт): {formatTugrik(e.taxIncluded)}</div>
                        ) : null}
                      </td>
                      <td className="px-4 py-3 text-sm text-[var(--oc-ink2)] whitespace-nowrap">
                        {e.methodLabel}
                        {e.bankLabel ? <span className="text-[var(--oc-muted4)]"> · {e.bankLabel}</span> : null}
                        {e.method === "CASH" && e.sessionId ? (
                          <div>
                            <Link
                              href={`/dashboard/cash/sessions/${e.sessionId}`}
                              className="text-xs text-[var(--oc-accent)] hover:text-[var(--oc-accent-hi)] transition-colors"
                            >
                              Ээлж
                            </Link>
                          </div>
                        ) : null}
                        {e.method === "CASH" && !e.sessionId ? (
                          <div className="mt-0.5">
                            <Chip tone="warn">Ээлжээс гадуур</Chip>
                          </div>
                        ) : null}
                      </td>
                      <td className="px-4 py-3 text-sm text-[var(--oc-ink2)]">
                        {e.customer?.name ?? e.counterparty ?? "—"}
                        {e.orderId ? (
                          <div>
                            <Link
                              href={`/dashboard/orders/${e.orderId}`}
                              className="text-xs text-[var(--oc-accent)] hover:text-[var(--oc-accent-hi)] transition-colors"
                            >
                              {e.orderNumber ? `Захиалга #${e.orderNumber}` : "Захиалга"}
                            </Link>
                          </div>
                        ) : null}
                        {e.settlementId ? (
                          <div>
                            <Link
                              href={`/dashboard/cash/settlements/${e.settlementId}`}
                              className="text-xs text-[var(--oc-accent)] hover:text-[var(--oc-accent-hi)] transition-colors"
                            >
                              Нэгдсэн тооцоо
                            </Link>
                          </div>
                        ) : null}
                      </td>
                      <td className="px-4 py-3 text-sm text-[var(--oc-ink2)] max-w-[16rem] break-words">{e.note ?? "—"}</td>
                      <td className="px-4 py-3 text-sm">
                        {e.attachmentPath ? (
                          <a
                            href={e.attachmentPath}
                            target="_blank"
                            rel="noreferrer"
                            className="text-[var(--oc-accent)] hover:text-[var(--oc-accent-hi)] transition-colors"
                          >
                            Харах
                          </a>
                        ) : (
                          <span className="text-[var(--oc-muted4)]">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-sm text-[var(--oc-ink2)] whitespace-nowrap">
                        {e.isSystem ? "—" : (e.createdBy?.name ?? "—")}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {!e.isSystem && !voided ? <CashVoidButton entryId={e.id} locked={e.locked} sessionOpen={openBranchIds.includes(e.branch.id)} hideNotice /> : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t border-[var(--oc-line)] bg-[var(--oc-panel2)]">
                  <td colSpan={3} className="px-4 py-3 text-xs text-[var(--oc-muted3)]">
                    Нийт (хүчингүй болон «Татвар (туршилт)»-гүйгээр, шүүлтүүрийн дагуу)
                  </td>
                  <td className="px-4 py-3 text-right text-sm font-semibold tabular-nums text-[var(--oc-ink)] whitespace-nowrap">
                    {formatTugrik(totalAmount)}
                  </td>
                  <td colSpan={6} />
                </tr>
              </tfoot>
            </table>
          </div>
          <Pagination
            page={pageNum}
            totalPages={totalPages}
            total={result.total}
            params={paginationParams}
          />
        </div>
      )}
    </div>
  );
}
