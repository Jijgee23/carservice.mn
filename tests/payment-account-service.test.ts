import assert from "node:assert/strict";
import { test } from "node:test";

process.env.DATABASE_URL ??= "postgresql://unused/unused";
process.env.SESSION_SECRET ??= "unit-test-placeholder-secret-value-not-real-00";
const code = (c: string) => (e: unknown) => (e as { code?: string }).code === c;

test("validate create: bank account needs name + 6..20 digit number; normalises separators", async () => {
  const { validatePaymentAccountInput } = await import("../lib/payment-account-service");
  const ok = validatePaymentAccountInput({ type: "BANK_ACCOUNT", name: " Хаан банк ", accountNumber: "5012 3456-78" }, "create");
  assert.deepEqual(ok, { type: "BANK_ACCOUNT", name: "Хаан банк", accountNumber: "5012345678", terminalId: null, merchantId: null, isTest: false });
  assert.throws(() => validatePaymentAccountInput({ type: "BANK_ACCOUNT", name: "X", accountNumber: "5012345678" }, "create"), code("PAYMENT_ACCOUNT_INVALID"));
  assert.throws(() => validatePaymentAccountInput({ type: "BANK_ACCOUNT", name: "Хаан банк", accountNumber: "123" }, "create"), code("PAYMENT_ACCOUNT_INVALID"));
  assert.throws(() => validatePaymentAccountInput({ type: "BANK_ACCOUNT", name: "Хаан банк", accountNumber: "1".repeat(21) }, "create"), code("PAYMENT_ACCOUNT_INVALID"));
  assert.throws(() => validatePaymentAccountInput({ type: "WALLET", name: "Хаан банк", accountNumber: "5012345678" }, "create"), code("PAYMENT_ACCOUNT_INVALID"));
});

test("validate create: terminal fields and isTest are POS-only; POS defaults isTest from input", async () => {
  const { validatePaymentAccountInput } = await import("../lib/payment-account-service");
  assert.throws(() => validatePaymentAccountInput({ type: "BANK_ACCOUNT", name: "Хаан банк", accountNumber: "5012345678", terminalId: "T1" }, "create"), code("PAYMENT_ACCOUNT_INVALID"));
  assert.throws(() => validatePaymentAccountInput({ type: "BANK_ACCOUNT", name: "Хаан банк", accountNumber: "5012345678", isTest: true }, "create"), code("PAYMENT_ACCOUNT_INVALID"));
  const pos = validatePaymentAccountInput({ type: "POS", name: "Голомт POS", accountNumber: "1234567890", terminalId: "TID001", merchantId: "MID9", isTest: true }, "create");
  assert.equal(pos.terminalId, "TID001");
  assert.equal(pos.merchantId, "MID9");
  assert.equal(pos.isTest, true);
  assert.throws(() => validatePaymentAccountInput({ type: "POS", name: "Голомт POS", accountNumber: "1234567890", terminalId: "bad id!" }, "create"), code("PAYMENT_ACCOUNT_INVALID"));
  assert.throws(() => validatePaymentAccountInput({ type: "POS", name: "Голомт POS", accountNumber: "1234567890", terminalId: "A".repeat(33) }, "create"), code("PAYMENT_ACCOUNT_INVALID"));
});

test("validate update: type is immutable, partial fields allowed", async () => {
  const { validatePaymentAccountInput } = await import("../lib/payment-account-service");
  assert.throws(() => validatePaymentAccountInput({ type: "POS" }, "update"), code("PAYMENT_ACCOUNT_INVALID"));
  assert.deepEqual(validatePaymentAccountInput({ isActive: false }, "update"), { isActive: false });
  assert.deepEqual(validatePaymentAccountInput({ name: "Шинэ нэр" }, "update"), { name: "Шинэ нэр" });
});

// ---- service cases: prisma.$transaction / paymentAccount replaced on the singleton (same seam as cash-session.test.ts) ----

type Row = { id: string; tenantId: string; type: string; name: string; accountNumber: string | null; terminalId: string | null; merchantId: string | null; isTest: boolean; isActive: boolean };

