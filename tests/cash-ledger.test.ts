import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";

process.env.DATABASE_URL ??= "postgresql://unused/unused";
process.env.SESSION_SECRET ??= "unit-test-placeholder-secret-value-not-real-00";

const src = (path: string) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

async function decimal(value: string) {
  return new (await import("../app/generated/prisma/client")).Prisma.Decimal(value);
}

// ---------------------------------------------------------------- pure rules

test("parseCashAmount: positive, <= 2 decimals, bounded; accepts grouped strings and plain numbers", async () => {
  const { parseCashAmount } = await import("../lib/cash/rules");
  assert.equal(parseCashAmount("1,500.50")?.toString(), "1500.5");
  assert.equal(parseCashAmount(250)?.toString(), "250");
  assert.equal(parseCashAmount("0.01")?.toString(), "0.01");
  for (const bad of ["0", "-5", "1.234", "abc", "", null, undefined, Number.NaN, Number.POSITIVE_INFINITY, "10000000000", {}, "1e3"]) {
    assert.equal(parseCashAmount(bad), null, String(bad));
  }
});

test("requireCashAmount / requireManualMethod throw the spec'd 422 codes (QPAY is not manual)", async () => {
  const rules = await import("../lib/cash/rules");
  assert.throws(() => rules.requireCashAmount("0"), (e: unknown) => e instanceof rules.CashError && e.code === "CASH_AMOUNT_INVALID" && e.status === 422);
  for (const method of ["CASH", "BANK_TRANSFER", "CARD", "OTHER"]) assert.equal(rules.requireManualMethod(method), method);
  for (const bad of ["QPAY", "PAYPAL", "", null, undefined, 5]) {
    assert.throws(() => rules.requireManualMethod(bad), (e: unknown) => e instanceof rules.CashError && e.code === "CASH_METHOD_INVALID" && e.status === 422);
  }
});

test("resolveOccurredAt: default now, rejects invalid and > 1 day in the future, parses business-local strings", async () => {
  const rules = await import("../lib/cash/rules");
  const now = new Date("2026-10-05T04:00:00.000Z"); // 12:00 Ulaanbaatar
  assert.equal(rules.resolveOccurredAt(undefined, now), now);
  assert.equal(rules.resolveOccurredAt("", now), now);
  assert.equal(rules.resolveOccurredAt("2026-10-05", now), now); // today -> now
  assert.equal(rules.resolveOccurredAt("2026-10-03", now).toISOString(), "2026-10-03T04:00:00.000Z"); // noon local
  assert.equal(rules.resolveOccurredAt("2026-10-04T09:30", now).toISOString(), "2026-10-04T01:30:00.000Z"); // +08:00
  assert.equal(rules.resolveOccurredAt("2026-10-04T01:30:00.000Z", now).toISOString(), "2026-10-04T01:30:00.000Z");
  assert.equal(rules.resolveOccurredAt(new Date(now.getTime() + 23 * 3600_000), now).getTime(), now.getTime() + 23 * 3600_000);
  for (const bad of ["not-a-date", "2026-13-40", new Date(now.getTime() + 25 * 3600_000), "2026-10-07T12:00:00Z", 12345]) {
    assert.throws(() => rules.resolveOccurredAt(bad, now), (e: unknown) => e instanceof rules.CashError && e.code === "CASH_DATE_INVALID" && e.status === 422, String(bad));
  }
});

test("taxIncluded is EXPENSE-only, positive and not above the amount", async () => {
  const rules = await import("../lib/cash/rules");
  const amount = await decimal("10000");
  assert.equal(rules.resolveTaxIncluded("EXPENSE", null, amount), null);
  assert.equal(rules.resolveTaxIncluded("EXPENSE", "", amount), null);
  assert.equal(rules.resolveTaxIncluded("EXPENSE", "909.09", amount)?.toString(), "909.09");
  for (const [direction, value] of [["INCOME", "100"], ["EXPENSE", "0"], ["EXPENSE", "10000.01"], ["EXPENSE", "x"]] as const) {
    assert.throws(() => rules.resolveTaxIncluded(direction, value, amount), (e: unknown) => e instanceof rules.CashError && e.code === "CASH_TAX_INVALID");
  }
});

