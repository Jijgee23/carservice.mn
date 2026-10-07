import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { test } from "node:test";

process.env.DATABASE_URL ??= "postgresql://unused/unused";
process.env.SESSION_SECRET ??= "unit-test-placeholder-secret-value-not-real-00";

const src = (rel: string) => readFile(new URL(`../${rel}`, import.meta.url), "utf8");
const D = async (v: string | number) => new (await import("../app/generated/prisma/client")).Prisma.Decimal(v);
const code = (c: string) => (e: unknown) => (e as { code?: string }).code === c;

// ---- pure ---------------------------------------------------------------------------------------

test("parseNonNegativeCash accepts 0 and positive money, rejects everything else with CASH_AMOUNT_INVALID", async () => {
  const { parseNonNegativeCash } = await import("../lib/cash/session");
  assert.equal(parseNonNegativeCash("0", "x").toString(), "0");
  assert.equal(parseNonNegativeCash(0, "x").toString(), "0");
  assert.equal(parseNonNegativeCash("0.00", "x").toString(), "0");
  assert.equal(parseNonNegativeCash("0.5", "x").toString(), "0.5");
  assert.equal(parseNonNegativeCash("1,500.50", "x").toString(), "1500.5");
  assert.equal(parseNonNegativeCash(250000, "x").toString(), "250000");
  for (const bad of ["-1", "-0.5", -5, "abc", "0x", "00.123", "", null, undefined, "1.234", "10000000000", {}, NaN]) {
    assert.throws(() => parseNonNegativeCash(bad, "openingCash"), (e: unknown) => {
      const err = e as { code?: string; status?: number; fieldErrors?: Record<string, string> };
      return err.code === "CASH_AMOUNT_INVALID" && err.status === 422 && "openingCash" in (err.fieldErrors ?? {});
    }, `should reject ${String(bad)}`);
  }
});

test("expectedCashFrom = opening + income - expense", async () => {
  const { expectedCashFrom } = await import("../lib/cash/session");
  assert.equal(expectedCashFrom(await D(50000), await D(120000), await D(20000)).toString(), "150000");
  assert.equal(expectedCashFrom(await D(0), await D(0), await D(500)).toString(), "-500");
});

// ---- expected cash from the ledger (fake client) --------------------------------------------------

function ledgerClient(rows: Array<{ direction: "INCOME" | "EXPENSE"; amount: string; method: string; voided: boolean; sessionId: string | null; bank?: string | null }>) {
  const wheres: unknown[] = [];
  const client = {
    cashTransaction: {
      groupBy: async ({ by, where }: { by: string[]; where: { sessionId: string; method?: string; voidedAt?: null } }) => {
        wheres.push(where);
        const sums = new Map<string, { sum: number; n: number; method: string; bank: string | null; direction: string }>();
        for (const r of rows) {
          if (r.sessionId !== where.sessionId) continue;
          if (where.method !== undefined && r.method !== where.method) continue;
          if (where.voidedAt === null && r.voided) continue;
          const bank = r.bank ?? null;
          const key = by.includes("method") ? `${r.method}|${bank}|${r.direction}` : r.direction;
          const cur = sums.get(key) ?? { sum: 0, n: 0, method: r.method, bank, direction: r.direction };
          sums.set(key, { ...cur, sum: cur.sum + Number(r.amount), n: cur.n + 1 });
        }
        return [...sums.values()].map((v) => ({ direction: v.direction, ...(by.includes("method") ? { method: v.method, bank: v.bank } : {}), _sum: { amount: v.sum }, _count: { _all: v.n } }));
      },
    },
  };
  return { client: client as never, wheres };
}

