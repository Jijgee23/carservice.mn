// tests/payment-accounts.test.ts
import assert from "node:assert/strict";
import { test } from "node:test";

process.env.DATABASE_URL ??= "postgresql://unused/unused";
process.env.SESSION_SECRET ??= "unit-test-placeholder-secret-value-not-real-00";

const code = (c: string) => (e: unknown) => (e as { code?: string }).code === c;

type Row = { id: string; tenantId: string; type: "CASH" | "BANK_ACCOUNT" | "POS"; name: string; isTest: boolean; isActive: boolean; legacyCode: string | null };
function db(rows: Row[]) {
  return {
    paymentAccount: {
      findFirst: async ({ where }: { where: Record<string, unknown> }) =>
        rows.find((r) =>
          r.tenantId === where.tenantId &&
          (where.id === undefined || r.id === where.id) &&
          (where.legacyCode === undefined || r.legacyCode === where.legacyCode) &&
          (where.type === undefined || r.type === where.type)) ?? null,
    },
  };
}
const rows: Row[] = [
  { id: "a1", tenantId: "t1", type: "BANK_ACCOUNT", name: "Хаан банк", isTest: false, isActive: true, legacyCode: null },
  { id: "p1", tenantId: "t1", type: "POS", name: "Голомт POS", isTest: true, isActive: true, legacyCode: null },
  { id: "a2", tenantId: "t1", type: "BANK_ACCOUNT", name: "Хуучин", isTest: false, isActive: false, legacyCode: null },
  { id: "c1", tenantId: "t1", type: "CASH", name: "Касс 1", isTest: false, isActive: true, legacyCode: null },
  { id: "c2", tenantId: "t1", type: "CASH", name: "Касс 2", isTest: false, isActive: false, legacyCode: null },
  { id: "x1", tenantId: "t2", type: "BANK_ACCOUNT", name: "Бусад тенант", isTest: false, isActive: true, legacyCode: null },
  { id: "l1", tenantId: "t1", type: "BANK_ACCOUNT", name: "Хаан банк", isTest: false, isActive: true, legacyCode: "KHAN" },
];

test("normalizeAccountNumber keeps digits only and rejects empty", async () => {
  const { normalizeAccountNumber } = await import("../lib/payment-accounts");
  assert.equal(normalizeAccountNumber("5012 3456-78"), "5012345678");
  assert.equal(normalizeAccountNumber("  "), null);
  assert.equal(normalizeAccountNumber(undefined), null);
  assert.equal(normalizeAccountNumber("ab"), null);
});

test("maskAccountNumber shows only the last four digits", async () => {
  const { maskAccountNumber } = await import("../lib/payment-accounts");
  assert.equal(maskAccountNumber("5012345678"), "••••5678");
  assert.equal(maskAccountNumber("123"), "••••");
  assert.equal(maskAccountNumber(null), "");
});

test("type <-> method mapping", async () => {
  const m = await import("../lib/payment-accounts");
  assert.equal(m.typeForMethod("BANK_TRANSFER"), "BANK_ACCOUNT");
  assert.equal(m.typeForMethod("CARD"), "POS");
  assert.equal(m.typeForMethod("CASH"), "CASH");
  assert.equal(m.typeForMethod("QPAY"), null);
  assert.equal(m.methodForType("POS"), "CARD");
  assert.equal(m.methodForType("CASH"), "CASH");
});

test("resolvePaymentAccount: QPAY / OTHER ignore input", async () => {
  const { resolvePaymentAccount } = await import("../lib/payment-accounts");
  for (const method of ["QPAY", "OTHER"]) {
    assert.equal(await resolvePaymentAccount(db(rows) as never, "t1", method, "a1"), null);
  }
});

test("resolvePaymentAccount: CASH account is optional; only this tenant's CASH rows resolve", async () => {
  const { resolvePaymentAccount } = await import("../lib/payment-accounts");
  assert.equal(await resolvePaymentAccount(db(rows) as never, "t1", "CASH", ""), null);
  assert.equal(await resolvePaymentAccount(db(rows) as never, "t1", "CASH", undefined), null);
  assert.equal((await resolvePaymentAccount(db(rows) as never, "t1", "CASH", "c1"))?.id, "c1");
  // Stale bank ids / codes from older clients are ignored, as before CASH accounts existed.
  assert.equal(await resolvePaymentAccount(db(rows) as never, "t1", "CASH", "a1"), null);
  assert.equal(await resolvePaymentAccount(db(rows) as never, "t1", "CASH", "KHAN"), null);
  await assert.rejects(resolvePaymentAccount(db(rows) as never, "t1", "CASH", "c2"), code("PAYMENT_BANK_NOT_ENABLED"));
});

test("resolvePaymentAccount: required, found, type match", async () => {
  const { resolvePaymentAccount } = await import("../lib/payment-accounts");
  await assert.rejects(resolvePaymentAccount(db(rows) as never, "t1", "BANK_TRANSFER", ""), code("PAYMENT_BANK_REQUIRED"));
  await assert.rejects(resolvePaymentAccount(db(rows) as never, "t1", "CARD", undefined), code("PAYMENT_BANK_REQUIRED"));
  const ok = await resolvePaymentAccount(db(rows) as never, "t1", "BANK_TRANSFER", "a1");
  assert.deepEqual(ok, { id: "a1", type: "BANK_ACCOUNT", name: "Хаан банк", isTest: false, legacyCode: null });
  const pos = await resolvePaymentAccount(db(rows) as never, "t1", "CARD", "p1");
  assert.equal(pos?.isTest, true);
});

