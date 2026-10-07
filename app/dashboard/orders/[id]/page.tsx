import { formerPlate } from "@/lib/vehicle-plate";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Prisma } from "@/app/generated/prisma/client";
import { deleteOrderAction } from "@/app/_actions/orders";
import { ConfirmForm } from "@/app/_components/confirm-form";
import { Btn } from "@/app/_components/landing-ops-ui";
import { requireUser } from "@/lib/auth";
import {
  orderAssignableWhere,
  canCreate,
  canDelete,
  canEdit,
  canView,
  hasPermission,
  workingBranchScopeId,
} from "@/lib/auth/roles";
import { canEditOrder as canEditAssignedOrder, canViewOrder } from "@/lib/auth/order-access";
import { redirect } from "next/navigation";
import { tenantVisibleTemplateWhere } from "@/lib/diagnostics";
import { customerLabel } from "@/lib/customers";
import type { ServiceKind } from "@/lib/services";
import {
  ORDER_STATUS_BADGE,
  ORDER_STATUS_LABEL,
  ORDER_STATUS_TRANSITIONS,
  PAYMENT_STATUS_BADGE,
  PAYMENT_STATUS_LABEL,
  INTERNAL_BADGE,
  INTERNAL_LABEL,
  INTERNAL_PAYMENT_NOTE,
  POSTPAID_BADGE,
  POSTPAID_CLOSE_FORBIDDEN_MESSAGE,
  POSTPAID_LABEL,
  POSTPAID_SETTLEMENT_NOTE,
  type OrderStatus,
  type PaymentStatus,
  canFillDiagnostics,
  formatTugrik,
} from "@/lib/orders";
import { canSettlePostpaidOrder } from "@/lib/orders/order-commands";
import { prisma } from "@/lib/prisma";
import { calculateServiceItemDurationMinutes } from "@/lib/service-duration";
import type { QPayBankUrl } from "@/lib/qpay-tenant";
import { AddItemForm } from "./add-item-form";
import { IntakeRecord } from "./intake-record";
import { OrderItems } from "./order-items";
import { OrderPaymentsList } from "./order-payments-list";
import { openSessionBranchIds } from "../../cash/open-sessions";
import { PAYMENT_LEDGER_SELECT } from "@/lib/orders/order-payment-commands";
import { PAID_PAYMENT_LOCKED_CANCEL_REASON } from "@/lib/cash/locked-copy";
import { findLockedPaymentIds } from "@/lib/cash/session-attach";
import { getTenantBanks } from "@/lib/tenant-banks";
import { StatusControls } from "./status-controls";
import { OrderForm } from "../order-form";
import { vehicleOwnerIsOrganization } from "@/lib/vehicles/owner-kind";

export const metadata = {
  title: "Засварын хуудасны дэлгэрэнгүй",
};