function fakeDb(seed: Row[] = []) {
  const rows = [...seed];
  const audits: Array<Record<string, unknown>> = [];
  const creates: Array<Record<string, unknown>> = [];
  const state = { createError: null as unknown };
  const pick = (r: Row) => ({ id: r.id, type: r.type, name: r.name, accountNumber: r.accountNumber, terminalId: r.terminalId, merchantId: r.merchantId, isTest: r.isTest, isActive: r.isActive });
  const model = {
    findMany: async ({ where }: { where: { tenantId: string; isActive?: boolean } }) =>
      rows.filter((r) => r.tenantId === where.tenantId && (where.isActive === undefined || r.isActive === where.isActive)).map(pick),
    findFirst: async ({ where }: { where: { id?: string; tenantId: string; type?: string } }) => {
      const r = rows.find(
        (x) => x.tenantId === where.tenantId && (where.id === undefined || x.id === where.id) && (where.type === undefined || x.type === where.type),
      );
      return r ? pick(r) : null;
    },
    create: async ({ data }: { data: Record<string, unknown> }) => {
      creates.push(data);
      if (state.createError) throw state.createError;
      const r = { id: "new1", isActive: true, ...data } as Row;
      rows.push(r);
      return pick(r);
    },
    update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
      const r = rows.find((x) => x.id === where.id)!;
      Object.assign(r, data);
      return pick(r);
    },
  };
  const tx = { paymentAccount: model, auditLog: { create: async ({ data }: { data: Record<string, unknown> }) => { audits.push(data); } } };
  return { rows, audits, creates, state, tx, model };
}

async function withFake<T>(db: ReturnType<typeof fakeDb>, run: () => Promise<T>): Promise<T> {
  const { prisma } = await import("../lib/prisma");
  const target = prisma as unknown as { $transaction: unknown; paymentAccount: unknown };
  const orig = { t: target.$transaction, p: target.paymentAccount };
  target.$transaction = async (fn: (t: unknown) => Promise<unknown>) => fn(db.tx);
  target.paymentAccount = db.model;
  try {
    return await run();
  } finally {
    target.$transaction = orig.t;
    target.paymentAccount = orig.p;
  }
}

const manager = { id: "u1", tenantId: "t1", isOwner: false, role: { permissions: ["cash.manage"] } };
const staff = { id: "u2", tenantId: "t1", isOwner: false, role: { permissions: [] as string[] } };
const base = (o: Partial<Row>): Row => ({ id: "a1", tenantId: "t1", type: "BANK_ACCOUNT", name: "Хаан банк", accountNumber: "5012345678", terminalId: null, merchantId: null, isTest: false, isActive: true, ...o });
const status = (e: unknown) => (e as { status?: number }).status;

test("service: non-cash.manage is forbidden (403) on create and update", async () => {
  const { createPaymentAccount, updatePaymentAccount } = await import("../lib/payment-account-service");
  const db = fakeDb([base({})]);
  await withFake(db, async () => {
    await assert.rejects(createPaymentAccount({ actor: staff, data: { type: "BANK_ACCOUNT", name: "Хаан банк", accountNumber: "5012345678" } }), (e) => code("CASH_MANAGE_FORBIDDEN")(e) && status(e) === 403);
    await assert.rejects(updatePaymentAccount({ actor: staff, id: "a1", data: { name: "Шинэ нэр" } }), (e) => code("CASH_MANAGE_FORBIDDEN")(e) && status(e) === 403);
  });
  assert.equal(db.creates.length, 0);
});

test("service: list returns the full account number to every caller (numbers are not hidden)", async () => {
  const { listPaymentAccounts } = await import("../lib/payment-account-service");
  const db = fakeDb([base({}), base({ id: "a2", tenantId: "t2", name: "Бусад" })]);
  await withFake(db, async () => {
    const asStaff = await listPaymentAccounts({ actor: staff });
    assert.equal(asStaff.length, 1);
    assert.equal(asStaff[0].accountNumber, "5012345678");
    assert.match(asStaff[0].accountNumberMasked, /5678$/);
    const asManager = await listPaymentAccounts({ actor: manager });
    assert.equal(asManager[0].accountNumber, "5012345678");
  });
});

