// Хэвлэх баримт бичгийн (захиалгын хуудас / тооцооны нэхэмжлэх) цэвэр view model.
// DB-гүй, тестлэх боломжтой. Энэ нь татварын баримт (e-barimt) БИШ — тиймээс
// гарчигт «баримт» гэдэг үгийг санаатайгаар хэрэглэхгүй. Spec: PRINTABLE_ORDER_SPEC.md.
import { Prisma } from "@/app/generated/prisma/client";
import { customerLabel } from "@/lib/customers";
import { ORDER_PAYMENT_METHOD_LABEL } from "@/lib/orders";
import { paymentAccountHint } from "@/lib/payment-accounts";

export const PRINT_FORMATS = ["a4", "80mm"] as const;
export type PrintFormat = (typeof PRINT_FORMATS)[number];

export function parsePrintFormat(value: unknown): PrintFormat {
  return value === "80mm" ? "80mm" : "a4";
}

const ZERO = new Prisma.Decimal(0);
const dec = (v: Prisma.Decimal | string | number | null | undefined) => (v == null ? ZERO : new Prisma.Decimal(v.toString()));

export type DocHeader = {
  logoUrl: string | null;
  shopName: string;
  shopRegnum: string;
  branchName: string;
  address: string | null;
  phone: string | null;
};

export type DocCustomer = { name: string; phone: string | null; orgName: string | null; orgRegnum: string | null };

type AccountSource = { name: string; type: string; accountNumber?: string | null; terminalId?: string | null } | null;

export type HeaderSource = {
  tenant: { name: string; registerNumber: string; phone1: string; logoUrl: string | null };
  branch: { name: string; phone: string | null; city: string | null; district: string | null; khoroo: string | null; address: string | null };
};

export function buildHeader({ tenant, branch }: HeaderSource): DocHeader {
  const address = [branch.city, branch.district, branch.khoroo, branch.address].map((s) => s?.trim()).filter(Boolean).join(", ");
  return {
    logoUrl: tenant.logoUrl,
    shopName: tenant.name,
    shopRegnum: tenant.registerNumber,
    branchName: branch.name,
    address: address || null,
    phone: branch.phone?.trim() || tenant.phone1 || null,
  };
}

export type CustomerSource = { fullName: string | null; phone: string | null; isOrganization: boolean; orgName: string | null; orgRegnum: string | null };

export function buildCustomer(c: CustomerSource): DocCustomer {
  return {
    name: customerLabel(c),
    phone: c.phone?.trim() || null,
    orgName: c.isOrganization ? c.orgName?.trim() || null : null,
    orgRegnum: c.isOrganization ? c.orgRegnum?.trim() || null : null,
  };
}

function accountLabel(account: AccountSource): string | null {
  if (!account) return null;
  const hint = paymentAccountHint(account);
  return hint ? `${account.name} ${hint}` : account.name;
}

// --- order ---------------------------------------------------------------------

export type OrderDocumentSource = HeaderSource & {
  order: {
    number: string;
    status: string;
    isInternal: boolean;
    totalAmount: Prisma.Decimal | null;
    createdAt: Date;
    completedAt: Date | null;
    plateSnapshot: string | null;
    vinSnapshot: string | null;
    intakeMileageKm: number | null;
  };
  master: { firstName: string; lastName: string } | null;
  customer: CustomerSource;
  vehicle: { plate: string; make: string | null; model: string | null; year: number | null };
  items: ReadonlyArray<{ description: string; quantity: Prisma.Decimal; unitPrice: Prisma.Decimal; total: Prisma.Decimal; cancelledAt: Date | null }>;
  /** All payments of the order; only PAID ones are printed. */
  payments: ReadonlyArray<{ amount: Prisma.Decimal; method: string; status: string; paidAt: Date | null; createdAt: Date; bankAccount: AccountSource }>;
  /** The tenant's payment accounts; the pay-to box keeps active, non-test BANK_ACCOUNT ones. */
  accounts: ReadonlyArray<{ name: string; type: string; accountNumber: string | null; isTest: boolean; isActive: boolean }>;
};

export type OrderDocument = {
  kind: "order";
  title: string;
  header: DocHeader;
  number: string;
  date: Date;
  master: string | null;
  customer: DocCustomer;
  vehicle: { plate: string; makeModel: string | null; vin: string | null; mileageKm: number | null };
  lines: Array<{ description: string; quantity: string; unitPrice: string; total: string }>;
  total: string;
  /** null for internal orders (no payment section). */
  payments: Array<{ date: Date; method: string; account: string | null; amount: string }> | null;
  paid: string;
  remaining: string;
  payTo: Array<{ name: string; accountNumber: string }>;
};

