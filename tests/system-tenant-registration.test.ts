import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { before, test } from "node:test";

process.env.DATABASE_URL ??= "postgresql://unused/unused";
process.env.SESSION_SECRET ??= "unit-test-placeholder-secret-value-not-real-00";

let reg: typeof import("../lib/system/tenant-registration");
let act: typeof import("../lib/system/owner-activation");
let signup: typeof import("../lib/auth/tenant-signup");

before(async () => {
  [reg, act, signup] = await Promise.all([
    import("../lib/system/tenant-registration"),
    import("../lib/system/owner-activation"),
    import("../lib/auth/tenant-signup"),
  ]);
});

const src = (rel: string) => readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), rel), "utf8");
// Тайлбарыг (block ба line comment) хасч зөвхөн ажиллах кодыг үлдээнэ: «байх ёсгүй» шалгалт тайлбарт андуурахгүй.
const code = (rel: string) =>
  src(rel)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

const body =(over: Record<string, unknown> = {}) => ({
  orgName: "Төв Авто ХХК",
  registerNumber: "1234567",
  phone: "99112233",
  email: "Shop@Example.MN",
  ownerName: "Дорж Бат",
  latitude: 47.91,
  longitude: 106.92,
  city: "Улаанбаатар",
  address: "Өнөр 12",
  ...over,
});

// ------------------------------------------------------------------ validation without a password

test("registration validation needs NO password, ignores one if sent, but the default signup validation still requires it", () => {
  const input = signup.tenantSignupInputFromBody(body({ password: "ignored-pass-123" }));
  const reg1 = signup.validateTenantSignup(input, { requirePassword: false });
  assert.equal(reg1.ok, true);
  if (reg1.ok) {
    assert.equal(reg1.data.password, "", "a password sent by the client is never carried into the data");
    assert.equal(reg1.data.adminEmail, "shop@example.mn");
    assert.equal(reg1.data.phone, "99112233");
  }
  const noPw = signup.tenantSignupInputFromBody(body());
  assert.equal(signup.validateTenantSignup(noPw, { requirePassword: false }).ok, true);
  const strict = signup.validateTenantSignup(noPw);
  assert.equal(strict.ok, false);
  if (!strict.ok) assert.ok("password" in strict.fieldErrors);
});

test("registration still enforces every other rule: regno, phone, owner name for organisations, map location", () => {
  const v = (over: Record<string, unknown>) => signup.validateTenantSignup(signup.tenantSignupInputFromBody(body(over)), { requirePassword: false });
  const fe = (over: Record<string, unknown>) => (v(over) as { ok: false; fieldErrors: Record<string, string> }).fieldErrors;
  assert.ok("registerNumber" in fe({ registerNumber: "123" }));
  assert.ok("phone1" in fe({ phone: "123" }));
  assert.ok("phone1" in fe({ phone: "" }));
  assert.ok("ownerName" in fe({ ownerName: "" }), "an organisation needs the owner's name");
  assert.ok("latitude" in fe({ latitude: undefined }));
  assert.ok("latitude" in fe({ latitude: 999 }));
  assert.ok("orgName" in fe({ orgName: "" }));
  assert.ok("orgEmail" in fe({ email: "not-an-email" }));
  // a person registers with their own name (no separate owner name)
  const person = v({ registerNumber: "УБ99112233", orgName: "Бат Дорж", ownerName: "" });
  assert.equal(person.ok, true);
});

// ------------------------------------------------------------------ registerTenantBySystem (fake deps)

type Calls = { validate: unknown[]; conflicts: number; create: unknown[]; audit: Array<Record<string, unknown>>; notify: unknown[] };
function deps(over: Partial<import("../lib/system/tenant-registration").RegisterDeps> = {}) {
  const calls: Calls = { validate: [], conflicts: 0, create: [], audit: [], notify: [] };
  const d: import("../lib/system/tenant-registration").RegisterDeps = {
    validate: ((input: unknown, opts: unknown) => {
      calls.validate.push(opts);
      return signup.validateTenantSignup(input as never, opts as never);
    }) as never,
    findConflicts: (async () => {
      calls.conflicts++;
      return null;
    }) as never,
    create: (async (data: unknown, opts: unknown) => {
      calls.create.push(opts);
      void data;
      return { ok: true, created: { userId: "u1", tenantId: "t1", isOwner: true, workingBranchId: "b1" } };
    }) as never,
    audit: (async (i: Record<string, unknown>) => {
      calls.audit.push(i);
    }) as never,
    notify: (async (i: unknown) => {
      calls.notify.push(i);
    }) as never,
    ...over,
  };
  return { d, calls };
}

