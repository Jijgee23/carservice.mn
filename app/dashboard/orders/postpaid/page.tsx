import Link from "next/link";
import { redirect } from "next/navigation";
import { Prisma } from "@/app/generated/prisma/client";
import { ClickableRow } from "@/app/_components/clickable-row";
import {
  DateRangeFilter,
  FilterSelect,
  ResetFilters,
} from "@/app/_components/list-filters";
import { EmptyState, PageHeader } from "@/app/_components/page-header";
import { Pagination } from "@/app/_components/pagination";
import { buildMeta, getPageInfo } from "@/lib/pagination";
import { customerDisplay, customerLabel, orgRegnumLabel } from "@/lib/customers";
import { requireUser } from "@/lib/auth";
import { canView, hasPermission, workingBranchScopeId } from "@/lib/auth/roles";
import { bookingDateKey } from "@/lib/booking-time";
import { getTenantBanks } from "@/lib/tenant-banks";
import { openSessionBranchIds } from "../../cash/open-sessions";
import { SettleButton } from "./settle-dialog";
import { orderReadWhere } from "@/lib/auth/order-access";
import {
  ORDER_STATUS_BADGE,
  ORDER_STATUS_LABEL,
  PAYMENT_STATUS_BADGE,
  PAYMENT_STATUS_LABEL,
  type OrderStatus,
  type PaymentStatus,
  formatTugrik,
} from "@/lib/orders";
import { prisma } from "@/lib/prisma";
import { PAID_AT_SELECT, withPaidInFull } from "@/lib/orders/order-payment-totals";

export const metadata = {
  title: "Дараа төлбөрт",
};