test("void reason is required and trimmed", async () => {
  const rules = await import("../lib/cash/rules");
  assert.equal(rules.requireVoidReason("  буруу бичсэн "), "буруу бичсэн");
  for (const bad of ["", "   ", null, undefined, 5]) {
    assert.throws(() => rules.requireVoidReason(bad), (e: unknown) => e instanceof rules.CashError && e.code === "CASH_VOID_REASON_REQUIRED" && e.status === 422);
  }
});

test("system type guards: locked for edit; unusable for manual entries; direction/active enforced", async () => {
  const rules = await import("../lib/cash/rules");
  assert.throws(() => rules.assertTypeEditable({ systemKey: "ORDER_PAYMENT" }), (e: unknown) => e instanceof rules.CashError && e.code === "CASH_TYPE_SYSTEM" && e.status === 422);
  assert.doesNotThrow(() => rules.assertTypeEditable({ systemKey: null }));
  const ok = { direction: "INCOME", isActive: true, systemKey: null };
  assert.doesNotThrow(() => rules.assertTypeUsableForEntry(ok, "INCOME"));
  for (const bad of [null, { ...ok, isActive: false }, { ...ok, direction: "EXPENSE" }, { ...ok, systemKey: "ORDER_PAYMENT" }]) {
    assert.throws(() => rules.assertTypeUsableForEntry(bad, "INCOME"), (e: unknown) => e instanceof rules.CashError && e.code === "CASH_TYPE_INVALID");
  }
  assert.deepEqual(rules.SYSTEM_TYPE_DEFS.map((d) => [d.systemKey, d.direction, d.name]), [
    ["ORDER_PAYMENT", "INCOME", "Засварын орлого"],
    ["POSTPAID_SETTLEMENT", "INCOME", "Дараа тооцоо"],
    ["INTERNAL_REPAIR", "EXPENSE", "Дотоод засварын зардал"],
  ]);
  assert.deepEqual(rules.DEFAULT_TYPE_DEFS.map((d) => `${d.direction}:${d.name}`), [
    "INCOME:Бусад орлого", "INCOME:Сэлбэг худалдаа", "EXPENSE:Сэлбэг худалдан авалт", "EXPENSE:Цалин, урьдчилгаа",
    "EXPENSE:Түрээс", "EXPENSE:Ашиглалтын зардал", "EXPENSE:Бусад зардал",
  ]);
  assert.equal(rules.normalizeTypeName("  Бусад   орлого "), "Бусад орлого");
  assert.throws(() => rules.normalizeTypeName("   "), (e: unknown) => e instanceof rules.CashError && e.code === "CASH_TYPE_NAME_INVALID");
});

test("manual void guard: auto (payment/order/settlement-linked) and already-voided entries are refused", async () => {
  const rules = await import("../lib/cash/rules");
  const manual = { voidedAt: null, orderPaymentId: null, orderId: null, settlementId: null };
  assert.doesNotThrow(() => rules.assertManuallyVoidable(manual));
  assert.throws(() => rules.assertManuallyVoidable({ ...manual, voidedAt: new Date() }), (e: unknown) => e instanceof rules.CashError && e.code === "CASH_ALREADY_VOIDED" && e.status === 422);
  for (const patch of [{ orderPaymentId: "p1" }, { orderId: "o1" }, { settlementId: "s1" }]) {
    assert.throws(() => rules.assertManuallyVoidable({ ...manual, ...patch }), (e: unknown) => e instanceof rules.CashError && e.code === "CASH_SYSTEM_ENTRY" && e.status === 422);
  }
});

test("totals: per direction, voided rows and taxIncluded never counted", async () => {
  const { computeCashTotals } = await import("../lib/cash/rules");
  const rows = [
    { direction: "INCOME", amount: "1000.50", voidedAt: null },
    { direction: "INCOME", amount: "500", voidedAt: new Date() }, // voided
    { direction: "EXPENSE", amount: "300", voidedAt: null, taxIncluded: "27.27" },
    { direction: "EXPENSE", amount: "200.25", voidedAt: null, taxIncluded: "18" },
    { direction: "EXPENSE", amount: "999", voidedAt: new Date(), taxIncluded: "90" }, // voided
  ];
  const t = computeCashTotals(rows);
  assert.equal(t.income.toString(), "1000.5");
  assert.equal(t.expense.toString(), "500.25");
  assert.equal(t.net.toString(), "500.25");
  assert.equal(t.count, 3);
});

