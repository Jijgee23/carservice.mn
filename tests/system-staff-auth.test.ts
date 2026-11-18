import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { before, test } from "node:test";
import { SignJWT } from "jose";

process.env.DATABASE_URL ??= "postgresql://unused/unused";
process.env.SESSION_SECRET ??= "unit-test-placeholder-secret-value-not-real-00";
delete process.env.API_TOKEN_SECRET;

let perms: typeof import("../lib/auth/system-permissions");
let lock: typeof import("../lib/auth/system-lockout");
let api: typeof import("../lib/auth/system-api");
let rt: typeof import("../lib/auth/system-refresh-token");
let issue: typeof import("../lib/auth/system-session-issue");
let accountTok: typeof import("../lib/auth/account-api-token");

before(async () => {
  [perms, lock, api, rt, issue, accountTok] = await Promise.all([
    import("../lib/auth/system-permissions"),
    import("../lib/auth/system-lockout"),
    import("../lib/auth/system-api"),
    import("../lib/auth/system-refresh-token"),
    import("../lib/auth/system-session-issue"),
    import("../lib/auth/account-api-token"),
  ]);
});

const src = (rel: string) => readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), rel), "utf8");

// ------------------------------------------------------------------ permissions

test("STAFF gets exactly the four tenant permissions; ROOT gets everything defined; both are fresh copies", () => {
  assert.deepEqual(perms.permissionsForKind("STAFF"), ["tenants.view", "tenants.create", "tenants.edit", "tenants.suspend"]);
  assert.deepEqual(perms.permissionsForKind("ROOT"), [...perms.SYSTEM_PERMISSION_CODES]);
  for (const c of perms.permissionsForKind("STAFF")) assert.ok(perms.permissionsForKind("ROOT").includes(c), `ROOT must include ${c}`);
  perms.permissionsForKind("STAFF").push("tenants.view");
  assert.equal(perms.permissionsForKind("STAFF").length, 4, "callers cannot mutate the shared list");
});

test("hasSystemPermission is fail-closed for unknown kinds and gives STAFF no non-tenant power", () => {
  for (const bad of [undefined, null, "", "root", "ADMIN", 1]) {
    for (const code of perms.SYSTEM_PERMISSION_CODES) assert.equal(perms.hasSystemPermission(bad, code), false, String(bad));
  }
  assert.equal(perms.hasSystemPermission("STAFF", "tenants.create"), true);
  // the catalog only contains tenant permissions: nothing about plans/billing/admins can be granted by accident
  assert.ok(perms.SYSTEM_PERMISSION_CODES.every((c) => c.startsWith("tenants.")));
  assert.equal(perms.isRootKind("ROOT"), true);
  assert.equal(perms.isRootKind("STAFF"), false);
  assert.equal(perms.isRootKind(undefined), false);
});

// ------------------------------------------------------------------ lockout

test("isSystemLocked: only a future lockedUntil locks", () => {
  const now = new Date("2026-11-18T10:00:00Z");
  assert.equal(lock.isSystemLocked(null, now), false);
  assert.equal(lock.isSystemLocked(undefined, now), false);
  assert.equal(lock.isSystemLocked(new Date("2026-11-18T09:59:59Z"), now), false, "expired lock is open");
  assert.equal(lock.isSystemLocked(now, now), false, "exactly now = open");
  assert.equal(lock.isSystemLocked(new Date("2026-11-18T10:00:01Z"), now), true);
});

type Admin = { id: string; failedLoginAttempts: number; lockedUntil: Date | null };
function lockDb(admins: Admin[]) {
  const db = {
    superAdmin: {
      async update({ where, data }: { where: { id: string }; data: { failedLoginAttempts: { increment: number } } }) {
        const a = admins.find((x) => x.id === where.id)!;
        a.failedLoginAttempts += data.failedLoginAttempts.increment;
        return { failedLoginAttempts: a.failedLoginAttempts };
      },
      async updateMany({ where, data }: { where: { id: string; OR?: Array<Record<string, unknown>> }; data: Partial<Admin> }) {
        const a = admins.find((x) => x.id === where.id);
        if (!a) return { count: 0 };
        const ok = (where.OR ?? [{}]).some((c) => {
          if ("lockedUntil" in c) {
            const v = c.lockedUntil as null | { lte?: Date; not?: null };
            if (v === null) return a.lockedUntil === null;
            if (v.lte) return a.lockedUntil !== null && a.lockedUntil.getTime() <= v.lte.getTime();
            if ("not" in v) return a.lockedUntil !== null;
          }
          if ("failedLoginAttempts" in c) return a.failedLoginAttempts > 0;
          return true;
        });
        if (!ok) return { count: 0 };
        Object.assign(a, data);
        return { count: 1 };
      },
    },
  };
  return db as never;
}
const NOW = new Date("2026-11-18T10:00:00Z");

