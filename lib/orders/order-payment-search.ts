import { Prisma } from "@/app/generated/prisma/client";
import { orderReadWhere, type OrderAccessUser } from "@/lib/auth/order-access";
import { prisma } from "@/lib/prisma";
import { customerRelationSearchClauses } from "@/lib/customers/customer-search";

export const PAYABLE_ORDER_SEARCH_LIMIT = 20;
const MAX_QUERY_LENGTH = 100;

export type PayableOrderRow = {
  id: string;
  number: string;
  plate: string | null;
  customerName: string;
  customerPhone: string;
  createdAt: string;
  totalAmount: string;
  paidAmount: string;
  remaining: string;
  isPostpaid: boolean;
  status: string;
};

/**
 * Orders that can still take a payment, for ONE branch: not fully paid, not
 * internal, not cancelled (completed postpaid included), with a positive total.
 * `q` matches number, plate (current or snapshot), customer phone/name, and register
 * (customer.orgRegnum or vehicle.ownerRegnum). Tenant + branch + access are unconditional ANDs.
 */
export function buildPayableOrderSearchWhere(options: {
  tenantId: string;
  branchId: string;
  readWhere?: Prisma.ServiceOrderWhereInput;
  q?: string | null;
}): Prisma.ServiceOrderWhereInput {
  const q = (options.q ?? "").trim().slice(0, MAX_QUERY_LENGTH);
  const and: Prisma.ServiceOrderWhereInput[] = [];
  if (options.readWhere) and.push(options.readWhere);
  if (q) {
    const contains = { contains: q, mode: "insensitive" as const };
    and.push({
      OR: [
        { number: contains },
        { plateSnapshot: contains },
        { vehicle: { plate: contains } },
        ...customerRelationSearchClauses(q, (customer) => ({ customer })),
        { vehicle: { ownerRegnum: contains } },
      ],
    });
  }
  return {
    tenantId: options.tenantId,
    branchId: options.branchId,
    isInternal: false,
    status: { not: "CANCELLED" },
    paymentStatus: { not: "PAID" },
    totalAmount: { gt: 0 },
    AND: and,
  };
}

export async function searchPayableOrders(input: {
  actor: OrderAccessUser & { tenantId: string };
  branchId: string;
  q?: string | null;
}): Promise<PayableOrderRow[]> {
  const where = buildPayableOrderSearchWhere({
    tenantId: input.actor.tenantId,
    branchId: input.branchId,
    readWhere: orderReadWhere(input.actor),
    q: input.q,
  });
  const rows = await prisma.serviceOrder.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: PAYABLE_ORDER_SEARCH_LIMIT,
    select: {
      id: true,
      number: true,
      plateSnapshot: true,
      status: true,
      isPostpaid: true,
      createdAt: true,
      totalAmount: true,
      paidAmount: true,
      customer: { select: { fullName: true, phone: true } },
      vehicle: { select: { plate: true } },
    },
  });
  return rows.map((r) => {
    const total = r.totalAmount ?? new Prisma.Decimal(0);
    const paid = r.paidAmount ?? new Prisma.Decimal(0);
    const remaining = Prisma.Decimal.max(total.minus(paid), 0);
    return {
      id: r.id,
      number: r.number,
      plate: r.vehicle?.plate ?? r.plateSnapshot ?? null,
      customerName: r.customer.fullName,
      customerPhone: r.customer.phone,
      createdAt: r.createdAt.toISOString(),
      totalAmount: total.toString(),
      paidAmount: paid.toString(),
      remaining: remaining.toString(),
      isPostpaid: r.isPostpaid,
      status: r.status,
    };
  });
}
