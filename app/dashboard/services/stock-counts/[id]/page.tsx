import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { cancelStockCountAction } from "@/app/_actions/stock-counts";
import { ConfirmForm } from "@/app/_components/confirm-form";
import { Btn, Chip } from "@/app/_components/landing-ops-ui";
import { requireUser } from "@/lib/auth";
import { canEdit, canView } from "@/lib/auth/roles";
import { formatTugrik } from "@/lib/orders";
import { formatStock } from "@/lib/services";
import { STOCK_COUNT_STATUS_LABEL, STOCK_COUNT_STATUS_TONE, getStockCount, personName, stockCountLabel } from "@/lib/stock-counts";
import { CountSheet } from "./count-sheet";

export const metadata = { title: "Тооллого — Үйлчилгээ" };

function fmtDateTime(d: Date | null): string {
  if (!d) return "—";
  return d.toLocaleString("mn-MN", { timeZone: "Asia/Ulaanbaatar", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
}

const th = "font-plex-mono text-[10.5px] uppercase tracking-[0.08em] text-[var(--oc-muted3)] font-medium px-3 py-2.5 whitespace-nowrap";
const tdR = "px-3 py-2 text-right text-sm tabular-nums whitespace-nowrap";

export default async function StockCountPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ view?: string }> }) {
  const user = await requireUser();
  if (!canView(user, "services")) redirect("/dashboard");
  const { id } = await params;
  const count = await getStockCount(user.tenantId, id);
  if (!count) notFound();
  const label = stockCountLabel(count.number);
  const editable = count.status === "DRAFT" && canEdit(user, "services");
  const onlyDiff = (await searchParams).view === "diff";

  const header = (
    <div className="mb-5 flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
      <div>
        <Link href="/dashboard/services/stock-counts" className="text-xs text-[var(--oc-muted3)] hover:text-[var(--oc-ink)]">
          ← Тооллогын түүх
        </Link>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold text-[var(--oc-ink)]">Тооллого {label}</h1>
          <Chip tone={STOCK_COUNT_STATUS_TONE[count.status]}>{STOCK_COUNT_STATUS_LABEL[count.status]}</Chip>
        </div>
        <p className="text-sm text-[var(--oc-muted3)] mt-1">
          {count.categoryName ?? "Бүх идэвхтэй бараа"} · эхэлсэн {fmtDateTime(count.createdAt)} ({personName(count.createdBy)})
          {count.status === "COMPLETED" ? ` · дууссан ${fmtDateTime(count.completedAt)} (${personName(count.completedBy)})` : ""}
          {count.status === "CANCELLED" ? ` · цуцалсан ${fmtDateTime(count.cancelledAt)}` : ""}
        </p>
        {count.note ? <p className="text-sm text-[var(--oc-ink2)] mt-1">{count.note}</p> : null}
      </div>
      {editable ? (
        <ConfirmForm
          action={cancelStockCountAction.bind(null, count.id)}
          title="Тооллого цуцлах"
          message={`${label} тооллогыг цуцлах уу? Тоолсон тоо хадгалагдахгүй, үлдэгдэл өөрчлөгдөхгүй.`}
          confirmLabel="Цуцлах"
        >
          <Btn type="submit" variant="ghost" size="md">
            Цуцлах
          </Btn>
        </ConfirmForm>
      ) : null}
    </div>
  );

  if (editable) {
    return (
      <div className="p-4 sm:p-6 max-w-full flex-1 flex flex-col min-h-0 w-full">
        {header}
        <CountSheet
          countId={count.id}
          lines={count.lines.map((l) => ({
            id: l.id,
            name: l.name,
            code: l.code,
            unit: l.unit,
            costPrice: l.costPrice?.toString() ?? null,
            systemQty: l.systemQty.toString(),
            countedQty: l.countedQty?.toString() ?? null,
          }))}
        />
      </div>
    );
  }

  // Read-only: a closed count (or a DRAFT for someone who may not count).
  const done = count.status === "COMPLETED";
  const lines = onlyDiff ? count.lines.filter((l) => l.difference != null && !l.difference.isZero()) : count.lines;
  const net = Number(count.surplusValue) - Number(count.shortageValue);
  return (
    <div className="p-4 sm:p-6 max-w-full flex-1 flex flex-col min-h-0 w-full">
      {header}
      {done ? (
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-4">
          {[
            { label: "Тоолсон", value: `${count.countedCount} / ${count.lineCount}` },
            { label: "Зөрүүтэй", value: String(count.diffCount) },
            { label: "Дутагдал (өртгөөр)", value: formatTugrik(count.shortageValue.toString()), tone: Number(count.shortageValue) ? "text-red-400 light:text-red-600" : "" },
            { label: "Илүүдэл (өртгөөр)", value: formatTugrik(count.surplusValue.toString()), tone: Number(count.surplusValue) ? "text-[var(--oc-ok)]" : "" },
            { label: "Цэвэр", value: `${net > 0 ? "+" : net < 0 ? "−" : ""}${formatTugrik(Math.abs(net))}` },
          ].map((c) => (
            <div key={c.label} className="rounded-[10px] border border-[var(--oc-line)] bg-[var(--oc-panel)] px-4 py-3">
              <div className="text-xs text-[var(--oc-muted3)]">{c.label}</div>
              <div className={`text-lg font-semibold tabular-nums ${c.tone || "text-[var(--oc-ink)]"}`}>{c.value}</div>
            </div>
          ))}
        </div>
      ) : null}
      {done ? (
        <div className="mb-3 inline-flex self-start rounded-[10px] border border-[var(--oc-line)] bg-[var(--oc-panel)] p-0.5 text-sm">
          <Link href={`/dashboard/services/stock-counts/${count.id}`} className={`rounded-[8px] px-3 py-1.5 ${onlyDiff ? "text-[var(--oc-muted3)] hover:text-[var(--oc-ink)]" : "bg-[var(--oc-line)] text-[var(--oc-ink)] font-medium"}`}>
            Бүгд
          </Link>
          <Link href={`/dashboard/services/stock-counts/${count.id}?view=diff`} className={`rounded-[8px] px-3 py-1.5 ${onlyDiff ? "bg-[var(--oc-line)] text-[var(--oc-ink)] font-medium" : "text-[var(--oc-muted3)] hover:text-[var(--oc-ink)]"}`}>
            Зөрүүтэй ({count.diffCount})
          </Link>
        </div>
      ) : null}
      <div className="rounded-[10px] border border-[var(--oc-line)] bg-[var(--oc-panel)] overflow-auto flex-1 min-h-0">
        <table className="w-full min-w-[760px]">
          <thead>
            <tr className="border-b border-[var(--oc-line)]">
              <th className={`${th} text-left`}>Код</th>
              <th className={`${th} text-left`}>Нэр</th>
              <th className={`${th} text-right`}>Систем</th>
              <th className={`${th} text-right`}>Тоолсон</th>
              <th className={`${th} text-right`}>Зөрүү</th>
              <th className={`${th} text-right`}>Зөрүү (өртгөөр)</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--oc-line)]">
            {lines.map((l) => {
              const d = l.difference;
              const tone = d == null || d.isZero() ? "text-[var(--oc-muted3)]" : d.isNegative() ? "text-red-400 light:text-red-600" : "text-[var(--oc-ok)]";
              return (
                <tr key={l.id}>
                  <td className="px-3 py-2 font-plex-mono text-xs text-[var(--oc-muted2)]">{l.code ?? "—"}</td>
                  <td className="px-3 py-2 text-sm text-[var(--oc-ink)]">
                    {l.serviceId ? (
                      <Link href={`/dashboard/services/${l.serviceId}`} className="hover:text-[var(--oc-accent)]">
                        {l.name}
                      </Link>
                    ) : (
                      l.name
                    )}
                  </td>
                  <td className={`${tdR} text-[var(--oc-ink2)]`}>{formatStock(l.systemQty.toString(), l.unit)}</td>
                  <td className={`${tdR} text-[var(--oc-ink2)]`}>{l.countedQty == null ? <span className="text-[var(--oc-muted4)]">тоолоогүй</span> : formatStock(l.countedQty.toString(), l.unit)}</td>
                  <td className={`${tdR} ${tone}`}>{d == null ? "—" : d.isZero() ? "0" : `${d.isPositive() ? "+" : "−"}${formatStock(d.abs().toString(), l.unit)}`}</td>
                  <td className={`${tdR} text-[var(--oc-ink2)]`}>
                    {d == null || d.isZero() ? "—" : l.costPrice == null ? <span className="text-[var(--oc-muted4)]">өртөггүй</span> : `${d.isPositive() ? "+" : "−"}${formatTugrik(d.abs().times(l.costPrice).toString())}`}
                  </td>
                </tr>
              );
            })}
            {lines.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-3 py-8 text-center text-sm text-[var(--oc-muted3)]">
                  Зөрүүтэй бараа алга.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