test("success: validates without a password, creates in ACTIVATION mode, audits who created it, notifies root", async () => {
  const { d, calls } = deps();
  const r = await reg.registerTenantBySystem({ body: body(), adminId: "adm1" }, d);
  assert.equal(r.ok, true);
  assert.deepEqual(calls.validate, [{ requirePassword: false }]);
  assert.deepEqual(calls.create, [{ ownerActivation: true }]);
  assert.equal(calls.audit.length, 1);
  assert.deepEqual([calls.audit[0].adminId, calls.audit[0].tenantId, calls.audit[0].entity, calls.audit[0].action], ["adm1", "t1", "Tenant", "CREATE"]);
  const after = calls.audit[0].after as Record<string, unknown>;
  assert.deepEqual([after.name, after.registerNumber, after.ownerUserId, after.ownerActivation], ["Төв Авто ХХК", "1234567", "u1", true]);
  assert.equal(JSON.stringify(calls.audit[0]).includes("password"), false);
  assert.equal(calls.notify.length, 1);
});

test("validation failure → 422 with field errors; nothing is looked up, created or audited", async () => {
  const { d, calls } = deps();
  const r = await reg.registerTenantBySystem({ body: body({ registerNumber: "x" }), adminId: "adm1" }, d);
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.deepEqual([r.status, r.code], [422, "VALIDATION"]);
    assert.ok(r.fieldErrors && "registerNumber" in r.fieldErrors);
    assert.equal(r.message, r.fieldErrors!.registerNumber, "message is the first field error");
  }
  assert.deepEqual([calls.conflicts, calls.create.length, calls.audit.length, calls.notify.length], [0, 0, 0, 0]);
});

test("existing register number/phone → 409 CONFLICT with the field errors; not created, not audited", async () => {
  const { d, calls } = deps({ findConflicts: (async () => ({ registerNumber: "Энэ регистр аль хэдийн бүртгэгдсэн байна." })) as never });
  const r = await reg.registerTenantBySystem({ body: body(), adminId: "adm1" }, d);
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.deepEqual([r.status, r.code], [409, "CONFLICT"]);
    assert.deepEqual(r.fieldErrors, { registerNumber: "Энэ регистр аль хэдийн бүртгэгдсэн байна." });
  }
  assert.deepEqual([calls.create.length, calls.audit.length], [0, 0]);
});

test("a race lost at creation time (unique violation) is a 409; an internal failure is a 500 that leaks nothing", async () => {
  const raced = deps({ create: (async () => ({ ok: false, fieldErrors: { adminPhone: "Энэ утасны дугаар аль хэдийн бүртгэгдсэн байна." } })) as never });
  const a = await reg.registerTenantBySystem({ body: body(), adminId: "adm1" }, raced.d);
  assert.deepEqual(a.ok ? null : [a.status, a.code], [409, "CONFLICT"]);
  assert.equal(raced.calls.audit.length, 0);
  const broken = deps({ create: (async () => ({ ok: false, message: "Бүртгэх явцад алдаа гарлаа. Дахин оролдоно уу." })) as never });
  const b = await reg.registerTenantBySystem({ body: body(), adminId: "adm1" }, broken.d);
  assert.deepEqual(b.ok ? null : [b.status, b.code], [500, "SERVER_ERROR"]);
  assert.equal(broken.calls.audit.length, 0);
});

test("a failing notification never fails or undoes the registration", async () => {
  const { d, calls } = deps({ notify: (async () => { throw new Error("push down"); }) as never });
  const r = await reg.registerTenantBySystem({ body: body(), adminId: "adm1" }, d);
  assert.equal(r.ok, true);
  assert.equal(calls.audit.length, 1);
});

