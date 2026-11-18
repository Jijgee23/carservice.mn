import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { before, test } from "node:test";
import { SignJWT } from "jose";

process.env.DATABASE_URL ??= "postgresql://unused/unused";
process.env.SESSION_SECRET ??= "unit-test-placeholder-secret-value-not-real-00";
delete process.env.API_TOKEN_SECRET; // the module prefers it; keep the test deterministic on SESSION_SECRET

let tok: typeof import("../lib/auth/account-api-token");
let rt: typeof import("../lib/auth/account-refresh-token");
let issue: typeof import("../lib/auth/account-session-issue");

before(async () => {
  [tok, rt, issue] = await Promise.all([
    import("../lib/auth/account-api-token"),
    import("../lib/auth/account-refresh-token"),
    import("../lib/auth/account-session-issue"),
  ]);
});

const src = (rel: string) => readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), rel), "utf8");
const claims = { accountId: "acc1", phone: "99112233", tv: 0 };

// ------------------------------------------------------------------ access token modes

test("legacy token has no exp; expiring token has an exp one hour out; the same verify accepts both", async () => {
  const legacy = await tok.verifyAccountApiToken(await tok.signAccountApiToken(claims));
  assert.deepEqual(legacy, { ...claims, exp: null });
  const before = Math.floor(Date.now() / 1000);
  const exp = (await tok.verifyAccountApiToken(await tok.signExpiringAccountApiToken(claims)))!;
  assert.equal(exp.accountId, "acc1");
  assert.ok(exp.exp !== null && exp.exp >= before + tok.ACCOUNT_ACCESS_TOKEN_SECONDS - 2 && exp.exp <= before + tok.ACCOUNT_ACCESS_TOKEN_SECONDS + 2);
  assert.equal(tok.ACCOUNT_ACCESS_TOKEN_SECONDS, 3600);
});

test("an EXPIRED token is rejected; a tampered token is rejected; a staff-realm / wrong-secret token is rejected", async () => {
  const secret = new TextEncoder().encode(`account-api:${process.env.SESSION_SECRET}`);
  const expired = await new SignJWT({ ...claims })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt(Math.floor(Date.now() / 1000) - 7200)
    .setExpirationTime(Math.floor(Date.now() / 1000) - 3600)
    .sign(secret);
  assert.equal(await tok.verifyAccountApiToken(expired), null);

  const good = await tok.signExpiringAccountApiToken(claims);
  assert.equal(await tok.verifyAccountApiToken(good.slice(0, -3) + (good.endsWith("AAA") ? "BBB" : "AAA")), null);

  const wrongRealm = await new SignJWT({ ...claims }).setProtectedHeader({ alg: "HS256" }).sign(new TextEncoder().encode(`other:${process.env.SESSION_SECRET}`));
  assert.equal(await tok.verifyAccountApiToken(wrongRealm), null);
  assert.equal(await tok.verifyAccountApiToken("not.a.jwt"), null);
});

test("tokens with a bad tv or missing identity are rejected (unchanged rules)", async () => {
  const secret = new TextEncoder().encode(`account-api:${process.env.SESSION_SECRET}`);
  const sign = (c: Record<string, unknown>) => new SignJWT(c).setProtectedHeader({ alg: "HS256" }).sign(secret);
  assert.equal(await tok.verifyAccountApiToken(await sign({ accountId: "a", phone: "1", tv: -1 })), null);
  assert.equal(await tok.verifyAccountApiToken(await sign({ accountId: "a", phone: "1", tv: "x" })), null);
  assert.equal(await tok.verifyAccountApiToken(await sign({ phone: "1", tv: 0 })), null);
  // very old tokens without `tv` count as 0
  assert.equal((await tok.verifyAccountApiToken(await sign({ accountId: "a", phone: "1" })))!.tv, 0);
});

