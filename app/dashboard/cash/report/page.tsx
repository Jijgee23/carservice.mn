import { redirect } from "next/navigation";
import { DateRangeFilter, FilterSelect } from "@/app/_components/list-filters";
import { btnClass } from "@/app/_components/landing-ops-ui";
import { requireUser } from "@/lib/auth";
import { hasPermission } from "@/lib/auth/roles";
import { buildCashSummary, type CashReportTypeRow } from "@/lib/cash/report";
import { effectiveBranchScope } from "@/lib/cash/scope";
import { formatTugrik } from "@/lib/orders";
import { prisma } from "@/lib/prisma";
import { fmt, parseRange, validateReportRangeParams } from "@/lib/reports";

export const metadata = {
  title: "Мөнгөн гүйлгээний тайлан",
};

type SearchParams = { from?: string; to?: string; branchId?: string };

const MAX_DAYS = 366;
const DAY_MS = 24 * 60 * 60 * 1000;

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

function signedClass(value: string | null): string {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n) || n === 0) return "text-[var(--oc-ink)]";
  return n > 0 ? "text-[var(--oc-ok)]" : "text-red-400 light:text-red-600";
}

function fmtSigned(value: string | null): string {
  if (value == null) return "—";
  return `${Number(value) > 0 ? "+" : ""}${formatTugrik(value)}`;
}

const card = "rounded-[10px] border border-[var(--oc-line)] bg-[var(--oc-panel)] p-5";
const th = "px-3 py-2 text-left text-xs font-medium text-[var(--oc-muted3)] whitespace-nowrap";
const thR = `${th} text-right`;
const td = "px-3 py-2 text-sm text-[var(--oc-ink2)]";
const tdR = `${td} text-right tabular-nums font-plex-mono whitespace-nowrap`;

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className={card}>
      <h2 className="font-semibold text-[var(--oc-ink)]">{title}</h2>
      {hint ? <p className="text-xs text-[var(--oc-muted3)] mt-0.5">{hint}</p> : null}
      <div className="mt-3 overflow-x-auto">{children}</div>
    </section>
  );
}

function Empty() {
  return <p className="text-sm text-[var(--oc-muted3)] py-3 text-center">Өгөгдөл алга.</p>;
}

function TypeTable({ rows, total }: { rows: CashReportTypeRow[]; total: string }) {
  if (rows.length === 0) return <Empty />;
  return (
    <table className="w-full">
      <thead>
        <tr className="border-b border-[var(--oc-line)]">
          <th className={th}>Ангилал</th>
          <th className={thR}>Тоо</th>
          <th className={thR}>Дүн</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.typeId} className="border-b border-[var(--oc-line)]">
            <td className={td}>{r.name}</td>
            <td className={tdR}>{r.count}</td>
            <td className={tdR}>{formatTugrik(r.total)}</td>
          </tr>
        ))}
        <tr>
          <td className={`${td} font-semibold`}>Нийт</td>
          <td className={tdR} />
          <td className={`${tdR} font-semibold`}>{formatTugrik(total)}</td>
        </tr>
      </tbody>
    </table>
  );
}

