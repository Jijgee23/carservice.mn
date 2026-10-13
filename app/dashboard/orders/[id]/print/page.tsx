import { notFound, redirect } from "next/navigation";
import { OrderPrint } from "@/app/_components/print/print-document";
import { PrintToolbar } from "@/app/_components/print/print-toolbar";
import { requireUser } from "@/lib/auth";
import { canViewOrder } from "@/lib/auth/order-access";
import { canView, workingBranchScopeId } from "@/lib/auth/roles";
import { BANK_REF_SELECT } from "@/lib/payment-accounts";
import { buildOrderDocument, parsePrintFormat } from "@/lib/print/documents";
import { prisma } from "@/lib/prisma";

export const metadata = {
  title: "Захиалгын хуудас хэвлэх",
};

export default async function OrderPrintPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ format?: string }>;
}) {
  const user = await requireUser();
  if (!canView(user, "orders")) redirect("/dashboard");
  const scopeBranchId = workingBranchScopeId(user);
  const [{ id }, { format: rawFormat }] = await Promise.all([params, searchParams]);
  const format = parsePrintFormat(rawFormat);

  // Same visibility as the order detail page: tenant + working-branch scope, then canViewOrder.
  const order = await prisma.serviceOrder.findFirst({
    where: { id, tenantId: user.tenantId, ...(scopeBranchId ? { branchId: scopeBranchId } : {}) },
    select: {
      id: true,
      number: true,
      status: true,
      isInternal: true,
      totalAmount: true,
      createdAt: true,
      completedAt: true,
      plateSnapshot: true,
      vinSnapshot: true,
      intakeMileageKm: true,
      assignedToId: true,
      assignedTo: { select: { firstName: true, lastName: true } },
      customer: { select: { fullName: true, phone: true, isOrganization: true, orgName: true, orgRegnum: true } },
      vehicle: { select: { plate: true, make: true, model: true, year: true } },
      branch: { select: { name: true, phone: true, city: true, district: true, khoroo: true, address: true } },
      tenant: { select: { name: true, registerNumber: true, phone1: true, logoUrl: true } },
      items: {
        orderBy: { createdAt: "asc" },
        select: { description: true, quantity: true, unitPrice: true, total: true, cancelledAt: true },
      },
    },
  });
  if (!order) notFound();
  if (!canViewOrder(user, order)) redirect("/dashboard/orders");

  const [payments, accounts] = await Promise.all([
    prisma.orderPayment.findMany({
      where: { tenantId: user.tenantId, orderId: order.id, status: "PAID" },
      select: { amount: true, method: true, status: true, paidAt: true, createdAt: true, bankAccount: { select: BANK_REF_SELECT } },
    }),
    prisma.paymentAccount.findMany({
      where: { tenantId: user.tenantId, type: "BANK_ACCOUNT", isActive: true, isTest: false },
      orderBy: { createdAt: "asc" },
      select: { name: true, type: true, accountNumber: true, isTest: true, isActive: true },
    }),
  ]);

  const doc = buildOrderDocument({
    tenant: order.tenant,
    branch: order.branch,
    order,
    master: order.assignedTo,
    customer: order.customer,
    vehicle: order.vehicle,
    items: order.items,
    payments,
    accounts,
  });

  return (
    <div className="p-4 sm:p-6 max-w-full flex-1 flex flex-col min-h-0 w-full">
      <PrintToolbar
        backHref={`/dashboard/orders/${order.id}`}
        backLabel={`Засварын хуудас #${order.number}`}
        format={format}
        basePath={`/dashboard/orders/${order.id}/print`}
      />
      <OrderPrint doc={doc} format={format} />
    </div>
  );
}