// ------------------------------------------------------------------ owner activation code (fake SMS — never a real send)

type Owner = { id: string; email: string | null; phone: string; verified: boolean };
function actDeps(owners: Owner[], over: Partial<import("../lib/system/owner-activation").ActivationDeps> = {}) {
  const calls = { where: [] as unknown[], issue: [] as unknown[], send: [] as unknown[] };
  const d: import("../lib/system/owner-activation").ActivationDeps = {
    db: {
      user: {
        async findMany({ where }: { where: Record<string, unknown> }) {
          calls.where.push(where);
          return owners.filter((o) => !where.id || o.id === where.id);
        },
      },
    } as never,
    issue: (async (o: unknown) => {
      calls.issue.push(o);
      return { code: "123456", expiresAt: new Date() };
    }) as never,
    send: (async (code: string, type: string, phone: string) => {
      calls.send.push([code, type, phone]);
      return true;
    }) as never,
    ...over,
  };
  return { d, calls };
}
const ownerRow = (over: Partial<Owner> = {}): Owner => ({ id: "o1", email: null, phone: "99112233", verified: false, ...over });

test("sends a SET_PASSWORD code to the unactivated owner's phone and returns only a masked phone", async () => {
  const { d, calls } = actDeps([ownerRow()]);
  const r = await act.sendOwnerActivationCode({ tenantId: "t1", userAgent: "app/1", ip: "1.2.3.4" }, d);
  assert.deepEqual(r, { ok: true, ownerId: "o1", maskedPhone: "******33" });
  assert.deepEqual(calls.send, [["123456", "SET_PASSWORD", "99112233"]]);
  const issued = calls.issue[0] as Record<string, unknown>;
  assert.deepEqual([issued.type, issued.userId, issued.phone, issued.ip], ["SET_PASSWORD", "o1", "99112233", "1.2.3.4"]);
  assert.deepEqual(calls.where[0], { tenantId: "t1", isOwner: true, deletedAt: null });
});

test("the lookup is scoped to the tenant and only owners; an explicit ownerId narrows it further", async () => {
  const { d, calls } = actDeps([ownerRow(), ownerRow({ id: "o2", verified: false })]);
  await act.sendOwnerActivationCode({ tenantId: "t9", ownerId: "o2" }, d);
  assert.deepEqual(calls.where[0], { tenantId: "t9", isOwner: true, deletedAt: null, id: "o2" });
});

test("no owner → NOT_FOUND; all owners already activated → ALREADY_ACTIVE (no SMS either way)", async () => {
  const none = actDeps([]);
  assert.deepEqual(await act.sendOwnerActivationCode({ tenantId: "t1" }, none.d), { ok: false, reason: "NOT_FOUND", message: "Эзэн олдсонгүй." });
  const done = actDeps([ownerRow({ verified: true })]);
  const r = await act.sendOwnerActivationCode({ tenantId: "t1" }, done.d);
  assert.equal(r.ok === false && r.reason, "ALREADY_ACTIVE");
  assert.equal(none.calls.send.length + done.calls.send.length, 0);
  assert.equal(none.calls.issue.length + done.calls.issue.length, 0);
});

test("with several owners it targets the one that still needs activation", async () => {
  const { d, calls } = actDeps([ownerRow({ id: "a", verified: true }), ownerRow({ id: "b", verified: false, phone: "88001122" })]);
  const r = await act.sendOwnerActivationCode({ tenantId: "t1" }, d);
  assert.equal(r.ok && r.ownerId, "b");
  assert.deepEqual(calls.send, [["123456", "SET_PASSWORD", "88001122"]]);
});