test("4 failures count down; the 5th locks for 15 minutes and resets the counter", async () => {
  const a: Admin = { id: "a1", failedLoginAttempts: 0, lockedUntil: null };
  const db = lockDb([a]);
  for (let i = 1; i <= 4; i++) {
    const r = await lock.recordSystemFailedLogin("a1", NOW, db);
    assert.deepEqual(r, { locked: false, remaining: 5 - i });
  }
  assert.equal(a.lockedUntil, null);
  const fifth = await lock.recordSystemFailedLogin("a1", NOW, db);
  assert.deepEqual(fifth, { locked: true, remaining: 0 });
  assert.equal(a.lockedUntil!.getTime() - NOW.getTime(), 15 * 60_000);
  assert.equal(a.failedLoginAttempts, 0, "fresh 5 tries once the lock expires");
});

test("a failure while already locked does not extend the lock (no endless DoS via repeated attempts)", async () => {
  const until = new Date(NOW.getTime() + 10 * 60_000);
  const a: Admin = { id: "a1", failedLoginAttempts: 4, lockedUntil: until };
  const db = lockDb([a]);
  await lock.recordSystemFailedLogin("a1", NOW, db);
  assert.equal(a.lockedUntil!.getTime(), until.getTime());
  // once expired, hitting the limit again locks anew
  const later = new Date(until.getTime() + 1000);
  a.failedLoginAttempts = 4;
  await lock.recordSystemFailedLogin("a1", later, db);
  assert.equal(a.lockedUntil!.getTime(), later.getTime() + 15 * 60_000);
});

test("a successful login clears the counter and any expired lock; untouched admins stay untouched", async () => {
  const a: Admin = { id: "a1", failedLoginAttempts: 3, lockedUntil: null };
  const b: Admin = { id: "b1", failedLoginAttempts: 2, lockedUntil: null };
  const db = lockDb([a, b]);
  await lock.clearSystemLoginFailures("a1", db);
  assert.deepEqual([a.failedLoginAttempts, a.lockedUntil], [0, null]);
  assert.equal(b.failedLoginAttempts, 2);
});

// ------------------------------------------------------------------ access token realm isolation

const claims = { adminId: "adm1", email: "staff@example.mn", pv: "0123456789abcdef" };

test("system access token round-trips, expires in an hour, and carries no password hash", async () => {
  const t = await api.signSystemApiToken(claims);
  assert.deepEqual(await api.verifySystemApiToken(t), claims);
  const payload = JSON.parse(Buffer.from(t.split(".")[1], "base64url").toString());
  const nowS = Math.floor(Date.now() / 1000);
  assert.ok(payload.exp >= nowS + 3600 - 3 && payload.exp <= nowS + 3600 + 3);
  assert.equal(api.SYSTEM_ACCESS_TOKEN_SECONDS, 3600);
  assert.equal(JSON.stringify(payload).includes("passwordHash"), false);
});

test("realms cannot cross: a customer token is not a system token and a system token is not a customer token", async () => {
  const sys = await api.signSystemApiToken(claims);
  const cust = await accountTok.signAccountApiToken({ accountId: "acc1", phone: "99112233", tv: 0 });
  assert.equal(await api.verifySystemApiToken(cust), null);
  assert.equal(await accountTok.verifyAccountApiToken(sys), null);
});

test("expired, tampered, wrong-secret and malformed system tokens are rejected", async () => {
  const secret = new TextEncoder().encode(`system-api:${process.env.SESSION_SECRET}`);
  const expired = await new SignJWT({ ...claims })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt(Math.floor(Date.now() / 1000) - 7200)
    .setExpirationTime(Math.floor(Date.now() / 1000) - 60)
    .sign(secret);
  assert.equal(await api.verifySystemApiToken(expired), null);
  const good = await api.signSystemApiToken(claims);
  assert.equal(await api.verifySystemApiToken(good.slice(0, -3) + (good.endsWith("AAA") ? "BBB" : "AAA")), null);
  const other = await new SignJWT({ ...claims }).setProtectedHeader({ alg: "HS256" }).sign(new TextEncoder().encode(`x:${process.env.SESSION_SECRET}`));
  assert.equal(await api.verifySystemApiToken(other), null);
  assert.equal(await api.verifySystemApiToken("nope"), null);
  // missing / wrong-typed claims
  const noPv = await new SignJWT({ adminId: "a", email: "e" }).setProtectedHeader({ alg: "HS256" }).sign(secret);
  assert.equal(await api.verifySystemApiToken(noPv), null);
  const badAdmin = await new SignJWT({ adminId: 5, email: "e", pv: "x" }).setProtectedHeader({ alg: "HS256" }).sign(secret);
  assert.equal(await api.verifySystemApiToken(badAdmin), null);
});