test("computeExpectedCash: voided excluded, expense subtracted, non-CASH and other sessions ignored", async () => {
  const s = await import("../lib/cash/session");
  const { client, wheres } = ledgerClient([
    { direction: "INCOME", amount: "100000", method: "CASH", voided: false, sessionId: "s1" },
    { direction: "INCOME", amount: "30000", method: "CASH", voided: false, sessionId: "s1" },
    { direction: "INCOME", amount: "999", method: "CASH", voided: true, sessionId: "s1" }, // voided -> out
    { direction: "EXPENSE", amount: "20000", method: "CASH", voided: false, sessionId: "s1" },
    { direction: "EXPENSE", amount: "777", method: "CASH", voided: true, sessionId: "s1" }, // voided -> out
    { direction: "INCOME", amount: "55555", method: "CARD", voided: false, sessionId: "s1" }, // non-CASH -> out
    { direction: "INCOME", amount: "4242", method: "CASH", voided: false, sessionId: "s2" }, // other session -> out
    { direction: "INCOME", amount: "4343", method: "CASH", voided: false, sessionId: null }, // outside session -> out
  ]);
  const r = await s.computeExpectedCash(client, "t1", { id: "s1", openingCash: await D(50000) });
  assert.equal(r.cashIn.toString(), "130000");
  assert.equal(r.cashOut.toString(), "20000");
  assert.equal(r.entryCount, 3);
  assert.equal(r.expectedCash.toString(), "160000");
  const w = wheres[0] as Record<string, unknown>;
  assert.equal(w.tenantId, "t1");
  assert.equal(w.method, "CASH");
  assert.equal(w.voidedAt, null);
  // the per-method breakdown covers ANY method of the same session, still non-voided only
  const w2 = wheres[1] as Record<string, unknown>;
  assert.equal(w2.method, undefined);
  assert.equal(w2.voidedAt, null);
  assert.equal(r.totalEntryCount, 4);
  assert.deepEqual(r.byMethod.map((g) => [g.method, g.bank, g.income.toString(), g.expense.toString(), g.net.toString(), g.count]), [
    ["CASH", "", "130000", "20000", "110000", 3],
    ["CARD", "", "55555", "0", "55555", 1],
  ]);
  // empty session = opening only
  const empty = await s.computeExpectedCash(ledgerClient([]).client, "t1", { id: "s9", openingCash: await D(700) });
  assert.equal(empty.expectedCash.toString(), "700");
  assert.equal(empty.entryCount, 0);
});

// ---- attach helper ---------------------------------------------------------------------------------

function attachTx(openId: string | null) {
  const calls: Array<{ fn: string; args: unknown }> = [];
  const tx = {
    $queryRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => (calls.push({ fn: "lock", args: [strings.join("?"), ...values] }), [{ id: values[0] }]),
    cashSession: { findFirst: async (args: unknown) => (calls.push({ fn: "find", args }), openId ? { id: openId } : null) },
  };
  return { tx: tx as never, calls };
}

test("resolveCashSessionId: EVERY method attaches to the open session (locked), else null", async () => {
  const { resolveCashSessionId } = await import("../lib/cash/session-attach");
  for (const method of ["CARD", "BANK_TRANSFER", "QPAY", "OTHER"]) {
    const a = attachTx("s1");
    assert.equal(await resolveCashSessionId(a.tx, { tenantId: "t1", branchId: "b1", method }), "s1", method);
    assert.ok(a.calls.some((c) => c.fn === "lock"), `${method} takes the shared branch lock`);
    assert.equal(await resolveCashSessionId(attachTx(null).tx, { tenantId: "t1", branchId: "b1", method }), null);
  }
  const open = attachTx("s1");
  assert.equal(await resolveCashSessionId(open.tx, { tenantId: "t1", branchId: "b1", method: "CASH" }), "s1");
  const lock = open.calls.find((c) => c.fn === "lock")!.args as unknown[];
  assert.match(String(lock[0]), /FROM "Branch"[\s\S]*FOR SHARE/);
  assert.deepEqual(lock.slice(1), ["b1", "t1"]);
  const find = open.calls.find((c) => c.fn === "find")!.args as { where: Record<string, unknown> };
  assert.deepEqual(find.where, { tenantId: "t1", branchId: "b1", closedAt: null });
  assert.equal(await resolveCashSessionId(attachTx(null).tx, { tenantId: "t1", branchId: "b1", method: "CASH" }), null);
});

test("postPaymentIncome attaches payments of any method to the open session, never across tenants", async () => {
  const sync = await import("../lib/cash/sync");
  const mk = (openId: string | null, created: unknown[]) => {
    const a = attachTx(openId);
    const tx = {
      ...(a.tx as object),
      serviceOrder: { findFirst: async () => ({ branchId: "b1", customerId: "c1" }) },
      cashTransactionType: { findFirst: async () => ({ id: "type-1" }) },
      cashTransaction: { createMany: async (args: { data: unknown[] }) => (created.push(...args.data), { count: 1 }) },
    };
    return { tx: tx as never, calls: a.calls };
  };
  const payment = async (method: string) => ({ id: "p1", orderId: "o1", amount: await D(5000), method, bank: null, paidAt: new Date("2026-10-05T00:00:00Z") });
  const withSession: unknown[] = [];
  await sync.postPaymentIncome(mk("s1", withSession).tx, { tenantId: "t1", actorId: "u1", payment: await payment("CASH") });
  assert.equal((withSession[0] as { sessionId: string }).sessionId, "s1");
  const noSession: unknown[] = [];
  await sync.postPaymentIncome(mk(null, noSession).tx, { tenantId: "t1", actorId: "u1", payment: await payment("CASH") });
  assert.equal((noSession[0] as { sessionId: string | null }).sessionId, null);
  const card: unknown[] = [];
  await sync.postPaymentIncome(mk("s1", card).tx, { tenantId: "t1", actorId: "u1", payment: await payment("CARD") });
  assert.equal((card[0] as { sessionId: string | null }).sessionId, "s1", "CARD attaches too");
  const m = mk("s1", []);
  await sync.postPaymentIncome(m.tx, { tenantId: "t1", actorId: "u1", payment: await payment("CASH") });
  const find = m.calls.find((c) => c.fn === "find")!.args as { where: { tenantId: string; branchId: string } };
  assert.equal(find.where.tenantId, "t1");
  assert.equal(find.where.branchId, "b1", "branch comes from the order, not the caller");
});

