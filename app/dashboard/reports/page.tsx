import Link from "next/link";
import { DatePicker } from "@/app/_components/date-picker";
import { Btn, StatCell, StatGrid, TabLink, btnClass } from "@/app/_components/landing-ops-ui";
import { requireUser } from "@/lib/auth";
import { workingBranchScopeId } from "@/lib/auth/roles";
import { formatDuration } from "@/lib/category-duration";
import { INTERNAL_COST_LABEL, ITEM_KIND_BADGE, ORDER_STATUS_BADGE, formatTugrik } from "@/lib/orders";
import { IncomeChart } from "../income-chart";
import { fmt, loadReportData, parseRange, type Range } from "./data";

export const metadata = {
  title: "Тайлан",
};

const QUICK_RANGES = [
  { key: "this-month", label: "Энэ сар" },
  { key: "last-month", label: "Өнгөрсөн сар" },
  { key: "last-30", label: "Сүүлийн 30 хоног" },
  { key: "this-year", label: "Энэ жил" },
] as const;

// Хурдан мужийн огнооны хил — buildQuickHref болон active илрүүлэлт хоёулаа
// нэг эх сурвалжаас авахын тулд нэг функцэд төвлөрүүлэв.
function quickBounds(key: string): { from: Date; to: Date } {
  const now = new Date();
  switch (key) {
    case "last-month": {
      const from = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const to = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);
      return { from, to };
    }
    case "last-30":
      return {
        from: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000),
        to: now,
      };
    case "this-year":
      return { from: new Date(now.getFullYear(), 0, 1), to: now };
    default:
      return { from: new Date(now.getFullYear(), now.getMonth(), 1), to: now };
  }
}

function buildQuickHref(key: (typeof QUICK_RANGES)[number]["key"]): string {
  if (key === "this-month") return "/dashboard/reports";
  const { from, to } = quickBounds(key);
  return `/dashboard/reports?from=${fmt(from)}&to=${fmt(to)}`;
}

