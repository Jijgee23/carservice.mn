import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Chip } from "@/app/_components/landing-ops-ui";
import { requireUser } from "@/lib/auth";
import { hasPermission } from "@/lib/auth/roles";
import { CashError } from "@/lib/cash/rules";
import { getSessionDetail } from "@/lib/cash/session";
import { formatTugrik, ORDER_PAYMENT_METHOD_LABEL } from "@/lib/orders";
import { SessionMethodBreakdown, sessionTotals } from "../method-breakdown";
import { CloseSessionButton } from "../session-dialogs";

export const metadata = {
  title: "Кассын ээлжийн дэлгэрэнгүй",
};

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

type DetailEntry = Awaited<ReturnType<typeof getSessionDetail>>["entries"][number];

function EntriesTable({ entries, showVoid }: { entries: DetailEntry[]; showVoid?: boolean }) {
  return (
    <div className="overflow-auto">
      <table className="w-full min-w-[720px]">
        <thead>
          <tr className="border-b border-[var(--oc-line)]">
            {["Огноо", "Ангилал", "Арга", "Чиглэл", "Дүн", "Харилцагч / Тайлбар", showVoid ? "Хүчингүй болсон" : "Бүртгэсэн"].map((h) => (
              <th
                key={h}
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
          {entries.map((e) => (
            <tr key={e.id}>
              <td className="px-4 py-2.5 font-plex-mono text-xs text-[var(--oc-muted2)] whitespace-nowrap">{fmtDateTime(e.occurredAt)}</td>
              <td className="px-4 py-2.5 text-sm text-[var(--oc-ink2)]">{e.type.name}</td>
              <td className="px-4 py-2.5 text-sm text-[var(--oc-ink2)]">{ORDER_PAYMENT_METHOD_LABEL[e.method] ?? e.method}</td>
              <td className="px-4 py-2.5 text-sm text-[var(--oc-ink2)]">{e.direction === "INCOME" ? "Орлого" : "Зарлага"}</td>
              <td className="px-4 py-2.5 text-right text-sm tabular-nums text-[var(--oc-ink)] whitespace-nowrap">
                {e.direction === "EXPENSE" ? "−" : ""}
                {formatTugrik(e.amount)}
              </td>
              <td className="px-4 py-2.5 text-sm text-[var(--oc-ink2)]">
                {e.customer?.name ?? e.counterparty ?? "—"}
                {e.orderId ? (
                  <div>
                    <Link href={`/dashboard/orders/${e.orderId}`} className="text-xs text-[var(--oc-accent)] hover:text-[var(--oc-accent-hi)]">
                      {e.orderNumber ? `Захиалга #${e.orderNumber}` : "Захиалга"}
                    </Link>
                  </div>
                ) : null}
                {e.note ? <div className="text-xs text-[var(--oc-muted4)]">{e.note}</div> : null}
              </td>
              <td className="px-4 py-2.5 text-sm text-[var(--oc-ink2)]">
                {showVoid ? (
                  <>
                    {e.voidedAt ? fmtDateTime(e.voidedAt) : "—"}
                    {e.voidReason ? <div className="text-xs text-[var(--oc-muted4)]">{e.voidReason}</div> : null}
                  </>
                ) : e.isSystem ? (
                  "—"
                ) : (
                  (e.createdBy?.name ?? "—")
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default async function CashSessionDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  if (!hasPermission(user, "cash.manage")) redirect("/dashboard");
  const { id } = await params;

  let detail;
  try {
    detail = await getSessionDetail({ actor: user, sessionId: id });
  } catch (error) {
    if (error instanceof CashError && error.status === 404) notFound();
    throw error;
  }

  const { session: s, entries, postCloseVoids, truncated } = detail;
  const closed = s.status === "CLOSED";
  const diffNum = Number(s.difference ?? 0);
  const diffClass = diffNum === 0 ? "text-[var(--oc-ink)]" : diffNum > 0 ? "text-[var(--oc-ok)]" : "text-red-400 light:text-red-600";
  const totals = sessionTotals(s);
  const stat = (label: string, value: string, cls = "text-[var(--oc-ink)]") => (
    <div className="rounded-[10px] border border-[var(--oc-line)] bg-[var(--oc-panel)] px-4 py-3">
      <div className="text-xs text-[var(--oc-muted3)]">{label}</div>
      <div className={`text-lg font-semibold tabular-nums ${cls}`}>{value}</div>
    </div>
  );

  return (
    <div className="p-4 sm:p-6 max-w-5xl w-full flex flex-col gap-6">
      <div>
        <Link href="/dashboard/cash/sessions" className="text-sm text-[var(--oc-accent)] hover:text-[var(--oc-accent-hi)]">
          ← Кассын ээлж
        </Link>
        <div className="mt-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold text-[var(--oc-ink)] flex flex-wrap items-center gap-2">
              Кассын ээлж · {s.branch.name}
              {closed ? <Chip tone="neutral">Хаагдсан</Chip> : <Chip tone="ok">Нээлттэй</Chip>}
            </h1>
            <p className="text-sm text-[var(--oc-muted3)] mt-1">
              Нээсэн: {s.openedBy?.name ?? "—"} · {fmtDateTime(s.openedAt)}
              {closed ? ` · Хаасан: ${s.closedBy?.name ?? "—"} · ${s.closedAt ? fmtDateTime(s.closedAt) : ""}` : ""}
            </p>
            {s.note ? <p className="text-sm text-[var(--oc-ink2)] mt-1 whitespace-pre-line">{s.note}</p> : null}
          </div>
          {!closed ? <CloseSessionButton sessionId={s.id} /> : null}
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {stat("Нийт орлого", formatTugrik(totals.income))}
        {stat("Нийт зарлага", formatTugrik(totals.expense))}
        {stat("Цэвэр", formatTugrik(totals.net))}
        {stat("Бичлэг", String(totals.count))}
      </div>

      <div className="flex flex-col gap-2 -mt-2">
        <h2 className="text-sm font-semibold text-[var(--oc-ink)]">Бэлэн мөнгө</h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {stat("Эхний үлдэгдэл", formatTugrik(s.openingCash))}
          {stat("Бэлэн орлого (одоогийн)", formatTugrik(s.cashIn))}
          {stat("Бэлэн зарлага (одоогийн)", formatTugrik(s.cashOut))}
          {stat(closed ? "Тооцоолсон (хаахад)" : "Тооцоолсон үлдэгдэл", formatTugrik(s.expectedCash))}
          {closed ? stat("Тоолсон", formatTugrik(s.countedCash)) : null}
          {closed ? stat("Зөрүү", `${diffNum > 0 ? "+" : ""}${formatTugrik(s.difference)}`, diffClass) : null}
        </div>
      </div>
      {closed ? (
        <p className="text-xs text-[var(--oc-muted3)] -mt-3">
          Тооцоолсон дүн, тоолсон дүн, зөрүү нь хаах үеийн тогтсон утга. Орлого/зарлагын нийлбэр одоогийн (хүчингүйг хасаад) байдлаар.
        </p>
      ) : null}

      <SessionMethodBreakdown session={s} />

      {closed && postCloseVoids.count > 0 ? (
        <section className="rounded-[10px] border border-[var(--oc-warn)]/40 bg-[var(--oc-panel)] overflow-hidden">
          <div className="px-5 py-3 border-b border-[var(--oc-line)]">
            <h2 className="font-semibold text-[var(--oc-ink)]">Хаасны дараа хүчингүй болсон ({postCloseVoids.count})</h2>
            <p className="text-xs text-[var(--oc-muted3)] mt-1">
              Орлого {formatTugrik(postCloseVoids.incomeAmount)} · Зарлага {formatTugrik(postCloseVoids.expenseAmount)} · Цэвэр{" "}
              {formatTugrik(postCloseVoids.netAmount)}. Хаасан ээлжийн тооцоолсон дүнд өөрчлөлт орохгүй.
            </p>
          </div>
          <EntriesTable entries={postCloseVoids.entries} showVoid />
          {truncated.postCloseVoids ? (
            <p className="px-5 py-3 text-xs text-[var(--oc-muted3)]">Сүүлийн {truncated.cap} цуцалсан бичлэгийг харуулав; дээрх нийлбэр бүх бичлэгийг хамарна.</p>
          ) : null}
        </section>
      ) : null}

      <section className="rounded-[10px] border border-[var(--oc-line)] bg-[var(--oc-panel)] overflow-hidden">
        <div className="px-5 py-3 border-b border-[var(--oc-line)] font-semibold text-[var(--oc-ink)]">Бичлэгүүд ({entries.length})</div>
        {entries.length === 0 ? (
          <p className="px-5 py-4 text-sm text-[var(--oc-muted3)]">Энэ ээлжид бичлэг алга.</p>
        ) : (
          <EntriesTable entries={entries} />
        )}
        {truncated.entries ? (
          <p className="px-5 py-3 text-xs text-[var(--oc-muted3)] border-t border-[var(--oc-line)]">
            Сүүлийн {truncated.cap} бичлэгийг харуулав ({totals.count} бичлэгээс); дээрх нийлбэр бүх бичлэгийг хамарна. Бүрэн жагсаалтыг{" "}
            <Link href="/dashboard/cash/income" className="text-[var(--oc-accent)] hover:text-[var(--oc-accent-hi)]">
              орлогын жагсаалт
            </Link>{" "}
            дээрээс шүүж үзнэ үү.
          </p>
        ) : null}
      </section>
    </div>
  );
}
