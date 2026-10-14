import Link from "next/link";
import { redirect } from "next/navigation";
import { DateRangeFilter, FilterSelect, ResetFilters, SearchBox } from "@/app/_components/list-filters";
import { btnClass } from "@/app/_components/landing-ops-ui";
import { EmptyState } from "@/app/_components/page-header";
import { requireUser } from "@/lib/auth";
import { canView, workingBranchScopeId } from "@/lib/auth/roles";
import { formatTugrik } from "@/lib/orders";
import { fmt, parseRange, validateReportRangeParams } from "@/lib/reports";
import { LOW_STOCK_THRESHOLD, STOCK_BADGE, STOCK_LABEL, formatStock, type StockLevel } from "@/lib/services";
import { STOCK_REPORT_LEVELS, STOCK_REPORT_SORTS, loadStockReport, type StockReportSort } from "@/lib/stock-report";

export const metadata = {
  title: "Сэлбэг барааны үлдэгдэл",
};

type SearchParams = {
  q?: string;
  categoryId?: string;
  level?: string;
  inactive?: string;
  sort?: string;
  from?: string;
  to?: string;
};

const SORT_LABEL: Record<StockReportSort, string> = {
  name: "Нэрээр",
  stock: "Үлдэгдэл (багаас)",
  value: "Үлдэгдлийн өртөг (ихээс)",
  used: "Зарцуулалт (ихээс)",
};

const card = "rounded-[10px] border border-[var(--oc-line)] bg-[var(--oc-panel)] px-4 py-3";
const th = "font-plex-mono text-[10.5px] uppercase tracking-[0.08em] text-[var(--oc-muted3)] font-medium px-4 py-3 whitespace-nowrap";
const td = "px-4 py-2.5 text-sm text-[var(--oc-ink2)]";
const tdR = `${td} text-right tabular-nums whitespace-nowrap`;

