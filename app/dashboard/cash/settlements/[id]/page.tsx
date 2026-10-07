import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Chip } from "@/app/_components/landing-ops-ui";
import { requireUser } from "@/lib/auth";
import { hasPermission } from "@/lib/auth/roles";
import { CashError } from "@/lib/cash/rules";
import { getSettlement } from "@/lib/cash/settlement";
import { ORDER_PAYMENT_STATUS_LABEL, formatTugrik } from "@/lib/orders";
import { openSessionBranchIds } from "../../open-sessions";
import { SettlementVoidButton } from "./settlement-actions";

export const metadata = {
  title: "Тооцоо нийлэлтийн дэлгэрэнгүй",
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

export default async function SettlementDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  if (!hasPermission(user, "cash.manage")) redirect("/dashboard");
  const { id } = await params;

  let settlement;
  try {
    settlement = await getSettlement({ actor: user, settlementId: id });
  } catch (error) {
    if (error instanceof CashError && error.status === 404) notFound();
    throw error;
  }

  const voided = settlement.voidedAt != null;
  const canVoid = !voided && hasPermission(user, "orders.closeUnpaidPostpaid");
  const entry = settlement.entry;
  const sessionOpen = canVoid
    ? (await openSessionBranchIds(user.tenantId, [settlement.branch.id])).length > 0
    : true;

  return (
    <div className="p-4 sm:p-6 max-w-5xl w-full flex flex-col gap-6">
      <div>
        <Link href="/dashboard/cash/settlements" className="text-sm text-[var(--oc-accent)] hover:text-[var(--oc-accent-hi)]">
          ← Тооцоо нийлэлт
        </Link>
        <div className="mt-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold text-[var(--oc-ink)] flex flex-wrap items-center gap-2">
              Тооцоо нийлэлт · {settlement.customer.name}
              {voided ? <Chip tone="danger">Хүчингүй</Chip> : null}
            </h1>
            <p className="text-sm text-[var(--oc-muted3)] mt-1">
              {settlement.branch.name} · {fmtDateTime(settlement.occurredAt)}
            </p>
          </div>
          {canVoid ? <SettlementVoidButton settlementId={settlement.id} sessionOpen={sessionOpen} locked={settlement.locked} /> : null}
        </div>
      </div>

      {voided ? (
        <div className="rounded-[10px] border border-[var(--oc-line)] bg-[var(--oc-panel)] px-4 py-3 text-sm text-[var(--oc-ink2)]">
          Цуцалсан: {settlement.voidedAt ? fmtDateTime(settlement.voidedAt) : ""}
          {settlement.voidedBy ? ` · ${settlement.voidedBy.name}` : ""}
          {settlement.voidReason ? <div className="text-[var(--oc-muted3)] mt-1">Шалтгаан: {settlement.voidReason}</div> : null}
        </div>
      ) : null}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Info label="Нийт дүн" value={<span className={voided ? "line-through" : ""}>{formatTugrik(settlement.amount)}</span>} />
        <Info
          label="Арга"
          value={
            <>
              {settlement.methodLabel}
              {settlement.bankLabel ? <span className="text-[var(--oc-muted4)]"> · {settlement.bankLabel}</span> : null}
            </>
          }
        />
        <Info label="Захиалгын тоо" value={String(settlement.orderCount)} />
        <Info label="Бүртгэсэн" value={settlement.createdBy?.name ?? "—"} />
      </div>

      {settlement.note ? (
        <p className="text-sm text-[var(--oc-ink2)]">
          <span className="text-[var(--oc-muted3)]">Тайлбар: </span>
          {settlement.note}
        </p>
      ) : null}

      <div className="rounded-[10px] border border-[var(--oc-line)] bg-[var(--oc-panel)] overflow-hidden">
        <div className="px-5 py-3 border-b border-[var(--oc-line)] text-sm font-semibold text-[var(--oc-ink)]">
          Нийлүүлсэн захиалгууд
        </div>
        <div className="overflow-auto">
          <table className="w-full min-w-[640px]">
            <thead>
              <tr className="border-b border-[var(--oc-line)]">
                {["Захиалга", "Машин", "Захиалгын дүн", "Төлбөр", "Тооцооны дүн"].map((h) => (
                  <th
                    key={h}
                    className={`font-plex-mono text-[10.5px] uppercase tracking-[0.08em] text-[var(--oc-muted3)] font-medium px-4 py-3 ${
                      h.endsWith("дүн") ? "text-right" : "text-left"
                    }`}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--oc-line)]">
              {settlement.orders.map((o) => {
                const cancelled = o.paymentStatus === "CANCELLED";
                return (
                  <tr key={o.paymentId} className={cancelled ? "opacity-60" : ""}>
                    <td className="px-4 py-3 text-sm">
                      <Link
                        href={`/dashboard/orders/${o.orderId}`}
                        className="font-mono font-semibold text-[var(--oc-accent)] hover:text-[var(--oc-accent-hi)]"
                      >
                        #{o.orderNumber}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-sm font-mono text-[var(--oc-ink2)]">{o.plate ?? "—"}</td>
                    <td className="px-4 py-3 text-right text-sm tabular-nums text-[var(--oc-muted3)]">{formatTugrik(o.orderTotal)}</td>
                    <td className="px-4 py-3 text-sm text-[var(--oc-ink2)]">
                      {ORDER_PAYMENT_STATUS_LABEL[o.paymentStatus as keyof typeof ORDER_PAYMENT_STATUS_LABEL] ?? o.paymentStatus}
                    </td>
                    <td className="px-4 py-3 text-right text-sm tabular-nums text-[var(--oc-ink)]">
                      <span className={cancelled ? "line-through" : ""}>{formatTugrik(o.amount)}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="rounded-[10px] border border-[var(--oc-line)] bg-[var(--oc-panel)] px-5 py-4 flex flex-col gap-3">
        <div className="text-sm font-semibold text-[var(--oc-ink)]">Кассын бичлэг</div>
        {entry ? (
          <div className="text-sm text-[var(--oc-ink2)] flex flex-wrap items-center gap-x-3 gap-y-1">
            <span>{entry.type.name}</span>
            <Chip tone="neutral">Систем</Chip>
            <span className={`tabular-nums ${entry.voidedAt ? "line-through" : ""}`}>{formatTugrik(entry.amount)}</span>
            <span className="text-[var(--oc-muted4)]">{fmtDateTime(entry.occurredAt)}</span>
            {entry.voidedAt ? (
              <span className="text-[var(--oc-muted3)]">Хүчингүй{entry.voidReason ? ` · ${entry.voidReason}` : ""}</span>
            ) : null}
          </div>
        ) : (
          <p className="text-sm text-[var(--oc-muted3)]">Кассын бичлэг олдсонгүй.</p>
        )}
      </div>
    </div>
  );
}

function Info({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-[10px] border border-[var(--oc-line)] bg-[var(--oc-panel)] px-4 py-3">
      <div className="text-xs text-[var(--oc-muted3)]">{label}</div>
      <div className="text-base font-semibold tabular-nums text-[var(--oc-ink)]">{value}</div>
    </div>
  );
}