export default async function PostpaidOrdersPage({
  searchParams,
}: {
  searchParams: Promise<{
    vehicleId?: string;
    paymentStatus?: string;
    dateFrom?: string;
    dateTo?: string;
    page?: string;
  }>;
}) {
  const user = await requireUser();
  if (!canView(user, "orders")) redirect("/dashboard");

  const {
    vehicleId = "",
    paymentStatus = "",
    dateFrom = "",
    dateTo = "",
    page: pageParam,
  } = await searchParams;

  // Салбараар хязгаарлагдсан ажилтан зөвхөн өөрийн салбарын захиалгыг харна.
  const scopeBranchId = workingBranchScopeId(user);
  const orderScope: Prisma.ServiceOrderWhereInput = {
    tenantId: user.tenantId,
    isPostpaid: true,
    ...(scopeBranchId ? { branchId: scopeBranchId } : {}),
    // "Зөвхөн өөрийн" эрхтэй ажилтан зөвхөн өөрт оноосон захиалгыг харна.
    ...orderReadWhere(user),
  };
  const ownScoped = Object.keys(orderReadWhere(user)).length > 0;

  // Машин тус бүрийн нэгтгэл — бүх хугацааг хамарна (шүүлтүүрээс хамаарахгүй).
  // Цуцлагдсан захиалга дүнд орохгүй.
  const [links, sums] = await Promise.all([
    prisma.tenantVehicle.findMany({
      where: { tenantId: user.tenantId, isPostpaid: true },
      orderBy: { createdAt: "desc" },
      select: {
        vehicle: { select: { id: true, plate: true, make: true, model: true } },
        customer: {
          select: { id: true, fullName: true, phone: true, isOrganization: true, orgName: true, orgRegnum: true },
        },
      },
    }),
    prisma.serviceOrder.groupBy({
      by: ["vehicleId"],
      where: { ...orderScope, status: { not: "CANCELLED" } },
      _count: { _all: true },
      _sum: { totalAmount: true, paidAmount: true },
    }),
  ]);
  const sumByVehicle = new Map(sums.map((s) => [s.vehicleId, s]));

  const ZERO = new Prisma.Decimal(0);
  // Өөрийн хүрээтэй бол зөвхөн өөрийн захиалгатай машинуудыг харуулна.
  const visibleLinks = ownScoped ? links.filter((l) => sumByVehicle.has(l.vehicle.id)) : links;
  const vehicleRows = visibleLinks.map((l) => {
    const s = sumByVehicle.get(l.vehicle.id);
    const total = s?._sum.totalAmount ?? ZERO;
    const paid = s?._sum.paidAmount ?? ZERO;
    return {
      ...l.vehicle,
      customer: l.customer,
      orderCount: s?._count._all ?? 0,
      total,
      paid,
      balance: total.minus(paid),
    };
  });
  const grandTotal = vehicleRows.reduce((a, v) => a.plus(v.total), ZERO);
  const grandBalance = vehicleRows.reduce((a, v) => a.plus(v.balance), ZERO);
  const grandOrders = vehicleRows.reduce((a, v) => a + v.orderCount, 0);

  // Захиалгын түүх — шүүлтүүртэй.
  const where: Prisma.ServiceOrderWhereInput = { ...orderScope };
  if (vehicleId) where.vehicleId = vehicleId;
  if (paymentStatus && ["UNPAID", "PARTIAL", "PAID"].includes(paymentStatus)) {
    where.paymentStatus = paymentStatus as PaymentStatus;
  }
  const scheduledAt: Prisma.DateTimeFilter = {};
  if (dateFrom) scheduledAt.gte = new Date(`${dateFrom}T00:00:00`);
  if (dateTo) scheduledAt.lte = new Date(`${dateTo}T23:59:59.999`);
  if (scheduledAt.gte || scheduledAt.lte) where.scheduledAt = scheduledAt;

  const { page, pageSize, skip, take } = getPageInfo(pageParam);
  const [rawOrders, filteredTotal] = await Promise.all([
    prisma.serviceOrder.findMany({
      where,
      orderBy: [{ scheduledAt: "desc" }, { createdAt: "desc" }],
      skip,
      take,
      select: {
        id: true,
        number: true,
        status: true,
        paymentStatus: true,
        scheduledAt: true,
        completedAt: true,
        createdAt: true,
        totalAmount: true,
        paidAmount: true,
        ...PAID_AT_SELECT,
        customer: { select: { fullName: true, phone: true } },
        vehicle: { select: { plate: true, make: true, model: true } },
        branch: { select: { name: true } },
      },
    }),
    prisma.serviceOrder.count({ where }),
  ]);
  const orders = rawOrders.map(withPaidInFull);
  const meta = buildMeta(filteredTotal, page, pageSize);

  // «Тооцоо нийлэх» — зөвхөн хоёр эрхтэй хүнд. Салбар/үйлчлүүлэгч/банк зөвхөн үед нь ачаална.
  const canSettle =
    hasPermission(user, "orders.closeUnpaidPostpaid") && hasPermission(user, "cash.manage");
  let settle: {
    branches: { id: string; name: string }[];
    customers: { id: string; name: string }[];
    banks: { code: string; label: string }[];
    openBranchIds: string[];
  } | null = null;
  if (canSettle) {
    const [branches, tenantBanks] = await Promise.all([
      prisma.branch.findMany({
        where: { tenantId: user.tenantId, ...(scopeBranchId ? { id: scopeBranchId } : {}) },
        orderBy: { name: "asc" },
        select: { id: true, name: true },
      }),
      getTenantBanks(user.tenantId),
    ]);
    // Eligibility is the ORDER snapshot (postpaid, COMPLETED, non-internal, outstanding > 0), not the
    // current vehicle link, so source the picker from orders.
    const owing = await prisma.serviceOrder.findMany({
      where: {
        tenantId: user.tenantId,
        isPostpaid: true,
        isInternal: false,
        status: "COMPLETED",
        paymentStatus: { not: "PAID" },
        ...(scopeBranchId ? { branchId: scopeBranchId } : {}),
      },
      take: 5000,
      select: {
        customerId: true,
        totalAmount: true,
        payments: { where: { status: "PAID" }, select: { amount: true } },
      },
    });
    const owingIds = new Set<string>();
    for (const o of owing) {
      const paid = o.payments.reduce((sum, p) => sum.plus(p.amount), ZERO);
      if ((o.totalAmount ?? ZERO).minus(paid).gt(0)) owingIds.add(o.customerId);
    }
    const owingCustomers = owingIds.size
      ? await prisma.customer.findMany({
          where: { tenantId: user.tenantId, id: { in: [...owingIds] } },
          select: { id: true, fullName: true, phone: true, isOrganization: true, orgName: true, orgRegnum: true },
        })
      : [];
    const byCustomer = new Map<string, { id: string; name: string }>();
    for (const c of owingCustomers) {
      const d = customerDisplay(c);
      byCustomer.set(c.id, {
        id: c.id,
        name: [d.primary, d.secondary, orgRegnumLabel(c)].filter(Boolean).join(" · "),
      });
    }
    const labelByCode = new Map(tenantBanks.banks.map((b) => [b.code, b.label] as const));
    settle = {
      branches,
      customers: [...byCustomer.values()].sort((a, b) => a.name.localeCompare(b.name, "mn")),
      banks: tenantBanks.enabledBanks.map((code) => ({ code, label: labelByCode.get(code) ?? code })),
      openBranchIds: await openSessionBranchIds(user.tenantId, branches.map((b) => b.id)),
    };
  }

  const selectedVehicle = vehicleId
    ? vehicleRows.find((v) => v.id === vehicleId)
    : null;

  return (
    <div className="p-4 sm:p-6 max-w-full flex-1 flex flex-col min-h-0 w-full">
      <PageHeader
        title="Дараа төлбөрт"
        description="Гэрээт (дараа төлбөрт) машинуудын засварын хуудасны түүх, тооцоо"
        actions={
          settle ? (
            <SettleButton
              branches={settle.branches}
              defaultBranchId={scopeBranchId ?? settle.branches[0]?.id ?? ""}
              customers={settle.customers}
              banks={settle.banks}
              openBranchIds={settle.openBranchIds}
              today={bookingDateKey(new Date())}
            />
          ) : undefined
        }
      />

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        <StatCard
          label="Дараа төлбөрт машин"
          value={String(links.length)}
          color="text-white"
        />
        <StatCard
          label="Нийт засварын хуудас"
          value={String(grandOrders)}
          color="text-sky-400 light:text-sky-600"
        />
        <StatCard
          label="Нийт дүн"
          value={formatTugrik(grandTotal.toString())}
          color="text-white"
        />
        <StatCard
          label="Төлөгдөөгүй үлдэгдэл"
          value={formatTugrik(grandBalance.toString())}
          color={
            grandBalance.gt(0)
              ? "text-[var(--oc-warn)]"
              : "text-emerald-400 light:text-emerald-600"
          }
        />
      </div>

      {links.length === 0 ? (
        <EmptyState
          title="Дараа төлбөрт машин алга"
          description="Машины бүртгэл дээр «Дараа төлбөрт машин» сонголтыг идэвхжүүлснээр энд харагдана."
          cta={
            <Link
              href="/dashboard/vehicles"
              className="inline-flex items-center gap-2 bg-violet-600 hover:bg-violet-500 transition-colors px-4 py-2.5 rounded-xl text-sm font-medium"
            >
              Машинууд руу очих
            </Link>
          }
        />
      ) : (
        <div className="flex flex-col gap-6">
          {/* Машин тус бүрийн тооцооны нэгтгэл */}
          <div className="glass rounded-2xl overflow-hidden">
            <div className="px-5 py-3 border-b border-white/[0.06] flex items-center justify-between">
              <h2 className="font-semibold text-sm">Машин тус бүрийн тооцоо</h2>
              <span className="text-xs text-white/30 light:text-slate-500">
                Мөр дээр дарж түүхийг шүүнэ
              </span>
            </div>
            <div className="overflow-auto">
              <table className="w-full min-w-[760px]">
                <thead>
                  <tr className="border-b border-white/[0.06]">
                    {[
                      "Машин",
                      "Дугаар",
                      "Эзэмшигч",
                      "Засварын хуудас",
                      "Нийт дүн",
                      "Төлсөн",
                      "Үлдэгдэл",
                    ].map((h) => (
                      <th
                        key={h}
                        className="text-left text-xs text-white/30 light:text-slate-500 font-medium px-5 py-3"
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {vehicleRows.map((v) => (
                    <ClickableRow
                      key={v.id}
                      href={`/dashboard/orders/postpaid?vehicleId=${v.id}`}
                    >
                      <td className="px-5 py-3.5 text-sm text-white/85">
                        {v.make} {v.model}
                      </td>
                      <td className="px-5 py-3.5">
                        <span className="text-sm font-mono font-medium text-white/80">
                          {v.plate}
                        </span>
                      </td>
                      <td className="px-5 py-3.5 text-sm text-white/70">
                        {v.customer ? (
                          <>
                            {customerLabel(v.customer)}
                            <span className="text-white/30 text-xs ml-1">
                              · {v.customer.phone}
                            </span>
                          </>
                        ) : (
                          <span className="text-white/30">—</span>
                        )}
                      </td>
                      <td className="px-5 py-3.5 text-sm text-white/60">
                        {v.orderCount}
                      </td>
                      <td className="px-5 py-3.5 text-sm text-white/80 tabular-nums">
                        {formatTugrik(v.total.toString())}
                      </td>
                      <td className="px-5 py-3.5 text-sm text-white/60 tabular-nums">
                        {formatTugrik(v.paid.toString())}
                      </td>
                      <td className="px-5 py-3.5 text-sm tabular-nums">
                        <span
                          className={
                            v.balance.gt(0)
                              ? "text-[var(--oc-warn)] font-medium"
                              : "text-emerald-300 light:text-emerald-700"
                          }
                        >
                          {formatTugrik(v.balance.toString())}
                        </span>
                      </td>
                    </ClickableRow>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Засварын хуудасны түүх */}
          <div className="glass rounded-2xl overflow-hidden flex-1 min-h-0 flex flex-col">
            <div className="px-5 py-3 border-b border-white/[0.06] flex flex-wrap items-center gap-2">
              <h2 className="font-semibold text-sm mr-2">
                Засварын хуудасны түүх
                {selectedVehicle ? (
                  <span className="text-white/40 font-normal">
                    {" "}
                    · {selectedVehicle.plate}
                  </span>
                ) : null}
              </h2>
              <FilterSelect
                paramName="vehicleId"
                placeholder="Бүх машин"
                searchable
                searchPlaceholder="Дугаар, маркаар хайх..."
                options={vehicleRows.map((v) => ({
                  value: v.id,
                  label: v.plate,
                  hint: `${v.make} ${v.model}`,
                }))}
              />
              <FilterSelect
                paramName="paymentStatus"
                placeholder="Бүх төлбөр"
                options={[
                  { value: "UNPAID", label: PAYMENT_STATUS_LABEL.UNPAID },
                  { value: "PARTIAL", label: PAYMENT_STATUS_LABEL.PARTIAL },
                  { value: "PAID", label: PAYMENT_STATUS_LABEL.PAID },
                ]}
              />
              <DateRangeFilter label="Товлосон" />
              <ResetFilters
                paramNames={["vehicleId", "paymentStatus", "dateFrom", "dateTo"]}
              />
              <div className="ml-auto text-xs text-white/30 light:text-slate-500">
                {filteredTotal} засварын хуудас
              </div>
            </div>

            {orders.length === 0 ? (
              <div className="px-5 py-16 text-center text-white/40 text-sm">
                Шүүлтүүрт тохирох засварын хуудас алга.
              </div>
            ) : (
              <div className="overflow-auto flex-1 min-h-0">
                <table className="w-full min-w-[820px]">
                  <thead>
                    <tr className="border-b border-white/[0.06]">
                      {[
                        "#",
                        "Машин",
                        "Үйлчлүүлэгч",
                        "Салбар",
                        "Огноо",
                        "Дүн",
                        "Төлбөр",
                        "Статус",
                      ].map((h) => (
                        <th
                          key={h}
                          className="text-left text-xs text-white/30 light:text-slate-500 font-medium px-5 py-3"
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {orders.map((o) => {
                      const when = o.completedAt ?? o.scheduledAt ?? o.createdAt;
                      return (
                        <ClickableRow
                          key={o.id}
                          href={`/dashboard/orders/${o.id}`}
                        >
                          <td className="px-5 py-3.5">
                            <Link
                              href={`/dashboard/orders/${o.id}`}
                              className="font-mono text-sm font-semibold text-violet-300 hover:text-violet-200 light:text-violet-700 light:hover:text-violet-800"
                            >
                              #{o.number}
                            </Link>
                          </td>
                          <td className="px-5 py-3.5 text-sm">
                            <div className="text-white/80">
                              {o.vehicle.make} {o.vehicle.model}
                            </div>
                            <div className="text-xs text-white/30 font-mono">
                              {o.vehicle.plate}
                            </div>
                          </td>
                          <td className="px-5 py-3.5 text-sm text-white/70">
                            {customerLabel(o.customer)}
                          </td>
                          <td className="px-5 py-3.5 text-sm text-white/50">
                            {o.branch.name}
                          </td>
                          <td className="px-5 py-3.5 text-xs text-white/40 tabular-nums">
                            {when.toLocaleString("mn-MN", {
                              year: "numeric",
                              month: "short",
                              day: "2-digit",
                              hour: "2-digit",
                              minute: "2-digit",
                              hour12: false,
                            })}
                          </td>
                          <td className="px-5 py-3.5 text-sm text-white/80 tabular-nums">
                            {formatTugrik(o.totalAmount?.toString() ?? null)}
                          </td>
                          <td className="px-5 py-3.5">
                            <span
                              className={`text-[10px] px-1.5 py-0.5 rounded-full ${
                                PAYMENT_STATUS_BADGE[
                                  o.paymentStatus as PaymentStatus
                                ]
                              }`}
                            >
                              {
                                PAYMENT_STATUS_LABEL[
                                  o.paymentStatus as PaymentStatus
                                ]
                              }
                            </span>
                          </td>
                          <td className="px-5 py-3.5">
                            <span
                              className={`text-xs px-2.5 py-1 rounded-full ${
                                ORDER_STATUS_BADGE[o.status as OrderStatus]
                              }`}
                            >
                              {ORDER_STATUS_LABEL[o.status as OrderStatus]}
                            </span>
                          </td>
                        </ClickableRow>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            <Pagination
              page={meta.page}
              totalPages={meta.totalPages}
              total={meta.total}
              params={{ vehicleId, paymentStatus, dateFrom, dateTo }}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function StatCard({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color: string;
}) {
  return (
    <div className="glass rounded-xl p-4">
      <div className={`text-2xl font-bold ${color} truncate`}>{value}</div>
      <div className="text-xs text-white/40 mt-1">{label}</div>
    </div>
  );
}