// -------------------------------------------------- commands: pre-DB validation

test("createCashEntry rejects before touching the database: permission, shape, amount, method, date, tax, branch scope", async () => {
  const { createCashEntry } = await import("../lib/cash/ledger");
  const rules = await import("../lib/cash/rules");
  const owner = { id: "u1", tenantId: "t1", isOwner: true, role: null };
  const base = { actor: owner, direction: "EXPENSE", typeId: "ty1", branchId: "b1", amount: "100", method: "CASH" };
  const code = (c: string, status = 422) => (e: unknown) => e instanceof rules.CashError && e.code === c && e.status === status;

  await assert.rejects(createCashEntry({ ...base, actor: { ...owner, isOwner: false, role: { permissions: ["orders.view"] } } }), code("CASH_MANAGE_FORBIDDEN", 403));
  await assert.rejects(createCashEntry({ ...base, direction: "SIDEWAYS" }), code("CASH_TYPE_INVALID"));
  await assert.rejects(createCashEntry({ ...base, typeId: "" }), code("CASH_TYPE_INVALID"));
  await assert.rejects(createCashEntry({ ...base, amount: "-1" }), code("CASH_AMOUNT_INVALID"));
  await assert.rejects(createCashEntry({ ...base, method: "QPAY" }), code("CASH_METHOD_INVALID"));
  await assert.rejects(createCashEntry({ ...base, occurredAt: "2999-01-01" }), code("CASH_DATE_INVALID"));
  await assert.rejects(createCashEntry({ ...base, direction: "INCOME", taxIncluded: "5" }), code("CASH_TAX_INVALID"));
  await assert.rejects(createCashEntry({ ...base, taxIncluded: "500" }), code("CASH_TAX_INVALID"));
  await assert.rejects(createCashEntry({ ...base, attachmentPath: "/uploads/cash/OTHER-TENANT/x.png" }), code("CASH_ATTACHMENT_INVALID"));
  await assert.rejects(createCashEntry({ ...base, attachmentPath: "/uploads/cash/t1/../../etc/x.png" }), code("CASH_ATTACHMENT_INVALID"));
  await assert.rejects(createCashEntry({ ...base, scope: "b2" }), code("CASH_BRANCH_INVALID"));
  await assert.rejects(createCashEntry({ ...base, actor: { ...owner, workingBranchId: "b2" } }), code("CASH_BRANCH_INVALID"));
});

test("voidCashEntry and type commands enforce permission and required reason before the database", async () => {
  const { voidCashEntry } = await import("../lib/cash/ledger");
  const types = await import("../lib/cash/types");
  const rules = await import("../lib/cash/rules");
  const noPerm = { id: "u1", tenantId: "t1", isOwner: false, role: { permissions: [] as string[] } };
  const owner = { id: "u1", tenantId: "t1", isOwner: true, role: null };
  await assert.rejects(voidCashEntry({ actor: noPerm, entryId: "e1", reason: "x" }), (e: unknown) => e instanceof rules.CashError && e.code === "CASH_MANAGE_FORBIDDEN" && e.status === 403);
  await assert.rejects(voidCashEntry({ actor: owner, entryId: "e1", reason: "  " }), (e: unknown) => e instanceof rules.CashError && e.code === "CASH_VOID_REASON_REQUIRED");
  await assert.rejects(types.createCashType({ actor: noPerm, direction: "INCOME", name: "x" }), (e: unknown) => e instanceof rules.CashError && e.code === "CASH_MANAGE_FORBIDDEN");
  await assert.rejects(types.createCashType({ actor: owner, direction: "NOPE", name: "x" }), (e: unknown) => e instanceof rules.CashError && e.code === "CASH_TYPE_INVALID");
  await assert.rejects(types.updateCashType({ actor: noPerm, typeId: "t", name: "x" }), (e: unknown) => e instanceof rules.CashError && e.code === "CASH_MANAGE_FORBIDDEN");
  await assert.rejects(types.listCashTypes({ actor: noPerm }), (e: unknown) => e instanceof rules.CashError && e.code === "CASH_MANAGE_FORBIDDEN");
});

