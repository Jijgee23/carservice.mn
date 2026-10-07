import { RECEIVABLE_ORDER_WHERE } from "@/lib/orders/order-receivable";
import { orderVinSearchClauses } from "@/lib/orders/order-list-query";
import { formerPlate } from "@/lib/vehicle-plate";
import { Prisma } from "@/app/generated/prisma/client";
import {
  DateRangeFilter,
  FilterSelect,
  ResetFilters,
  SearchBox,
} from "@/app/_components/list-filters";
import { AddLinkButton, BtnLink } from "@/app/_components/landing-ops-ui";
import { PageHeader } from "@/app/_components/page-header";
import { Pagination } from "@/app/_components/pagination";
import { buildMeta, getPageInfo } from "@/lib/pagination";
import { customerLabel, orgRegnumLabel } from "@/lib/customers";
import { requireUser } from "@/lib/auth";
import { canCreate, canEdit, canView, orderAssignableWhere, workingBranchScopeId } from "@/lib/auth/roles";
import { canAssignOrders, orderReadWhere } from "@/lib/auth/order-access";
import { redirect } from "next/navigation";
import {
  ORDER_STATUSES,
  ORDER_STATUS_LABEL,
  PAYMENT_STATUS_LABEL,
  INTERNAL_REPAIR_LABEL,
  POSTPAID_LABEL,
  formatTugrik,
  type OrderStatus,
  type PaymentStatus,
} from "@/lib/orders";
import { prisma } from "@/lib/prisma";
import { formatShortDateTime, parseSort } from "@/lib/list-sort";
import { BulkOrdersTable, type BulkOrderRow } from "./bulk-orders-table";
import { customerRelationSearchClauses } from "@/lib/customers/customer-search";

export const metadata = {
  title: "Засварын хуудас",
};

