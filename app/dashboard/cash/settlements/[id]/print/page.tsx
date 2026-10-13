import { notFound, redirect } from "next/navigation";
import { SettlementPrint } from "@/app/_components/print/print-document";
import { PrintToolbar } from "@/app/_components/print/print-toolbar";
import { requireUser } from "@/lib/auth";
import { hasPermission } from "@/lib/auth/roles";
import { CashError } from "@/lib/cash/rules";
import { getSettlement } from "@/lib/cash/settlement";
import { buildSettlementDocument, parsePrintFormat } from "@/lib/print/documents";
import { prisma } from "@/lib/prisma";

export const metadata = {
  title: "Тооцооны нэхэмжлэх хэвлэх",
};

export default async function SettlementPrintPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ format?: string }>;
}) {
  const user = await requireUser();
  if (!hasPermission(user, "cash.manage")) redirect("/dashboard");
  const [{ id }, { format: rawFormat }] = await Promise.all([params, searchParams]);
  const format = parsePrintFormat(rawFormat);

  // getSettlement enforces cash.manage + branch scope (404 outside it), like the detail page.
  let settlement;
  try {
    settlement = await getSettlement({ actor: user, settlementId: id });
  } catch (error) {
    if (error instanceof CashError && error.status === 404) notFound();
    throw error;
  }

  const orderIds = settlement.orders.map((o) => o.orderId);
  const [branch, tenant, customer, orders, account] = await Promise.all([
    prisma.branch.findFirst({
      where: { id: settlement.branch.id, tenantId: user.tenantId },
      select: { name: true, phone: true, city: true, district: true, khoroo: true, address: true },
    }),
    prisma.tenant.findUnique({ where: { id: user.tenantId }, select: { name: true, registerNumber: true, phone1: true, logoUrl: true } }),
    prisma.customer.findFirst({
      where: { id: settlement.customer.id, tenantId: user.tenantId },
      select: { fullName: true, phone: true, isOrganization: true, orgName: true, orgRegnum: true },
    }),
    prisma.serviceOrder.findMany({ where: { tenantId: user.tenantId, id: { in: orderIds } }, select: { id: true, completedAt: true } }),
    settlement.bankId
      ? prisma.paymentAccount.findFirst({
          where: { id: settlement.bankId, tenantId: user.tenantId },
          select: { name: true, type: true, accountNumber: true, terminalId: true },
        })
      : Promise.resolve(null),
  ]);
  if (!branch || !tenant || !customer) notFound();
  const completedAt = new Map(orders.map((o) => [o.id, o.completedAt]));

  const doc = buildSettlementDocument({
    tenant,
    branch,
    customer,
    settlement: {
      amount: settlement.amount,
      method: settlement.method,
      occurredAt: new Date(settlement.occurredAt),
      voidedAt: settlement.voidedAt ? new Date(settlement.voidedAt) : null,
      voidReason: settlement.voidReason,
      bankAccount: account,
    },
    orders: settlement.orders.map((o) => ({
      number: o.orderNumber,
      completedAt: completedAt.get(o.orderId) ?? null,
      plate: o.plate,
      orderTotal: o.orderTotal,
      amount: o.amount,
    })),
  });

  return (
    <div className="p-4 sm:p-6 max-w-full flex-1 flex flex-col min-h-0 w-full">
      <PrintToolbar
        backHref={`/dashboard/cash/settlements/${settlement.id}`}
        backLabel="Тооцоо нийлэлт"
        format={format}
        basePath={`/dashboard/cash/settlements/${settlement.id}/print`}
      />
      <SettlementPrint doc={doc} format={format} />
    </div>
  );
}