test("legacyTokenAllowed: only a legacy (exp-less) token is cut off, only once the date has passed", () => {
  const now = new Date("2027-03-02T00:00:00Z");
  const until = "2027-03-01T00:00:00Z";
  assert.equal(tok.legacyTokenAllowed(null, now, undefined), true, "unset → legacy tokens keep working");
  assert.equal(tok.legacyTokenAllowed(null, now, ""), true);
  assert.equal(tok.legacyTokenAllowed(null, now, "not a date"), true, "unparseable → do not lock everyone out");
  assert.equal(tok.legacyTokenAllowed(null, new Date("2027-02-28T23:59:59Z"), until), true, "before the cutoff");
  assert.equal(tok.legacyTokenAllowed(null, now, until), false, "after the cutoff");
  assert.equal(tok.legacyTokenAllowed(null, new Date(until), until), false, "at the cutoff instant");
  assert.equal(tok.legacyTokenAllowed(1_900_000_000, now, until), true, "expiring tokens are never affected");
});

test("tokenVersionMatches keeps invalidating older tokens", () => {
  assert.equal(tok.tokenVersionMatches(2, 2), true);
  assert.equal(tok.tokenVersionMatches(1, 2), false);
});

// ------------------------------------------------------------------ refresh rotation (in-memory fake DB)

type Row = {
  id: string; tokenHash: string; accountId: string; tokenVersion: number; expiresAt: Date; revokedAt: Date | null;
  replacedById: string | null; userAgent: string | null; ip: string | null; createdAt: Date; lastUsedAt: Date | null;
};
type Acc = { id: string; phone: string; isActive: boolean; deactivatedAt: Date | null; deletedAt: Date | null; tokenVersion: number };

function makeDb(accounts: Acc[]) {
  const rows: Row[] = [];
  let seq = 0;
  const matches = (r: Row, where: Record<string, unknown>): boolean => {
    for (const [k, v] of Object.entries(where)) {
      if (k === "OR") {
        if (!(v as Array<Record<string, unknown>>).some((w) => matches(r, w))) return false;
        continue;
      }
      const val = (r as unknown as Record<string, unknown>)[k];
      if (v && typeof v === "object" && !(v instanceof Date)) {
        const op = v as { lt?: Date };
        if (op.lt !== undefined && !(val instanceof Date && val.getTime() < op.lt.getTime())) return false;
      } else if (val !== v) return false;
    }
    return true;
  };
  const model = () => ({
    async create({ data }: { data: Partial<Row> }) {
      const defaults = { revokedAt: null, replacedById: null, lastUsedAt: null, createdAt: new Date(), userAgent: null, ip: null };
      const row = { ...defaults, ...data, id: `t${++seq}` } as Row;
      rows.push(row);
      return { id: row.id };
    },
    async findUnique({ where }: { where: { tokenHash?: string; id?: string } }) {
      const r = rows.find((x) => (where.tokenHash ? x.tokenHash === where.tokenHash : x.id === where.id));
      return r ? { ...r } : null;
    },
    async updateMany({ where, data }: { where: Record<string, unknown>; data: Partial<Row> }) {
      const hit = rows.filter((r) => matches(r, where));
      for (const r of hit) Object.assign(r, data);
      return { count: hit.length };
    },
    async deleteMany({ where }: { where: Record<string, unknown> }) {
      const doomed = rows.filter((r) => matches(r, where));
      for (const r of doomed) rows.splice(rows.indexOf(r), 1);
      return { count: doomed.length };
    },
  });
  const db = {
    accountRefreshToken: model(),
    account: { async findUnique({ where }: { where: { id: string } }) { return accounts.find((a) => a.id === where.id) ?? null; } },
  };
  return { db: db as never, rows, accounts };
}
const acc = (over: Partial<Acc> = {}): Acc => ({ id: "acc1", phone: "99112233", isActive: true, deactivatedAt: null, deletedAt: null, tokenVersion: 3, ...over });
const T0 = new Date("2026-11-18T00:00:00Z");
const at = (ms: number) => new Date(T0.getTime() + ms);

test("issue stores only a hash, binds the account's tokenVersion, and expires in 90 days", async () => {
  const { db, rows } = makeDb([acc()]);
  const t = await rt.issueAccountRefreshToken({ accountId: "acc1", tokenVersion: 3, now: T0 }, db);
  assert.equal(rows.length, 1);
  assert.notEqual(rows[0].tokenHash, t.token);
  assert.equal(rows[0].tokenHash.length, 64);
  assert.equal(rows[0].tokenVersion, 3);
  assert.equal(t.expiresAt.getTime() - T0.getTime(), 90 * 24 * 3600 * 1000);
});