test("entry filters build a tenant-scoped where; a pinned branch scope always wins; voided handled by caller", async () => {
  const { buildCashEntryWhere } = await import("../lib/cash/ledger");
  const rules = await import("../lib/cash/rules");
  const w = buildCashEntryWhere("t1", { branchId: "bX", direction: "INCOME", method: "CARD", bank: "KHAN", typeId: "ty", from: "2026-10-01", to: "2026-10-05" }, null);
  assert.equal(w.tenantId, "t1");
  assert.equal(w.branchId, "bX");
  assert.equal(w.direction, "INCOME");
  assert.equal(w.bank, "KHAN");
  const occurred = w.occurredAt as { gte: Date; lt: Date };
  assert.equal(occurred.gte.toISOString(), "2026-09-30T16:00:00.000Z");
  assert.equal(occurred.lt.toISOString(), "2026-10-05T16:00:00.000Z"); // end of 10-05 local, exclusive
  assert.equal(buildCashEntryWhere("t1", { branchId: "bX" }, "bPinned").branchId, "bPinned");
  assert.throws(() => buildCashEntryWhere("t1", { direction: "X" }, null), (e: unknown) => e instanceof rules.CashError && e.code === "CASH_TYPE_INVALID");
  assert.throws(() => buildCashEntryWhere("t1", { from: "garbage" }, null), (e: unknown) => e instanceof rules.CashError && e.code === "CASH_DATE_INVALID");
  assert.throws(() => buildCashEntryWhere("t1", { bank: "NOPE" }, null), (e: unknown) => e instanceof rules.CashError && e.code === "PAYMENT_BANK_NOT_ENABLED");
  assert.equal("voidedAt" in w, false);
});

// ----------------------------------------------------------- sync (fake tx)

type Call = { fn: string; args: unknown };

function fakeTx(opts: { order?: unknown; existingTypes?: boolean; liveEntry?: boolean; createdCount?: number; openSessionId?: string | null; attachedBranches?: Array<{ branchId: string }> } = {}) {
  const calls: Call[] = [];
  const tx = {
    // Phase C3: CASH writes take a FOR SHARE lock on the Branch and look up the open session.
    $queryRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => (calls.push({ fn: "branchLock", args: [strings.join("?"), ...values] }), [{ id: values[0] }]),
    cashSession: { findFirst: async (args: unknown) => (calls.push({ fn: "session.findFirst", args }), opts.openSessionId ? { id: opts.openSessionId } : null) },
    serviceOrder: { findFirst: async (args: unknown) => (calls.push({ fn: "serviceOrder.findFirst", args }), opts.order === undefined ? { branchId: "b1", customerId: "c1" } : opts.order) },
    cashTransactionType: {
      findFirst: async (args: unknown) => (calls.push({ fn: "type.findFirst", args }), opts.existingTypes === false ? null : { id: "type-1" }),
      findMany: async (args: unknown) => (calls.push({ fn: "type.findMany", args }), []),
      createMany: async (args: unknown) => (calls.push({ fn: "type.createMany", args }), { count: 0 }),
    },
    cashTransaction: {
      createMany: async (args: unknown) => (calls.push({ fn: "createMany", args }), { count: opts.createdCount ?? 1 }),
      create: async (args: unknown) => (calls.push({ fn: "create", args }), { id: "e1" }),
      findFirst: async (args: unknown) => (calls.push({ fn: "findFirst", args }), opts.liveEntry ? { id: "live" } : null),
      findMany: async (args: unknown) => (calls.push({ fn: "findMany", args }), opts.attachedBranches ?? []),
      updateMany: async (args: unknown) => (calls.push({ fn: "updateMany", args }), { count: 2 }),
    },
  };
  return { tx: tx as never, calls };
}

