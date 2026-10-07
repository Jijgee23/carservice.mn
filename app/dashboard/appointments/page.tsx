import Link from "next/link";
import { redirect } from "next/navigation";
import { Prisma } from "@/app/generated/prisma/client";
import { BulkAppointmentsTable, type BulkAppointmentRow } from "./bulk-appointments-table";
import { AddLinkButton, BtnLink } from "@/app/_components/landing-ops-ui";
import { FilterSelect, ResetFilters, SearchBox } from "@/app/_components/list-filters";
import { EmptyState } from "@/app/_components/page-header";
import { Pagination } from "@/app/_components/pagination";
import {
  APPOINTMENT_STATUSES,
  APPOINTMENT_STATUS_LABEL,
  isAppointmentOverdue,
  type AppointmentStatus,
} from "@/lib/appointments";
import { appointmentSearchWhere } from "@/lib/appointments/appointment-list-query";
import { requireUser } from "@/lib/auth";
import { canAssignOrders } from "@/lib/auth/order-access";
import { canCreate, canEdit, canView, workingBranchScopeId } from "@/lib/auth/roles";
import {
  appointmentAssigneeLabel,
  assigneeOptionsForBranch,
  emptyAssigneeReason,
} from "@/lib/appointments/appointment-assignee-label";
import { buildAssignableUserWhere } from "@/lib/orders/order-assignable-users";
import { customerLabel } from "@/lib/customers";
import { formatPhone } from "@/lib/phone";
import { buildMeta, getPageInfo } from "@/lib/pagination";
import { prisma } from "@/lib/prisma";
import { appointmentBookingPaymentStatus } from "@/lib/appointment-payment-status";

export const metadata = {
  title: "Цаг захиалга",
};

const STATUS_OPTIONS = APPOINTMENT_STATUSES.map((st) => ({
  value: st,
  label: APPOINTMENT_STATUS_LABEL[st],
}));