test("rotate: returns a NEW token, keeps the tokenVersion, links the chain and revokes the old one", async () => {
  const { db, rows } = makeDb([acc()]);
  const first = await rt.issueAccountRefreshToken({ accountId: "acc1", tokenVersion: 3, now: T0 }, db);
  const r = await rt.rotateAccountRefreshToken(first.token, { now: at(1000) }, db);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.notEqual(r.token, first.token);
  assert.deepEqual([r.accountId, r.phone, r.tokenVersion], ["acc1", "99112233", 3]);
  const old = rows.find((x) => x.id === first.id)!;
  assert.ok(old.revokedAt && old.replacedById === r.id);
  assert.equal(rows.find((x) => x.id === r.id)!.revokedAt, null);
  // the new token works for the next rotation
  assert.equal((await rt.rotateAccountRefreshToken(r.token, { now: at(2000) }, db)).ok, true);
});

test("a rotated token replayed INSIDE the grace window is just invalid — other sessions survive", async () => {
  const { db, rows } = makeDb([acc()]);
  const a = await rt.issueAccountRefreshToken({ accountId: "acc1", tokenVersion: 3, now: T0 }, db);
  const other = await rt.issueAccountRefreshToken({ accountId: "acc1", tokenVersion: 3, now: T0 }, db); // a second device
  const r1 = await rt.rotateAccountRefreshToken(a.token, { now: at(1000) }, db);
  assert.equal(r1.ok, true);
  // the response was lost; the app retries with the OLD token a moment later
  const retry = await rt.rotateAccountRefreshToken(a.token, { now: at(1000 + 5000) }, db);
  assert.deepEqual(retry, { ok: false, reason: "invalid" });
  assert.equal(rows.find((x) => x.id === other.id)!.revokedAt, null, "other device untouched");
  assert.equal(r1.ok && rows.find((x) => x.id === r1.id)!.revokedAt, null, "the legitimately rotated token untouched");
});

test("a rotated token replayed AFTER the grace window is theft: every token of the account is revoked", async () => {
  const { db, rows } = makeDb([acc()]);
  const a = await rt.issueAccountRefreshToken({ accountId: "acc1", tokenVersion: 3, now: T0 }, db);
  const other = await rt.issueAccountRefreshToken({ accountId: "acc1", tokenVersion: 3, now: T0 }, db);
  const r1 = await rt.rotateAccountRefreshToken(a.token, { now: at(1000) }, db);
  assert.equal(r1.ok, true);
  const replay = await rt.rotateAccountRefreshToken(a.token, { now: at(1000 + rt.ACCOUNT_REFRESH_REUSE_GRACE_MS + 1) }, db);
  assert.deepEqual(replay, { ok: false, reason: "reused" });
  assert.ok(rows.every((x) => x.revokedAt !== null), "all revoked");
  assert.deepEqual(await rt.rotateAccountRefreshToken(other.token, { now: at(999_999) }, db), { ok: false, reason: "invalid" });
});

test("logout (explicit revoke) is plain invalid afterwards and never mass-revokes", async () => {
  const { db, rows } = makeDb([acc()]);
  const a = await rt.issueAccountRefreshToken({ accountId: "acc1", tokenVersion: 3, now: T0 }, db);
  const other = await rt.issueAccountRefreshToken({ accountId: "acc1", tokenVersion: 3, now: T0 }, db);
  await rt.revokeAccountRefreshToken(a.token, db, at(10));
  await rt.revokeAccountRefreshToken(a.token, db, at(20)); // idempotent
  await rt.revokeAccountRefreshToken("never-issued", db, at(20)); // unknown is fine
  assert.deepEqual(await rt.rotateAccountRefreshToken(a.token, { now: at(10 * 60_000) }, db), { ok: false, reason: "invalid" });
  assert.equal(rows.find((x) => x.id === other.id)!.revokedAt, null);
});