// ---- open / close guards (prisma.$transaction replaced by a fake tx) ---------------------------------------

type SessionRec = { id: string; tenantId: string; branchId: string; openedAt: Date; openingCash: unknown; closedAt: Date | null; closedById: string | null; countedCash: unknown; expectedCash: unknown; difference: unknown; note: string | null };

function sessionDb(seed: SessionRec[] = [], entries: Array<{ sessionId: string; direction: "INCOME" | "EXPENSE"; amount: number; voided: boolean; method?: string; bank?: string | null }> = []) {
  const methodCounts: Array<Record<string, unknown> & { sessionId: string }> = [];
  const sessions = seed.map((s) => ({ ...s }));
  const audits: Array<Record<string, unknown>> = [];
  const locks: string[] = [];
  let seq = 0;
  const view = (r: SessionRec) => ({
    ...r,
    methodCounts: methodCounts.filter((m) => m.sessionId === r.id),
    branch: { id: r.branchId, name: "B" },
    openedBy: { id: "u1", firstName: "A", lastName: "B" },
    closedBy: r.closedById ? { id: r.closedById, firstName: "C", lastName: "D" } : null,
  });
  const tx = {
    $queryRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => (locks.push(`${strings.join("?").includes("FOR UPDATE") ? "U" : "S"}:${values[0]}`), [{ id: values[0] }]),
    branch: { findFirst: async ({ where }: { where: { id: string } }) => (where.id === "gone" ? null : { id: where.id, isActive: where.id !== "inactive" }) },
    cashSession: {
      findFirst: async ({ where }: { where: { id?: string; tenantId: string; branchId?: string; closedAt?: null } }) => {
        const r = sessions.find((s) => s.tenantId === where.tenantId && (where.id === undefined || s.id === where.id) && (where.branchId === undefined || s.branchId === where.branchId) && (where.closedAt === undefined || s.closedAt === null));
        return r ? view(r) : null;
      },
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const r = { id: `s${++seq}`, closedAt: null, closedById: null, countedCash: null, expectedCash: null, difference: null, note: null, ...data } as SessionRec;
        sessions.push(r);
        return view(r);
      },
      updateMany: async ({ where, data }: { where: { id: string; closedAt: null }; data: Record<string, unknown> }) => {
        const r = sessions.find((s) => s.id === where.id && s.closedAt === null);
        if (!r) return { count: 0 };
        Object.assign(r, data);
        return { count: 1 };
      },
      findUniqueOrThrow: async ({ where }: { where: { id: string } }) => view(sessions.find((s) => s.id === where.id)!),
    },
    cashTransaction: {
      groupBy: async ({ by, where }: { by: string[]; where: { sessionId: string; method?: string } }) => {
        const out: Array<Record<string, unknown>> = [];
        const live = entries.filter((e) => e.sessionId === where.sessionId && !e.voided && (where.method === undefined || (e.method ?? "CASH") === where.method));
        const keys = by.includes("method") ? [...new Set(live.map((e) => `${e.method ?? "CASH"}|${e.bank ?? ""}`))] : [""];
        for (const key of keys) {
          const [method, bank] = key.split("|");
          for (const direction of ["INCOME", "EXPENSE"] as const) {
            const rows = live.filter((e) => e.direction === direction && (!by.includes("method") || ((e.method ?? "CASH") === method && (e.bank ?? "") === bank)));
            if (rows.length) out.push({ direction, ...(by.includes("method") ? { method, bank: bank || null } : {}), _sum: { amount: rows.reduce((a, e) => a + e.amount, 0) }, _count: { _all: rows.length } });
          }
        }
        return out;
      },
    },
    cashSessionMethodCount: { createMany: async ({ data }: { data: Array<Record<string, unknown>> }) => { methodCounts.push(...(data as Array<Record<string, unknown> & { sessionId: string }>)); return { count: data.length }; } },
    auditLog: { create: async ({ data }: { data: Record<string, unknown> }) => { audits.push(data); } },
  };
  return { sessions, audits, locks, tx, methodCounts };
}

async function withFakeTx<T>(tx: unknown, run: () => Promise<T>): Promise<T> {
  const { prisma } = await import("../lib/prisma");
  const target = prisma as unknown as { $transaction: unknown };
  const original = target.$transaction;
  target.$transaction = async (fn: (t: unknown) => Promise<unknown>) => fn(tx);
  try {
    return await run();
  } finally {
    target.$transaction = original;
  }
}

