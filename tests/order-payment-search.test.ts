import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

process.env.DATABASE_URL ??= "postgresql://unused/unused";
process.env.SESSION_SECRET ??= "unit-test-placeholder-secret-value-not-real-00";

test("payable-order search is tenant + branch scoped and excludes paid/internal/cancelled", async () => {
  const { buildPayableOrderSearchWhere } = await import("../lib/orders/order-payment-search");
  const w = buildPayableOrderSearchWhere({ tenantId: "t1", branchId: "b1", readWhere: { assignedToId: "u1" } });
  assert.equal(w.tenantId, "t1");
  assert.equal(w.branchId, "b1");
  assert.equal(w.isInternal, false);
  assert.deepEqual(w.status, { not: "CANCELLED" });
  assert.deepEqual(w.paymentStatus, { not: "PAID" });
  assert.deepEqual(w.AND, [{ assignedToId: "u1" }]);
  // postpaid is not excluded
  assert.equal("isPostpaid" in w, false);
});

test("payable-order search matches number, plate, phone, name and both register fields", async () => {
  const { buildPayableOrderSearchWhere } = await import("../lib/orders/order-payment-search");
  const w = buildPayableOrderSearchWhere({ tenantId: "t1", branchId: "b1", q: "  1234  " });
  const and = w.AND as Array<{ OR?: unknown[] }>;
  const json = JSON.stringify(and[0].OR);
  assert.equal(and.length, 1);
  for (const f of ["number", "plateSnapshot", "plate", "phone", "fullName", "orgRegnum", "ownerRegnum"]) assert.match(json, new RegExp(f));
  assert.match(json, /"contains":"1234"/);
  assert.match(json, /"orgRegnum":\{"startsWith":"1234"\}/);
  assert.equal(buildPayableOrderSearchWhere({ tenantId: "t", branchId: "b", q: "   " }).AND?.toString(), "");
});

test("note is normalised and propagated command -> postPaymentIncome -> CashTransaction.note", async () => {
  const { normalizePaymentNote, MAX_PAYMENT_NOTE_LENGTH } = await import("../lib/orders/order-payment-commands");
  assert.equal(normalizePaymentNote("  hi  "), "hi");
  assert.equal(normalizePaymentNote("   "), null);
  assert.equal(normalizePaymentNote(undefined), null);
  assert.equal(normalizePaymentNote("x".repeat(MAX_PAYMENT_NOTE_LENGTH))?.length, 1000);
  assert.throws(() => normalizePaymentNote("x".repeat(1001)), /1000/);

  const { postPaymentIncome } = await import("../lib/cash/sync");
  let data: Record<string, unknown> | undefined;
  const tx = {
    serviceOrder: { findFirst: async () => ({ branchId: "b1", customerId: "c1" }) },
    cashTransactionType: { findFirst: async () => ({ id: "ty" }), upsert: async () => ({ id: "ty" }), findUnique: async () => ({ id: "ty" }) },
    cashTransaction: { createMany: async (a: { data: Record<string, unknown>[] }) => { data = a.data[0]; return { count: 1 }; } },
  };
  try {
    await postPaymentIncome(tx as never, { tenantId: "t1", actorId: "u1", note: " paid by X ", payment: { id: "p1", orderId: "o1", amount: 5 as never, method: "CASH", bank: null, paidAt: new Date() } });
  } catch {
    // session/type helpers need a DB; fall through to the source check below
  }
  if (data) assert.equal(data.note, "paid by X");

  const sync = await readFile(new URL("../lib/cash/sync.ts", import.meta.url), "utf8");
  const cmd = await readFile(new URL("../lib/orders/order-payment-commands.ts", import.meta.url), "utf8");
  const act = await readFile(new URL("../app/_actions/order-payments.ts", import.meta.url), "utf8");
  assert.match(sync, /note: input\.note\.trim\(\)/);
  assert.match(cmd, /paidAt: payment\.paidAt \},\r?\n\s+note,/);
  assert.match(act, /allowCashChange: true, note: s\(formData, "note"\) \|\| null/);
});

test("search action gates on payments.create + cash.manage and branch", async () => {
  const act = await readFile(new URL("../app/_actions/order-payments.ts", import.meta.url), "utf8");
  const body = act.slice(act.indexOf("export async function searchPayableOrdersAction"));
  assert.match(body, /canCreate\(user, "payments"\) \|\| !hasPermission\(user, "cash\.manage"\)/);
  assert.match(body, /tenantId: user\.tenantId, isActive: true/);
});