test("postPaymentIncome writes ONE income entry copying payment + order data, idempotently", async () => {
  const sync = await import("../lib/cash/sync");
  const { tx, calls } = fakeTx();
  const paidAt = new Date("2026-10-05T01:00:00Z");
  const created = await sync.postPaymentIncome(tx, {
    tenantId: "t1",
    actorId: "u1",
    payment: { id: "p1", orderId: "o1", amount: await decimal("5000"), method: "BANK_TRANSFER", bank: "KHAN", paidAt },
  });
  assert.equal(created, true);
  const call = calls.find((c) => c.fn === "createMany")!;
  const args = call.args as { data: Array<Record<string, unknown>>; skipDuplicates: boolean };
  assert.equal(args.skipDuplicates, true, "idempotent via the orderPaymentId unique");
  assert.equal(args.data.length, 1);
  assert.deepEqual(
    { ...args.data[0], amount: String(args.data[0].amount) },
    {
      tenantId: "t1", branchId: "b1", direction: "INCOME", typeId: "type-1", amount: "5000", method: "BANK_TRANSFER", bank: "KHAN",
      occurredAt: paidAt, customerId: "c1", orderPaymentId: "p1", orderId: "o1", sessionId: null, createdById: "u1",
    },
  );
  const orderLookup = calls.find((c) => c.fn === "serviceOrder.findFirst")!.args as { where: { tenantId: string } };
  assert.equal(orderLookup.where.tenantId, "t1");
  // a repeat (row already exists) reports false and never throws
  const again = fakeTx({ createdCount: 0 });
  assert.equal(await sync.postPaymentIncome(again.tx, { tenantId: "t1", actorId: "u1", payment: { id: "p1", orderId: "o1", amount: await decimal("5000"), method: "CASH", bank: null, paidAt } }), false);
});

test("postPaymentIncome skips settlement payments and unknown orders; seeds system types lazily", async () => {
  const sync = await import("../lib/cash/sync");
  const payment = { id: "p1", orderId: "o1", amount: await decimal("1"), method: "CASH", bank: null, paidAt: new Date() };
  const a = fakeTx();
  assert.equal(await sync.postPaymentIncome(a.tx, { tenantId: "t1", actorId: "u1", payment: { ...payment, settlementId: "s1" } }), false);
  assert.equal(a.calls.length, 0);
  const b = fakeTx({ order: null });
  assert.equal(await sync.postPaymentIncome(b.tx, { tenantId: "t1", actorId: "u1", payment }), false);
  assert.equal(b.calls.some((c) => c.fn === "createMany"), false);
  // type row missing -> ensureSystemTypes runs; the (fake) re-read still finds nothing -> hard error, never a silent skip
  const c = fakeTx({ existingTypes: false });
  await assert.rejects(sync.postPaymentIncome(c.tx, { tenantId: "t1", actorId: "u1", payment }));
  assert.ok(c.calls.some((x) => x.fn === "type.createMany"));
});

test("voidPaymentIncome targets only this tenant's live entries of the payment", async () => {
  const sync = await import("../lib/cash/sync");
  const v = fakeTx();
  const now = new Date("2026-10-05T00:00:00Z");
  assert.equal(await sync.voidPaymentIncome(v.tx, { tenantId: "t1", actorId: "u1", paymentIds: ["p1", "p2"], now }), 2);
  assert.deepEqual(v.calls.find((c) => c.fn === "updateMany")!.args, {
    where: { tenantId: "t1", orderPaymentId: { in: ["p1", "p2"] }, voidedAt: null },
    data: { voidedAt: now, voidedById: "u1", voidReason: "Төлбөр буцаагдсан" },
  });
  const none = fakeTx();
  assert.equal(await sync.voidPaymentIncome(none.tx, { tenantId: "t1", actorId: "u1", paymentIds: [] }), 0);
  assert.equal(none.calls.length, 0);
});