export default async function StockReportPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const user = await requireUser();
  if (!canView(user, "services")) redirect("/dashboard/reports");
  const sp = await searchParams;

  const rawRange = { from: sp.from || undefined, to: sp.to || undefined };
  const invalid = validateReportRangeParams(rawRange);
  const range = parseRange(invalid ? {} : rawRange);
  const level = (STOCK_REPORT_LEVELS as readonly string[]).includes(sp.level ?? "") ? (sp.level as StockLevel) : null;
  const sort = (STOCK_REPORT_SORTS as readonly string[]).includes(sp.sort ?? "") ? (sp.sort as StockReportSort) : "name";
  const includeInactive = sp.inactive === "1";

  const report = await loadStockReport(user.tenantId, {
    q: sp.q,
    categoryId: sp.categoryId || null,
    level,
    includeInactive,
    sort,
    from: range.from,
    to: range.to,
    branchId: workingBranchScopeId(user),
  });
  const { rows, totals } = report;

  const exportQs = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) if (typeof v === "string" && v) exportQs.set(k, v);
  exportQs.set("from", fmt(range.from));
  exportQs.set("to", fmt(range.to));
  const exportHref = `/dashboard/reports/stock/export?${exportQs.toString()}`;

  const cards: Array<{ label: string; value: string; hint?: string; tone?: string }> = [
    { label: "Бараа", value: totals.items.toLocaleString("mn-MN") },
    {
      label: "Үлдэгдлийн өртөг",
      value: formatTugrik(totals.stockCost),
      hint: totals.missingCostCount > 0 ? `${totals.missingCostCount} бараа өртөггүй — тооцоонд ороогүй` : undefined,
    },
    { label: "Зарах үнээр", value: formatTugrik(totals.stockRetail) },
    { label: "Дууссан", value: totals.outCount.toLocaleString("mn-MN"), tone: totals.outCount ? "text-red-400 light:text-red-600" : undefined },
    { label: `Бага (< ${LOW_STOCK_THRESHOLD})`, value: totals.lowCount.toLocaleString("mn-MN"), tone: totals.lowCount ? "text-[var(--oc-warn)]" : undefined },
    { label: "Хугацаанд зарцуулсан", value: formatTugrik(totals.usedAmount) },
  ];

  return (
    <div className="p-4 sm:p-6 max-w-full flex-1 flex flex-col min-h-0 w-full">
      <div className="mb-6 flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-[var(--oc-ink)]">Сэлбэг барааны үлдэгдэл</h1>
          <p className="text-sm text-[var(--oc-muted3)] mt-1">
            Үлдэгдэл — одоогийн байдлаар (бүх салбарт нэг нөөц). Зарцуулалт — {range.label}, засварын хуудсанд нэмэгдсэн (цуцлагдсаныг
            оруулаагүй).
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 self-start">
          <Link href="/dashboard/services/stock-counts" className={btnClass("ghost", "sm", "shrink-0")}>
            Тооллого
          </Link>
          <a href={exportHref} className={btnClass("ghost", "sm", "shrink-0")}>
            Excel татах
          </a>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-4">
        <SearchBox placeholder="Нэр, код..." className="w-56" />
        <FilterSelect paramName="categoryId" placeholder="Бүх ангилал" options={report.categories.map((c) => ({ value: c.id, label: c.name }))} />
        <FilterSelect
          paramName="level"
          placeholder="Бүх төлөв"
          options={STOCK_REPORT_LEVELS.map((l) => ({ value: l, label: STOCK_LABEL[l] }))}
        />
        <FilterSelect paramName="inactive" placeholder="Идэвхтэй бараа" options={[{ value: "1", label: "Идэвхгүйг оруулах" }]} />
        <FilterSelect
          paramName="sort"
          placeholder={SORT_LABEL.name}
          allowClear={false}
          options={STOCK_REPORT_SORTS.map((s) => ({ value: s, label: SORT_LABEL[s] }))}
        />
        <DateRangeFilter fromParam="from" toParam="to" label="Зарцуулалт" />
        <ResetFilters paramNames={["q", "categoryId", "level", "inactive", "sort", "from", "to"]} />
      </div>

      {invalid ? <p className="mb-4 text-sm text-red-400 light:text-red-600">{invalid.message}</p> : null}

      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3 mb-4">
        {cards.map((c) => (
          <div key={c.label} className={card}>
            <div className="text-xs text-[var(--oc-muted3)]">{c.label}</div>
            <div className={`text-lg font-semibold tabular-nums ${c.tone ?? "text-[var(--oc-ink)]"}`}>{c.value}</div>
            {c.hint ? <div className="text-[11px] text-[var(--oc-muted4)] mt-0.5">{c.hint}</div> : null}
          </div>
        ))}
      </div>

      {rows.length === 0 ? (
        <EmptyState title="Бараа олдсонгүй" description="Шүүлтүүрээ өөрчилж үзнэ үү эсвэл Үйлчилгээ → Сэлбэг/Бараа хэсэгт бараа нэмнэ үү." />
      ) : (
        <div className="rounded-[10px] border border-[var(--oc-line)] bg-[var(--oc-panel)] overflow-hidden flex-1 min-h-0 flex flex-col">
          <div className="overflow-auto flex-1 min-h-0">
            <table className="w-full min-w-[1080px]">
              <thead>
                <tr className="border-b border-[var(--oc-line)]">
                  <th className={`${th} text-left`}>Код</th>
                  <th className={`${th} text-left`}>Нэр</th>
                  <th className={`${th} text-left`}>Ангилал</th>
                  <th className={`${th} text-right`}>Үлдэгдэл</th>
                  <th className={`${th} text-right`}>Өртөг</th>
                  <th className={`${th} text-right`}>Зарах үнэ</th>
                  <th className={`${th} text-right`}>Үлдэгдлийн өртөг</th>
                  <th className={`${th} text-right`}>Зарах үнээр</th>
                  <th className={`${th} text-right`}>Зарцуулсан</th>
                  <th className={`${th} text-right`}>Зарцуулсан дүн</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--oc-line)]">
                {rows.map((r) => (
                  <tr key={r.id} className={`hover:bg-white/[0.02] ${r.isActive ? "" : "opacity-60"}`}>
                    <td className={`${td} font-plex-mono text-xs text-[var(--oc-muted2)]`}>{r.code ?? "—"}</td>
                    <td className={td}>
                      <Link href={`/dashboard/services/${r.id}`} className="text-[var(--oc-ink)] hover:text-[var(--oc-accent)]">
                        {r.name}
                      </Link>
                      {r.isActive ? null : <span className="ml-1.5 text-xs text-[var(--oc-muted4)]">(идэвхгүй)</span>}
                    </td>
                    <td className={td}>{r.category ?? "—"}</td>
                    <td className={tdR}>
                      <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${STOCK_BADGE[r.level]}`} title={STOCK_LABEL[r.level]}>
                        {formatStock(r.stock, r.unit)}
                      </span>
                    </td>
                    <td className={tdR}>{r.costPrice == null ? <span className="text-[var(--oc-muted4)]">—</span> : formatTugrik(r.costPrice)}</td>
                    <td className={tdR}>{formatTugrik(r.price)}</td>
                    <td className={`${tdR} text-[var(--oc-ink)]`}>{r.stockCost == null ? <span className="text-[var(--oc-muted4)]">—</span> : formatTugrik(r.stockCost)}</td>
                    <td className={tdR}>{formatTugrik(r.stockRetail)}</td>
                    <td className={tdR}>{Number(r.usedQty) ? formatStock(r.usedQty, r.unit) : "—"}</td>
                    <td className={tdR}>{Number(r.usedAmount) ? formatTugrik(r.usedAmount) : "—"}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-[var(--oc-line)] bg-[var(--oc-panel2)]">
                  <td colSpan={6} className="px-4 py-3 text-xs text-[var(--oc-muted3)]">
                    Нийт {totals.items} бараа (шүүлтүүрийн дагуу). Хасах үлдэгдэл өртөгт 0-ээр тооцогдоно.
                  </td>
                  <td className={`${tdR} font-semibold text-[var(--oc-ink)]`}>{formatTugrik(totals.stockCost)}</td>
                  <td className={`${tdR} font-semibold text-[var(--oc-ink)]`}>{formatTugrik(totals.stockRetail)}</td>
                  <td className={tdR} />
                  <td className={`${tdR} font-semibold text-[var(--oc-ink)]`}>{formatTugrik(totals.usedAmount)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