export default async function OrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireUser();
  if (!canView(user, "orders")) redirect("/dashboard");
  const canChangeItemStatus = hasPermission(user, "orders.itemStatus");
  const canChangeItemPrice = hasPermission(user, "orders.itemPrice");
  const canViewItemHistory = hasPermission(user, "orders.itemHistory");
  const canDeleteOrder = canDelete(user, "orders");
  const canEditPayments = canEdit(user, "payments");
  const canRecordPayments = canCreate(user, "payments");
  const canReversePayments = canDelete(user, "payments");
  const scopeBranchId = workingBranchScopeId(user);
  const { id } = await params;

  const [order, branches, customers, vehicles, technicians, services, diagnosticTemplates] = await Promise.all([
    prisma.serviceOrder.findFirst({
      where: {
        id,
        tenantId: user.tenantId,
        ...(scopeBranchId ? { branchId: scopeBranchId } : {}),
      },
      include: {
        items: {
          orderBy: { createdAt: "asc" },
          include: {
            cancelledBy: { select: { firstName: true, lastName: true } },
            diagnosticTemplate: { select: { type: true, durationMin: true } },
            service: {
              select: {
                durationValue: true,
                durationUnit: { select: { name: true, code: true } },
              },
            },
          },
        },
        categories: {
          orderBy: { createdAt: "asc" },
        },
        intakePhotos: {
          orderBy: { createdAt: "asc" },
          select: { id: true, path: true },
        },
        intakeRecordedBy: { select: { firstName: true, lastName: true } },
        customer: { select: { id: true, fullName: true, phone: true } },
        vehicle: {
          select: {
            id: true,
            plate: true,
            make: true,
            model: true,
            year: true,
          },
        },
        branch: { select: { name: true } },
        assignedTo: { select: { id: true, firstName: true, lastName: true } },
      },
    }),
    prisma.branch.findMany({
      where: {
        tenantId: user.tenantId,
        ...(scopeBranchId ? { id: scopeBranchId } : {}),
      },
      orderBy: { createdAt: "asc" },
      select: { id: true, name: true },
    }),
    prisma.customer.findMany({
      where: { tenantId: user.tenantId },
      orderBy: { fullName: "asc" },
      select: { id: true, fullName: true, phone: true, isOrganization: true, orgName: true, orgRegnum: true },
    }),
    prisma.tenantVehicle
      .findMany({
        where: { tenantId: user.tenantId, isActive: true },
        orderBy: { createdAt: "desc" },
        select: {
          customerId: true,
          isPostpaid: true,
          customer: { select: { isOrganization: true } },
          vehicle: {
            select: { id: true, plate: true, vin: true, make: true, model: true, ownerRegnum: true },
          },
        },
      })
      .then((rows) =>
        rows.map(({ vehicle: { ownerRegnum, ...vehicle }, customer, ...r }) => ({
          ...vehicle,
          customerId: r.customerId,
          isPostpaid: r.isPostpaid,
          ownerIsOrganization: vehicleOwnerIsOrganization(customer, ownerRegnum),
        })),
      ),
    prisma.user.findMany({
      where: {
        tenantId: user.tenantId,
        isActive: true,
        ...orderAssignableWhere(),
      },
      orderBy: { firstName: "asc" },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        branchId: true,
        assignableBranchIds: true,
        isOwner: true,
        role: { select: { name: true } },
      },
    }),
    prisma.service.findMany({
      where: {
        tenantId: user.tenantId,
        isActive: true,
        // Үлдэгдэлгүй сэлбэгийг ч жагсаана ("Үлдэгдэлгүй" гэж тэмдэглэнэ) — эс
        // бөгөөс шинэ сэлбэг огт харагдахгүй, «Сэлбэг» tab идэвхгүй болдог.
        // Үлдэгдэл хүрэхгүй бол addOrderItemCommand тодорхой алдаа буцаана.
        type: { in: ["LABOR", "GOODS"] },
      },
      orderBy: [{ type: "asc" }, { name: "asc" }],
      select: {
        id: true,
        type: true,
        name: true,
        code: true,
        price: true,
        stock: true,
        unit: { select: { name: true } },
        categoryId: true,
        category: { select: { name: true } },
      },
    }),
    prisma.diagnosticTemplate.findMany({
      where: { ...tenantVisibleTemplateWhere(user.tenantId), isActive: true },
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        type: true,
        price: true,
        durationMin: true,
      },
    }),
  ]);

  // QPay тохиргоо + одоо хүлээгдэж байгаа QPay invoice + бүртгэгдсэн
  // төлбөрүүдийн жагсаалт (арга бүрээр — жишээ нь 20,000₮ QPay, 50,000₮ бэлнээр).
  const [qpayConfig, pendingOrderPayment, orderPayments, tenantBanks] = await Promise.all([
    prisma.tenantQPaySettings.findUnique({
      where: { tenantId: user.tenantId },
      select: { enabled: true },
    }),
    prisma.orderPayment.findFirst({
      where: { orderId: id, status: "PENDING", method: "QPAY" },
      orderBy: { createdAt: "desc" },
    }),
    prisma.orderPayment.findMany({
      where: { orderId: id, status: { not: "PENDING" } },
      orderBy: { createdAt: "desc" },
      select: PAYMENT_LEDGER_SELECT,
    }),
    getTenantBanks(user.tenantId),
  ]);
  const qpayReady = Boolean(qpayConfig?.enabled);
  const lockedPaymentIds = await findLockedPaymentIds(prisma, user.tenantId, orderPayments.map((p) => p.id));

  if (!order) notFound();
  if (!canViewOrder(user, order)) redirect("/dashboard/orders");
  const canEditOrder = canEditAssignedOrder(user, order);

  const status = order.status as OrderStatus;
  const paymentStatus = order.paymentStatus as PaymentStatus;
  const allowedTransitions = ORDER_STATUS_TRANSITIONS[status];
  const remainingAmount = (order.totalAmount ?? new Prisma.Decimal(0))
    .minus(order.paidAmount ?? new Prisma.Decimal(0))
    .toString();
  const isEditable = status !== "COMPLETED" && status !== "CANCELLED";
  const diagnosticsFillable = canFillDiagnostics(status);
  const serviceItemDurationMinutes = calculateServiceItemDurationMinutes(order.items);

  // Гүйцэтгэлийн прогресс: цуцлагдаагүй мөрүүдээс хэд нь дууссан вэ.
  // Сэлбэг (PART) мөрүүд явцгүй тул тооцоололд оролцохгүй.
  // Зөвхөн хуудас эхэлсэн (IN_PROGRESS) үед харуулна.
  const orderStarted = diagnosticsFillable;
  const activeItems = order.items.filter(
    (it) => it.status !== "CANCELLED" && it.kind !== "PART",
  );
  const completedItemsCount = activeItems.filter(
    (it) => it.status === "COMPLETED",
  ).length;
  const progressPercent =
    activeItems.length > 0
      ? Math.round((completedItemsCount / activeItems.length) * 100)
      : 0;

  // Оношилгоо (kind=DIAGNOSTIC) мөрүүд: тайлан бөглөгдсөн эсэхийг "Гүйцэтгэл"
  // тоймд ашиглана — бөглөх/үзэх нь тухайн мөрөөс өөрөөс нь (OrderItems).
  const diagnosticItems = activeItems.filter((it) => it.kind === "DIAGNOSTIC");
  const unfilledDiagnosticItems = diagnosticItems.filter(
    (it) => !it.diagnosticReportId,
  );
  const filledDiagnosticCount = diagnosticItems.length - unfilledDiagnosticItems.length;

  // Төлөгдсөн төлбөртэй бол мөрийн мөнгөн дүнг өөрчлөхгүй (сервер ч хориглоно).
  const hasPaidPayment = orderPayments.some((p) => p.status === "PAID");
  // Дууссан дараа тооцоот захиалгын төлбөрийг зөвхөн orders.closeUnpaidPostpaid эрхтэй хүн бүртгэнэ.
  const canSettle = canSettlePostpaidOrder(user, { isPostpaid: order.isPostpaid, status: order.status });
  // Every user-initiated money write (record / QPay start / reverse) needs the order's branch register open.
  const cashSessionOpen =
    (canRecordPayments || canReversePayments || canEditPayments) && canSettle
      ? (await openSessionBranchIds(user.tenantId, [order.branchId])).length > 0
      : true;
  const settlementLocked = !canSettle;
  // «Дуусгах»-ын урьдчилсан нөхцөл — applyOrderPatchCommand-ийн шалгалттай ижил.
  const unfinishedItemsCount = activeItems.length - completedItemsCount;
  const remainingDecimal = (order.totalAmount ?? new Prisma.Decimal(0)).minus(
    order.paidAmount ?? new Prisma.Decimal(0),
  );
  const completeBlockedReason =
    unfilledDiagnosticItems.length > 0
      ? "Бөглөгдөөгүй оношилгоо байна."
      : unfinishedItemsCount > 0
        ? `Дуусаагүй ${unfinishedItemsCount} ажил байна.`
        : order.isInternal
          ? null
          : remainingDecimal.gt(0) && !order.isPostpaid
          ? `Төлбөр бүрэн төлөгдөөгүй (үлдэгдэл ${formatTugrik(remainingDecimal.toString())}).`
          : remainingDecimal.gt(0) && !hasPermission(user, "orders.closeUnpaidPostpaid")
            ? POSTPAID_CLOSE_FORBIDDEN_MESSAGE
            : null;
  // Ижил оношилгоо нэг засварын хуудсанд давхардаж болохгүй тул аль хэдийн
  // нэмэгдсэн загваруудыг "+ Мөр нэмэх" сонголтоос хасна.
  const usedDiagnosticTemplateIds = new Set(
    diagnosticItems
      .map((it) => it.diagnosticTemplateId)
      .filter((id): id is string => Boolean(id)),
  );

  return (
    <div className="p-4 sm:p-6 max-w-full flex-1 flex flex-col min-h-0 w-full">
      <nav className="flex items-center gap-1.5 text-[13px] text-[var(--oc-muted3)] mb-3">
        <Link href="/dashboard/orders" className="hover:text-[var(--oc-accent-hi)] transition-colors">
          Засварын хуудас
        </Link>
        <span>/</span>
        <span className="text-[var(--oc-muted)]">#{order.number}</span>
      </nav>

      <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-[var(--oc-ink)]">
            Засварын хуудас #{order.number}
          </h1>
          <p className="text-sm text-[var(--oc-muted3)] mt-1">
            {customerLabel(order.customer)} · {order.vehicle.plate}
            {formerPlate(order.plateSnapshot, order.vehicle.plate) ? (
              <span className="text-[var(--oc-muted3)]">
                {" "}
                (хуучин: {formerPlate(order.plateSnapshot, order.vehicle.plate)})
              </span>
            ) : null}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {order.isInternal ? (
            <span
              className={`font-plex-mono text-[11px] px-3 py-1.5 rounded-full ${INTERNAL_BADGE}`}
            >
              {INTERNAL_LABEL}
            </span>
          ) : null}
          {order.isPostpaid ? (
            <span
              className={`font-plex-mono text-[11px] px-3 py-1.5 rounded-full ${POSTPAID_BADGE}`}
            >
              {POSTPAID_LABEL}
            </span>
          ) : null}
          {order.isInternal ? null : (
            <span
              className={`font-plex-mono text-[11px] px-3 py-1.5 rounded-full ${PAYMENT_STATUS_BADGE[paymentStatus]}`}
            >
              {PAYMENT_STATUS_LABEL[paymentStatus]}
            </span>
          )}
          <span
            className={`font-plex-mono text-[11px] px-3 py-1.5 rounded-full ${ORDER_STATUS_BADGE[status]}`}
          >
            {ORDER_STATUS_LABEL[status]}
          </span>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2 flex flex-col gap-6">
          <section className="rounded-[10px] border border-[var(--oc-line)] bg-[var(--oc-panel)] relative z-10">
            <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-[var(--oc-line)]">
              <div>
                <h2 className="font-semibold text-[var(--oc-ink)]">Үйлчилгээ</h2>
                <p className="text-xs text-[var(--oc-muted3)] mt-0.5">
                  {order.items.length} үйлчилгээ · {filledDiagnosticCount}/
                  {diagnosticItems.length} оношилгоо · нийт{" "}
                  <strong className="font-plex-mono text-[var(--oc-ink)]">
                    {formatTugrik(order.totalAmount?.toString() ?? "0")}
                  </strong>
                </p>
              </div>
              {diagnosticTemplates.length === 0 && canEditOrder ? (
                <Link
                  href="/dashboard/services/diagnostics/new"
                  className="shrink-0 text-xs text-[var(--oc-accent)] hover:text-[var(--oc-accent-hi)]"
                >
                  Загвар үүсгэх →
                </Link>
              ) : null}
            </div>

            {orderStarted && activeItems.length > 0 ? (
              <div className="px-5 py-3 border-b border-[var(--oc-line)]">
                <div className="flex items-center justify-between gap-3 mb-1.5">
                  <span className="text-xs text-[var(--oc-muted3)]">
                    Гүйцэтгэл · {completedItemsCount}/{activeItems.length} дууссан
                  </span>
                  <span
                    className={`font-plex-mono text-xs font-semibold tabular-nums ${
                      progressPercent >= 100
                        ? "text-emerald-400 light:text-emerald-600"
                        : "text-[var(--oc-accent)]"
                    }`}
                  >
                    {progressPercent}%
                  </span>
                </div>
                <div className="h-1.5 rounded-full bg-white/[0.06] overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-[width] duration-300 ${
                      progressPercent >= 100 ? "bg-emerald-500" : "bg-[var(--oc-accent)]"
                    }`}
                    style={{ width: `${progressPercent}%` }}
                  />
                </div>
              </div>
            ) : null}

            {order.items.length === 0 ? (
              <div className="px-5 py-10 text-center text-sm text-[var(--oc-muted3)]">
                Үйлчилгээ нэмэгдээгүй байна. Доороос нэмнэ үү.
              </div>
            ) : (
              <OrderItems
                items={order.items.map((it) => ({
                  id: it.id,
                  kind: it.kind,
                  description: it.description,
                  quantity: it.quantity.toString(),
                  unitPrice: it.unitPrice.toString(),
                  total: it.total.toString(),
                  status: it.status,
                  cancelledAt: it.cancelledAt?.toISOString() ?? null,
                  cancelledByName: it.cancelledBy
                    ? `${it.cancelledBy.lastName} ${it.cancelledBy.firstName}`
                    : null,
                  diagnosticReportId: it.diagnosticReportId,
                }))}
                orderId={order.id}
                canEdit={isEditable && canEditOrder}
                canChangeStatus={isEditable && canChangeItemStatus}
                canChangePrice={isEditable && canChangeItemPrice}
                canViewHistory={canViewItemHistory}
                orderStarted={orderStarted}
                paymentLocked={hasPaidPayment}
              />
            )}

            {isEditable && canEditOrder ? (
              <div className="px-5 py-4 border-t border-[var(--oc-line)] bg-[var(--oc-panel2)]">
                <AddItemForm
                  orderId={order.id}
                  services={services.map((s) => ({
                    id: s.id,
                    type: s.type as ServiceKind,
                    name: s.name,
                    code: s.code,
                    unit: s.unit?.name ?? "",
                    price: s.price.toString(),
                    stock: s.stock != null ? s.stock.toString() : null,
                    laborCategoryId: s.categoryId,
                    laborCategoryName: s.category?.name ?? null,
                  }))}
                  diagnosticTemplates={diagnosticTemplates
                    .filter((t) => !usedDiagnosticTemplateIds.has(t.id))
                    .map((t) => ({
                      id: t.id,
                      name: t.name,
                      price: t.price?.toString() ?? "0",
                      durationMin: t.durationMin,
                    }))}
                  canChangePrice={canChangeItemPrice}
                />
              </div>
            ) : null}
          </section>

          {isEditable && canEditOrder ? (
            <section className="rounded-[10px] border border-[var(--oc-line)] bg-[var(--oc-panel)] p-4 sm:p-5">
              <h2 className="font-semibold text-[var(--oc-ink)] mb-5">Засварын хуудасны мэдээлэл</h2>
              <OrderForm
                initial={{
                  id: order.id,
                  branchId: order.branchId,
                  customerId: order.customerId,
                  vehicleId: order.vehicleId,
                  assignedToId: order.assignedToId,
                  scheduledAt: order.scheduledAt,
                  notes: order.notes,
                  isPostpaid: order.isPostpaid,
                  isInternal: order.isInternal,
                }}
                branches={branches}
                customers={customers}
                vehicles={vehicles}
                technicians={technicians}
                backHref="/dashboard/orders"
                hasPaidPayment={hasPaidPayment}
              />
            </section>
          ) : null}
        </div>

        <aside className="flex flex-col gap-6">
          {/* Эцсийн төлөвт карт харуулахгүй — статус нь дээд badge-д аль
              хэдийн байгаа тул давхардана */}
          {allowedTransitions.length > 0 ? (
            <div className="relative rounded-[10px] border border-[var(--oc-line)] bg-[var(--oc-panel)] p-5">
              <h2 className="font-semibold text-[var(--oc-ink)] mb-4 text-sm">Статус</h2>
              <StatusControls
                orderId={order.id}
                transitions={allowedTransitions}
                disabled={!canEditOrder}
                currentStatus={order.status as OrderStatus}
                estimatedDurationMinutes={order.estimatedDurationMinutes}
                serviceItemDurationMinutes={serviceItemDurationMinutes}
                completeBlockedReason={completeBlockedReason}
                cancelBlockedReason={orderPayments.some((p) => p.status === "PAID" && lockedPaymentIds.has(p.id)) ? PAID_PAYMENT_LOCKED_CANCEL_REASON : null}
              />
            </div>
          ) : null}

          {order.isInternal ? (
            <div className="rounded-[10px] border border-slate-500/25 bg-slate-500/[0.08] p-5 text-sm">
              <h2 className="font-semibold text-[var(--oc-ink)] mb-2 text-sm">Төлбөр</h2>
              <p className="text-xs text-slate-300 light:text-slate-700">{INTERNAL_PAYMENT_NOTE}</p>
              <div className="mt-3 flex items-center justify-between">
                <span className="text-[var(--oc-muted3)] text-xs">Нийт дүн</span>
                <span className="font-plex-mono text-[var(--oc-ink2)]">
                  {formatTugrik(order.totalAmount?.toString() ?? "0")}
                </span>
              </div>
            </div>
          ) : (
          <div className="rounded-[10px] border border-[var(--oc-line)] bg-[var(--oc-panel)] p-5">
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-semibold text-[var(--oc-ink)] text-sm">Төлбөр</h2>
              <span
                className={`font-plex-mono text-[11px] px-2.5 py-1 rounded-full ${PAYMENT_STATUS_BADGE[paymentStatus]}`}
              >
                {PAYMENT_STATUS_LABEL[paymentStatus]}
              </span>
            </div>
            <dl className="space-y-2 text-sm mb-4">
              <div className="flex items-center justify-between">
                <dt className="text-[var(--oc-muted3)] text-xs">Нийт дүн</dt>
                <dd className="font-plex-mono text-[var(--oc-ink2)]">
                  {formatTugrik(order.totalAmount?.toString() ?? "0")}
                </dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="text-[var(--oc-muted3)] text-xs">Төлсөн</dt>
                <dd className="font-plex-mono text-[var(--oc-ink2)]">
                  {order.paidAmount
                    ? formatTugrik(order.paidAmount.toString())
                    : "—"}
                </dd>
              </div>
              {order.paidAt ? (
                <div className="flex items-center justify-between">
                  <dt className="text-[var(--oc-muted3)] text-xs">Төлсөн огноо</dt>
                  <dd className="font-plex-mono text-[var(--oc-ink2)] text-xs">
                    {order.paidAt.toLocaleString("mn-MN", { hour12: false })}
                  </dd>
                </div>
              ) : null}
              <div className="flex items-center justify-between pt-2 mt-1 border-t border-[var(--oc-line)]">
                <dt className="text-[var(--oc-ink2)] text-xs font-semibold">Үлдэгдэл</dt>
                {new Prisma.Decimal(remainingAmount).gt(0) ? (
                  <dd className="font-plex-mono text-lg font-semibold text-[var(--oc-warn)]">
                    {formatTugrik(remainingAmount)}
                  </dd>
                ) : (
                  <dd className="font-plex-mono text-lg font-semibold text-emerald-300 light:text-emerald-700">
                    ✓ {formatTugrik("0")}
                  </dd>
                )}
              </div>
            </dl>
            {order.isPostpaid ? (
              <p className="text-xs text-sky-400/90 light:text-sky-700 mb-4 -mt-1">
                Дараа төлбөрт засварын хуудас — төлбөрийг гэрээгээр нэгтгэн төлнө.
              </p>
            ) : null}
            {(orderPayments.length > 0 || canRecordPayments || (canEditPayments && canSettle && paymentStatus !== "PAID")) ? (
              <div className="mt-4 pt-4 border-t border-[var(--oc-line)]">
                <div className="font-plex-mono text-[10.5px] text-[var(--oc-muted3)] uppercase tracking-[0.1em] mb-2">
                  Төлбөрүүд
                </div>
                <OrderPaymentsList
                  orderId={order.id}
                  payments={orderPayments.map((p) => ({
                    id: p.id,
                    amount: p.amount.toString(),
                    method: p.method,
                    status: p.status,
                    createdAt: p.createdAt.toISOString(),
                    bank: p.bank,
                    settlementId: p.settlementId,
                    locked: lockedPaymentIds.has(p.id),
                  }))}
                  banks={tenantBanks.banks.filter((b) => tenantBanks.enabledBanks.includes(b.code))}
                  cashSessionOpen={cashSessionOpen}
                  remaining={remainingAmount}
                  canRecord={canRecordPayments && canSettle}
                  canReverse={canReversePayments && canSettle}
                  qpayAvailable={canEditPayments && canSettle && paymentStatus !== "PAID"}
                  qpayConfigured={qpayReady}
                  pendingQPay={
                    pendingOrderPayment
                      ? {
                          id: pendingOrderPayment.id,
                          qrImage: pendingOrderPayment.qrImage,
                          urls: Array.isArray(pendingOrderPayment.qpayUrls)
                            ? (pendingOrderPayment.qpayUrls as unknown as QPayBankUrl[])
                            : [],
                          amount: pendingOrderPayment.amount.toString(),
                        }
                      : null
                  }
                />
                {settlementLocked ? (
                  <p className="mt-2 text-xs text-[var(--oc-muted3)]">{POSTPAID_SETTLEMENT_NOTE}</p>
                ) : null}
              </div>
            ) : null}
          </div>
          )}

          <div className="rounded-[10px] border border-[var(--oc-line)] bg-[var(--oc-panel)] p-5 text-sm">
            <h2 className="font-semibold text-[var(--oc-ink)] mb-4 text-sm">Дэлгэрэнгүй</h2>
            <dl className="space-y-3">
              <Row label="Үйлчлүүлэгч">
                <Link
                  href={`/dashboard/customers/${order.customer.id}`}
                  className="text-[var(--oc-accent)] hover:text-[var(--oc-accent-hi)]"
                >
                  {customerLabel(order.customer)}
                </Link>
                <div className="text-xs text-[var(--oc-muted3)]">
                  {order.customer.phone}
                </div>
              </Row>
              <Row label="Машин">
                <Link
                  href={`/dashboard/vehicles/${order.vehicle.id}`}
                  className="text-[var(--oc-accent)] hover:text-[var(--oc-accent-hi)]"
                >
                  {order.vehicle.make} {order.vehicle.model}
                </Link>
                <div className="font-plex-mono text-xs text-[var(--oc-muted3)]">
                  {order.vehicle.plate}
                  {order.vehicle.year ? ` · ${order.vehicle.year}` : ""}
                </div>
              </Row>
              <Row label="Салбар">{order.branch.name}</Row>
              {order.categories.length > 0 ? (
                <Row label="Захиалгаар сонгосон ангилал">
                  <div className="flex flex-wrap gap-1.5">
                    {order.categories.map((category) => (
                      <span
                        key={category.id}
                        className="rounded-full border border-violet-400/25 bg-violet-400/10 px-2 py-0.5 text-xs text-violet-200 light:text-violet-800"
                      >
                        {category.name}
                      </span>
                    ))}
                  </div>
                </Row>
              ) : null}
              <Row label="Хариуцагч">
                {order.assignedTo
                  ? `${order.assignedTo.lastName} ${order.assignedTo.firstName}`
                  : "—"}
              </Row>
              <Row label="Товлосон">
                {order.scheduledAt
                  ? order.scheduledAt.toLocaleString("mn-MN", {
                      year: "numeric",
                      month: "short",
                      day: "2-digit",
                      hour: "2-digit",
                      minute: "2-digit",
                      hour12: false,
                    })
                  : "—"}
              </Row>
              {order.startedAt ? (
                <Row label="Эхэлсэн">
                  {order.startedAt.toLocaleString("mn-MN", { hour12: false })}
                </Row>
              ) : null}
              {order.completedAt ? (
                <Row label="Дууссан">
                  {order.completedAt.toLocaleString("mn-MN", { hour12: false })}
                </Row>
              ) : null}
              <div className="pt-2 border-t border-[var(--oc-line)]">
                <IntakeRecord
                  notes={order.intakeNotes}
                  photos={order.intakePhotos}
                  signaturePath={order.intakeSignaturePath}
                  mileageKm={order.intakeMileageKm}
                  recordedAtLabel={
                    order.intakeRecordedAt
                      ? order.intakeRecordedAt.toLocaleString("mn-MN", { timeZone: "Asia/Ulaanbaatar", hour12: false })
                      : null
                  }
                  recordedBy={
                    order.intakeRecordedBy
                      ? [order.intakeRecordedBy.lastName, order.intakeRecordedBy.firstName].filter(Boolean).join(" ")
                      : null
                  }
                />
              </div>
              {order.notes ? (
                <div className="pt-2 border-t border-[var(--oc-line)]">
                  <div className="text-[var(--oc-muted3)] text-xs mb-1">Тэмдэглэл</div>
                  <p className="text-sm text-[var(--oc-ink2)] leading-relaxed whitespace-pre-wrap">
                    {order.notes}
                  </p>
                </div>
              ) : null}
            </dl>
          </div>

          {canDeleteOrder ? (
            <ConfirmForm
              action={deleteOrderAction}
              message={`Засварын хуудас #${order.number}-ыг устгах уу? Энэ үйлдлийг буцаах боломжгүй.`}
              className="rounded-[10px] border border-red-500/25 bg-[var(--oc-panel)] p-5"
            >
              <h2 className="font-semibold mb-2 text-sm text-red-400 light:text-red-600">
                Аюултай бүс
              </h2>
              <p className="text-xs text-[var(--oc-muted3)] mb-4">
                Засварын хуудсыг устгасны дараа сэргээх боломжгүй.
              </p>
              <input type="hidden" name="id" value={order.id} />
              <Btn type="submit" variant="danger" className="w-full">
                Засварын хуудсыг устгах
              </Btn>
            </ConfirmForm>
          ) : null}
        </aside>
      </div>
    </div>
  );
}

function Row({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <dt className="text-xs text-[var(--oc-muted3)]">{label}</dt>
      <dd className="mt-0.5 text-[var(--oc-ink2)]">{children}</dd>
    </div>
  );
}