export default async function OrdersPage({
  searchParams,
}: {
  searchParams: Promise<{
    status?: string;
    q?: string;
    branchId?: string;
    paymentStatus?: string;
    postpaid?: string;
    internal?: string;
    unpaid?: string;
    paymentMode?: string;
    customerId?: string;
    vehicleId?: string;
    dateFrom?: string;
    dateTo?: string;
    page?: string;
    sort?: string;
    dir?: string;
  }>;
}) {
  const user = await requireUser();
  if (!canView(user, "orders")) redirect("/dashboard");
  const canAdd = canCreate(user, "orders");

  const {
    status: statusParam,
    q = "",
    branchId = "",
    paymentStatus = "",
    postpaid = "",
    internal = "",
    unpaid = "",
    paymentMode = "",
    customerId = "",
    vehicleId = "",
    dateFrom = "",
    dateTo = "",
    page: pageParam,
    sort: sortParam,
    dir: dirParam,
  } = await searchParams;
  const sort = parseSort(
    { sort: sortParam, dir: dirParam },
    ["date", "amount", "created"] as const,
    { key: "created", dir: "desc" },
  );
  const orderBy: Prisma.ServiceOrderOrderByWithRelationInput =
    sort.key === "date"
      ? { scheduledAt: { sort: sort.dir, nulls: "last" } }
      : sort.key === "amount"
        ? { totalAmount: { sort: sort.dir, nulls: "last" } }
        : { createdAt: sort.dir };
  const status =
    statusParam && (ORDER_STATUSES as readonly string[]).includes(statusParam)
      ? (statusParam as OrderStatus)
      : null;

  // Салбараар хязгаарлагдсан ажилтан зөвхөн өөрийн салбарын захиалгыг харна.
  const scopeBranchId = workingBranchScopeId(user);

  const where: Prisma.ServiceOrderWhereInput = {
    tenantId: user.tenantId,
    ...orderReadWhere(user),
    ...(status ? { status } : {}),
  };
  if (scopeBranchId) where.branchId = scopeBranchId;
  else if (branchId) where.branchId = branchId;
  if (customerId) where.customerId = customerId;
  if (vehicleId) where.vehicleId = vehicleId;
  if (
    paymentStatus &&
    ["UNPAID", "PARTIAL", "PAID"].includes(paymentStatus)
  ) {
    where.paymentStatus = paymentStatus as PaymentStatus;
  }
  if (postpaid === "yes") where.isPostpaid = true;
  else if (postpaid === "no") where.isPostpaid = false;
  if (internal === "yes") where.isInternal = true;
  else if (internal === "no") where.isInternal = false;
  // Нэгдсэн "Төлбөрийн нөхцөл" шүүлтүүр (postpaid/internal param-ууд хуучин холбоосонд үлдэнэ).
  if (paymentMode === "regular") {
    where.isPostpaid = false;
    where.isInternal = false;
  } else if (paymentMode === "postpaid") where.isPostpaid = true;
  else if (paymentMode === "internal") where.isInternal = true;
  // «Авлага» — dashboard card link: completed, non-internal, unpaid balance (same definition as lib/orders/order-receivable).
  // Composed with AND so it narrows (never overwrites) the other filters; conflicts give an empty list.
  if (unpaid === "1") {
    where.AND = [
      ...(Array.isArray(where.AND) ? where.AND : where.AND ? [where.AND] : []),
      RECEIVABLE_ORDER_WHERE,
    ];
  }
  // Огнооны муж — товлосон огноо (scheduledAt)-аар шүүнэ
  const scheduledAt: Prisma.DateTimeFilter = {};
  if (dateFrom) scheduledAt.gte = new Date(`${dateFrom}T00:00:00`);
  if (dateTo) scheduledAt.lte = new Date(`${dateTo}T23:59:59.999`);
  if (scheduledAt.gte || scheduledAt.lte) where.scheduledAt = scheduledAt;
  if (q) {
    where.OR = [
      { number: { contains: q, mode: "insensitive" } },
      ...customerRelationSearchClauses(q, (customer) => ({ customer })),
      { plateSnapshot: { contains: q, mode: "insensitive" } },
      { vehicle: { plate: { contains: q, mode: "insensitive" } } },
      { vehicle: { make: { contains: q, mode: "insensitive" } } },
      { vehicle: { model: { contains: q, mode: "insensitive" } } },
      ...orderVinSearchClauses(q),
    ];
  }

  const canBulkEdit = canEdit(user, "orders");
  const canAssign = canAssignOrders(user);

  const { page, pageSize, skip, take } = getPageInfo(pageParam);
  const [orders, filteredTotal, counts, branches, customers, vehicles, employees] =
    await Promise.all([
    prisma.serviceOrder.findMany({
      where,
      orderBy: [orderBy, { id: "asc" }],
      skip,
      take,
      include: {
        customer: { select: { fullName: true, phone: true } },
        vehicle: { select: { plate: true, make: true, model: true } },
        branch: { select: { name: true } },
        assignedTo: { select: { firstName: true, lastName: true } },
        items: {
          orderBy: { createdAt: "asc" },
          take: 3,
          select: { id: true, description: true, kind: true },
        },
        _count: { select: { items: true } },
      },
    }),
    prisma.serviceOrder.count({ where }),
    prisma.serviceOrder.groupBy({
      by: ["status"],
      where: {
        tenantId: user.tenantId,
        ...orderReadWhere(user),
        ...(scopeBranchId ? { branchId: scopeBranchId } : {}),
      },
      _count: { _all: true },
    }),
    prisma.branch.findMany({
      where: {
        tenantId: user.tenantId,
        ...(scopeBranchId ? { id: scopeBranchId } : {}),
      },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    prisma.customer.findMany({
      where: { tenantId: user.tenantId, serviceOrders: { some: { ...orderReadWhere(user) } } },
      orderBy: { fullName: "asc" },
      select: { id: true, fullName: true, phone: true, isOrganization: true, orgRegnum: true },
    }),
    prisma.tenantVehicle
      .findMany({
        where: { tenantId: user.tenantId, isActive: true },
        orderBy: { vehicle: { plate: "asc" } },
        select: {
          vehicle: {
            select: { id: true, plate: true, make: true, model: true },
          },
        },
      })
      .then((rows) => rows.map((r) => r.vehicle)),
    canBulkEdit
      ? prisma.user.findMany({
          // Хариуцагч оноох сонголт — ажлаас гарсан / хугацаа дууссан /
          // orders.assignable эрхгүй ажилтныг харуулахгүй (сервер ч татгалзана).
          where: { tenantId: user.tenantId, isActive: true, ...orderAssignableWhere() },
          orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
          select: { id: true, firstName: true, lastName: true },
        })
      : Promise.resolve([]),
  ]);

  const countByStatus = Object.fromEntries(
    counts.map((c) => [c.status, c._count._all]),
  );
  const total = counts.reduce((a, c) => a + c._count._all, 0);
  const meta = buildMeta(filteredTotal, page, pageSize);

  const bulkRows: BulkOrderRow[] = orders.map((o) => ({
    id: o.id,
    number: o.number,
    customerLabel: customerLabel(o.customer),
    vehicleMakeModel: `${o.vehicle.make} ${o.vehicle.model}`,
    vehiclePlate: o.vehicle.plate,
    formerPlate: formerPlate(o.plateSnapshot, o.vehicle.plate),
    items: o.items,
    itemCount: o._count.items,
    branchName: o.branch.name,
    assignedToLabel: o.assignedTo
      ? `${o.assignedTo.lastName} ${o.assignedTo.firstName}`
      : null,
    scheduledAtLabel: o.scheduledAt
      ? formatShortDateTime(o.scheduledAt)
      : null,
    totalLabel: formatTugrik(o.totalAmount ? o.totalAmount.toString() : null),
    paymentStatus: o.paymentStatus as PaymentStatus,
    isPostpaid: o.isPostpaid,
    isInternal: o.isInternal,
    status: o.status as OrderStatus,
  }));
  const employeeOptions = employees.map((e) => ({
    id: e.id,
    label: `${e.lastName} ${e.firstName}`,
  }));

  return (
    <div className="p-4 sm:p-6 max-w-full flex-1 flex flex-col min-h-0 w-full">
      <PageHeader
        title="Засварын хуудас"
        description="Бүх ажил, статус, орлогын бүртгэл"
        actions={
          <>
            <BtnLink href="/dashboard/orders/in-progress" variant="ghost">
              Явц харах
            </BtnLink>
            {canAdd ? (
              <AddLinkButton href="/dashboard/orders/new">
                Засварын хуудас үүсгэх
              </AddLinkButton>
            ) : null}
          </>
        }
      />

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        <StatCard label="Нийт" value={total} color="text-[var(--oc-ink)]" />
        <StatCard
          label={ORDER_STATUS_LABEL.SCHEDULED}
          value={countByStatus.SCHEDULED ?? 0}
          color="text-[var(--oc-warn)]"
        />
        <StatCard
          label={ORDER_STATUS_LABEL.IN_PROGRESS}
          value={countByStatus.IN_PROGRESS ?? 0}
          color="text-blue-400 light:text-blue-600"
        />
        <StatCard
          label={ORDER_STATUS_LABEL.COMPLETED}
          value={countByStatus.COMPLETED ?? 0}
          color="text-emerald-400 light:text-emerald-600"
        />
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-4">
        <SearchBox placeholder="№, үйлчлүүлэгч, улсын/арлын дугаараар хайх" />
        <FilterSelect
          paramName="status"
          placeholder="Бүх төлөв"
          options={[
            { value: "SCHEDULED", label: ORDER_STATUS_LABEL.SCHEDULED },
            { value: "IN_PROGRESS", label: ORDER_STATUS_LABEL.IN_PROGRESS },
            { value: "COMPLETED", label: ORDER_STATUS_LABEL.COMPLETED },
            { value: "CANCELLED", label: ORDER_STATUS_LABEL.CANCELLED },
          ]}
        />
        <FilterSelect
          paramName="branchId"
          placeholder="Бүх салбар"
          options={branches.map((b) => ({ value: b.id, label: b.name }))}
        />
        <FilterSelect
          paramName="customerId"
          placeholder="Бүх үйлчлүүлэгч"
          searchable
          searchPlaceholder="Үйлчлүүлэгч хайх..."
          options={customers.map((c) => ({
            value: c.id,
            label: customerLabel(c),
            hint: [orgRegnumLabel(c), c.phone].filter(Boolean).join(" · "),
          }))}
        />
        <FilterSelect
          paramName="vehicleId"
          placeholder="Бүх машин"
          searchable
          searchPlaceholder="Дугаар, маркаар хайх..."
          options={vehicles.map((v) => ({
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
        <FilterSelect
          paramName="paymentMode"
          placeholder="Төлбөрийн нөхцөл"
          options={[
            { value: "regular", label: "Энгийн" },
            { value: "postpaid", label: POSTPAID_LABEL },
            { value: "internal", label: INTERNAL_REPAIR_LABEL },
          ]}
        />
        <DateRangeFilter label="Товлосон" />
        <ResetFilters
          paramNames={[
            "q",
            "branchId",
            "customerId",
            "vehicleId",
            "paymentStatus",
            "postpaid",
            "internal",
            "paymentMode",
            "unpaid",
            "dateFrom",
            "dateTo",
            "status",
          ]}
        />
      </div>

      <div className="rounded-[10px] border border-[var(--oc-line)] bg-[var(--oc-panel)] overflow-hidden flex-1 min-h-0 flex flex-col">
        <div className="px-4 py-2.5 border-b border-[var(--oc-line)] flex items-center">
          <div className="ml-auto text-xs text-[var(--oc-muted3)]">
            {filteredTotal} засварын хуудас
          </div>
        </div>

        {orders.length === 0 ? (
          <div className="px-5 py-16 text-center text-[var(--oc-muted3)] text-sm flex-1">
            {status
              ? "Энэ статуст засварын хуудас алга."
              : "Засварын хуудас алга байна. Эхний засварын хуудсаа үүсгээрэй."}
          </div>
        ) : (
          <BulkOrdersTable
            rows={bulkRows}
            employees={employeeOptions}
            canBulkEdit={canBulkEdit}
            canAssign={canAssign}
            currentUserId={user.id}
            sort={sort}
          />
        )}

        <Pagination
          page={meta.page}
          totalPages={meta.totalPages}
          total={meta.total}
          params={{
            status: status ?? "",
            q,
            branchId,
            customerId,
            vehicleId,
            paymentStatus,
            postpaid,
            internal,
            paymentMode,
            unpaid,
            dateFrom,
            dateTo,
            sort: sortParam ?? "",
            dir: dirParam ?? "",
          }}
        />
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  color,
}: {
  label: string;
  value: number;
  color: string;
}) {
  return (
    <div className="rounded-[10px] border border-[var(--oc-line)] bg-[var(--oc-panel)] p-4">
      <div className={`text-2xl font-bold ${color}`}>{value}</div>
      <div className="text-xs text-[var(--oc-muted3)] mt-1">{label}</div>
    </div>
  );
}