test("Review focus 1/3: foreign tenant, unknown and inactive ids are NOT_ENABLED; wrong type is TYPE_MISMATCH", async () => {
  const { resolvePaymentAccount } = await import("../lib/payment-accounts");
  await assert.rejects(resolvePaymentAccount(db(rows) as never, "t1", "BANK_TRANSFER", "x1"), code("PAYMENT_BANK_NOT_ENABLED"));
  await assert.rejects(resolvePaymentAccount(db(rows) as never, "t1", "BANK_TRANSFER", "nope"), code("PAYMENT_BANK_NOT_ENABLED"));
  await assert.rejects(resolvePaymentAccount(db(rows) as never, "t1", "BANK_TRANSFER", "a2"), code("PAYMENT_BANK_NOT_ENABLED"));
  await assert.rejects(resolvePaymentAccount(db(rows) as never, "t1", "CARD", "a1"), code("PAYMENT_BANK_TYPE_MISMATCH"));
  await assert.rejects(resolvePaymentAccount(db(rows) as never, "t1", "BANK_TRANSFER", "p1"), code("PAYMENT_BANK_TYPE_MISMATCH"));
});

test("Review focus 2: legacy code resolves per type; a tenant without that legacy row is NOT_ENABLED", async () => {
  const { resolvePaymentAccount } = await import("../lib/payment-accounts");
  const hit = await resolvePaymentAccount(db(rows) as never, "t1", "BANK_TRANSFER", "KHAN");
  assert.equal(hit?.id, "l1");
  // t1 has a legacy KHAN BANK_ACCOUNT row but no legacy POS row -> CARD + "KHAN" must fail, not 500.
  await assert.rejects(resolvePaymentAccount(db(rows) as never, "t1", "CARD", "KHAN"), code("PAYMENT_BANK_NOT_ENABLED"));
  await assert.rejects(resolvePaymentAccount(db(rows) as never, "t2", "BANK_TRANSFER", "KHAN"), code("PAYMENT_BANK_NOT_ENABLED"));
});

test("bankRef serializes an account, tolerates null, flags inactive in the label", async () => {
  const { bankRef, INACTIVE_SUFFIX, TEST_BADGE } = await import("../lib/payment-accounts");
  assert.deepEqual(bankRef(null), { bankId: null, bank: null, bankLabel: null, bankHint: null, bankType: null, bankIsTest: false });
  const live = bankRef({ id: "p1", name: "Голомт POS", type: "POS", isTest: true, isActive: true, legacyCode: null });
  assert.equal(live.bankLabel, "Голомт POS");
  assert.equal(live.bankType, "POS");
  assert.equal(live.bankIsTest, true);
  const old = bankRef({ id: "a2", name: "Хуучин", type: "BANK_ACCOUNT", isTest: false, isActive: false, legacyCode: "KHAN" });
  assert.equal(old.bankLabel, `Хуучин${INACTIVE_SUFFIX}`);
  assert.equal(old.bank, "KHAN");
  assert.equal(typeof TEST_BADGE, "string");
});

test("loadPaymentAccountLabels maps id -> label incl. inactive suffix, one query", async () => {
  const { loadPaymentAccountLabels } = await import("../lib/payment-accounts");
  let calls = 0;
  const client = { paymentAccount: { findMany: async () => { calls += 1; return [{ id: "a1", name: "Хаан", type: "BANK_ACCOUNT", accountNumber: null, terminalId: null, isTest: false, isActive: true }, { id: "a2", name: "Хуучин", type: "BANK_ACCOUNT", accountNumber: null, terminalId: null, isTest: false, isActive: false }]; } } };
  const map = await loadPaymentAccountLabels(client as never, "t1", ["a1", "a2", "a1", ""]);
  assert.equal(map.get("a1"), "Хаан");
  assert.equal(map.get("a2"), "Хуучин (идэвхгүй)");
  assert.equal(calls, 1);
  const none = await loadPaymentAccountLabels(client as never, "t1", []);
  assert.equal(none.size, 0);
  assert.equal(calls, 1, "no query for an empty id list");
});

test("paymentAccountHint / paymentAccountLabel tell same-named accounts apart with the full number", async () => {
  const { paymentAccountHint, paymentAccountLabel, bankRef } = await import("../lib/payment-accounts");
  assert.equal(paymentAccountHint({ type: "BANK_ACCOUNT", accountNumber: "5000 1234 5678" }), "500012345678");
  assert.equal(paymentAccountHint({ type: "CASH", accountNumber: null }), null);
  assert.equal(paymentAccountHint({ type: "POS", accountNumber: "123456789", terminalId: " 0042 " }), "TID 0042");
  assert.equal(paymentAccountHint({ type: "POS", accountNumber: "123456789", terminalId: null }), "123456789");
  assert.equal(paymentAccountHint({ type: "BANK_ACCOUNT", accountNumber: null }), null);
  assert.equal(
    paymentAccountLabel({ name: "Голомт банк", type: "POS", terminalId: "0042", accountNumber: null, isTest: true, isActive: false }),
    "Голомт банк TID 0042 · Туршилт (идэвхгүй)",
  );
  const ref = bankRef({ id: "a1", name: "Хаан", type: "BANK_ACCOUNT", isTest: false, isActive: true, legacyCode: null, accountNumber: "5000123456" });
  assert.equal(ref.bankLabel, "Хаан");
  assert.equal(ref.bankHint, "5000123456");
  assert.equal(bankRef(null).bankHint, null);
});