export function orderDocumentTitle(input: { status: string; isInternal: boolean; total: Prisma.Decimal; paid: Prisma.Decimal }): string {
  if (input.status === "CANCELLED") return "Цуцлагдсан захиалга";
  if (input.isInternal || !input.total.gt(0)) return "Захиалгын хуудас";
  if (!input.total.minus(input.paid).gt(0)) return "Төлбөр төлөгдсөн";
  return input.status === "COMPLETED" ? "Нэхэмжлэх" : "Захиалгын хуудас";
}

export function buildOrderDocument(src: OrderDocumentSource): OrderDocument {
  const { order } = src;
  const total = dec(order.totalAmount);
  const paidRows = order.isInternal ? [] : src.payments.filter((p) => p.status === "PAID");
  const paid = paidRows.reduce((sum, p) => sum.plus(dec(p.amount)), ZERO);
  const remainingRaw = total.minus(paid);
  const remaining = remainingRaw.gt(0) ? remainingRaw : ZERO;
  const owes = !order.isInternal && order.status !== "CANCELLED" && remaining.gt(0);
  const makeModel = [src.vehicle.make, src.vehicle.model, src.vehicle.year ? String(src.vehicle.year) : null].filter(Boolean).join(" ");

  return {
    kind: "order",
    title: orderDocumentTitle({ status: order.status, isInternal: order.isInternal, total, paid }),
    header: buildHeader(src),
    number: order.number,
    date: order.completedAt ?? order.createdAt,
    master: src.master ? `${src.master.lastName ? `${src.master.lastName.charAt(0)}. ` : ""}${src.master.firstName}` : null,
    customer: buildCustomer(src.customer),
    vehicle: {
      plate: order.plateSnapshot?.trim() || src.vehicle.plate,
      makeModel: makeModel || null,
      vin: order.vinSnapshot?.trim() || null,
      mileageKm: order.intakeMileageKm,
    },
    lines: src.items
      .filter((i) => i.cancelledAt == null)
      .map((i) => ({ description: i.description, quantity: dec(i.quantity).toString(), unitPrice: dec(i.unitPrice).toString(), total: dec(i.total).toString() })),
    total: total.toString(),
    payments: order.isInternal
      ? null
      : paidRows
          .map((p) => ({
            date: p.paidAt ?? p.createdAt,
            method: ORDER_PAYMENT_METHOD_LABEL[p.method] ?? p.method,
            account: accountLabel(p.bankAccount),
            amount: dec(p.amount).toString(),
          }))
          .sort((a, b) => a.date.getTime() - b.date.getTime()),
    paid: paid.toString(),
    remaining: remaining.toString(),
    payTo: owes
      ? src.accounts
          .filter((a) => a.type === "BANK_ACCOUNT" && a.isActive && !a.isTest && a.accountNumber?.trim())
          .map((a) => ({ name: a.name, accountNumber: a.accountNumber!.trim() }))
      : [],
  };
}

// --- settlement ----------------------------------------------------------------

export type SettlementDocumentSource = HeaderSource & {
  settlement: { amount: Prisma.Decimal | string; method: string; occurredAt: Date; voidedAt: Date | null; voidReason: string | null; bankAccount: AccountSource };
  customer: CustomerSource;
  orders: ReadonlyArray<{ number: string; completedAt: Date | null; plate: string | null; orderTotal: Prisma.Decimal | string; amount: Prisma.Decimal | string }>;
};

export type SettlementDocument = {
  kind: "settlement";
  title: string;
  voided: boolean;
  voidReason: string | null;
  header: DocHeader;
  date: Date;
  customer: DocCustomer;
  orders: Array<{ number: string; date: Date | null; plate: string | null; orderTotal: string; amount: string }>;
  total: string;
  method: string;
  account: string | null;
};

export function buildSettlementDocument(src: SettlementDocumentSource): SettlementDocument {
  const voided = src.settlement.voidedAt != null;
  return {
    kind: "settlement",
    title: voided ? "Цуцлагдсан тооцоо" : "Тооцооны нэхэмжлэх",
    voided,
    voidReason: voided ? src.settlement.voidReason : null,
    header: buildHeader(src),
    date: src.settlement.occurredAt,
    customer: buildCustomer(src.customer),
    orders: [...src.orders]
      .sort((a, b) => (a.completedAt?.getTime() ?? 0) - (b.completedAt?.getTime() ?? 0))
      .map((o) => ({ number: o.number, date: o.completedAt, plate: o.plate, orderTotal: dec(o.orderTotal).toString(), amount: dec(o.amount).toString() })),
    total: dec(src.settlement.amount).toString(),
    method: ORDER_PAYMENT_METHOD_LABEL[src.settlement.method] ?? src.settlement.method,
    account: accountLabel(src.settlement.bankAccount),
  };
}