test("internal repair expense: posts once at order total, skips zero totals and existing live entries, voids by system type", async () => {
  const sync = await import("../lib/cash/sync");
  const occurredAt = new Date("2026-10-05T03:00:00Z");
  const base = { tenantId: "t1", actorId: "u1", orderId: "o1", branchId: "b1", occurredAt };

  const a = fakeTx();
  assert.equal(await sync.postInternalRepairExpense(a.tx, { ...base, amount: await decimal("125000") }), true);
  const created = a.calls.find((c) => c.fn === "create")!.args as { data: Record<string, unknown> };
  assert.deepEqual({ ...created.data, amount: String(created.data.amount) }, {
    tenantId: "t1", branchId: "b1", direction: "EXPENSE", typeId: "type-1", amount: "125000", method: "OTHER", occurredAt, orderId: "o1", sessionId: null, createdById: "u1",
  });

  for (const amount of [null, undefined, await decimal("0")]) {
    const z = fakeTx();
    assert.equal(await sync.postInternalRepairExpense(z.tx, { ...base, amount }), false);
    assert.equal(z.calls.length, 0);
  }
  const live = fakeTx({ liveEntry: true });
  assert.equal(await sync.postInternalRepairExpense(live.tx, { ...base, amount: await decimal("5") }), false);
  assert.equal(live.calls.some((c) => c.fn === "create"), false, "at most one live entry per order");

  const v = fakeTx();
  const now = new Date("2026-10-05T04:00:00Z");
  assert.equal(await sync.voidInternalRepairExpense(v.tx, { tenantId: "t1", actorId: "u1", orderId: "o1", reason: "Захиалга цуцлагдсан", now }), 2);
  assert.deepEqual(v.calls.find((c) => c.fn === "updateMany")!.args, {
    where: { tenantId: "t1", orderId: "o1", orderPaymentId: null, voidedAt: null, type: { systemKey: "INTERNAL_REPAIR" } },
    data: { voidedAt: now, voidedById: "u1", voidReason: "Захиалга цуцлагдсан" },
  });
});

test("ensureSystemTypes seeds the 5 system types always and editable defaults only for a type-less tenant", async () => {
  const { ensureSystemTypes } = await import("../lib/cash/types");
  const run = async (existing: Array<{ systemKey: string | null }>) => {
    const created: Array<Record<string, unknown>> = [];
    const client = {
      cashTransactionType: {
        findMany: async () => existing,
        createMany: async (args: { data: Array<Record<string, unknown>>; skipDuplicates: boolean }) => { assert.equal(args.skipDuplicates, true); created.push(...args.data); return { count: args.data.length }; },
      },
    };
    await ensureSystemTypes(client as never, "t1");
    return created;
  };
  const fresh = await run([]);
  assert.equal(fresh.length, 3 + 7);
  assert.ok(fresh.every((r) => r.tenantId === "t1"));
  assert.equal(fresh.filter((r) => r.systemKey).length, 3);
  const partial = await run([{ systemKey: "ORDER_PAYMENT" }]);
  assert.deepEqual(partial.map((r) => r.systemKey), ["POSTPAID_SETTLEMENT", "INTERNAL_REPAIR"]); // no defaults re-seeded
  assert.deepEqual(await run([{ systemKey: "ORDER_PAYMENT" }, { systemKey: "POSTPAID_SETTLEMENT" }, { systemKey: "INTERNAL_REPAIR" }, { systemKey: "CLOSED_SESSION_VOID_OUT" }]), []);
});

// ---------------------------------------- structural: every path calls its hook

function fnBody(source: string, header: string): string {
  const start = source.indexOf(header);
  assert.notEqual(start, -1, `missing ${header}`);
  const next = source.indexOf("\nexport ", start + header.length);
  return source.slice(start, next === -1 ? undefined : next);
}

