import { bankLabel } from "@/lib/banks";
import type { SerializedCashSession } from "@/lib/cash/session";
import { formatTugrik, ORDER_PAYMENT_METHOD_LABEL } from "@/lib/orders";

type Session = Pick<
  SerializedCashSession,
  "status" | "byMethod" | "cashIn" | "cashOut" | "expectedCash" | "countedCash" | "difference" | "entryCount" | "totalEntryCount"
>;

export type BreakdownRow = SerializedCashSession["byMethod"][number];

/** byMethod has no CASH row when the session has no cash entries: always show the drawer row from the session figures. */
export function withCashRow(s: Session): BreakdownRow[] {
  const rows = s.byMethod ?? [];
  if (rows.some((r) => r.method === "CASH")) return rows;
  const cash: BreakdownRow = {
    method: "CASH",
    bank: null,
    income: s.cashIn ?? "0",
    expense: s.cashOut ?? "0",
    net: String(Number(s.cashIn ?? 0) - Number(s.cashOut ?? 0)),
    count: s.entryCount ?? 0,
    expected: s.expectedCash,
    counted: s.countedCash,
    difference: s.difference,
  };
  return [cash, ...rows];
}

/** All-method totals of a shift, summed in integer cents (no float drift). */
export function sessionTotals(s: Session): { income: string; expense: string; net: string; count: number } {
  const rows = withCashRow(s);
  const cents = (pick: (r: BreakdownRow) => string) => rows.reduce((sum, r) => sum + Math.round(Number(pick(r)) * 100), 0);
  const income = cents((r) => r.income);
  const expense = cents((r) => r.expense);
  return {
    income: String(income / 100),
    expense: String(expense / 100),
    net: String((income - expense) / 100),
    count: s.totalEntryCount ?? rows.reduce((sum, r) => sum + r.count, 0),
  };
}

export function methodRowLabel(r: Pick<BreakdownRow, "method" | "bank">): string {
  const base = ORDER_PAYMENT_METHOD_LABEL[r.method] ?? r.method;
  return r.bank ? `${base} · ${bankLabel(r.bank)}` : base;
}

function diffText(difference: string | null): string {
  if (difference == null) return "—";
  return `${Number(difference) > 0 ? "+" : ""}${formatTugrik(difference)}`;
}

function diffTone(difference: string | null): string {
  const n = Number(difference ?? 0);
  if (!Number.isFinite(n) || n === 0) return "text-[var(--oc-ink)]";
  return n > 0 ? "text-[var(--oc-ok)]" : "text-red-400 light:text-red-600";
}

/** Per-method takings of a shift: income, expense, net, plus expected/counted/difference (frozen once closed). */
export function SessionMethodBreakdown({ session }: { session: Session }) {
  const rows = withCashRow(session);
  const closed = session.status === "CLOSED";
  const th = "font-plex-mono text-[10.5px] uppercase tracking-[0.08em] text-[var(--oc-muted3)] font-medium px-4 py-3";
  const tdR = "px-4 py-2.5 text-right text-sm tabular-nums text-[var(--oc-ink)] whitespace-nowrap";
  return (
    <section className="rounded-[10px] border border-[var(--oc-line)] bg-[var(--oc-panel)] overflow-hidden">
      <div className="px-5 py-3 border-b border-[var(--oc-line)]">
        <h2 className="font-semibold text-[var(--oc-ink)]">Төлбөрийн аргаар</h2>
        <p className="text-xs text-[var(--oc-muted3)] mt-1">
          Бэлэн мөнгөний тооцоололд эхний үлдэгдэл орно. Бусад аргын тооцоолсон дүн нь цэвэр дүн; тоолсон дүн заавал биш.
        </p>
      </div>
      <div className="overflow-auto">
        <table className="w-full min-w-[720px]">
          <thead>
            <tr className="border-b border-[var(--oc-line)]">
              <th className={`${th} text-left`}>Арга</th>
              <th className={`${th} text-right`}>Орлого</th>
              <th className={`${th} text-right`}>Зарлага</th>
              <th className={`${th} text-right`}>Цэвэр</th>
              <th className={`${th} text-right`}>{closed ? "Тооцоолсон (хаахад)" : "Тооцоолсон"}</th>
              <th className={`${th} text-right`}>Тоолсон</th>
              <th className={`${th} text-right`}>Зөрүү</th>
              <th className={`${th} text-right`}>Бичлэг</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--oc-line)]">
            {rows.map((r) => (
              <tr key={`${r.method}:${r.bank ?? ""}`}>
                <td className="px-4 py-2.5 text-sm text-[var(--oc-ink2)]">{methodRowLabel(r)}</td>
                <td className={tdR}>{formatTugrik(r.income)}</td>
                <td className={tdR}>{formatTugrik(r.expense)}</td>
                <td className={tdR}>{formatTugrik(r.net)}</td>
                <td className={tdR}>{r.expected == null ? "—" : formatTugrik(r.expected)}</td>
                <td className={tdR}>{r.counted == null ? "—" : formatTugrik(r.counted)}</td>
                <td className={`${tdR} ${diffTone(r.difference)}`}>{diffText(r.difference)}</td>
                <td className={tdR}>{r.count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
