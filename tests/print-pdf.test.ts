import assert from "node:assert/strict";
import { before, test } from "node:test";

process.env.DATABASE_URL ??= "postgresql://unused/unused";
process.env.SESSION_SECRET ??= "unit-test-placeholder-secret-value-not-real-00";

let pdf: typeof import("../lib/print/pdf");
let docs: typeof import("../lib/print/documents");
let Prisma: typeof import("../app/generated/prisma/client").Prisma;

before(async () => {
  [pdf, docs] = await Promise.all([import("../lib/print/pdf"), import("../lib/print/documents")]);
  ({ Prisma } = await import("../app/generated/prisma/client"));
});

const D = (n: number | string) => new Prisma.Decimal(n);

function orderDoc(over: { lines?: number; internal?: boolean; paid?: number } = {}) {
  const n = over.lines ?? 2;
  return docs.buildOrderDocument({
    tenant: { name: "Төв Авто ХХК", registerNumber: "1234567", phone1: "99112233", logoUrl: "https://example.com/logo.png" },
    branch: { name: "Үндсэн салбар", phone: null, city: "Улаанбаатар", district: "Баянзүрх", khoroo: "5-р хороо", address: "Өнөр гудамж 12" },
    order: {
      number: "00042",
      status: "COMPLETED",
      isInternal: over.internal ?? false,
      totalAmount: D(n * 50000),
      createdAt: new Date("2026-11-17T03:00:00Z"),
      completedAt: new Date("2026-11-18T07:00:00Z"),
      plateSnapshot: "1234УБА",
      vinSnapshot: "JTDKB20U777654321",
      intakeMileageKm: 123456,
      intakeChecklist: [{ label: "Шил", status: "ISSUE", note: "Зураас" }],
    },
    template: { headerNote: "Баярлалаа!", footerNote: "Баталгаа 30 хоног\nХаяг: Өнөр гудамж", signatureLines: true, showChecklist: true },
    master: { firstName: "Бат", lastName: "Дорж" },
    customer: { fullName: "Сүхбаатар Өлзийбат", phone: "88112233", isOrganization: false, orgName: null, orgRegnum: null },
    vehicle: { plate: "1234УБА", make: "Toyota", model: "Prius", year: 2012 },
    items: Array.from({ length: n }, (_, i) => ({
      description: `Тос солих, шүүлтүүр ${i + 1} — өндөр чанарын Өөрийн үйлдвэрлэл`,
      quantity: D(1),
      unitPrice: D(50000),
      total: D(50000),
      cancelledAt: null,
    })),
    payments: over.paid ? [{ amount: D(over.paid), method: "CASH", status: "PAID", paidAt: new Date("2026-11-18T08:00:00Z"), createdAt: new Date("2026-11-18T08:00:00Z"), bankAccount: null }] : [],
    accounts: [{ name: "Хаан банк", type: "BANK_ACCOUNT", accountNumber: "5012345678", isTest: false, isActive: true }],
  });
}

function settlementDoc() {
  return docs.buildSettlementDocument({
    tenant: { name: "Төв Авто ХХК", registerNumber: "1234567", phone1: "99112233", logoUrl: null },
    branch: { name: "Үндсэн салбар", phone: null, city: null, district: null, khoroo: null, address: null },
    customer: { fullName: null, phone: "88112233", isOrganization: true, orgName: "Монгол Тээвэр ХХК", orgRegnum: "7654321" },
    settlement: { amount: D(150000), method: "BANK", occurredAt: new Date("2026-11-18T05:00:00Z"), voidedAt: new Date("2026-11-18T06:00:00Z"), voidReason: "Буруу дүн", bankAccount: { name: "Хаан банк", type: "BANK_ACCOUNT", accountNumber: "5012345678", terminalId: null } },
    orders: [
      { number: "00041", completedAt: new Date("2026-11-10T00:00:00Z"), plate: "1111УНА", orderTotal: D(100000), amount: D(100000) },
      { number: "00042", completedAt: null, plate: null, orderTotal: D(50000), amount: D(50000) },
    ],
  });
}

const isPdf = (b: Buffer) => b.subarray(0, 5).toString("latin1") === "%PDF-";
const pages = (b: Buffer) => (b.toString("latin1").match(/\/Type\s*\/Page\b/g) ?? []).length;

test("order PDF renders for A4 and 80mm with Cyrillic content", async () => {
  for (const format of ["a4", "80mm"] as const) {
    const buf = await pdf.renderPrintPdf(orderDoc({ paid: 20000 }), format, new Date("2026-11-18T09:00:00Z"));
    assert.ok(isPdf(buf), `${format}: not a PDF`);
    assert.ok(buf.length > 2000, `${format}: suspiciously small (${buf.length})`);
    assert.equal(pages(buf), 1, `${format}: a short order fits on one page`);
  }
});

test("internal order (no payments section) and an unpaid invoice with pay-to box both render", async () => {
  assert.ok(isPdf(await pdf.renderPrintPdf(orderDoc({ internal: true }), "a4")));
  assert.ok(isPdf(await pdf.renderPrintPdf(orderDoc({ paid: 0 }), "80mm")));
});

test("a long A4 order paginates instead of overflowing; the 80mm receipt stays a single tall page", async () => {
  const long = orderDoc({ lines: 80, paid: 100000 });
  const a4 = await pdf.renderPrintPdf(long, "a4");
  assert.ok(pages(a4) > 1, "A4 should paginate");
  const receipt = await pdf.renderPrintPdf(long, "80mm");
  assert.equal(pages(receipt), 1);
});

test("settlement PDF (voided, org customer) renders for both formats", async () => {
  for (const format of ["a4", "80mm"] as const) {
    assert.ok(isPdf(await pdf.renderPrintPdf(settlementDoc(), format)), format);
  }
});

test("receipt height grows with content and never collapses below the minimum", () => {
  const small = pdf.receiptHeightPt(orderDoc({ lines: 1 }));
  const big = pdf.receiptHeightPt(orderDoc({ lines: 30, paid: 1000 }));
  assert.ok(small >= 260);
  assert.ok(big > small);
  assert.ok(pdf.receiptHeightPt(settlementDoc()) >= 260);
});

test("a PDF is a pure function of the document: same input, same page count; output stays deterministic in size class", async () => {
  const when = new Date("2026-11-18T09:00:00Z");
  const a = await pdf.renderPrintPdf(orderDoc(), "a4", when);
  const b = await pdf.renderPrintPdf(orderDoc(), "a4", when);
  assert.equal(pages(a), pages(b));
  assert.ok(Math.abs(a.length - b.length) < 200);
});