const actor = (over: Record<string, unknown> = {}) => ({ id: "u1", tenantId: "t1", isOwner: true, permissions: [], workingBranchId: null, ...over }) as never;

test("openCashSession: locks the branch, creates OPEN session, audits; second open -> 409 CASH_SESSION_ALREADY_OPEN", async () => {
  const s = await import("../lib/cash/session");
  const db = sessionDb();
  const first = await withFakeTx(db.tx, () => s.openCashSession({ actor: actor(), branchId: "b1", openingCash: "50000", note: " morning ", now: new Date("2026-10-06T00:00:00Z") }));
  assert.equal(first.status, "OPEN");
  assert.equal(first.openingCash, "50000");
  assert.equal(first.expectedCash, "50000");
  assert.equal(first.note, "morning");
  assert.deepEqual(db.locks, ["U:b1"]);
  assert.equal(db.audits.length, 1);
  assert.equal(db.audits[0].entity, "CashSession");
  await assert.rejects(withFakeTx(db.tx, () => s.openCashSession({ actor: actor(), branchId: "b1", openingCash: "0" })), (e: unknown) => code("CASH_SESSION_ALREADY_OPEN")(e) && (e as { status: number }).status === 409);
  assert.equal(db.sessions.length, 1, "no second row");
  // another branch is independent; zero opening cash is allowed
  const other = await withFakeTx(db.tx, () => s.openCashSession({ actor: actor(), branchId: "b2", openingCash: "0" }));
  assert.equal(other.openingCash, "0");
  assert.equal(db.sessions.length, 2);
});

test("openCashSession validation: permission, branch scope, amount, unknown/inactive branch", async () => {
  const s = await import("../lib/cash/session");
  const db = sessionDb();
  await assert.rejects(s.openCashSession({ actor: actor({ isOwner: false }), branchId: "b1", openingCash: "1" }), code("CASH_MANAGE_FORBIDDEN"));
  await assert.rejects(s.openCashSession({ actor: actor(), branchId: "", openingCash: "1" }), code("CASH_BRANCH_INVALID"));
  await assert.rejects(s.openCashSession({ actor: actor(), branchId: "b1", openingCash: "-1" }), code("CASH_AMOUNT_INVALID"));
  await assert.rejects(s.openCashSession({ actor: actor(), scope: "b2", branchId: "b1", openingCash: "1" }), code("CASH_BRANCH_INVALID"));
  await assert.rejects(withFakeTx(db.tx, () => s.openCashSession({ actor: actor(), branchId: "gone", openingCash: "1" })), code("CASH_BRANCH_INVALID"));
  await assert.rejects(withFakeTx(db.tx, () => s.openCashSession({ actor: actor(), branchId: "inactive", openingCash: "1" })), code("CASH_BRANCH_INVALID"));
  assert.equal(db.sessions.length, 0);
});

test("closeCashSession: freezes expected/difference, locks branch, second close -> 422 NOT_OPEN, unknown/out-of-scope -> 404", async () => {
  const s = await import("../lib/cash/session");
  const base: SessionRec = { id: "s1", tenantId: "t1", branchId: "b1", openedAt: new Date("2026-10-06T00:00:00Z"), openingCash: await D(50000), closedAt: null, closedById: null, countedCash: null, expectedCash: null, difference: null, note: "open note" };
  const db = sessionDb([base], [
    { sessionId: "s1", direction: "INCOME", amount: 100000, voided: false },
    { sessionId: "s1", direction: "INCOME", amount: 5000, voided: true },
    { sessionId: "s1", direction: "EXPENSE", amount: 20000, voided: false },
  ]);
  const closed = await withFakeTx(db.tx, () => s.closeCashSession({ actor: actor(), sessionId: "s1", countedCash: "128000", note: "short", now: new Date("2026-10-06T10:00:00Z") }));
  assert.equal(closed.status, "CLOSED");
  assert.equal(closed.expectedCash, "130000");
  assert.equal(closed.countedCash, "128000");
  assert.equal(closed.difference, "-2000");
  assert.equal(closed.note, "open note\nshort");
  assert.equal(closed.closedBy?.id, "u1");
  assert.deepEqual(db.locks, ["U:b1"]);
  assert.equal(db.audits.length, 1);
  assert.equal(db.sessions[0].closedAt?.toISOString(), "2026-10-06T10:00:00.000Z");
  // immutable: closing again is refused and leaves the frozen values alone
  await assert.rejects(withFakeTx(db.tx, () => s.closeCashSession({ actor: actor(), sessionId: "s1", countedCash: "1" })), (e: unknown) => code("CASH_SESSION_NOT_OPEN")(e) && (e as { status: number }).status === 422);
  assert.equal(String(db.sessions[0].countedCash), "128000");
  await assert.rejects(withFakeTx(db.tx, () => s.closeCashSession({ actor: actor(), sessionId: "nope", countedCash: "1" })), (e: unknown) => code("CASH_SESSION_NOT_FOUND")(e) && (e as { status: number }).status === 404);
  await assert.rejects(withFakeTx(db.tx, () => s.closeCashSession({ actor: actor(), scope: "b2", sessionId: "s1", countedCash: "1" })), code("CASH_SESSION_NOT_FOUND"));
  await assert.rejects(s.closeCashSession({ actor: actor(), sessionId: "s1", countedCash: "-1" }), code("CASH_AMOUNT_INVALID"));
  await assert.rejects(s.closeCashSession({ actor: actor({ isOwner: false }), sessionId: "s1", countedCash: "1" }), code("CASH_MANAGE_FORBIDDEN"));
});