// Одоогийн from/to параметр аль хурдан мужид яг тохирч байгааг тодорхойлно.
// (parseRange бүх custom мужийг "custom" болгодог тул active-ийг үүгээр илрүүлнэ.)
function activeQuickKey(params: { from?: string; to?: string }): string {
  if (!params.from && !params.to) return "this-month";
  for (const q of QUICK_RANGES) {
    if (q.key === "this-month") continue;
    const { from, to } = quickBounds(q.key);
    if (fmt(from) === params.from && fmt(to) === params.to) return q.key;
  }
  return "custom";
}

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const user = await requireUser();
  const params = await searchParams;
  const range: Range = parseRange(params);
  const activeKey = activeQuickKey(params);

  const data = await loadReportData(user, range, workingBranchScopeId(user));
  const {
    totalRevenue,
    internalCost,
    completedCount,
    avgTicket,
    activeCount,
    statusRows,
    kindRows,
    branchRows,
    techRows,
    customerRows,
    partRows,
    avgJobDurationMinutes,
    jobDurationRows,
    income,
  } = data;

  const totalInRange = statusRows.reduce((a, s) => a + s.count, 0);
  const maxBranchRevenue = branchRows[0]?.revenue ?? 1;
  const exportHref = `/dashboard/reports/export?from=${fmt(range.from)}&to=${fmt(range.to)}`;

  return (
    <div className="p-4 sm:p-6 max-w-full flex-1 flex flex-col min-h-0 w-full">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-[var(--oc-ink)]">Тайлан</h1>
        <p className="text-sm text-[var(--oc-muted3)] mt-1">
          {range.label} · {completedCount} дууссан засварын хуудас · {totalInRange} нийт
        </p>
      </div>

      <div className="flex items-center gap-2 flex-wrap mb-6">
        {QUICK_RANGES.map((q) => (
          <TabLink key={q.key} href={buildQuickHref(q.key)} active={activeKey === q.key}>
            {q.label}
          </TabLink>
        ))}

        <a href={exportHref} className={btnClass("ghost", "sm", "shrink-0")}>
          Excel татах
        </a>

        <Link href="/dashboard/cash/report" className={btnClass("ghost", "sm", "shrink-0")}>
          Мөнгөн гүйлгээний тайлан
        </Link>

        <form className="ml-auto flex items-center gap-2" action="/dashboard/reports">
          <DatePicker
            mode="range"
            fromName="from"
            toName="to"
            defaultValue={{
              from: params.from ?? fmt(range.from),
              to: params.to ?? fmt(range.to),
            }}
            className="w-[15rem]"
          />
          <Btn type="submit" size="sm" className="shrink-0">
            Хэрэгжүүлэх
          </Btn>
        </form>
      </div>

      <StatGrid cols={6}>
        <BigStat label="Нийт орлого" value={formatTugrik(totalRevenue)} tone="accent" />
        <BigStat label={INTERNAL_COST_LABEL} value={formatTugrik(internalCost)} />
        <StatCell label="Дууссан засварын хуудас" value={completedCount} />
        <BigStat label="Дундаж дүн" value={formatTugrik(avgTicket)} />
        <StatCell label="Идэвхтэй" value={activeCount} />
        <BigStat label="Дундаж гүйцэтгэх хугацаа" value={formatDuration(avgJobDurationMinutes)} />
      </StatGrid>

      <section className="rounded-[10px] border border-[var(--oc-line)] bg-[var(--oc-panel)] p-6 mb-6">
        <h2 className="font-semibold text-[var(--oc-ink)] mb-1">Орлогын хандлага</h2>
        <p className="text-xs text-[var(--oc-muted3)] mb-2">
          {range.label} — дууссан засварын хуудасны өдөр тутмын орлого.
        </p>
        <IncomeChart
          points={income.points}
          up={(income.changePct ?? 0) >= 0}
        />
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="rounded-[10px] border border-[var(--oc-line)] bg-[var(--oc-panel)] p-6">
          <h2 className="font-semibold text-[var(--oc-ink)] mb-1">Орлого — ажил, оношилгоо, сэлбэг</h2>
          <p className="text-xs text-[var(--oc-muted3)] mb-5">
            Дууссан засварын хуудасны мөрүүдийн хуваарилалт.
          </p>
          <div className="space-y-4">
            {kindRows.map((r) => (
              <div key={r.kind}>
                <div className="flex items-center justify-between mb-1.5">
                  <span
                    className={`text-xs px-2 py-0.5 rounded-full ${ITEM_KIND_BADGE[r.kind]}`}
                  >
                    {r.label}
                  </span>
                  <span className="font-plex-mono text-sm text-[var(--oc-ink2)]">
                    {formatTugrik(r.total)} · {r.pct}%
                  </span>
                </div>
                <div className="h-1.5 bg-white/[0.06] rounded-full overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-[var(--oc-accent)] to-[var(--oc-accent-hi)]"
                    style={{ width: `${r.pct}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-[10px] border border-[var(--oc-line)] bg-[var(--oc-panel)] p-6">
          <h2 className="font-semibold text-[var(--oc-ink)] mb-1">Засварын хуудасны статус</h2>
          <p className="text-xs text-[var(--oc-muted3)] mb-5">Сонгосон хугацааны нийт засварын хуудас.</p>
          <div className="space-y-2">
            {statusRows.map((s) => (
              <div key={s.status} className="flex items-center gap-3">
                <span
                  className={`text-xs px-2 py-0.5 rounded-full ${ORDER_STATUS_BADGE[s.status]} shrink-0`}
                >
                  {s.label}
                </span>
                <div className="flex-1 h-1.5 bg-white/[0.06] rounded-full overflow-hidden">
                  <div
                    className="h-full bg-white/30"
                    style={{ width: `${s.pct}%` }}
                  />
                </div>
                <span className="font-plex-mono text-sm text-[var(--oc-ink2)] tabular-nums shrink-0 w-14 text-right">
                  {s.count}
                </span>
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-[10px] border border-[var(--oc-line)] bg-[var(--oc-panel)] p-6">
          <h2 className="font-semibold text-[var(--oc-ink)] mb-1">Салбараар</h2>
          <p className="text-xs text-[var(--oc-muted3)] mb-5">Орлого ба засварын хуудасны тоо.</p>
          {branchRows.length === 0 ? (
            <p className="text-sm text-[var(--oc-muted3)] py-4 text-center">Өгөгдөл алга.</p>
          ) : (
            <div className="space-y-4">
              {branchRows.map((b) => {
                const pct = Math.round((b.revenue / (maxBranchRevenue || 1)) * 100);
                return (
                  <div key={b.id}>
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-sm font-medium text-[var(--oc-ink2)]">
                        {b.name}
                      </span>
                      <span className="font-plex-mono text-sm text-[var(--oc-muted2)]">
                        {formatTugrik(b.revenue)}{" "}
                        <span className="text-[var(--oc-muted4)]">· {b.count}</span>
                        {b.internalCost > 0 ? (
                          <span className="block text-right text-[11px] text-[var(--oc-muted4)]">
                            {INTERNAL_COST_LABEL}: {formatTugrik(b.internalCost)}
                          </span>
                        ) : null}
                      </span>
                    </div>
                    <div className="h-1.5 bg-white/[0.06] rounded-full overflow-hidden">
                      <div
                        className="h-full bg-gradient-to-r from-[var(--oc-accent)] to-[var(--oc-accent-hi)]"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        <section className="rounded-[10px] border border-[var(--oc-line)] bg-[var(--oc-panel)] p-6">
          <h2 className="font-semibold text-[var(--oc-ink)] mb-1">Мастер / Менежер</h2>
          <p className="text-xs text-[var(--oc-muted3)] mb-5">Хариуцсан засварын хуудасны орлого.</p>
          {techRows.length === 0 ? (
            <p className="text-sm text-[var(--oc-muted3)] py-4 text-center">Өгөгдөл алга.</p>
          ) : (
            <div className="space-y-4">
              {techRows.slice(0, 6).map((t) => {
                const max = techRows[0]?.revenue || 1;
                const pct = Math.round((t.revenue / max) * 100);
                return (
                  <div key={t.id}>
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-sm font-medium text-[var(--oc-ink2)]">
                        {t.name}
                      </span>
                      <span className="font-plex-mono text-sm text-[var(--oc-muted2)]">
                        {formatTugrik(t.revenue)}{" "}
                        <span className="text-[var(--oc-muted4)]">· {t.count}</span>
                        {t.internalCost > 0 ? (
                          <span className="block text-right text-[11px] text-[var(--oc-muted4)]">
                            {INTERNAL_COST_LABEL}: {formatTugrik(t.internalCost)}
                          </span>
                        ) : null}
                      </span>
                    </div>
                    <div className="h-1.5 bg-white/[0.06] rounded-full overflow-hidden">
                      <div
                        className="h-full bg-gradient-to-r from-[var(--oc-ok)] to-[var(--oc-accent-hi)]"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        <section className="rounded-[10px] border border-[var(--oc-line)] bg-[var(--oc-panel)] p-6">
          <h2 className="font-semibold text-[var(--oc-ink)] mb-1">Топ үйлчлүүлэгчид</h2>
          <p className="text-xs text-[var(--oc-muted3)] mb-5">Хамгийн их орлого авчирсан.</p>
          {customerRows.length === 0 ? (
            <p className="text-sm text-[var(--oc-muted3)] py-4 text-center">Өгөгдөл алга.</p>
          ) : (
            <ul className="divide-y divide-[var(--oc-line)]">
              {customerRows.map((c, i) => (
                <li key={c.id}>
                  <Link
                    href={`/dashboard/customers/${c.id}`}
                    className="flex items-center gap-3 py-3 hover:bg-white/[0.02] -mx-2 px-2 rounded-lg transition-colors"
                  >
                    <span className="font-plex-mono text-xs text-[var(--oc-muted4)] w-5 shrink-0">
                      #{i + 1}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-[var(--oc-ink)] truncate">
                        {c.name}
                      </div>
                      <div className="text-xs text-[var(--oc-muted4)]">
                        {c.count} засварын хуудас
                      </div>
                    </div>
                    <span className="font-plex-mono text-sm text-[var(--oc-ink2)] shrink-0">
                      {formatTugrik(c.revenue)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="rounded-[10px] border border-[var(--oc-line)] bg-[var(--oc-panel)] p-6">
          <h2 className="font-semibold text-[var(--oc-ink)] mb-1">Топ сэлбэгүүд</h2>
          <p className="text-xs text-[var(--oc-muted3)] mb-5">Хамгийн их орлоготой сэлбэг.</p>
          {partRows.length === 0 ? (
            <p className="text-sm text-[var(--oc-muted3)] py-4 text-center">Өгөгдөл алга.</p>
          ) : (
            <ul className="divide-y divide-[var(--oc-line)]">
              {partRows.map((p, i) => (
                <li key={p.id}>
                  <Link
                    href={`/dashboard/services/${p.id}`}
                    className="flex items-center gap-3 py-3 hover:bg-white/[0.02] -mx-2 px-2 rounded-lg transition-colors"
                  >
                    <span className="font-plex-mono text-xs text-[var(--oc-muted4)] w-5 shrink-0">
                      #{i + 1}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-[var(--oc-ink)] truncate">
                        {p.name}
                      </div>
                      <div className="font-plex-mono text-xs text-[var(--oc-muted4)]">
                        {p.sku}
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="font-plex-mono text-sm text-[var(--oc-ink2)]">
                        {formatTugrik(p.revenue)}
                      </div>
                      <div className="text-xs text-[var(--oc-muted3)]">
                        {p.qty.toLocaleString("mn-MN", {
                          maximumFractionDigits: 2,
                        })}{" "}
                        {p.unit}
                      </div>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="rounded-[10px] border border-[var(--oc-line)] bg-[var(--oc-panel)] p-6">
          <h2 className="font-semibold text-[var(--oc-ink)] mb-1">Ажлын гүйцэтгэх дундаж хугацаа</h2>
          <p className="text-xs text-[var(--oc-muted3)] mb-5">
            Эхэлсэн-дуусах цаг тэмдэглэгдсэн ажлуудаар (сэлбэгийн төрлөөр).
          </p>
          {jobDurationRows.length === 0 ? (
            <p className="text-sm text-[var(--oc-muted3)] py-4 text-center">Өгөгдөл алга.</p>
          ) : (
            <ul className="divide-y divide-[var(--oc-line)]">
              {jobDurationRows.map((j, i) => (
                <li key={j.id}>
                  <Link
                    href={`/dashboard/services/${j.id}`}
                    className="flex items-center gap-3 py-3 hover:bg-white/[0.02] -mx-2 px-2 rounded-lg transition-colors"
                  >
                    <span className="font-plex-mono text-xs text-[var(--oc-muted4)] w-5 shrink-0">
                      #{i + 1}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-[var(--oc-ink)] truncate">
                        {j.name}
                      </div>
                      <div className="text-xs text-[var(--oc-muted4)]">{j.count} удаа</div>
                    </div>
                    <span className="font-plex-mono text-sm text-[var(--oc-ink2)] shrink-0">
                      {formatDuration(j.avgMinutes)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

// `StatCell`-тэй ижил харагдацтай, гэхдээ (currency string, тоо биш) утга авна
// — `formatTugrik()`-ийн буцаах утга нь "1,234,000₮" маягийн бэлэн текст тул
// `StatCell`-ийн `value: number` төрөлд шууд оруулах боломжгүй.
function BigStat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "accent";
}) {
  return (
    <div className="bg-[var(--oc-panel)] p-4">
      <div className="font-plex-mono text-[10.5px] uppercase tracking-[0.1em] text-[var(--oc-muted3)]">
        {label}
      </div>
      <div
        className={`font-plex-mono text-2xl font-semibold mt-1 tabular-nums ${tone === "accent" ? "text-[var(--oc-accent)]" : "text-[var(--oc-ink)]"
          }`}
      >
        {value}
      </div>
    </div>
  );
}
