import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

// ГЭРЭЭ: /api/v1-ийн handler бүр (1) нэвтрэлт шалгадаг, эсвэл (2) доорх нийтийн жагсаалтад ЗОРИУДААР
// орсон байх ёстой. Шинэ route нэмээд нэвтрэлт мартвал энэ тест шууд унана.
// (Бодит HTTP 401 шалгалт биш — бүтцийн гэрээ; handler-ийн логикийг тусад нь тест хамгаална.)

const here = dirname(fileURLToPath(import.meta.url));
const V1 = resolve(here, "../app/api/v1");

function routeFiles(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...routeFiles(p));
    else if (e.name === "route.ts") out.push(p);
  }
  return out;
}

const HANDLER_RE = /export (?:async )?function (GET|POST|PUT|PATCH|DELETE)\b/g;
const AUTH_CALL = /\b(requireApiUser|requireCashApiUser|getApiUserFromRequest|getApiAccountFromRequest|authenticateAccountRequest|requireSystemApiUser)\(/;

type Handler = { route: string; method: string; body: string; file: string; source: string };

function handlers(): Handler[] {
  const out: Handler[] = [];
  for (const file of routeFiles(V1)) {
    const source = readFileSync(file, "utf8").replace(/\r\n/g, "\n");
    const route = file.replace(/\\/g, "/").split("/app/api/v1/")[1].replace(/\/route\.ts$/, "");
    const starts: Array<{ method: string; at: number }> = [];
    let m: RegExpExecArray | null;
    HANDLER_RE.lastIndex = 0;
    while ((m = HANDLER_RE.exec(source))) starts.push({ method: m[1], at: m.index });
    starts.forEach((h, i) => {
      out.push({
        route,
        method: h.method,
        file,
        source,
        body: source.slice(h.at, i + 1 < starts.length ? starts[i + 1].at : source.length),
      });
    });
  }
  return out;
}

/** Зориудаар нийтийн (токенгүй) endpoint-ууд. Нэмэхээсээ өмнө хоёр дахин бодоорой. */
const PUBLIC: Record<string, string> = {
  // --- Нэвтрэлт/бүртгэл: токен авахын өмнөх алхмууд (rate limit-тэй)
  "POST app/auth/login-password": "customer password login",
  "POST app/auth/request-otp": "customer OTP request",
  "POST app/auth/verify-otp": "customer OTP verify",
  "POST app/auth/refresh": "customer refresh-token rotation (the opaque refresh token IS the credential)",
  "POST app/auth/logout": "revokes the customer refresh token supplied in the body",
  // --- System realm (мобайл): токен авахын өмнөх алхмууд. login нь IP+имэйл rate limit, DB-ийн хугацаат түгжээтэй.
  "POST system/auth/login": "system realm login (rate limited + timed lockout)",
  "POST system/auth/refresh": "system refresh-token rotation (the opaque token IS the credential)",
  "POST system/auth/logout": "revokes the system refresh token supplied in the body",
  "POST auth/login": "staff login",
  "POST auth/logout": "revokes the refresh token supplied in the body",
  "POST auth/refresh": "exchanges a refresh token",
  "POST auth/activate": "staff activation by OTP",
  "POST auth/activate/request-otp": "staff activation OTP",
  "POST auth/check-email": "signup pre-check",
  "POST auth/password/request-otp": "forgot password",
  "POST auth/password/reset": "forgot password",
  "POST auth/signup": "tenant signup",
  "POST auth/signup/request-otp": "tenant signup OTP",
  "GET auth/signup/address": "signup address lookup",
  "GET auth/signup/lookup": "signup registry lookup",
  // --- Сүлжээний шалгалт: DB-д хүрэхгүй, зөвхөн { ok: true } (app/api/v1/app/health/route.ts)
  "GET app/health": "reachability probe, no DB access, no data",
  // --- Нийтийн каталог (захиалгын өмнө харуулна; IP rate limit)
  "GET app/booking-fee": "public booking fee",
  "GET app/branch-tags": "public catalog",
  "GET app/service-keys": "public catalog",
  "GET app/orgs": "public catalog",
  "GET app/orgs/map": "public catalog",
  "GET app/orgs/[slug]": "public catalog",
  "GET app/branches/[branchId]/availability": "public slots",
  "GET app/branches/[branchId]/reviews": "public reviews (POST on the same route is authenticated)",
  // --- QPay webhook: тайлан нь QPay-ээс ирдэг, төлбөрийг QPay-ийн API-аар дахин баталгаажуулдаг
  "GET appointments/qpay/callback": "QPay webhook",
  "POST appointments/qpay/callback": "QPay webhook",
  "GET subscriptions/qpay/callback": "QPay webhook",
  "POST subscriptions/qpay/callback": "QPay webhook",
};

/** Нэвтрэлтийг handler-ийн оронд тусдаа helper хийдэг route-ууд: тэр helper нь жинхэнэ auth дуудах ёстой. */
const AUTH_HELPERS = ["authForItem", "systemManaged"];

function helperAuthenticates(source: string, name: string): boolean {
  const at = source.search(new RegExp(`(?:async )?function ${name}\\b`));
  if (at === -1) return false;
  const rest = source.slice(at);
  const next = rest.slice(10).search(/\n(?:export )?(?:async )?function /);
  const body = next === -1 ? rest : rest.slice(0, next + 10);
  return AUTH_CALL.test(body);
}

test("every /api/v1 handler authenticates, or is on the explicit public list", () => {
  const offenders: string[] = [];
  for (const h of handlers()) {
    const key = `${h.method} ${h.route}`;
    if (key in PUBLIC) continue;
    const direct = AUTH_CALL.test(h.body);
    const viaHelper = AUTH_HELPERS.some((name) => h.body.includes(`${name}(`) && helperAuthenticates(h.source, name));
    if (!direct && !viaHelper) offenders.push(key);
  }
  assert.deepEqual(offenders, [], `handlers with no authentication and not on the public list:\n${offenders.join("\n")}`);
});

test("the public list has no stale entries and nothing on it secretly authenticates (keep it honest)", () => {
  const all = new Map(handlers().map((h) => [`${h.method} ${h.route}`, h]));
  for (const key of Object.keys(PUBLIC)) {
    const h = all.get(key);
    assert.ok(h, `public list entry no longer exists: ${key}`);
    // a handler that authenticates does not belong on the "public" list — drop the entry
    assert.doesNotMatch(h!.body, AUTH_CALL, `${key} authenticates; remove it from the public list`);
  }
});

test("public catalog and login routes are rate limited", () => {
  const needLimit = Object.keys(PUBLIC).filter(
    (k) => k.includes("app/") && !k.includes("qpay") && !k.startsWith("POST app/auth/") && k !== "GET app/health",
  );
  const all = new Map(handlers().map((h) => [`${h.method} ${h.route}`, h]));
  for (const key of needLimit) {
    assert.match(all.get(key)!.body, /enforceRateLimit\(/, `${key} must be rate limited`);
  }
  for (const key of Object.keys(PUBLIC).filter((k) => k.startsWith("POST app/auth/") || k.startsWith("POST auth/"))) {
    // logout/refresh are bound to a secret token; the rest take guessable inputs and must be limited
    if (key.endsWith("auth/logout") || key.endsWith("auth/refresh")) continue;
    assert.match(all.get(key)!.source, /enforceRateLimit\(/, `${key} must be rate limited`);
  }
});

/** Зориудаар cash.manage-аас зөөлөн: төлбөр бүртгэх (payments.create) ажилтан ээлж нээлттэй эсэхийг мэдэх ёстой. */
const CASH_SOFT = "cash/sessions/open-flag";

test("every cash route goes through the cash.manage gate (except the documented open-flag)", () => {
  const cash = handlers().filter((h) => h.route.startsWith("cash/"));
  assert.ok(cash.length >= 15, "expected the cash routes to be present");
  for (const h of cash) {
    if (h.route === CASH_SOFT) continue;
    assert.match(h.body, /requireCashApiUser\(/, `${h.method} ${h.route} must use requireCashApiUser`);
  }
  // open-flag still authenticates and enforces payments.create OR cash.manage inside the service
  const flag = cash.find((h) => h.route === CASH_SOFT)!;
  assert.match(flag.body, /requireApiUser\(req\)/);
  assert.match(flag.body, /branchCashSessionOpen\(auth\.user,/);
  const session = readFileSync(resolve(here, "../lib/cash/session.ts"), "utf8");
  const fn = session.slice(session.indexOf("export async function branchCashSessionOpen"));
  assert.match(fn.slice(0, 260), /!hasPermission\(actor, "payments\.create"\) && !hasPermission\(actor, "cash\.manage"\)\) throw cashForbidden\(\)/);
  // …and that gate really is auth + permission
  const http = readFileSync(resolve(here, "../lib/cash/http.ts"), "utf8");
  assert.match(http, /requireApiUser\(req\)/);
  assert.match(http, /hasPermission\(auth\.user, "cash\.manage"\)/);
});

test("customer-realm /api/v1/app routes authenticate with the ACCOUNT token, staff routes with the user token", () => {
  for (const h of handlers()) {
    if (`${h.method} ${h.route}` in PUBLIC) continue;
    const isApp = h.route.startsWith("app/");
    const isSystem = h.route.startsWith("system/");
    if (isSystem) {
      // System realm: зөвхөн system token (requireSystemApiUser); ажилтан/Account token хүлээн авахгүй.
      assert.match(h.body, /requireSystemApiUser\(req/, `${h.method} ${h.route}: system route must use the system token`);
      assert.doesNotMatch(h.body, /requireApiUser\(|getApiAccountFromRequest\(|authenticateAccountRequest\(|requireCashApiUser\(/, `${h.method} ${h.route}: system route must not accept other realms' tokens`);
    } else if (isApp) {
      assert.ok(
        /getApiAccountFromRequest\(|authenticateAccountRequest\(/.test(h.body) || /requireApiAccount\(/.test(h.body) || AUTH_HELPERS.some((n) => h.body.includes(`${n}(`)),
        `${h.method} ${h.route}: customer route must use the account token`,
      );
      assert.doesNotMatch(h.body, /requireApiUser\(/, `${h.method} ${h.route}: customer route must not accept a staff token`);
    } else {
      assert.doesNotMatch(h.body, /getApiAccountFromRequest\(|authenticateAccountRequest\(|requireSystemApiUser\(/, `${h.method} ${h.route}: staff route must not accept an account or system token`);
    }
  }
});