test("closeCashSession: tenant isolation (another tenant's session is NOT_FOUND)", async () => {
  const s = await import("../lib/cash/session");
  const db = sessionDb([{ id: "s1", tenantId: "other", branchId: "b1", openedAt: new Date(), openingCash: await D(1), closedAt: null, closedById: null, countedCash: null, expectedCash: null, difference: null, note: null }]);
  await assert.rejects(withFakeTx(db.tx, () => s.closeCashSession({ actor: actor(), sessionId: "s1", countedCash: "1" })), code("CASH_SESSION_NOT_FOUND"));
});

// ---- outside-session filter ------------------------------------------------------------------------

test("buildCashEntryWhere outsideSession = sessionId null for ANY method (method filter still narrows)", async () => {
  const { buildCashEntryWhere } = await import("../lib/cash/ledger");
  const w = buildCashEntryWhere("t1", { outsideSession: true }, null);
  assert.equal(w.method, undefined);
  assert.equal(w.sessionId, null);
  const card = buildCashEntryWhere("t1", { outsideSession: true, method: "CARD" }, null);
  assert.equal(card.method, "CARD");
  assert.equal(card.sessionId, null);
  assert.equal("sessionId" in buildCashEntryWhere("t1", {}, null), false);
});

// ---- structural: every ledger write path attaches --------------------------------------------------------

async function walk(dir: string, out: string[] = []): Promise<string[]> {
  for (const entry of await readdir(new URL(`../${dir}/`, import.meta.url), { withFileTypes: true })) {
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) await walk(rel, out);
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(rel);
  }
  return out;
}