export default async function CashReportPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const user = await requireUser();
  if (!hasPermission(user, "cash.manage")) redirect("/dashboard");
  const sp = await searchParams;

  const rawRange = { from: sp.from || undefined, to: sp.to || undefined };
  const invalid = validateReportRangeParams(rawRange);
  const range = parseRange(invalid ? {} : rawRange);
  // Same helper buildCashSummary uses: a pinned scope ignores any requested branch, so no selector for it.
  const pinnedBranchId = effectiveBranchScope(user, undefined);
  const branches = pinnedBranchId
    ? await prisma.branch.findMany({
        where: { tenantId: user.tenantId, id: pinnedBranchId },
        select: { id: true, name: true },
      })
    : await prisma.branch.findMany({
        where: { tenantId: user.tenantId, isActive: true },
        orderBy: { name: "asc" },
        select: { id: true, name: true },
      });

  // Зөвшөөрөгдсөн салбарт байхгүй branchId-г үл тооно (скоп доторх бүх салбар руу буцна).
  const branchId = !pinnedBranchId && branches.some((b) => b.id === sp.branchId) ? (sp.branchId as string) : null;
  const exportQs = new URLSearchParams({ from: fmt(range.from), to: fmt(range.to) });
  if (branchId) exportQs.set("branchId", branchId);
  const exportHref = `/dashboard/cash/report/export?${exportQs.toString()}`;

  const header = (
    <>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-[var(--oc-ink)]">Мөнгөн гүйлгээний тайлан</h1>
        <p className="text-sm text-[var(--oc-muted3)] mt-1">{range.label} · цуцлагдсан бичлэгийг оруулаагүй.</p>
      </div>
      <div className="flex flex-wrap items-center gap-2 mb-6">
        <DateRangeFilter fromParam="from" toParam="to" />
        {pinnedBranchId ? (
          <span className="text-sm text-[var(--oc-ink2)]">Салбар: {branches[0]?.name ?? "—"}</span>
        ) : (
          <FilterSelect
            paramName="branchId"
            placeholder="Бүх салбар"
            options={branches.map((b) => ({ value: b.id, label: b.name }))}
          />
        )}
        <a href={exportHref} className={btnClass("ghost", "sm", "shrink-0 ml-auto")}>
          Excel татах
        </a>
      </div>
    </>
  );

  if (invalid) {
    return (
      <div className="p-4 sm:p-6 max-w-full flex-1 flex flex-col min-h-0 w-full">
        {header}
        <p className="text-sm text-red-400 light:text-red-600">{invalid.message}</p>
      </div>
    );
  }

  if (range.to.getTime() - range.from.getTime() > MAX_DAYS * DAY_MS) {
    return (
      <div className="p-4 sm:p-6 max-w-full flex-1 flex flex-col min-h-0 w-full">
        {header}
        <p className="text-sm text-[var(--oc-muted3)]">Тайлангийн хугацаа {MAX_DAYS} хоногоос хэтрэхгүй байх ёстой.</p>
      </div>
    );
  }

  const s = await buildCashSummary({
    actor: user,
    from: range.from,
    to: range.to,
    branchId,
  });

  return (
    <div className="p-4 sm:p-6 max-w-full flex-1 flex flex-col min-h-0 w-full">
      {header}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <div className={card}>
          <div className="text-xs text-[var(--oc-muted3)]">Нийт орлого</div>
          <div className="mt-1 text-xl font-semibold tabular-nums text-[var(--oc-ink)]">{formatTugrik(s.totals.income)}</div>
        </div>
        <div className={card}>
          <div className="text-xs text-[var(--oc-muted3)]">Нийт зарлага</div>
          <div className="mt-1 text-xl font-semibold tabular-nums text-[var(--oc-ink)]">{formatTugrik(s.totals.expense)}</div>
        </div>
        <div className={card}>
          <div className="text-xs text-[var(--oc-muted3)]">Цэвэр дүн</div>
          <div className={`mt-1 text-xl font-semibold tabular-nums ${signedClass(s.totals.net)}`}>{fmtSigned(s.totals.net)}</div>
        </div>
        <div className={card}>
          <div className="text-xs text-[var(--oc-muted3)]">Бэлэн мөнгөний цэвэр хөдөлгөөн</div>
          <div className={`mt-1 text-xl font-semibold tabular-nums ${signedClass(s.netCash)}`}>{fmtSigned(s.netCash)}</div>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="lg:col-span-2">
          <Section title="Орлого — төлбөрийн аргаар">
            <table className="w-full">
              <thead>
                <tr className="border-b border-[var(--oc-line)]">
                  <th className={th}>Арга / банк</th>
                  <th className={thR}>Тоо</th>
                  <th className={thR}>Нийт</th>
                </tr>
              </thead>
              <tbody>
                {s.incomeByMethod.flatMap((m) => [
                  <tr key={m.method} className="border-b border-[var(--oc-line)]">
                    <td className={`${td} font-medium`}>{m.methodLabel}</td>
                    <td className={tdR}>{m.count}</td>
                    <td className={`${tdR} font-medium`}>{formatTugrik(m.total)}</td>
                  </tr>,
                  ...m.banks.map((b) => (
                    <tr key={`${m.method}:${b.bank ?? "none"}`} className="border-b border-[var(--oc-line)]">
                      <td className={`${td} pl-8`}>
                        {b.bankLabel}
                        {b.bank && b.bank !== b.bankLabel ? (
                          <span className="ml-1.5 text-xs text-[var(--oc-muted4)]">{b.bank}</span>
                        ) : null}
                      </td>
                      <td className={tdR}>{b.count}</td>
                      <td className={tdR}>{formatTugrik(b.total)}</td>
                    </tr>
                  )),
                ])}
              </tbody>
            </table>
          </Section>
        </div>

        <Section title="Орлого — ангиллаар">
          <TypeTable rows={s.incomeByType} total={s.totals.income} />
        </Section>

        <Section title="Зарлага — ангиллаар" hint="Дотоод засварын зардал тусдаа мөр.">
          <TypeTable rows={s.expenseByType} total={s.totals.expense} />
        </Section>

        <Section title="Зарлага — төлбөрийн аргаар">
          <table className="w-full">
            <thead>
              <tr className="border-b border-[var(--oc-line)]">
                <th className={th}>Арга</th>
                <th className={thR}>Тоо</th>
                <th className={thR}>Дүн</th>
              </tr>
            </thead>
            <tbody>
              {s.expenseByMethod.map((r) => (
                <tr key={r.method} className="border-b border-[var(--oc-line)] last:border-0">
                  <td className={td}>{r.methodLabel}</td>
                  <td className={tdR}>{r.count}</td>
                  <td className={tdR}>{formatTugrik(r.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>

        <Section title="Цэвэр дүн — төлбөрийн аргаар" hint="Орлого − зарлага. Бэлэн мөнгөний цэвэр дүн нь кассын хүлээгдэж буй хөдөлгөөн.">
          <table className="w-full">
            <thead>
              <tr className="border-b border-[var(--oc-line)]">
                <th className={th}>Арга</th>
                <th className={thR}>Орлого</th>
                <th className={thR}>Зарлага</th>
                <th className={thR}>Цэвэр</th>
              </tr>
            </thead>
            <tbody>
              {s.netByMethod.map((r) => (
                <tr key={r.method} className="border-b border-[var(--oc-line)] last:border-0">
                  <td className={td}>{r.methodLabel}</td>
                  <td className={tdR}>{formatTugrik(r.income)}</td>
                  <td className={tdR}>{formatTugrik(r.expense)}</td>
                  <td className={`${tdR} ${signedClass(r.net)}`}>{fmtSigned(r.net)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>

        <Section title="Дараа тооцоо" hint={`Үлдэгдэл нь ${fmtDateTime(s.postpaid.outstanding.asOf)} байдлаарх.`}>
          <dl className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
            <div>
              <dt className="text-xs text-[var(--oc-muted3)]">Дараа тооцоогоор хийсэн ажил ({s.postpaid.workDone.count})</dt>
              <dd className="tabular-nums text-[var(--oc-ink)]">{formatTugrik(s.postpaid.workDone.total)}</dd>
            </div>
            <div>
              <dt className="text-xs text-[var(--oc-muted3)]">Хугацаанд цуглуулсан</dt>
              <dd className="tabular-nums text-[var(--oc-ink)]">{formatTugrik(s.postpaid.collected.total)}</dd>
              <dd className="text-[11px] text-[var(--oc-muted4)]">
                Тооцоо {formatTugrik(s.postpaid.collected.settlements.total)} ({s.postpaid.collected.settlements.count}) · Шууд{" "}
                {formatTugrik(s.postpaid.collected.directPayments.total)} ({s.postpaid.collected.directPayments.count})
              </dd>
            </div>
            <div>
              <dt className="text-xs text-[var(--oc-muted3)]">Авлагын үлдэгдэл (бүх дууссан захиалга)</dt>
              <dd className="tabular-nums font-semibold text-[var(--oc-ink)]">{formatTugrik(s.postpaid.outstanding.total)}</dd>
            </div>
          </dl>
        </Section>

        <Section title="Дотоод зардал" hint="Кассын бүртгэлийн дотоод засварын зарлага.">
          <div className="text-xl font-semibold tabular-nums text-[var(--oc-ink)]">{formatTugrik(s.internalCost.total)}</div>
          <div className="text-xs text-[var(--oc-muted3)] mt-1">{s.internalCost.count} бичлэг</div>
        </Section>

        <div className="lg:col-span-2">
          <Section title="Кассын ээлжүүд" hint="Сонгосон хугацаанд нээгдсэн ээлжүүд. Хаагдсан ээлж — хаах үеийн тогтоосон дүн; нээлттэй ээлж — одоогийн тооцоо.">
            {s.sessions.items.length === 0 ? (
              <Empty />
            ) : (
              <table className="w-full">
                <thead>
                  <tr className="border-b border-[var(--oc-line)]">
                    <th className={th}>Салбар</th>
                    <th className={th}>Нээсэн</th>
                    <th className={th}>Хаасан</th>
                    <th className={thR}>Эхний</th>
                    <th className={thR}>Бэлэн орлого</th>
                    <th className={thR}>Бэлэн зарлага</th>
                    <th className={thR}>Тооцоолсон</th>
                    <th className={thR}>Тоолсон</th>
                    <th className={thR}>Зөрүү</th>
                    <th className={thR}>Хаасны дараах цуцлалт</th>
                  </tr>
                </thead>
                <tbody>
                  {s.sessions.items.map((x) => (
                    <tr key={x.id} className="border-b border-[var(--oc-line)] last:border-0">
                      <td className={td}>{x.branch.name}</td>
                      <td className={`${td} whitespace-nowrap`}>{fmtDateTime(x.openedAt)}</td>
                      <td className={`${td} whitespace-nowrap`}>{x.closedAt ? fmtDateTime(x.closedAt) : "Нээлттэй"}</td>
                      <td className={tdR}>{formatTugrik(x.openingCash)}</td>
                      <td className={tdR}>{formatTugrik(x.cashIn)}</td>
                      <td className={tdR}>{formatTugrik(x.cashOut)}</td>
                      <td className={tdR}>
                        {formatTugrik(x.expectedCash)}
                        <span className="block text-[11px] text-[var(--oc-muted4)]">
                          {x.status === "CLOSED" ? "(хаалтын дүн)" : "(одоогийн)"}
                        </span>
                      </td>
                      <td className={tdR}>{x.countedCash == null ? "—" : formatTugrik(x.countedCash)}</td>
                      <td className={`${tdR} ${signedClass(x.difference)}`}>{fmtSigned(x.difference)}</td>
                      <td className={tdR}>
                        {x.postCloseVoids.count > 0
                          ? `${x.postCloseVoids.count} · ${fmtSigned(x.postCloseVoids.netAmount)}`
                          : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <p className="text-sm text-[var(--oc-ink2)] mt-3 pt-3 border-t border-[var(--oc-line)]">
              <span className="font-medium">Ээлжээс гадуур</span> (бүх арга): орлого {formatTugrik(s.sessions.outsideSession.income)} ·
              зарлага {formatTugrik(s.sessions.outsideSession.expense)} · цэвэр {fmtSigned(s.sessions.outsideSession.net)} ·{" "}
              {s.sessions.outsideSession.count} бичлэг
            </p>
          </Section>
        </div>
      </div>
    </div>
  );
}