test("service: create takes tenantId from actor and audits the account", async () => {
  const { createPaymentAccount } = await import("../lib/payment-account-service");
  const db = fakeDb();
  await withFake(db, async () => {
    const dto = await createPaymentAccount({ actor: manager, data: { type: "BANK_ACCOUNT", name: "Хаан банк", accountNumber: "5012345678", tenantId: "evil" } });
    assert.equal(dto.accountNumber, "5012345678");
  });
  assert.equal(db.creates[0].tenantId, "t1");
  assert.equal(db.audits.length, 1);
  const after = db.audits[0].after as Record<string, unknown>;
  assert.equal(after.accountNumber, "5012345678");
});

test("service: unique violation -> PAYMENT_ACCOUNT_DUPLICATE (409)", async () => {
  const { createPaymentAccount } = await import("../lib/payment-account-service");
  const db = fakeDb();
  db.state.createError = { code: "P2002" };
  await withFake(db, async () => {
    await assert.rejects(createPaymentAccount({ actor: manager, data: { type: "BANK_ACCOUNT", name: "Хаан банк", accountNumber: "5012345678" } }), (e) => code("PAYMENT_ACCOUNT_DUPLICATE")(e) && status(e) === 409);
  });
});

test("service: update of another tenant id -> PAYMENT_ACCOUNT_NOT_FOUND (404)", async () => {
  const { updatePaymentAccount } = await import("../lib/payment-account-service");
  const db = fakeDb([base({ id: "x9", tenantId: "t2" })]);
  await withFake(db, async () => {
    await assert.rejects(updatePaymentAccount({ actor: manager, id: "x9", data: { name: "Шинэ нэр" } }), (e) => code("PAYMENT_ACCOUNT_NOT_FOUND")(e) && status(e) === 404);
  });
});

test("service: setting terminalId on a BANK_ACCOUNT -> PAYMENT_ACCOUNT_INVALID; valid update is audited", async () => {
  const { updatePaymentAccount } = await import("../lib/payment-account-service");
  const db = fakeDb([base({})]);
  await withFake(db, async () => {
    await assert.rejects(updatePaymentAccount({ actor: manager, id: "a1", data: { terminalId: "T1" } }), code("PAYMENT_ACCOUNT_INVALID"));
    const dto = await updatePaymentAccount({ actor: manager, id: "a1", data: { name: "Шинэ нэр" } });
    assert.equal(dto.name, "Шинэ нэр");
  });
  assert.equal(db.audits.length, 1);
});

test("service: «Бэлэн» is automatic — it cannot be created, switched off or given a number; its name can be edited", async () => {
  const { createPaymentAccount, updatePaymentAccount, validatePaymentAccountInput } = await import("../lib/payment-account-service");
  assert.throws(() => validatePaymentAccountInput({ type: "CASH", name: "Касс 1" }, "create"), code("PAYMENT_ACCOUNT_INVALID"));
  const db = fakeDb([base({ id: "c1", type: "CASH", name: "Бэлэн", accountNumber: null })]);
  await withFake(db, async () => {
    await assert.rejects(createPaymentAccount({ actor: manager, data: { type: "CASH", name: "Касс 2" } }), code("PAYMENT_ACCOUNT_INVALID"));
    await assert.rejects(updatePaymentAccount({ actor: manager, id: "c1", data: { isActive: false } }), code("PAYMENT_ACCOUNT_INVALID"));
    await assert.rejects(updatePaymentAccount({ actor: manager, id: "c1", data: { accountNumber: "5012345678" } }), code("PAYMENT_ACCOUNT_INVALID"));
    const renamed = await updatePaymentAccount({ actor: manager, id: "c1", data: { name: "Касс" } });
    assert.equal(renamed.name, "Касс");
    assert.equal(renamed.method, "CASH");
    assert.equal(renamed.accountNumber, null);
  });
  assert.equal(db.creates.length, 0);
});

test("ensureCashAccount inserts the default «Бэлэн» idempotently (skipDuplicates)", async () => {
  const { ensureCashAccount, DEFAULT_CASH_ACCOUNT_NAME } = await import("../lib/payment-accounts");
  const calls: unknown[] = [];
  const client = { paymentAccount: { createMany: async (args: unknown) => { calls.push(args); return { count: 1 }; } } };
  await ensureCashAccount(client as never, "t1");
  assert.deepEqual(calls, [{ data: [{ tenantId: "t1", type: "CASH", name: DEFAULT_CASH_ACCOUNT_NAME }], skipDuplicates: true }]);
});
