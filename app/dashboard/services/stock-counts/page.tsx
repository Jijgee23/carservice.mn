import Link from "next/link";
import { redirect } from "next/navigation";
import { Chip, btnClass } from "@/app/_components/landing-ops-ui";
import { EmptyState } from "@/app/_components/page-header";
import { Pagination } from "@/app/_components/pagination";
import { requireUser } from "@/lib/auth";
import { canEdit, canView } from "@/lib/auth/roles";
import { formatTugrik } from "@/lib/orders";
import { prisma } from "@/lib/prisma";
import { STOCK_COUNT_STATUS_LABEL, STOCK_COUNT_STATUS_TONE, listStockCounts, personName, stockCountLabel } from "@/lib/stock-counts";
import { StartCountButton } from "./start-count-button";

export const metadata = { title: "Тооллого — Үйлчилгээ" };

function fmtDateTime(d: Date | null): string {
  if (!d) return "—";
  return d.toLocaleString("mn-MN", { timeZone: "Asia/Ulaanbaatar", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
}

const th = "font-plex-mono text-[10.5px] uppercase tracking-[0.08em] text-[var(--oc-muted3)] font-medium px-4 py-3 whitespace-nowrap";
const td = "px-4 py-3 text-sm text-[var(--oc-ink2)]";
const tdR = `${td} text-right tabular-nums whitespace-nowrap`;

/** Тооллогын түүх + шинээр эхлүүлэх. */
export default async function StockCountsPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const user = await requireUser();
  if (!canView(user, "services")) redirect("/dashboard");
  const page = Math.max(1, Number.parseInt((await searchParams).page ?? "1", 10) || 1);
  const mayCount = canEdit(user, "services");

  const [{ rows, total, totalPages, draft }, categories] = await Promise.all([
    listStockCounts(user.tenantId, page),
    mayCount
      ? prisma.category.findMany({
          where: { tenantId: user.tenantId, services: { some: { type: "GOODS", isActive: true } } },
          orderBy: { name: "asc" },
          select: { id: true, name: true, _count: { select: { services: { where: { type: "GOODS", isActive: true } } } } },
        })
      : Promise.resolve([]),
  ]);

  return (
    <div className="p-4 sm:p-6 max-w-full flex-1 flex flex-col min-h-0 w-full">
      <div className="mb-5 flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-[var(--oc-ink)]">Сэлбэг барааны тооллого</h1>
          <p className="text-sm text-[var(--oc-muted3)] mt-1">Бодит үлдэгдлийг тоолж системийн үлдэгдэлтэй тулгана. Дуусгахад зөрүүгээр үлдэгдэл засагдана.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link href="/dashboard/reports/stock" className={btnClass("ghost", "md", "shrink-0")}>
            Үлдэгдлийн тайлан
          </Link>
          {draft ? (
            <Link href={`/dashboard/services/stock-counts/${draft.id}`} className={btnClass("primary", "md", "shrink-0")}>
              {stockCountLabel(draft.number)} үргэлжлүүлэх
            </Link>
          ) : mayCount ? (
            <StartCountButton categories={categories.map((c) => ({ id: c.id, name: c.name, goodsCount: c._count.services }))} />
          ) : null}
        </div>
      </div>

      {rows.length === 0 ? (
        <EmptyState title="Тооллого хийгээгүй байна" description={mayCount ? "«Тооллого эхлүүлэх» дарж эхний тооллогоо хийнэ үү." : "Тооллогын түүх энд харагдана."} />
      ) : (
        <div className="rounded-[10px] border border-[var(--oc-line)] bg-[var(--oc-panel)] overflow-hidden flex-1 min-h-0 flex flex-col">
          <div className="overflow-auto flex-1 min-h-0">
            <table className="w-full min-w-[960px]">
              <thead>
                <tr className="border-b border-[var(--oc-line)]">
                  <th className={`${th} text-left`}>Дугаар</th>
                  <th className={`${th} text-left`}>Төлөв</th>
                  <th className={`${th} text-left`}>Хамрах хүрээ</th>
                  <th className={`${th} text-left`}>Эхэлсэн</th>
                  <th className={`${th} text-left`}>Дууссан</th>
                  <th className={`${th} text-right`}>Тоолсон</th>
                  <th className={`${th} text-right`}>Зөрүүтэй</th>
                  <th className={`${th} text-right`}>Дутагдал</th>
                  <th className={`${th} text-right`}>Илүүдэл</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--oc-line)]">
                {rows.map((r) => {
                  const done = r.status === "COMPLETED";
                  return (
                    <tr key={r.id} className="hover:bg-white/[0.02]">
                      <td className={td}>
                        <Link href={`/dashboard/services/stock-counts/${r.id}`} className="font-medium text-[var(--oc-ink)] hover:text-[var(--oc-accent)]">
                          {stockCountLabel(r.number)}
                        </Link>
                        {r.note ? <div className="text-xs text-[var(--oc-muted4)] max-w-[16rem] truncate">{r.note}</div> : null}
                      </td>
                      <td className={td}>
                        <Chip tone={STOCK_COUNT_STATUS_TONE[r.status]}>{STOCK_COUNT_STATUS_LABEL[r.status]}</Chip>
                      </td>
                      <td className={td}>{r.categoryName ?? "Бүх бараа"}</td>
                      <td className={`${td} whitespace-nowrap`}>
                        {fmtDateTime(r.createdAt)}
                        <div className="text-xs text-[var(--oc-muted4)]">{personName(r.createdBy)}</div>
                      </td>
                      <td className={`${td} whitespace-nowrap`}>
                        {done ? fmtDateTime(r.completedAt) : r.status === "CANCELLED" ? fmtDateTime(r.cancelledAt) : "—"}
                        {done ? <div className="text-xs text-[var(--oc-muted4)]">{personName(r.completedBy)}</div> : null}
                      </td>
                      <td className={tdR}>{done ? `${r.countedCount} / ${r.lineCount}` : `— / ${r.lineCount}`}</td>
                      <td className={tdR}>{done ? r.diffCount : "—"}</td>
                      <td className={`${tdR} ${done && Number(r.shortageValue) ? "text-red-400 light:text-red-600" : ""}`}>{done ? formatTugrik(r.shortageValue.toString()) : "—"}</td>
                      <td className={`${tdR} ${done && Number(r.surplusValue) ? "text-[var(--oc-ok)]" : ""}`}>{done ? formatTugrik(r.surplusValue.toString()) : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <Pagination page={page} totalPages={totalPages} total={total} />
        </div>
      )}
    </div>
  );
}
