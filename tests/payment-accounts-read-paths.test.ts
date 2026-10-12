import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";

process.env.DATABASE_URL ??= "postgresql://unused/unused";
process.env.SESSION_SECRET ??= "unit-test-placeholder-secret-value-not-real-00";
const src = (rel: string) => readFile(new URL(`../${rel}`, import.meta.url), "utf8");
const code = (c: string) => (e: unknown) => (e as { code?: string }).code === c;

test("report + session group by bankId; no remaining 'bank' groupBy keys on the three ledger tables", async () => {
  for (const file of ["lib/cash/report.ts", "lib/cash/session.ts"]) {
    const s = await src(file);
    assert.doesNotMatch(s, /by: \[[^\]]*"bank"[^\]]*\]/, `${file} must group by bankId`);
    assert.match(s, /"bankId"/, file);
  }
  const ledger = await src("lib/cash/ledger.ts");
  assert.doesNotMatch(ledger, /isBankCode|from "@\/lib\/banks"/);
  assert.match(ledger, /legacyCode: filters\.bank/);
});

test("no cash read path imports the legacy lib/banks catalogue", async () => {
  for (const file of ["lib/cash/ledger.ts", "lib/cash/settlement.ts", "lib/cash/report.ts", "lib/cash/report-export.ts", "lib/cash/session.ts", "lib/cash/action-failure.ts"]) {
    assert.doesNotMatch(await src(file), /@\/lib\/banks"/, file);
  }
});

test("parseMethodCounts still accepts '' / id strings and rejects duplicates and CASH", async () => {
  const s = await import("../lib/cash/session");
  const rows = s.parseMethodCounts([{ method: "CARD", bank: "pa1", counted: "100" }, { method: "BANK_TRANSFER", counted: "5" }]);
  assert.deepEqual(rows.map((r) => [r.method, r.bank]), [["CARD", "pa1"], ["BANK_TRANSFER", ""]]);
  assert.throws(() => s.parseMethodCounts([{ method: "CARD", bank: "pa1" }, { method: "CARD", bank: "pa1" }]), code("CASH_FIELD_INVALID"));
  assert.throws(() => s.parseMethodCounts([{ method: "CASH" }]), code("CASH_FIELD_INVALID"));
});

test("Review focus 4/5: serializeCashEntry labels from the relation; null bank on a bank method stays null", async () => {
  const l = await import("../lib/cash/ledger");
  const D = (await import("../app/generated/prisma/client")).Prisma.Decimal;
  const base = {
    id: "e1", direction: "INCOME", type: { id: "t", name: "n", systemKey: null }, branch: { id: "b", name: "B" }, amount: new D(1),
    method: "CARD", occurredAt: new Date(), note: null, attachmentPath: null, taxIncluded: null, customer: null, counterparty: null,
    orderId: null, orderPaymentId: null, settlementId: null, sessionId: null, session: null, voidedAt: null, createdBy: { id: "u", firstName: "A", lastName: "B" },
    createdAt: new Date(), voidedBy: null, voidReason: null,
  };
  const withAcct = l.serializeCashEntry({ ...base, bankId: "pa1", bankAccount: { id: "pa1", name: "Голомт POS", type: "POS", isTest: true, isActive: false, legacyCode: null } } as never);
  assert.equal(withAcct.bankId, "pa1");
  assert.equal(withAcct.bankLabel, "Голомт POS (идэвхгүй)");
  const none = l.serializeCashEntry({ ...base, bankId: null, bankAccount: null } as never);
  assert.equal(none.bankId, null);
  assert.equal(none.bankLabel, null);
});

test("buildCashEntryWhere: bank filter matches the account id OR a legacy code, scoped to the tenant", async () => {
  const l = await import("../lib/cash/ledger");
  for (const bank of ["pa1", "KHAN"]) {
    const where = l.buildCashEntryWhere("t1", { bank } as never, null);
    assert.equal(where.tenantId, "t1");
    assert.equal((where as { bankId?: string }).bankId, undefined);
    assert.deepEqual(where.AND, [{ OR: [{ bankId: bank }, { bankAccount: { tenantId: "t1", legacyCode: bank } }] }]);
  }
});

test("buildCashEntryWhere: the bank clause composes with other filters and does not clobber OR/AND", async () => {
  const l = await import("../lib/cash/ledger");
  const where = l.buildCashEntryWhere("t1", { bank: "KHAN", method: "CARD", from: "2026-10-01" } as never, null);
  assert.equal(where.method, "CARD");
  assert.ok(where.occurredAt);
  assert.equal(where.OR, undefined);
  assert.equal((where.AND as unknown[]).length, 1);
  // Callers that add their own OR/AND via spread keep the bank clause only when they append to AND; the source never assigns where.OR.
  const ledger = await src("lib/cash/ledger.ts");
  assert.doesNotMatch(ledger.slice(ledger.indexOf("export function buildCashEntryWhere")), /where\.OR\s*=/);
});