function formatDateTime(d: Date): string {
  return d.toLocaleString("mn-MN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

const APPOINTMENT_INCLUDE = {
  account: { select: { name: true, phone: true } },
  customer: { select: { fullName: true, phone: true } },
  branch: { select: { name: true } },
  // QA #28: хуучин оноолтыг (идэвхгүй болсон ч) харуулна.
  assignedTo: { select: { id: true, firstName: true, lastName: true } },
  category: { select: { name: true } },
  // Booking v2: олон ангилал (categories) — хуучин ганц category нь
  // энэ migration-ийн өмнөх мөрүүдэд fallback хэвээр үлдэнэ.
  categories: { select: { category: { select: { name: true } } } },
  // S14: dashboard rows displayed only the appointment's own requestedAt even
  // after the linked order progressed past SCHEDULED (own scheduledAt no
  // longer tied to requestedAt by Phase A). Select enough to show both,
  // labeled, mirroring the customer appointment detail page's existing
  // pattern.
  serviceOrder: {
    select: {
      id: true,
      number: true,
      status: true,
      scheduledAt: true,
    },
  },
  payment: { select: { status: true } },
} satisfies Prisma.AppointmentInclude;

export default async function AppointmentsPage({
  searchParams,
}: {
  searchParams: Promise<{
    status?: string;
    q?: string;
    branchId?: string;
    page?: string;
    // Мэдэгдэл дээр дарахад ирнэ (харах: lib/notifications.ts
    // staffAppointmentHref) — тухайн нэг цаг захиалга руу шууд "үсэрнэ",
    // бусад шүүлт/хуудаслалтыг тойрч зөвхөн энэ мөрийг харуулна.
    highlight?: string;
  }>;
}) {
  const user = await requireUser();
  if (!canView(user, "appointments")) redirect("/dashboard");
  const canRespond = canEdit(user, "appointments");
  const canAdd = canCreate(user, "appointments");

  const {
    status: statusParam,
    q = "",
    branchId = "",
    page: pageParam,
    highlight,
  } = await searchParams;
  const status =
    statusParam && (APPOINTMENT_STATUSES as readonly string[]).includes(statusParam)
      ? (statusParam as AppointmentStatus)
      : null;
  const highlightId = highlight?.trim() || null;

  const scopeBranchId = workingBranchScopeId(user);

  const where: Prisma.AppointmentWhereInput = {
    tenantId: user.tenantId,
    ...(status ? { status } : {}),
  };
  if (scopeBranchId) where.branchId = scopeBranchId;
  else if (branchId) where.branchId = branchId;
  const searchWhere = appointmentSearchWhere(q);
  if (searchWhere) where.OR = searchWhere;

  const { page, pageSize, skip, take } = getPageInfo(pageParam);

  let appointments: Prisma.AppointmentGetPayload<{ include: typeof APPOINTMENT_INCLUDE }>[];
  let filteredTotal: number;
  if (highlightId) {
    // Мэдэгдлээс ирсэн бол шүүлт/хуудаслалтыг үл хэрэгсэж яг тухайн мөрийг
    // л (тухайн ажилтны салбарын хүрээнд) шууд авчирна.
    const one = await prisma.appointment.findFirst({
      where: {
        id: highlightId,
        tenantId: user.tenantId,
        ...(scopeBranchId ? { branchId: scopeBranchId } : {}),
      },
      include: APPOINTMENT_INCLUDE,
    });
    appointments = one ? [one] : [];
    filteredTotal = appointments.length;
  } else {
    [appointments, filteredTotal] = await Promise.all([
      prisma.appointment.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take,
        include: APPOINTMENT_INCLUDE,
      }),
      prisma.appointment.count({ where }),
    ]);
  }

  const branches = await prisma.branch.findMany({
    where: {
      tenantId: user.tenantId,
      ...(scopeBranchId ? { id: scopeBranchId } : {}),
    },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });

  // Ажлын төрөл олноор солих модальд хэрэглэнэ — зөвхөн засах эрхтэй бол.
  const categories = canRespond
    ? await prisma.category.findMany({
        where: { tenantId: user.tenantId, isActive: true },
        orderBy: { name: "asc" },
        select: { id: true, name: true },
      })
    : [];

  // QA #28: мастер солих сонголтууд — зөвхөн засах эрхтэйд, orders-ийн
  // мастер сонгогчтой ижил шүүлтүүр (orderAssignableWhere).
  const assignCandidates = canRespond
    ? await prisma.user.findMany({
        where: buildAssignableUserWhere({ tenantId: user.tenantId, branchId: scopeBranchId }),
        orderBy: { firstName: "asc" },
        select: { id: true, firstName: true, lastName: true, branchId: true, assignableBranchIds: true },
      })
    : [];
  const assignOnlyUserId = canAssignOrders(user) ? null : user.id;

  const bulkRows: BulkAppointmentRow[] = appointments.map((a) => {
    const orderHref = `/dashboard/orders/new?${new URLSearchParams({
      customerId: a.customerId ?? "",
      vehicleId: a.vehicleId ?? "",
      branchId: a.branchId,
      scheduledAt: a.requestedAt.toISOString(),
      note: a.note ?? "",
      appointmentId: a.id,
    }).toString()}`;
    // Онлайн бол Account-аас, утсаар бүртгэсэн бол Customer-аас.
    // Нэргүй бол placeholder биш — утсаар нь харуулна (customerLabel).
    const apptPhone = a.account?.phone ?? a.customer?.phone ?? "";
    const displayName = customerLabel({
      fullName: a.account?.name ?? a.customer?.fullName,
      phone: apptPhone,
    });
    // displayName өөрөө утас болсон бол доор давхардуулахгүй.
    const phoneLine =
      apptPhone && displayName !== formatPhone(apptPhone) ? formatPhone(apptPhone) : null;
    // Booking v2: олон ангилал сонгосон бол бүгдийг нь харуулна; энэ
    // migration-ийн өмнөх мөрүүд дээр `categories` хоосон тул хуучин ганц
    // `category`-руу fallback хийнэ.
    const categoryNames = a.categories.length
      ? a.categories.map((c) => c.category.name)
      : a.category
        ? [a.category.name]
        : [];
    const bookingPaymentStatus = appointmentBookingPaymentStatus(a);
    const overdue = isAppointmentOverdue(a);
    return {
      id: a.id,
      displayName,
      phoneLine,
      branchName: a.branch.name,
      categoryNames,
      requestedAtLabel: formatDateTime(a.requestedAt),
      requestedAtIso: a.requestedAt.toISOString(),
      orderScheduledLabel:
        a.serviceOrder && a.serviceOrder.status !== "SCHEDULED" && a.serviceOrder.scheduledAt
          ? `Товлосон огноо: ${formatDateTime(a.serviceOrder.scheduledAt)}`
          : null,
      note: a.note,
      assignedToId: a.assignedToId,
      assigneeName: appointmentAssigneeLabel(a.assignedTo),
      assigneeOptions:
        canRespond && (a.status === "PENDING" || a.status === "CONFIRMED") && !a.serviceOrder
          ? assigneeOptionsForBranch(assignCandidates, a.branchId, {
              onlyUserId: assignOnlyUserId,
              current: a.assignedTo,
            })
          : null,
      assigneeEmptyReason: emptyAssigneeReason(assignOnlyUserId),
      status: a.status,
      bookingPaymentStatus,
      serviceOrderId: a.serviceOrder?.id ?? null,
      serviceOrderNumber: a.serviceOrder?.number ?? null,
      orderHref,
      canConfirm:
        !overdue && (bookingPaymentStatus === "NOT_REQUIRED" || bookingPaymentStatus === "PAID"),
      overdue,
      arrived: !!a.arrivedAt,
    };
  });

  const meta = buildMeta(filteredTotal, page, pageSize);

  return (
    <div className="p-4 sm:p-6 max-w-full flex-1 flex flex-col min-h-0 w-full">
      <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-[var(--oc-ink)]">Цаг захиалга</h1>
          <p className="text-sm text-[var(--oc-muted3)] mt-1">
            Онлайн болон утсаар орж ирсэн цагийн хүсэлтүүд.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <BtnLink href="/dashboard/appointments/calendar" variant="ghost">
            Календарь
          </BtnLink>
          {canAdd ? (
            <AddLinkButton href="/dashboard/appointments/new">Цаг бүртгэх</AddLinkButton>
          ) : null}
        </div>
      </div>

      {highlightId ? (
        <div className="flex items-center justify-between gap-3 mb-4 rounded-[10px] border border-[var(--oc-accent)]/40 bg-[var(--oc-accent)]/[0.08] px-4 py-2.5">
          <p className="text-sm text-[var(--oc-ink2)]">
            Мэдэгдлээс сонгосон нэг цаг захиалга харагдаж байна.
          </p>
          <Link
            href="/dashboard/appointments"
            className="shrink-0 text-sm text-[var(--oc-accent)] hover:text-[var(--oc-accent-hi)] transition-colors"
          >
            Бүх жагсаалт руу буцах →
          </Link>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2 mb-4">
          <SearchBox placeholder="Нэр, утас, тэмдэглэл..." />
          <FilterSelect
            paramName="status"
            placeholder="Бүх төлөв"
            options={STATUS_OPTIONS}
          />
          {!scopeBranchId && branches.length > 1 ? (
            <FilterSelect
              paramName="branchId"
              placeholder="Бүх салбар"
              options={branches.map((b) => ({ value: b.id, label: b.name }))}
            />
          ) : null}
          <ResetFilters paramNames={["status", "q", "branchId"]} />
        </div>
      )}

      {appointments.length === 0 ? (
        <EmptyState
          title={highlightId ? "Цаг захиалга олдсонгүй" : "Цаг захиалгын хүсэлт алга"}
          description={
            highlightId
              ? "Энэ цаг захиалга устгагдсан эсвэл танд харах эрх байхгүй байна."
              : "Одоогоор цаг захиалгын хүсэлт ирээгүй байна."
          }
        />
      ) : (
        <BulkAppointmentsTable
          rows={bulkRows}
          categories={categories}
          canBulkEdit={canRespond}
          canRespond={canRespond}
        />
      )}

      {!highlightId ? (
        <Pagination
          page={meta.page}
          totalPages={meta.totalPages}
          total={meta.total}
          params={{ status: status ?? "", q, branchId }}
        />
      ) : null}
    </div>
  );
}