test("expired, unknown and garbage tokens are rejected", async () => {
  const { db } = makeDb([acc()]);
  const a = await rt.issueAccountRefreshToken({ accountId: "acc1", tokenVersion: 3, now: T0 }, db);
  const later = new Date(T0.getTime() + (90 * 24 * 3600 + 1) * 1000);
  assert.deepEqual(await rt.rotateAccountRefreshToken(a.token, { now: later }, db), { ok: false, reason: "expired" });
  assert.deepEqual(await rt.rotateAccountRefreshToken("nope", { now: T0 }, db), { ok: false, reason: "invalid" });
  assert.deepEqual(await rt.rotateAccountRefreshToken("", { now: T0 }, db), { ok: false, reason: "invalid" });
});

test("a password change (tokenVersion bump) kills every refresh token without touching the table", async () => {
  const { db, accounts } = makeDb([acc({ tokenVersion: 3 })]);
  const a = await rt.issueAccountRefreshToken({ accountId: "acc1", tokenVersion: 3, now: T0 }, db);
  accounts[0].tokenVersion = 4; // setAccountPassword / removeAccountPassword / reactivation
  assert.deepEqual(await rt.rotateAccountRefreshToken(a.token, { now: at(1000) }, db), { ok: false, reason: "invalid" });
});

test("closed / blocked / deleted accounts cannot refresh", async () => {
  for (const over of [{ isActive: false }, { deactivatedAt: T0 }, { deletedAt: T0 }] as Array<Partial<Acc>>) {
    const { db, rows } = makeDb([acc(over)]);
    const a = await rt.issueAccountRefreshToken({ accountId: "acc1", tokenVersion: 3, now: T0 }, db);
    assert.deepEqual(await rt.rotateAccountRefreshToken(a.token, { now: at(1000) }, db), { ok: false, reason: "invalid" }, JSON.stringify(over));
    assert.ok(rows[0].revokedAt, "the dead token is revoked");
    assert.equal(rows.length, 1, "and no new token was minted");
  }
});

test("two simultaneous refreshes with the same token: exactly one wins, no stray token survives, nobody is logged out everywhere", async () => {
  const { db, rows } = makeDb([acc()]);
  const a = await rt.issueAccountRefreshToken({ accountId: "acc1", tokenVersion: 3, now: T0 }, db);
  const other = await rt.issueAccountRefreshToken({ accountId: "acc1", tokenVersion: 3, now: T0 }, db);
  const results = await Promise.all([
    rt.rotateAccountRefreshToken(a.token, { now: at(1000) }, db),
    rt.rotateAccountRefreshToken(a.token, { now: at(1000) }, db),
  ]);
  assert.equal(results.filter((r) => r.ok).length, 1);
  assert.deepEqual(results.find((r) => !r.ok), { ok: false, reason: "invalid" });
  const live = rows.filter((r) => r.revokedAt === null);
  assert.equal(live.length, 2, "the winner's new token + the other device");
  assert.ok(live.some((r) => r.id === other.id));
});

test("rotation prunes only THIS account's old rows (expired/revoked > 7 days) and keeps recent ones for reuse detection", async () => {
  const { db, rows } = makeDb([acc(), acc({ id: "acc2", phone: "88112233" })]);
  const longAgo = new Date(T0.getTime() - 30 * 24 * 3600 * 1000);
  const oldDead = await rt.issueAccountRefreshToken({ accountId: "acc1", tokenVersion: 3, now: longAgo }, db);
  rows.find((r) => r.id === oldDead.id)!.revokedAt = longAgo;
  const otherAccountOld = await rt.issueAccountRefreshToken({ accountId: "acc2", tokenVersion: 3, now: longAgo }, db);
  rows.find((r) => r.id === otherAccountOld.id)!.revokedAt = longAgo;
  const recentRevoked = await rt.issueAccountRefreshToken({ accountId: "acc1", tokenVersion: 3, now: T0 }, db);
  rows.find((r) => r.id === recentRevoked.id)!.revokedAt = new Date(T0.getTime() - 24 * 3600 * 1000);
  const live = await rt.issueAccountRefreshToken({ accountId: "acc1", tokenVersion: 3, now: T0 }, db);
  const r = await rt.rotateAccountRefreshToken(live.token, { now: at(1000) }, db);
  assert.equal(r.ok, true);
  const ids = new Set(rows.map((x) => x.id));
  assert.equal(ids.has(oldDead.id), false, "old dead row of this account pruned");
  assert.equal(ids.has(otherAccountOld.id), true, "another account's rows are never touched");
  assert.equal(ids.has(recentRevoked.id), true, "recent revoked row kept (reuse detection)");
});