test("OTP throttling → THROTTLED (no SMS); a failed SMS → SMS_FAILED", async () => {
  const throttled = actDeps([ownerRow()], { issue: (async () => { throw new Error("Хэт олон код хүслээ. 5 минутын дараа дахин оролдоно уу."); }) as never });
  const t = await act.sendOwnerActivationCode({ tenantId: "t1" }, throttled.d);
  assert.deepEqual(t.ok ? null : [t.reason, t.message], ["THROTTLED", "Хэт олон код хүслээ. 5 минутын дараа дахин оролдоно уу."]);
  assert.equal(throttled.calls.send.length, 0);
  const failing = actDeps([ownerRow()], { send: (async () => false) as never });
  const f = await act.sendOwnerActivationCode({ tenantId: "t1" }, failing.d);
  assert.equal(f.ok === false && f.reason, "SMS_FAILED");
});

test("maskPhone keeps only the last two digits", () => {
  assert.equal(act.maskPhone("99112233"), "******33");
  assert.equal(act.maskPhone("12"), "**");
  assert.equal(act.maskPhone(""), "**");
});

// ------------------------------------------------------------------ wiring (source patterns)

function ordered(s: string, a: string, b: string) {
  const ia = s.indexOf(a);
  const ib = s.indexOf(b);
  assert.ok(ia !== -1 && ib !== -1, `${a} / ${b} must both exist`);
  assert.ok(ia < ib, `${a} must come before ${b}`);
}

test("POST /system/tenants: tenants.create, rate limit and body checks come before registration", () => {
  const s = src("../app/api/v1/system/tenants/route.ts");
  const post = s.slice(s.indexOf("export async function POST"));
  assert.match(post, /requireSystemApiUser\(req, "tenants\.create"\)/);
  assert.match(post, /enforceRateLimit\(req, "system-api-tenant-create"[\s\S]*?auth\.admin\.id\)/);
  ordered(post, "requireSystemApiUser(", "enforceRateLimit(");
  ordered(post, "enforceRateLimit(", "req.json()");
  ordered(post, "req.json()", "registerTenantBySystem(");
  assert.match(post, /registerTenantBySystem\(\{ body, adminId: auth\.admin\.id, req \}\)/);
  assert.match(post, /\{ status: 201 \}/);
  // the response exposes the activation state, never any password data
  assert.doesNotMatch(post, /passwordHash|hashPassword/);
});

test("activation-code route: tenants.edit, per-admin rate limit, mapped statuses", () => {
  const s = src("../app/api/v1/system/tenants/[id]/owner/activation-code/route.ts");
  assert.match(s, /requireSystemApiUser\(req, "tenants\.edit"\)/);
  assert.match(s, /enforceRateLimit\(req, "system-api-activation-code"[\s\S]*?auth\.admin\.id\)/);
  assert.match(s, /NOT_FOUND: 404, ALREADY_ACTIVE: 409, THROTTLED: 429, SMS_FAILED: 502/);
  assert.match(s, /sendOwnerActivationCode\(\{ tenantId: id,/);
});

test("signup core: a REAL transaction, activation mode, and the self-signup path is unchanged", () => {
  const s = code("../lib/auth/tenant-signup.ts");
  assert.doesNotMatch(s, /prisma\.\$transaction/, "no rollback-less interactive transaction");
  assert.match(s, /withBookingTransaction\(tenantId, async \(tx\) =>/);
  assert.match(s, /id: tenantId,\s+slug: makeSlug/);
  assert.match(s, /const passwordHash = activation \? null : await hashPassword\(data\.password\)/);
  assert.match(s, /verified: !activation,/);
  // existing callers do not pass options → they keep password + verified owner
  assert.match(src("../app/_actions/auth.ts"), /createTenantWithOwner\(data\)/);
  assert.match(src("../app/api/v1/auth/signup/route.ts"), /createTenantWithOwner\(data\)/);
  // the cash account stays inside the same transaction as the tenant
  assert.match(s, /await ensureCashAccount\(tx, tenant\.id\)/);
});

test("the registration path uses ownerActivation and never hashes or stores a password", () => {
  const s = code("../lib/system/tenant-registration.ts");
  assert.match(s, /deps\.create\(data, \{ ownerActivation: true \}\)/);
  assert.match(s, /requirePassword: false/);
  assert.doesNotMatch(s, /hashPassword|passwordHash/);
});