test("every PAID / reverse path in the order-payment commands calls its ledger hook in-transaction", async () => {
  const commands = await src("lib/orders/order-payment-commands.ts");
  const create = fnBody(commands, "export async function createOrderPaymentCommand");
  assert.match(create, /postPaymentIncome\(tx,/);
  assert.ok(create.indexOf("postPaymentIncome") > create.indexOf("tx.orderPayment.create"));

  const reverse = fnBody(commands, "export async function reverseOrderPaymentCommand");
  assert.match(reverse, /voidPaymentIncome\(tx,[^)]*paymentIds: \[payment\.id\]/);

  const reverseAll = fnBody(commands, "export async function reverseAllOrderPaymentsCommand");
  assert.match(reverseAll, /voidPaymentIncome\(tx,[^)]*paid\.map/);

  const confirm = fnBody(commands, "export async function confirmOrderQPayPaymentCommand");
  assert.match(confirm, /status: "PAID"[^}]*\} \}\);\s*\/\/ Cash ledger[^\n]*\n\s*await postPaymentIncome\(tx,/);

  // Every code path that sets OrderPayment.status = PAID, anywhere in lib/app, must be a known hooked site.
  const legacyQpay = await src("lib/order-payments.ts");
  assert.match(fnBody(legacyQpay, "export async function confirmOrderQPayPayment"), /postPaymentIncome\(tx,/);
});