// ------------------------------------------------------------------ session issuing + route wiring

test("wantsRefreshSession / modeForExistingToken", () => {
  assert.equal(issue.wantsRefreshSession({ supportsRefresh: true }), true);
  for (const b of [null, undefined, {}, { supportsRefresh: "true" }, { supportsRefresh: 1 }, "x", []]) {
    assert.equal(issue.wantsRefreshSession(b), false, JSON.stringify(b));
  }
  assert.equal(issue.modeForExistingToken(null), "legacy");
  assert.equal(issue.modeForExistingToken(1_900_000_000), "refresh");
});

test("legacy mode returns exactly the old shape (accessToken only) — old apps are untouched", async () => {
  const out = await issue.issueAccountSession({ id: "acc1", phone: "99112233", tokenVersion: 0 }, "legacy", new Request("http://x"));
  assert.deepEqual(Object.keys(out), ["accessToken"]);
  assert.equal((await tok.verifyAccountApiToken(out.accessToken))!.exp, null);
});

test("login routes opt into refresh via supportsRefresh; refresh/logout routes are rate limited, bypass-context, and use the shared modules", () => {
  for (const f of ["../app/api/v1/app/auth/verify-otp/route.ts", "../app/api/v1/app/auth/login-password/route.ts"]) {
    const s = src(f);
    assert.match(s, /issueAccountSession\(account, wantsRefreshSession\(body\) \? "refresh" : "legacy", req\)/, f);
    assert.match(s, /\.\.\.tokens,/, f);
  }
  const refresh = src("../app/api/v1/app/auth/refresh/route.ts");
  assert.match(refresh, /enforceRateLimit\(req, "app-refresh"/);
  assert.match(refresh, /setBypassContext\(\)/);
  assert.match(refresh, /rotateAccountRefreshToken\(refreshToken\.trim\(\)/);
  assert.match(refresh, /signExpiringAccountApiToken\(/);
  assert.doesNotMatch(refresh, /signAccountApiToken\(/, "refresh must never mint a non-expiring token");
  assert.match(refresh, /reason: result\.reason/);
  const logout = src("../app/api/v1/app/auth/logout/route.ts");
  assert.match(logout, /enforceRateLimit\(req, "app-logout"/);
  assert.match(logout, /revokeAccountRefreshToken\(refreshToken\.trim\(\)\)/);
});

test("password set/remove re-issues in the SAME mode as the caller's current token", () => {
  const s = src("../app/api/v1/app/account/password/route.ts");
  assert.equal(s.match(/modeForExistingToken\(tokenExp\)/g)?.length, 2);
  assert.equal(s.match(/\.\.\.tokens/g)?.length, 2);
  assert.doesNotMatch(s, /signAccountApiToken/);
});

test("authenticateAccountRequest applies the legacy cutoff, the active/tv checks, and returns the token mode", () => {
  const s = src("../lib/auth/account-api-token.ts");
  assert.match(s, /legacyTokenAllowed\(payload\.exp, now, process\.env\.ACCOUNT_LEGACY_TOKENS_UNTIL\)/);
  assert.match(s, /!account\.isActive \|\| account\.deactivatedAt \|\| account\.deletedAt/);
  assert.match(s, /tokenVersionMatches\(payload\.tv, account\.tokenVersion\)/);
  assert.match(s, /return \{ account, tokenExp: payload\.exp \}/);
  // the cutoff is validated at boot, and the table is a plain global one (no RLS) with cascading FKs
  assert.match(src("../lib/env.ts"), /ACCOUNT_LEGACY_TOKENS_UNTIL/);
  const sql = src("../prisma/migrations/20261118130000_account_refresh_tokens/migration.sql");
  assert.match(sql, /CREATE UNIQUE INDEX "AccountRefreshToken_tokenHash_key"/);
  assert.match(sql, /"AccountRefreshToken_accountId_fkey" FOREIGN KEY \("accountId"\) REFERENCES "Account"\("id"\) ON DELETE CASCADE/);
  assert.doesNotMatch(sql, /ROW LEVEL SECURITY/);
});
