// tests/print-documents.test.ts
import assert from "node:assert/strict";
import { test } from "node:test";

process.env.DATABASE_URL ??= "postgresql://unused/unused";

const D = (v: string | number) => v as unknown as never;

async function load() {
  const { Prisma } = await import("../app/generated/prisma/client");
  const mod = await import("../lib/print/documents");
  const dec = (v: string | number) => new Prisma.Decimal(v);
  const base = {
    tenant: { name: "Сайн Засвар", registerNumber: "1234567", phone1: "99112233", logoUrl: null },
    branch: { name: "Төв", phone: null, city: "Улаанбаатар", district: "Баянзүрх", khoroo: null, address: "  " },
    order: {
      number: "1001",
      status: "COMPLETED",
      isInternal: false,
      totalAmount: dec(100000),
      createdAt: new Date("2026-10-01T02:00:00Z"),
      completedAt: new Date("2026-10-02T02:00:00Z"),
      plateSnapshot: "1234УБА",
      vinSnapshot: null,
      intakeMileageKm: 120000,
    },
    master: { firstName: "Бат", lastName: "Дорж" },
    customer: { fullName: "Болд", phone: "88001122", isOrganization: false, orgName: "X ХХК", orgRegnum: "7654321" },
    vehicle: { plate: "9999УБА", make: "Toyota", model: "Prius", year: 2015 },
    items: [
      { description: "Тос солих", quantity: dec("1.000"), unitPrice: dec(60000), total: dec(60000), cancelledAt: null },
      { description: "Шүүр", quantity: dec("2.000"), unitPrice: dec(20000), total: dec(40000), cancelledAt: null },
      { description: "Цуцалсан ажил", quantity: dec(1), unitPrice: dec(5000), total: dec(5000), cancelledAt: new Date() },
    ],
    payments: [
      { amount: dec(30000), method: "CASH", status: "PAID", paidAt: new Date("2026-10-02T03:00:00Z"), createdAt: new Date(), bankAccount: null },
      { amount: dec(50000), method: "CASH", status: "CANCELLED", paidAt: null, createdAt: new Date(), bankAccount: null },
    ],
    accounts: [
      { name: "Хаан", type: "BANK_ACCOUNT", accountNumber: "5000123456", isTest: false, isActive: true },
      { name: "Хуучин", type: "BANK_ACCOUNT", accountNumber: "5000999999", isTest: false, isActive: false },
      { name: "Туршилт", type: "BANK_ACCOUNT", accountNumber: "1111", isTest: true, isActive: true },
      { name: "Голомт POS", type: "POS", accountNumber: "2222", isTest: false, isActive: true },
    ],
  };
  return { ...mod, dec, base };
}

test("parsePrintFormat defaults to a4", async () => {
  const { parsePrintFormat } = await load();
  assert.equal(parsePrintFormat("80mm"), "80mm");
  assert.equal(parsePrintFormat(undefined), "a4");
  assert.equal(parsePrintFormat("letter"), "a4");
});

test("order document: cancelled lines out, PAID only, remaining, full account numbers in pay-to", async () => {
  const { buildOrderDocument, base } = await load();
  const doc = buildOrderDocument(base as never);
  assert.equal(doc.title, "Нэхэмжлэх");
  assert.deepEqual(doc.lines.map((l) => [l.description, l.quantity]), [["Тос солих", "1"], ["Шүүр", "2"]]);
  assert.equal(doc.paid, "30000");
  assert.equal(doc.remaining, "70000");
  assert.equal(doc.payments?.length, 1);
  assert.deepEqual(doc.payTo, [{ name: "Хаан", accountNumber: "5000123456" }]);
  assert.equal(doc.vehicle.plate, "1234УБА", "plate snapshot wins");
  assert.equal(doc.vehicle.makeModel, "Toyota Prius 2015");
  assert.equal(doc.customer.orgName, null, "org fields only for organisations");
  assert.equal(doc.header.address, "Улаанбаатар, Баянзүрх");
  assert.equal(doc.header.phone, "99112233", "falls back to tenant phone");
  assert.equal(doc.master, "Д. Бат");
});

test("order document titles by state; no pay-to once paid", async () => {
  const { buildOrderDocument, orderDocumentTitle, base, dec } = await load();
  const paid = buildOrderDocument({ ...base, payments: [{ ...base.payments[0], amount: dec(120000) }] } as never);
  assert.equal(paid.title, "Төлбөр төлөгдсөн");
  assert.equal(paid.remaining, "0", "overpayment clamps to 0");
  assert.deepEqual(paid.payTo, []);
  assert.equal(orderDocumentTitle({ status: "IN_PROGRESS", isInternal: false, total: dec(100), paid: dec(0) }), "Захиалгын хуудас");
  assert.equal(orderDocumentTitle({ status: "CANCELLED", isInternal: false, total: dec(100), paid: dec(0) }), "Цуцлагдсан захиалга");
  assert.equal(orderDocumentTitle({ status: "COMPLETED", isInternal: false, total: dec(0), paid: dec(0) }), "Захиалгын хуудас");
  const cancelled = buildOrderDocument({ ...base, order: { ...base.order, status: "CANCELLED" } } as never);
  assert.deepEqual(cancelled.payTo, [], "no pay-to on a cancelled order");
});

test("internal order: plain sheet, no payment section, no pay-to", async () => {
  const { buildOrderDocument, base } = await load();
  const doc = buildOrderDocument({ ...base, order: { ...base.order, isInternal: true } } as never);
  assert.equal(doc.title, "Захиалгын хуудас");
  assert.equal(doc.payments, null);
  assert.deepEqual(doc.payTo, []);
});

test("organisation customer shows org name + regnum", async () => {
  const { buildOrderDocument, base } = await load();
  const doc = buildOrderDocument({ ...base, customer: { ...base.customer, isOrganization: true } } as never);
  assert.equal(doc.customer.orgName, "X ХХК");
  assert.equal(doc.customer.orgRegnum, "7654321");
});

test("settlement document: title, voided, account hint, orders sorted by completion", async () => {
  const { buildSettlementDocument, base } = await load();
  const src = {
    tenant: base.tenant,
    branch: base.branch,
    customer: base.customer,
    settlement: {
      amount: D("150000"),
      method: "BANK_TRANSFER",
      occurredAt: new Date("2026-10-10T02:00:00Z"),
      voidedAt: null,
      voidReason: null,
      bankAccount: { name: "Хаан", type: "BANK_ACCOUNT", accountNumber: "5000123456", terminalId: null },
    },
    orders: [
      { number: "B", completedAt: new Date("2026-10-05"), plate: null, orderTotal: "100000", amount: "100000" },
      { number: "A", completedAt: new Date("2026-10-01"), plate: "1234УБА", orderTotal: "60000", amount: "50000" },
    ],
  };
  const doc = buildSettlementDocument(src as never);
  assert.equal(doc.title, "Тооцооны нэхэмжлэх");
  assert.equal(doc.voided, false);
  assert.equal(doc.account, "Хаан ··3456", "settlement shows last 4 only");
  assert.deepEqual(doc.orders.map((o) => o.number), ["A", "B"]);
  assert.equal(doc.total, "150000");

  const voided = buildSettlementDocument({ ...src, settlement: { ...src.settlement, voidedAt: new Date(), voidReason: "Алдаа" } } as never);
  assert.equal(voided.title, "Цуцлагдсан тооцоо");
  assert.equal(voided.voidReason, "Алдаа");
});
