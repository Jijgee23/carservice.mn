import Link from "next/link";
import { PageHeader } from "@/app/_components/page-header";
import { Pagination } from "@/app/_components/pagination";
import { requireSuperAdmin } from "@/lib/auth/system";
import { formatTugrik } from "@/lib/orders";
import { buildMeta, getPageInfo } from "@/lib/pagination";
import { getPlatformSettings } from "@/lib/platform-settings";
import { prisma } from "@/lib/prisma";
import { REFUND_CLAIM_PREFIX, REFUND_CLAIM_STALE_MS } from "@/lib/appointment-refund";
import { RefundButton } from "./refund-button";
import { VerifyRefundButton } from "./verify-refund-button";

export const metadata = {
  title: "Цаг захиалгын орлого",
};

export default async function BookingRevenuePage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  await requireSuperAdmin();
  const { page: pageParam } = await searchParams;

  const { page, pageSize, skip, take } = getPageInfo(pageParam);
  const [settings, payments, total, paidAgg, refundedAgg, refundedCount, underpaid, deadBookingPaid, heldRefunds] =
    await Promise.all([
      getPlatformSettings(),
      // Мөр бүр аль хэдийн ТӨЛӨГДСӨН (Invoice зөвхөн PAID болсны дараа л
      // үүснэ — lib/appointment-payments.ts), status нь дараа REFUNDED болж
      // болно.
      prisma.appointmentPayment.findMany({
        orderBy: { paidAt: "desc" },
        skip,
        take,
        include: {
          tenant: { select: { name: true } },
          account: { select: { name: true, phone: true } },
        },
      }),
      prisma.appointmentPayment.count(),
      prisma.appointmentPayment.aggregate({
        where: { status: "PAID" },
        _sum: { amount: true },
      }),
      prisma.appointmentPayment.aggregate({
        where: { status: "REFUNDED" },
        _sum: { amount: true },
      }),
      prisma.appointmentPayment.count({ where: { status: "REFUNDED" } }),
      // Дутуу төлбөр (0 < төлсөн < шаардлагатай) илэрсэн боловч Invoice
      // ҮҮСЭЭГҮЙ хэвээр буй захиалгууд — confirmAppointmentPayment тэмдэглэсэн.
      prisma.appointment.findMany({
        where: { feeUnderpaidAmount: { not: null } },
        orderBy: { feeUnderpaidAt: "desc" },
        take: 20,
        select: {
          id: true,
          feeAmount: true,
          feeUnderpaidAmount: true,
          feeUnderpaidAt: true,
          tenant: { select: { name: true } },
          account: { select: { name: true, phone: true } },
        },
      }),
      // Цуцлагдсан/татгалзсан цагт төлөгдсөн (PAID) хураамж — буцаалт
      // шаардлагатай (I1: төлбөр цуцлалтын дараа ирсэн эсвэл цуцлахаас өмнө
      // төлөгдсөн). Схем өөрчлөлтгүй: payment PAID + appointment CANCELLED/REJECTED.
      prisma.appointmentPayment.findMany({
        where: {
          status: "PAID",
          appointment: { status: { in: ["CANCELLED", "REJECTED"] } },
        },
        orderBy: { paidAt: "desc" },
        take: 50,
        select: {
          id: true,
          amount: true,
          paymentType: true,
          paidAt: true,
          tenant: { select: { name: true } },
          account: { select: { name: true, phone: true } },
        },
      }),
      // Буцаалтын оролдлого тодорхойгүй дууссан (timeout/5xx) — QPay дээр шалгаж
      // «Буцаасан гэж тэмдэглэх» шаардлагатай (refundNote түгжээний prefix-тэй).
      prisma.appointmentPayment.findMany({
        where: { status: "PAID", refundNote: { startsWith: REFUND_CLAIM_PREFIX } },
        orderBy: { updatedAt: "desc" },
        take: 50,
        select: {
          id: true,
          amount: true,
          paymentType: true,
          updatedAt: true,
          tenant: { select: { name: true } },
          account: { select: { name: true, phone: true } },
        },
      }),
    ]);
  const renderedAt = new Date().getTime();
  const meta = buildMeta(total, page, pageSize);
  const netRevenue = Number.parseFloat(paidAgg._sum.amount?.toString() ?? "0");
  const refundedTotal = Number.parseFloat(
    refundedAgg._sum.amount?.toString() ?? "0",
  );

  return (
    <div className="p-6 sm:p-8 max-w-screen">
      <PageHeader
        title="Цаг захиалгын орлого"
        description="Хэрэглэгч онлайн цаг захиалахдаа төлдөг платформын хураамжийн invoice-ууд (зөвхөн бодитоор төлөгдсөн)"
      />

      <div className="rounded-[10px] border border-[var(--oc-line)] bg-[var(--oc-panel)] p-4 mb-6 flex items-center justify-between gap-3 flex-wrap">
        <div className="text-sm text-[var(--oc-muted)]">
          Одоогийн хураамж:{" "}
          <span className="font-plex-mono font-semibold text-[var(--oc-ink)]">
            {settings.appointmentFeeEnabled
              ? formatTugrik(settings.appointmentFeeAmount)
              : "Идэвхгүй (үнэгүй)"}
          </span>
        </div>
        <Link
          href="/system/settings"
          className="text-xs text-[var(--oc-accent)] hover:text-[var(--oc-accent-hi)]"
        >
          Тохиргоо засах →
        </Link>
      </div>

      <div className="grid gap-4 sm:grid-cols-3 mb-8">
        <div className="rounded-[10px] border border-[var(--oc-ok)]/20 bg-[var(--oc-panel)] p-5">
          <div className="text-xs text-[var(--oc-muted3)] uppercase tracking-wider">
            Цэвэр орлого
          </div>
          <div className="mt-2 text-2xl sm:text-3xl font-bold text-[var(--oc-ink)]">
            {formatTugrik(netRevenue)}
          </div>
          <p className="text-xs text-[var(--oc-muted3)] mt-1">Буцаагдсаныг хассан</p>
        </div>
        <div className="rounded-[10px] border border-[var(--oc-line)] bg-[var(--oc-panel)] p-5">
          <div className="text-2xl sm:text-3xl font-bold text-[var(--oc-ink)]">
            {total.toLocaleString("mn-MN")}
          </div>
          <div className="text-sm text-[var(--oc-muted3)] mt-1">Нийт invoice</div>
        </div>
        <div className="rounded-[10px] border border-[var(--oc-line)] bg-[var(--oc-panel)] p-5">
          <div className="text-2xl sm:text-3xl font-bold text-[var(--oc-warn)]">
            {formatTugrik(refundedTotal)}
          </div>
          <div className="text-sm text-[var(--oc-muted3)] mt-1">
            Буцаагдсан ({refundedCount.toLocaleString("mn-MN")})
          </div>
        </div>
      </div>

      {heldRefunds.length > 0 ? (
        <div className="rounded-[10px] border border-amber-500/30 bg-[var(--oc-panel)] overflow-hidden mb-6">
          <div className="px-5 py-3 border-b border-[var(--oc-line2)]">
            <h2 className="text-sm font-semibold text-amber-300 light:text-amber-700">
              Буцаалт шалгах шаардлагатай ({heldRefunds.length})
            </h2>
            <p className="text-xs text-[var(--oc-muted3)] mt-0.5">
              Буцаалтын оролдлого тодорхойгүй дууссан. QPay дээр буцаалт
              хийгдсэн эсэхийг шалгаад «Буцаасан гэж тэмдэглэх» дарна уу.
            </p>
          </div>
          <div className="overflow-auto">
            <table className="w-full min-w-[560px]">
              <tbody className="divide-y divide-[var(--oc-line2)]">
                {heldRefunds.map((p) => (
                  <tr key={p.id} className="hover:bg-white/[0.02] transition-colors">
                    <td className="px-5 py-2.5 text-sm text-[var(--oc-ink2)]">{p.tenant.name}</td>
                    <td className="px-5 py-2.5 text-xs text-[var(--oc-muted)]">
                      {p.account.name?.trim() || p.account.phone}
                    </td>
                    <td className="px-5 py-2.5 font-plex-mono text-xs text-[var(--oc-ink2)]">
                      {formatTugrik(p.amount.toString())}
                    </td>
                    <td className="px-5 py-2.5 font-plex-mono text-xs text-[var(--oc-muted3)]">
                      {p.updatedAt.toLocaleString("mn-MN", { hour12: false })}
                    </td>
                    <td className="px-5 py-2.5">
                      {/* Claim younger than the stale window: the refund may still be in flight. */}
                      {renderedAt - p.updatedAt.getTime() < REFUND_CLAIM_STALE_MS ? (
                        <span className="text-xs text-[var(--oc-muted3)]">Явцад</span>
                      ) : (
                        <VerifyRefundButton paymentId={p.id} />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {deadBookingPaid.length > 0 ? (
        <div className="rounded-[10px] border border-red-500/25 bg-[var(--oc-panel)] overflow-hidden mb-6">
          <div className="px-5 py-3 border-b border-[var(--oc-line2)]">
            <h2 className="text-sm font-semibold text-red-400 light:text-red-700">
              Буцаалт шаардлагатай ({deadBookingPaid.length})
            </h2>
            <p className="text-xs text-[var(--oc-muted3)] mt-0.5">
              Цуцлагдсан/татгалзсан цагийн хураамж төлөгдсөн байна. Доорх
              хүснэгтээс &quot;Буцаах&quot; үйлдлийг ашиглана уу.
            </p>
          </div>
          <div className="overflow-auto">
            <table className="w-full min-w-[560px]">
              <tbody className="divide-y divide-[var(--oc-line2)]">
                {deadBookingPaid.map((p) => (
                  <tr key={p.id} className="hover:bg-white/[0.02] transition-colors">
                    <td className="px-5 py-2.5 text-sm text-[var(--oc-ink2)]">{p.tenant.name}</td>
                    <td className="px-5 py-2.5 text-xs text-[var(--oc-muted)]">
                      {p.account.name?.trim() || p.account.phone}
                    </td>
                    <td className="px-5 py-2.5 font-plex-mono text-xs text-[var(--oc-ink2)]">
                      {formatTugrik(p.amount.toString())}
                    </td>
                    <td className="px-5 py-2.5 font-plex-mono text-xs text-[var(--oc-muted3)]">
                      {p.paidAt ? p.paidAt.toLocaleString("mn-MN", { hour12: false }) : "—"}
                    </td>
                    <td className="px-5 py-2.5">
                      <RefundButton paymentId={p.id} paymentType={p.paymentType} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {underpaid.length > 0 ? (
        <div className="rounded-[10px] border border-[var(--oc-warn)]/20 bg-[var(--oc-panel)] overflow-hidden mb-6">
          <div className="px-5 py-3 border-b border-[var(--oc-line2)]">
            <h2 className="text-sm font-semibold text-[var(--oc-warn)]">
              Дутуу төлбөр илэрсэн ({underpaid.length})
            </h2>
            <p className="text-xs text-[var(--oc-muted3)] mt-0.5">
              Хэрэглэгч дутуу дүн төлж, Invoice хараахан үүсээгүй байгаа
              захиалгууд — үлдэгдлээ нөхмөгц автоматаар PAID болно.
            </p>
          </div>
          <div className="overflow-auto">
            <table className="w-full min-w-[560px]">
              <tbody className="divide-y divide-[var(--oc-line2)]">
                {underpaid.map((a) => (
                  <tr key={a.id} className="hover:bg-white/[0.02] transition-colors">
                    <td className="px-5 py-2.5 text-sm text-[var(--oc-ink2)]">
                      {a.tenant.name}
                    </td>
                    <td className="px-5 py-2.5 text-xs text-[var(--oc-muted)]">
                      {a.account?.name?.trim() || a.account?.phone || "—"}
                    </td>
                    <td className="px-5 py-2.5 font-plex-mono text-xs text-[var(--oc-warn)]">
                      {formatTugrik(a.feeUnderpaidAmount?.toString())} /{" "}
                      {formatTugrik(a.feeAmount?.toString())}
                    </td>
                    <td className="px-5 py-2.5 font-plex-mono text-xs text-[var(--oc-muted3)]">
                      {a.feeUnderpaidAt
                        ? a.feeUnderpaidAt.toLocaleString("mn-MN", { hour12: false })
                        : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      <div className="rounded-[10px] border border-[var(--oc-line)] bg-[var(--oc-panel)] overflow-hidden">
        {payments.length === 0 ? (
          <div className="px-5 py-16 text-center text-[var(--oc-muted3)] text-sm">
            Бичлэг олдсонгүй.
          </div>
        ) : (
          <div className="overflow-auto">
            <table className="w-full min-w-[900px]">
              <thead>
                <tr className="border-b border-[var(--oc-line2)]">
                  {[
                    "Байгууллага",
                    "Хэрэглэгч",
                    "Дүн",
                    "Төрөл",
                    "Статус",
                    "Төлсөн",
                    "Үйлдэл",
                  ].map((h) => (
                    <th
                      key={h}
                      className="text-left font-plex-mono text-[10.5px] uppercase tracking-[0.08em] text-[var(--oc-muted3)] font-medium px-5 py-3"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--oc-line2)]">
                {payments.map((p) => (
                  <tr key={p.id} className="hover:bg-white/[0.02] transition-colors">
                    <td className="px-5 py-3 text-sm text-[var(--oc-ink2)]">
                      {p.tenant.name}
                    </td>
                    <td className="px-5 py-3 text-xs text-[var(--oc-muted)]">
                      {p.account.name?.trim() || p.account.phone}
                    </td>
                    <td className="px-5 py-3 font-plex-mono text-xs text-[var(--oc-ink2)]">
                      {formatTugrik(p.amount.toString())}
                    </td>
                    <td className="px-5 py-3 text-xs text-[var(--oc-muted3)]">
                      {p.paymentType ?? "—"}
                    </td>
                    <td className="px-5 py-3">
                      <span
                        className={`text-xs px-2 py-0.5 rounded-full ${
                          p.status === "REFUNDED"
                            ? "bg-[var(--oc-panel2)] text-[var(--oc-muted3)]"
                            : "bg-emerald-500/15 text-emerald-400 light:bg-emerald-100 light:text-emerald-700"
                        }`}
                      >
                        {p.status === "REFUNDED" ? "Буцаагдсан" : "Төлөгдсөн"}
                      </span>
                    </td>
                    <td className="px-5 py-3 font-plex-mono text-xs text-[var(--oc-muted3)]">
                      {p.paidAt
                        ? p.paidAt.toLocaleString("mn-MN", { hour12: false })
                        : "—"}
                    </td>
                    <td className="px-5 py-3">
                      {p.status === "PAID" ? (
                        <RefundButton paymentId={p.id} paymentType={p.paymentType} />
                      ) : (
                        <span className="text-xs text-[var(--oc-muted4)]" title={p.refundNote ?? undefined}>
                          {p.refundedAt?.toLocaleDateString("mn-MN") ?? "—"}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <Pagination
          page={meta.page}
          totalPages={meta.totalPages}
          total={meta.total}
          tone="danger"
        />
      </div>
    </div>
  );
}