test("no other source file writes OrderPayment status PAID or reverses payments outside the hooked commands", async () => {
  const { readdir } = await import("node:fs/promises");
  // lib/cash/settlement.ts writes settlement payments + their ONE lump ledger entry in a single transaction (Phase C2).
  const hooked = new Set(["lib/orders/order-payment-commands.ts", "lib/order-payments.ts", "lib/cash/settlement.ts"]);
  const offenders: string[] = [];
  async function walk(dir: string) {
    for (const entry of await readdir(new URL(`../${dir}`, import.meta.url), { withFileTypes: true })) {
      const rel = `${dir}/${entry.name}`;
      if (entry.isDirectory()) {
        if (entry.name === "generated" || entry.name === "node_modules") continue;
        await walk(rel);
      } else if (/\.(ts|tsx)$/.test(entry.name) && !hooked.has(rel)) {
        const text = await src(rel);
        if (/orderPayment\.(create|update|updateMany|upsert)\(/.test(text) || /\$executeRaw[^;]*"OrderPayment"/.test(text)) offenders.push(rel);
      }
    }
  }
  await walk("lib");
  await walk("app");
  // Pre-existing non-PAID writers that never move a payment into/out of PAID (QR url refresh, pending cancel).
  const nonPaidWriters = new Set(["app/api/v1/orders/[id]/qpay/route.ts"]);
  assert.deepEqual(offenders.filter((f) => !nonPaidWriters.has(f)), []);
  const qrRoute = await src("app/api/v1/orders/[id]/qpay/route.ts");
  assert.doesNotMatch(qrRoute, /status: "PAID"|status: "CANCELLED"/);
});

test("internal order lifecycle: complete posts, cancel/delete void, all in the order transaction", async () => {
  const orderCommands = await src("lib/orders/order-commands.ts");
  const patch = fnBody(orderCommands, "export async function applyOrderPatchCommand");
  assert.match(patch, /nextStatus === "COMPLETED" && nextInternal\) \{\s*await postInternalRepairExpense\(tx,/);
  assert.match(patch, /amount: order\.totalAmount/);
  assert.match(patch, /nextStatus === "CANCELLED"\) \{\s*await voidInternalRepairExpense\(tx,[^)]*VOID_REASON_ORDER_CANCELLED/);
  assert.match(patch, /order\.status === "COMPLETED" && nextStatus !== "COMPLETED"\) \{\s*await voidInternalRepairExpense\(tx,[^)]*VOID_REASON_ORDER_REOPENED/);
  const del = fnBody(orderCommands, "export async function deleteOrderCommand");
  assert.match(del, /voidInternalRepairExpense\(tx,[^)]*VOID_REASON_ORDER_DELETED/);
  assert.ok(del.indexOf("voidInternalRepairExpense") < del.indexOf("tx.serviceOrder.delete"));
  // changeOrderStatusCommand / assignOrderCommand / bulk status all funnel through applyOrderPatchCommand
  const bulk = await src("lib/orders/order-bulk-commands.ts");
  assert.match(bulk, /changeOrderStatusCommand|applyOrderPatchCommand/);
  assert.match(fnBody(orderCommands, "export async function changeOrderStatusCommand"), /applyOrderPatchCommand/);
});

test("cash staff API: every route is gated by cash.manage, branch-scoped and subscription-locked on writes", async () => {
  const files = [
    "app/api/v1/cash/entries/route.ts",
    "app/api/v1/cash/entries/[id]/void/route.ts",
    "app/api/v1/cash/types/route.ts",
    "app/api/v1/cash/types/[id]/route.ts",
    "app/api/v1/cash/attachments/route.ts",
  ];
  for (const file of files) {
    const text = await src(file);
    assert.match(text, /requireCashApiUser\(req\)/, file);
    if (/export async function (POST|PATCH)/.test(text)) assert.match(text, /requireActiveSubscriptionApi/, file);
  }
  const http = await src("lib/cash/http.ts");
  assert.match(http, /hasPermission\(auth\.user, "cash\.manage"\)/);
  assert.match(http, /code: "CASH_MANAGE_FORBIDDEN"/);
  for (const file of ["app/api/v1/cash/entries/route.ts", "app/api/v1/cash/entries/[id]/void/route.ts"]) {
    assert.match(await src(file), /resolveWorkingBranch/, file);
  }
  const actions = await src("app/_actions/cash.ts");
  for (const name of ["createCashEntryAction", "voidCashEntryAction", "createCashTypeAction", "updateCashTypeAction", "uploadCashAttachmentAction"]) {
    assert.match(actions, new RegExp(`export async function ${name}`));
  }
});

test("migration is idempotent, seeds types for existing tenants, backfills both ledgers and enables RLS", async () => {
  const sql = await src("prisma/migrations/20261005170000_cash_ledger/migration.sql");
  assert.match(sql, /SET LOCAL app\.bypass_rls = 'on'/);
  assert.equal((sql.match(/CREATE TABLE IF NOT EXISTS/g) ?? []).length, 4);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS "settlementId"/);
  assert.match(sql, /NOT EXISTS \(SELECT 1 FROM "CashTransaction" c WHERE c\."orderPaymentId" = p\."id"\)/);
  assert.match(sql, /p\."status" = 'PAID'/);
  assert.match(sql, /COALESCE\(p\."paidAt", p\."updatedAt"\)/);
  assert.match(sql, /ty\."systemKey" = 'INTERNAL_REPAIR'/);
  assert.match(sql, /o\."isInternal" = true\s+AND o\."status" = 'COMPLETED'/);
  for (const table of ["CashTransactionType", "CashTransaction", "PostpaidSettlement", "CashSession"]) {
    assert.match(sql, new RegExp(`ALTER TABLE "${table}" FORCE ROW LEVEL SECURITY`));
  }
  for (const name of ["Засварын орлого", "Дараа тооцоо", "Дотоод засварын зардал", "Бусад орлого", "Сэлбэг худалдаа", "Сэлбэг худалдан авалт", "Цалин, урьдчилгаа", "Түрээс", "Ашиглалтын зардал", "Бусад зардал"]) {
    assert.ok(sql.includes(`'${name}'`), name);
  }
});

test("ensureSystemTypes adopts a same-direction same-name editable type instead of failing on the unique key", async () => {
  const { ensureSystemTypes } = await import("../lib/cash/types");
  const updates: Array<{ where: { id: string }; data: Record<string, unknown> }> = [];
  const created: Array<Record<string, unknown>> = [];
  const existing = [
    { id: "x1", systemKey: null, direction: "INCOME", name: "Засварын орлого" },
    { id: "x2", systemKey: null, direction: "EXPENSE", name: "Засварын орлого" }, // other direction: not adoptable
    { id: "x3", systemKey: "POSTPAID_SETTLEMENT", direction: "INCOME", name: "Дараа тооцоо" },
  ];
  const client = {
    cashTransactionType: {
      findMany: async () => existing,
      update: async (args: { where: { id: string }; data: Record<string, unknown> }) => { updates.push(args); return {}; },
      createMany: async (args: { data: Array<Record<string, unknown>> }) => { created.push(...args.data); return { count: args.data.length }; },
    },
  };
  await ensureSystemTypes(client as never, "t1");
  assert.deepEqual(updates, [{ where: { id: "x1" }, data: { systemKey: "ORDER_PAYMENT", isActive: true } }]);
  assert.deepEqual(created.map((r) => r.systemKey), ["INTERNAL_REPAIR"]);
});
