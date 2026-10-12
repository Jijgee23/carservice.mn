import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";

process.env.DATABASE_URL ??= "postgresql://unused/unused";
process.env.SESSION_SECRET ??= "unit-test-placeholder-secret-value-not-real-00";
const src = (rel: string) => readFile(new URL(`../${rel}`, import.meta.url), "utf8");

test("write paths use resolvePaymentAccount and persist bankId, never assertPaymentBank/enabledBanks", async () => {
  for (const file of ["lib/orders/order-payment-commands.ts", "lib/cash/ledger.ts", "lib/cash/settlement.ts"]) {
    const s = await src(file);
    assert.match(s, /resolvePaymentAccount\(/, file);
    assert.doesNotMatch(s, /assertPaymentBank|enabledBanks|from "@\/lib\/banks"/, file);
    assert.match(s, /bankId/, file);
  }
});

test("routes accept bankId, falling back to the legacy bank field", async () => {
  for (const file of ["app/api/v1/orders/[id]/payments/route.ts", "app/api/v1/orders/[id]/payment/route.ts"]) {
    const s = await src(file);
    assert.match(s, /b\.bankId/, file);
  }
  for (const file of ["app/api/v1/cash/entries/route.ts", "app/api/v1/cash/settlements/route.ts"]) {
    const s = await src(file);
    assert.match(s, /body\.bankId/, file);
  }
});

test("serializeLedgerPayment exposes bank fields from the account relation", async () => {
  const c = await import("../lib/orders/order-payment-commands");
  const D = (await import("../app/generated/prisma/client")).Prisma.Decimal;
  const row = c.serializeLedgerPayment({
    id: "p", amount: new D(5), method: "CARD", status: "PAID", paidAt: null, createdAt: new Date(), settlementId: null, bankId: "pa1",
    bankAccount: { id: "pa1", name: "Голомт POS", type: "POS", isTest: true, isActive: true, legacyCode: null },
  } as never);
  assert.equal(row.bankId, "pa1");
  assert.equal(row.bankLabel, "Голомт POS");
  assert.equal(row.bankType, "POS");
  assert.equal(row.bankIsTest, true);
  const cash = c.serializeLedgerPayment({ id: "p2", amount: new D(5), method: "CASH", status: "PAID", paidAt: null, createdAt: new Date(), settlementId: null, bankId: null, bankAccount: null } as never);
  assert.equal(cash.bankId, null);
  assert.equal(cash.bankLabel, null);
});