test("passwordFingerprint changes with the hash, is stable, and hides the hash", () => {
  const a = api.passwordFingerprint("$2a$12$aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
  const b = api.passwordFingerprint("$2a$12$bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");
  assert.notEqual(a, b);
  assert.equal(a, api.passwordFingerprint("$2a$12$aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"));
  assert.equal(a.length, 16);
  assert.ok(!a.includes("$2a$"));
});

test("systemAdminDto is a strict whitelist (no password hash, lockout or id of anything else)", () => {
  const dto = issue.systemAdminDto({ id: "a", email: "e@x.mn", firstName: "Б", lastName: "Д", kind: "STAFF", passwordHash: "SECRET", lockedUntil: new Date() } as never);
  assert.deepEqual(Object.keys(dto).sort(), ["email", "firstName", "id", "kind", "lastName", "permissions"]);
  assert.deepEqual(dto.permissions, perms.permissionsForKind("STAFF"));
  assert.equal(JSON.stringify(dto).includes("SECRET"), false);
});

// ------------------------------------------------------------------ refresh rotation (in-memory fake DB)

type Row = {
  id: string; tokenHash: string; adminId: string; expiresAt: Date; revokedAt: Date | null; replacedById: string | null;
  userAgent: string | null; ip: string | null; createdAt: Date; lastUsedAt: Date | null;
};
type Adm = { id: string; email: string; isActive: boolean; passwordHash: string };

function refreshDb(admins: Adm[]) {
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
  const db = {
    superAdminRefreshToken: {
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
    },
    superAdmin: { async findUnique({ where }: { where: { id: string } }) { return admins.find((a) => a.id === where.id) ?? null; } },
  };
  return { db: db as never, rows, admins };
}
const adm = (over: Partial<Adm> = {}): Adm => ({ id: "adm1", email: "staff@example.mn", isActive: true, passwordHash: "$2a$12$hash", ...over });
const T0 = new Date("2026-11-18T00:00:00Z");
const at = (ms: number) => new Date(T0.getTime() + ms);

test("issue stores only a hash and a 90-day expiry; the raw token is never persisted", async () => {
  const { db, rows } = refreshDb([adm()]);
  const t = await rt.issueSystemRefreshToken({ adminId: "adm1", now: T0 }, db);
  assert.notEqual(rows[0].tokenHash, t.token);
  assert.equal(rows[0].tokenHash.length, 64);
  assert.equal(t.expiresAt.getTime() - T0.getTime(), 90 * 24 * 3600 * 1000);
});

test("rotate returns a new token + the admin identity, links the chain, and the new token keeps rotating", async () => {
  const { db, rows } = refreshDb([adm()]);
  const first = await rt.issueSystemRefreshToken({ adminId: "adm1", now: T0 }, db);
  const r = await rt.rotateSystemRefreshToken(first.token, { now: at(1000) }, db);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.notEqual(r.token, first.token);
  assert.deepEqual([r.adminId, r.email, r.passwordHash], ["adm1", "staff@example.mn", "$2a$12$hash"]);
  assert.ok(rows.find((x) => x.id === first.id)!.revokedAt);
  assert.equal(rows.find((x) => x.id === first.id)!.replacedById, r.id);
  assert.equal((await rt.rotateSystemRefreshToken(r.token, { now: at(2000) }, db)).ok, true);
});

test("replay inside the 60s grace is just invalid; replay after it is theft and revokes every token of that admin only", async () => {
  const { db, rows } = refreshDb([adm(), adm({ id: "adm2", email: "other@example.mn" })]);
  const a = await rt.issueSystemRefreshToken({ adminId: "adm1", now: T0 }, db);
  const sibling = await rt.issueSystemRefreshToken({ adminId: "adm1", now: T0 }, db);
  const stranger = await rt.issueSystemRefreshToken({ adminId: "adm2", now: T0 }, db);
  assert.equal((await rt.rotateSystemRefreshToken(a.token, { now: at(1000) }, db)).ok, true);
  assert.deepEqual(await rt.rotateSystemRefreshToken(a.token, { now: at(6000) }, db), { ok: false, reason: "invalid" });
  assert.equal(rows.find((x) => x.id === sibling.id)!.revokedAt, null, "grace replay leaves other sessions alone");
  assert.deepEqual(await rt.rotateSystemRefreshToken(a.token, { now: at(1000 + rt.SYSTEM_REFRESH_REUSE_GRACE_MS + 1) }, db), { ok: false, reason: "reused" });
  assert.ok(rows.filter((x) => x.adminId === "adm1").every((x) => x.revokedAt !== null));
  assert.equal(rows.find((x) => x.id === stranger.id)!.revokedAt, null, "another admin is never affected");
});

test("logout, expiry, unknown and inactive-admin cases", async () => {
  const { db, rows, admins } = refreshDb([adm()]);
  const a = await rt.issueSystemRefreshToken({ adminId: "adm1", now: T0 }, db);
  const b = await rt.issueSystemRefreshToken({ adminId: "adm1", now: T0 }, db);
  await rt.revokeSystemRefreshToken(a.token, db, at(10));
  await rt.revokeSystemRefreshToken(a.token, db, at(20));
  await rt.revokeSystemRefreshToken("never-issued", db, at(20));
  assert.deepEqual(await rt.rotateSystemRefreshToken(a.token, { now: at(600_000) }, db), { ok: false, reason: "invalid" });
  assert.equal(rows.find((x) => x.id === b.id)!.revokedAt, null, "logout never mass-revokes");
  assert.deepEqual(await rt.rotateSystemRefreshToken("nope", { now: T0 }, db), { ok: false, reason: "invalid" });
  const later = new Date(T0.getTime() + (90 * 24 * 3600 + 1) * 1000);
  assert.deepEqual(await rt.rotateSystemRefreshToken(b.token, { now: later }, db), { ok: false, reason: "expired" });
  // deactivated admin: token dies and no new token is minted
  const c = await rt.issueSystemRefreshToken({ adminId: "adm1", now: T0 }, db);
  admins[0].isActive = false;
  const before = rows.length;
  assert.deepEqual(await rt.rotateSystemRefreshToken(c.token, { now: at(1000) }, db), { ok: false, reason: "invalid" });
  assert.equal(rows.length, before);
});

test("two simultaneous refreshes: exactly one wins and no stray live token is left behind", async () => {
  const { db, rows } = refreshDb([adm()]);
  const a = await rt.issueSystemRefreshToken({ adminId: "adm1", now: T0 }, db);
  const other = await rt.issueSystemRefreshToken({ adminId: "adm1", now: T0 }, db);
  const results = await Promise.all([rt.rotateSystemRefreshToken(a.token, { now: at(1000) }, db), rt.rotateSystemRefreshToken(a.token, { now: at(1000) }, db)]);
  assert.equal(results.filter((r) => r.ok).length, 1);
  assert.deepEqual(results.find((r) => !r.ok), { ok: false, reason: "invalid" });
  const live = rows.filter((r) => r.revokedAt === null);
  assert.equal(live.length, 2);
  assert.ok(live.some((r) => r.id === other.id));
});

// ------------------------------------------------------------------ web is closed to STAFF + wiring (source patterns)

test("web /system is closed to STAFF: loader, session probe and sign-in all require ROOT", () => {
  const s = src("../lib/auth/system.ts");
  assert.match(s, /if \(!isRootKind\(admin\.kind\)\) \{\s+await clearSystemSessionCookie\(\);\s+redirect\("\/system\/login"\);/);
  assert.match(s, /Boolean\(admin\?\.isActive && isRootKind\(admin\.kind\)\)/);
  const auth = src("../app/_actions/system-auth.ts");
  assert.match(auth, /admin\.kind !== "ROOT"/);
  // the refusal happens AFTER the password was verified, so it does not reveal which emails are staff
  assert.ok(auth.indexOf("verifyPassword(") < auth.indexOf('admin.kind !== "ROOT"'));
  assert.ok(auth.indexOf('admin.kind !== "ROOT"') < auth.indexOf("signSystemSession({"));
});

test("only ROOT admins receive platform notifications", () => {
  assert.match(src("../lib/notifications.ts"), /superAdmin\.findMany\(\{ where: \{ kind: "ROOT", isActive: true \}/);
});

test("admin management: kind chosen on create, last-ROOT guard ignores STAFF, deactivation revokes tokens, STAFF-only password reset", () => {
  const s = src("../app/_actions/system-admins.ts");
  assert.match(s, /s\(formData, "kind"\) === "STAFF" \? "STAFF" : "ROOT"/);
  assert.match(s, /kind === "ROOT"[\s\S]*?count\(\{ where: \{ isActive: true, kind: "ROOT" \} \}\)/);
  assert.match(s, /if \(!active\) await revokeAllSystemRefreshTokens\(id\)/);
  const reset = s.slice(s.indexOf("export async function resetStaffPasswordAction"));
  assert.match(reset, /await requireSuperAdmin\(\)/);
  assert.match(reset, /target\.kind !== "STAFF"/);
  assert.match(reset, /failedLoginAttempts: 0, lockedUntil: null/);
  assert.match(reset, /revokeAllSystemRefreshTokens\(id\)/);
  // the page lets a STAFF be deactivated even when only one ROOT remains, but protects the last ROOT
  assert.match(src("../app/system/(authed)/admins/page.tsx"), /canDeactivate=\{a\.kind === "STAFF" \|\| activeRootCount > 1\}/);
});

test("system login route: validated body, rate limit before any DB read, lock check before the password check, timing-equalised, whitelisted response", () => {
  const s = src("../app/api/v1/system/auth/login/route.ts");
  const post = s.slice(s.indexOf("export async function POST"));
  const idx = (needle: string) => {
    const i = post.indexOf(needle);
    assert.ok(i !== -1, `missing ${needle}`);
    return i;
  };
  assert.ok(idx("consumeRateLimit(`system-api-login-ip") < idx("prisma.superAdmin.findFirst"));
  assert.ok(idx("consumeRateLimit(`system-api-login:") < idx("prisma.superAdmin.findFirst"));
  assert.ok(idx("isSystemLocked(") < idx("verifyPassword("));
  assert.match(post, /verifyPassword\(password, admin \? admin\.passwordHash : await getDummyHash\(\)\)/);
  assert.match(post, /limit: 5, windowMs: LOGIN_WINDOW_MS/);
  assert.match(post, /if \(admin\) await recordSystemFailedLogin\(admin\.id\)/);
  assert.match(post, /systemAdminDto\(admin\)/);
  assert.ok(idx("ADMIN_INACTIVE") > idx("verifyPassword("), "inactive status only revealed after a correct password");
  assert.doesNotMatch(post, /passwordHash: admin\.passwordHash|json\(admin\)/);
});

test("refresh/logout/me/password routes use the system modules and never mint non-system tokens", () => {
  const refresh = src("../app/api/v1/system/auth/refresh/route.ts");
  assert.match(refresh, /enforceRateLimit\(req, "system-api-refresh"/);
  assert.match(refresh, /rotateSystemRefreshToken\(/);
  assert.match(refresh, /reason: result\.reason/);
  assert.match(src("../app/api/v1/system/auth/logout/route.ts"), /revokeSystemRefreshToken\(refreshToken\.trim\(\)\)/);
  assert.match(src("../app/api/v1/system/me/route.ts"), /requireSystemApiUser\(req\)/);
  const pw = src("../app/api/v1/system/me/password/route.ts");
  assert.match(pw, /requireSystemApiUser\(req\)/);
  ordered(pw, "verifyPassword(current", "prisma.superAdmin.update(");
  ordered(pw, "prisma.superAdmin.update(", "revokeAllSystemRefreshTokens(");
  ordered(pw, "revokeAllSystemRefreshTokens(", "issueSystemTokens(");
  assert.match(pw, /enforceRateLimit\(req, "system-api-password"/);
});

function ordered(s: string, a: string, b: string) {
  const ia = s.indexOf(a);
  const ib = s.indexOf(b);
  assert.ok(ia !== -1 && ib !== -1, `${a} / ${b} must both exist`);
  assert.ok(ia < ib, `${a} must come before ${b}`);
}

test("migration: kind defaults to ROOT (existing admins unchanged), new tables are global with cascading FKs", () => {
  const sql = src("../prisma/migrations/20261118140000_system_staff/migration.sql");
  assert.match(sql, /"kind" "SuperAdminKind" NOT NULL DEFAULT 'ROOT'/);
  assert.match(sql, /CREATE UNIQUE INDEX "SuperAdminRefreshToken_tokenHash_key"/);
  assert.match(sql, /"SuperAdminRefreshToken_adminId_fkey" FOREIGN KEY \("adminId"\) REFERENCES "SuperAdmin"\("id"\) ON DELETE CASCADE/);
  assert.match(sql, /"SystemAuditLog_adminId_fkey"[\s\S]*ON DELETE RESTRICT/);
  assert.doesNotMatch(sql, /ROW LEVEL SECURITY/);
  assert.doesNotMatch(sql, /DROP\s|DELETE\s+FROM/i);
});