test("every cashTransaction create/createMany site is a known ledger write path and every writer attaches a session", async () => {
  const files = [...(await walk("lib")), ...(await walk("app/api")), ...(await walk("app/_actions"))].filter((f) => !f.includes("generated"));
  const writers: string[] = [];
  for (const f of files) if (/cashTransaction\.(create|createMany)\(/.test(await src(f))) writers.push(f);
  assert.deepEqual(writers.sort(), ["lib/cash/ledger.ts", "lib/cash/settlement.ts", "lib/cash/sync.ts"], "a new ledger write path must be added here AND attach the open session");

  const ledger = await src("lib/cash/ledger.ts");
  const createFn = ledger.slice(ledger.indexOf("export async function createCashEntry"), ledger.indexOf("export async function runVoidCashEntry"));
  assert.match(createFn, /resolveCashSessionId\(tx, \{ tenantId, branchId, method \}\)/);
  assert.match(createFn, /sessionId,\s*\n?\s*createdById: actor\.id/);
  assert.ok(createFn.indexOf("resolveCashSessionId") < createFn.indexOf("tx.cashTransaction.create"), "lookup happens inside the same tx, before the insert");

  const sync = await src("lib/cash/sync.ts");
  const incomeFn = sync.slice(sync.indexOf("export async function postPaymentIncome"), sync.indexOf("export async function voidPaymentIncome"));
  assert.match(incomeFn, /resolveCashSessionId\(tx, \{ tenantId, branchId: order\.branchId, method: payment\.method \}\)/);
  assert.match(incomeFn, /\r?\n\s*sessionId,\r?\n/);
  // internal-repair expense (method OTHER) attaches too, via the same helper (system path: attaches if open, never blocks)
  const repairFn = sync.slice(sync.indexOf("export async function postInternalRepairExpense"), sync.indexOf("export async function voidInternalRepairExpense"));
  assert.match(repairFn, /resolveCashSessionId\(tx, \{ tenantId, branchId: input\.branchId, method: "OTHER" \}\)/);
  assert.match(repairFn, /\r?\n\s*sessionId,\r?\n/);
  assert.ok(repairFn.indexOf("resolveCashSessionId") < repairFn.indexOf("tx.cashTransaction.create"));

  const settlement = await src("lib/cash/settlement.ts");
  assert.match(settlement, /resolveCashSessionId\(tx, \{ tenantId, branchId: input\.branchId, method: input\.method \}\)/);
  const lump = settlement.slice(settlement.indexOf("// ONE ledger entry for the whole settlement"));
  assert.ok(lump.indexOf("resolveCashSessionId") < lump.indexOf("tx.cashTransaction.create"));
  assert.match(lump.slice(lump.indexOf("tx.cashTransaction.create"), lump.indexOf("await logAudit")), /sessionId,/);
});

test("every caller of postPaymentIncome runs it inside its own transaction client (tx), so the attach is atomic with the payment", async () => {
  for (const f of ["lib/order-payments.ts", "lib/orders/order-payment-commands.ts"]) {
    const text = await src(f);
    assert.match(text, /postPaymentIncome\(tx,/, f);
  }
});

test("session routes: permission + error mapping + open-flag readable by payments.create", async () => {
  for (const route of ["sessions/route.ts", "sessions/current/route.ts", "sessions/[id]/route.ts", "sessions/[id]/close/route.ts"]) {
    const text = await src(`app/api/v1/cash/${route}`);
    assert.match(text, /requireCashApiUser\(req\)/, route);
    assert.match(text, /cashErrorResponse/, route);
  }
  const flag = await src("app/api/v1/cash/sessions/open-flag/route.ts");
  assert.match(flag, /requireApiUser\(req\)/);
  assert.doesNotMatch(flag, /requireCashApiUser/);
  const session = await src("lib/cash/session.ts");
  assert.match(session, /hasPermission\(actor, "payments\.create"\)/);
  assert.match(session, /FOR UPDATE/);
  for (const c of ["CASH_SESSION_ALREADY_OPEN", "CASH_SESSION_NOT_OPEN", "CASH_SESSION_NOT_FOUND"]) assert.match(session, new RegExp(c));
});

test("voidPaymentIncome takes the shared Branch lock for session-attached entries only (serialises with close)", async () => {
  const sync = await import("../lib/cash/sync");
  const mk = (attached: Array<{ branchId: string }>) => {
    const locks: unknown[][] = [];
    const finds: unknown[] = [];
    const tx = {
      $queryRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => (locks.push([strings.join("?"), ...values]), []),
      cashTransaction: {
        findMany: async (args: unknown) => (finds.push(args), (args as { where: { session?: unknown } }).where.session ? [] : attached), // closed-session CASH query (B2) -> none
        updateMany: async () => ({ count: attached.length }),
      },
    };
    return { tx: tx as never, locks, finds };
  };
  const a = mk([{ branchId: "b2" }, { branchId: "b1" }, { branchId: "b1" }]);
  assert.equal(await sync.voidPaymentIncome(a.tx, { tenantId: "t1", actorId: "u1", paymentIds: ["p1"] }), 3);
  assert.equal(a.locks.length, 2, "one shared lock per distinct branch");
  assert.match(String(a.locks[0][0]), /FROM "Branch"[\s\S]*FOR SHARE/);
  assert.deepEqual(a.locks.map((l) => l[1]), ["b1", "b2"], "deterministic order");
  assert.deepEqual((a.finds[0] as { where: Record<string, unknown> }).where.sessionId, { not: null });
  const b = mk([]);
  await sync.voidPaymentIncome(b.tx, { tenantId: "t1", actorId: "u1", paymentIds: ["p1"] });
  assert.equal(b.locks.length, 0, "entries outside any session need no lock");
});

test("manual void and settlement void take the shared Branch lock before voiding", async () => {
  const ledger = await src("lib/cash/ledger.ts");
  const v = ledger.slice(ledger.indexOf("export async function runVoidCashEntry"), ledger.indexOf("export type CashEntryFilters"));
  assert.ok(v.indexOf("assertCashSessionOpen(tx, tenantId, entry.branchId)") !== -1, "assert helper takes the shared Branch lock itself");
  assert.ok(v.indexOf("assertCashSessionOpen") < v.indexOf("tx.cashTransaction.updateMany"));
  const st = await src("lib/cash/settlement.ts");
  const sv = st.slice(st.indexOf("export async function runVoidSettlement"));
  assert.ok(sv.indexOf("lockOrdersInOrder") < sv.indexOf("assertCashSessionOpen(tx, tenantId, settlement.branchId)"), "order locks first, then branch");
  assert.ok(sv.indexOf("assertCashSessionOpen") < sv.indexOf("tx.cashTransaction.updateMany"));
  const sess = await src("lib/cash/session.ts");
  assert.match(sess, /voidedAt: \{ gte: closedAt \}/, "post-close = voidedAt >= closedAt, aggregated in the DB");
});

// ---- Odoo-style per-method close ---------------------------------------------------------------------------

const openRec = async (): Promise<SessionRec> => ({ id: "s1", tenantId: "t1", branchId: "b1", openedAt: new Date("2026-10-06T00:00:00Z"), openingCash: await D(10000), closedAt: null, closedById: null, countedCash: null, expectedCash: null, difference: null, note: null });
const mixedEntries = [
  { sessionId: "s1", direction: "INCOME" as const, amount: 5000, voided: false },
  { sessionId: "s1", direction: "INCOME" as const, amount: 70000, voided: false, method: "CARD", bank: "KHAN" },
  { sessionId: "s1", direction: "INCOME" as const, amount: 30000, voided: false, method: "CARD", bank: "GOLOMT" },
  { sessionId: "s1", direction: "EXPENSE" as const, amount: 10000, voided: false, method: "CARD", bank: "GOLOMT" },
  { sessionId: "s1", direction: "INCOME" as const, amount: 90000, voided: true, method: "CARD", bank: "KHAN" },
  { sessionId: "s1", direction: "INCOME" as const, amount: 40000, voided: false, method: "QPAY" },
  { sessionId: "s1", direction: "INCOME" as const, amount: 20000, voided: false, method: "BANK_TRANSFER", bank: "KHAN" },
];

test("closeCashSession with methodCounts: writes one frozen row per non-CASH (method, bank) group; counted optional; QPAY implicit", async () => {
  const s = await import("../lib/cash/session");
  const db = sessionDb([await openRec()], mixedEntries);
  const closed = await withFakeTx(db.tx, () => s.closeCashSession({
    actor: actor(), sessionId: "s1", countedCash: "15000",
    methodCounts: [{ method: "CARD", bank: "KHAN", counted: "69000" }, { method: "QPAY", counted: "1" }, { method: "CARD", bank: "GOLOMT", counted: "" }],
  }));
  // cash drawer unchanged: 10000 + 5000
  assert.equal(closed.expectedCash, "15000");
  assert.equal(closed.difference, "0");
  assert.equal(closed.totalEntryCount, 6);
  assert.equal(closed.entryCount, 1);
  const rows = db.methodCounts.map((r) => [r.method, r.bank, String(r.expected), r.counted === null ? null : String(r.counted), r.difference === null ? null : String(r.difference)]);
  assert.deepEqual(rows, [
    ["CARD", "GOLOMT", "20000", null, null],
    ["CARD", "KHAN", "70000", "69000", "-1000"],
    ["BANK_TRANSFER", "KHAN", "20000", null, null],
    ["QPAY", "", "40000", "40000", "0"],
  ] as never);
  assert.ok(db.methodCounts.every((r) => r.tenantId === "t1" && r.sessionId === "s1"));
  const by = closed.byMethod;
  assert.deepEqual(by.map((g) => [g.method, g.bank]), [["CASH", null], ["CARD", "GOLOMT"], ["CARD", "KHAN"], ["BANK_TRANSFER", "KHAN"], ["QPAY", null]]);
  const khan = by.find((g) => g.method === "CARD" && g.bank === "KHAN")!;
  assert.deepEqual([khan.income, khan.expense, khan.net, khan.expected, khan.counted, khan.difference, khan.count], ["70000", "0", "70000", "70000", "69000", "-1000", 1]);
  const golomt = by.find((g) => g.bank === "GOLOMT")!;
  assert.deepEqual([golomt.net, golomt.expected, golomt.counted, golomt.difference], ["20000", "20000", null, null]);
  const cash = by[0];
  assert.deepEqual([cash.expected, cash.counted, cash.difference], ["15000", "15000", "0"]);
});

test("closeCashSession: no methodCounts input still records expected for every group; open session serializes live byMethod", async () => {
  const s = await import("../lib/cash/session");
  const db = sessionDb([await openRec()], mixedEntries);
  const live = await s.computeExpectedCash(db.tx as never, "t1", { id: "s1", openingCash: await D(10000) });
  assert.equal(live.byMethod.length, 5);
  assert.equal(live.totalEntryCount, 6);
  await withFakeTx(db.tx, () => s.closeCashSession({ actor: actor(), sessionId: "s1", countedCash: "15000" }));
  assert.equal(db.methodCounts.length, 4);
  assert.ok(db.methodCounts.filter((r) => r.method !== "QPAY").every((r) => r.counted === null && r.difference === null));
  // cash-only session: no rows
  const only = sessionDb([await openRec()], [{ sessionId: "s1", direction: "INCOME", amount: 1, voided: false }]);
  await withFakeTx(only.tx, () => s.closeCashSession({ actor: actor(), sessionId: "s1", countedCash: "10001" }));
  assert.equal(only.methodCounts.length, 0);
});

test("closeCashSession methodCounts validation: bad shape/amount/CASH/duplicate/unknown group -> 422 and nothing is written", async () => {
  const s = await import("../lib/cash/session");
  const bad: unknown[] = [
    "x", [null], [{ method: "NOPE", counted: "1" }], [{ method: "CASH", counted: "1" }],
    [{ method: "CARD", bank: 5, counted: "1" }], [{ method: "CARD", bank: "KHAN", counted: "-1" }], [{ method: "CARD", bank: "KHAN", counted: "abc" }],
    [{ method: "CARD", bank: "KHAN", counted: "1" }, { method: "CARD", bank: "KHAN", counted: "2" }],
  ];
  for (const methodCounts of bad) {
    await assert.rejects(s.closeCashSession({ actor: actor(), sessionId: "s1", countedCash: "1", methodCounts }), (e: unknown) => (e as { status?: number }).status === 422, JSON.stringify(methodCounts));
  }
  const db = sessionDb([await openRec()], mixedEntries);
  // group the session does not have (CARD/MBANK) -> 422 inside the tx (rolls back in real Postgres)
  await assert.rejects(withFakeTx(db.tx, () => s.closeCashSession({ actor: actor(), sessionId: "s1", countedCash: "15000", methodCounts: [{ method: "CARD", bank: "MBANK", counted: "1" }] })), code("CASH_FIELD_INVALID"));
  assert.equal(s.parseMethodCounts(undefined).length, 0);
  assert.equal(s.parseMethodCounts(null).length, 0);
  assert.equal(s.parseMethodCounts([{ method: "CARD", bank: " KHAN ", counted: "0" }])[0].bank, "KHAN");
});

test("close route + server action pass methodCounts through", async () => {
  const route = await src("app/api/v1/cash/sessions/[id]/close/route.ts");
  assert.match(route, /methodCounts: body\.methodCounts/);
  const action = await src("app/_actions/cash.ts");
  assert.match(action, /methodCounts,\s*note: s\(formData, "note"\)/);
});

test("migration + schema define CashSessionMethodCount with a NOT NULL bank so the unique index is effective", async () => {
  const sql = await src("prisma/migrations/20261006120000_cash_session_method_counts/migration.sql");
  assert.match(sql, /"bank" TEXT NOT NULL DEFAULT ''/);
  assert.match(sql, /UNIQUE INDEX[^;]*\("sessionId", "method", "bank"\)/);
  assert.match(sql, /REFERENCES "CashSession"\("id"\) ON DELETE CASCADE/);
  assert.match(sql, /tenant_isolation/);
  const schema = await src("prisma/schema.prisma");
  assert.match(schema, /model CashSessionMethodCount[\s\S]*@@unique\(\[sessionId, method, bank\]\)/);
});

// ---- B3: batched page totals ------------------------------------------------------------------------

test("computeExpectedCashBatch runs ONE groupBy for the whole page and splits it per session", async () => {
  const { computeExpectedCashBatch } = await import("../lib/cash/session");
  const calls: unknown[] = [];
  const client = {
    cashTransaction: {
      groupBy: async (args: unknown) => {
        calls.push(args);
        return [
          { sessionId: "s1", method: "CASH", bank: null, direction: "INCOME", _sum: { amount: "1000" }, _count: { _all: 2 } },
          { sessionId: "s1", method: "CASH", bank: null, direction: "EXPENSE", _sum: { amount: "300" }, _count: { _all: 1 } },
          { sessionId: "s1", method: "CARD", bank: "KHAN", direction: "INCOME", _sum: { amount: "500" }, _count: { _all: 1 } },
          { sessionId: "s2", method: "CASH", bank: null, direction: "INCOME", _sum: { amount: "40" }, _count: { _all: 1 } },
        ];
      },
    },
  };
  const out = await computeExpectedCashBatch(client as never, "t1", [
    { id: "s1", openingCash: await D(100) },
    { id: "s2", openingCash: await D(0) },
    { id: "s3", openingCash: await D(7) },
  ]);
  assert.equal(calls.length, 1);
  const where = (calls[0] as { where: { sessionId: { in: string[] }; voidedAt: null } }).where;
  assert.deepEqual(where.sessionId.in, ["s1", "s2", "s3"]);
  assert.equal(where.voidedAt, null);
  const s1 = out.get("s1")!;
  assert.equal(s1.cashIn.toString(), "1000");
  assert.equal(s1.cashOut.toString(), "300");
  assert.equal(s1.entryCount, 3);
  assert.equal(s1.expectedCash.toString(), "800");
  assert.equal(s1.totalEntryCount, 4);
  assert.deepEqual(s1.byMethod.map((g) => `${g.method}|${g.bank}`), ["CASH|", "CARD|KHAN"]);
  assert.equal(out.get("s2")!.expectedCash.toString(), "40");
  assert.equal(out.get("s3")!.expectedCash.toString(), "7");
  const empty = await computeExpectedCashBatch(client as never, "t1", []);
  assert.equal(empty.size, 0);
  assert.equal(calls.length, 1, "no query for an empty page");
});
