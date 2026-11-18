// Хэвлэх баримтын өгөгдлийг татах НЭГ газар: вэб хэвлэх хуудас (HTML) болон мобайл PDF endpoint хоёул
// энийг дуудна — тэгснээр харагдах эрх, салбарын хүрээ, талбарууд хоёр талд зөрөхгүй.
// Дуудагч tenant context-ийг (requireUser/requireApiUser) тавьсан байх ёстой.

import { canViewOrder, type OrderAccessUser } from "@/lib/auth/order-access";
import { CashError } from "@/lib/cash/rules";
import { getSettlement } from "@/lib/cash/settlement";
import type { CashActor } from "@/lib/cash/types";
import { getOrderSettings } from "@/lib/orders/order-settings-server";
import { BANK_REF_SELECT } from "@/lib/payment-accounts";
import {
  buildOrderDocument,
  buildSettlementDocument,
  type OrderDocument,
  type PrintFormat,
  type SettlementDocument,
} from "@/lib/print/documents";
import { prisma } from "@/lib/prisma";

export type OrderDocumentResult =
  | { ok: true; doc: OrderDocument; order: { id: string; number: string }; defaultFormat: PrintFormat }
  | { ok: false; reason: "not_found" | "forbidden" };

/**
 * Захиалгын хуудас/нэхэмжлэх. «not_found» = байхгүй эсвэл (tenant/салбарын хүрээнээс гадуур);
 * «forbidden» = байгаа ч энэ хэрэглэгч харах эрхгүй (ж: өөрийнх биш хуудас).
 * `scopeBranchId` — ажиллах салбарын хүрээ (null = бүх салбар); `hideBranches` — ганц салбартай
 * энгийн багцад салбарын нэрийг нууна.
 */
export async function loadOrderDocument(input: {
  user: OrderAccessUser & { tenantId: string };
  orderId: string;
  scopeBranchId: string | null;
  hideBranches: boolean;
}): Promise<OrderDocumentResult> {
  const { user, orderId, scopeBranchId, hideBranches } = input;
  const orderSettings = await getOrderSettings(prisma, user.tenantId);

  // Same visibility as the order detail page: tenant + working-branch scope, then canViewOrder.
  const order = await prisma.serviceOrder.findFirst({
    where: { id: orderId, tenantId: user.tenantId, ...(scopeBranchId ? { branchId: scopeBranchId } : {}) },
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
      intakeChecklist: true,
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
  if (!order) return { ok: false, reason: "not_found" };
  if (!canViewOrder(user, order)) return { ok: false, reason: "forbidden" };

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
    branch: hideBranches ? { ...order.branch, name: "" } : order.branch,
    order,
    master: order.assignedTo,
    template: {
      headerNote: orderSettings.printHeaderNote,
      footerNote: orderSettings.printFooterNote,
      signatureLines: orderSettings.printSignatureLines,
      showChecklist: orderSettings.printShowChecklist,
    },
    customer: order.customer,
    vehicle: order.vehicle,
    items: order.items,
    payments,
    accounts,
  });
  return { ok: true, doc, order: { id: order.id, number: order.number }, defaultFormat: orderSettings.printFormat };
}

export type SettlementDocumentResult =
  | { ok: true; doc: SettlementDocument; settlement: { id: string } }
  | { ok: false; reason: "not_found" };

/**
 * Тооцооны нэхэмжлэх. getSettlement нь cash.manage болон салбарын хүрээг шалгана (хүрээнээс гадуур
 * бол 404); эрхгүй бол CashError(403)-г дуудагч руу дамжуулна.
 */
export async function loadSettlementDocument(input: {
  actor: CashActor;
  settlementId: string;
  scope?: string | null;
}): Promise<SettlementDocumentResult> {
  const { actor, settlementId } = input;
  let settlement;
  try {
    settlement = await getSettlement({ actor, scope: input.scope, settlementId });
  } catch (error) {
    if (error instanceof CashError && error.status === 404) return { ok: false, reason: "not_found" };
    throw error;
  }

  const orderIds = settlement.orders.map((o) => o.orderId);
  const [branch, tenant, customer, orders, account] = await Promise.all([
    prisma.branch.findFirst({
      where: { id: settlement.branch.id, tenantId: actor.tenantId },
      select: { name: true, phone: true, city: true, district: true, khoroo: true, address: true },
    }),
    prisma.tenant.findUnique({ where: { id: actor.tenantId }, select: { name: true, registerNumber: true, phone1: true, logoUrl: true } }),
    prisma.customer.findFirst({
      where: { id: settlement.customer.id, tenantId: actor.tenantId },
      select: { fullName: true, phone: true, isOrganization: true, orgName: true, orgRegnum: true },
    }),
    prisma.serviceOrder.findMany({ where: { tenantId: actor.tenantId, id: { in: orderIds } }, select: { id: true, completedAt: true } }),
    settlement.bankId
      ? prisma.paymentAccount.findFirst({
          where: { id: settlement.bankId, tenantId: actor.tenantId },
          select: { name: true, type: true, accountNumber: true, terminalId: true },
        })
      : Promise.resolve(null),
  ]);
  if (!branch || !tenant || !customer) return { ok: false, reason: "not_found" };
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
  return { ok: true, doc, settlement: { id: settlement.id } };
}
