import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

// Ажилтны мобайл апп-ын тохиргооны endpoint-ууд (2026-11-11):
//   /api/v1/subscription (+ qpay, qpay/check, quote), /api/v1/tenant/qpay,
//   /api/v1/branches/[id]/schedules(/[scheduleId]), /api/v1/branches/schedules/holiday.
// Source-pattern (tests/reports-routes.test.ts-ийн загвараар): auth → эрх →
// (subscription lock) → lib дуудлага дараалал, вэб action-ууд ижил lib-ийг
// дууддаг ("moved, not forked"); + 401 behavioural + цэвэр helper-ууд.

process.env.DATABASE_URL ??= "postgresql://unused/unused";
process.env.SESSION_SECRET ??= "unit-test-placeholder-secret-value-not-real-00";

function src(relPath: string): string {
  return readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "..", relPath), "utf8").replace(/\r\n/g, "\n");
}

/** `export async function METHOD(` -ээс дараагийн export хүртэлх хэсэг. */
function handler(source: string, method: string): string {
  const start = source.indexOf(`export async function ${method}(`);
  assert.ok(start >= 0, `${method} handler not found`);
  const next = source.indexOf("\nexport ", start + 1);
  return source.slice(start, next === -1 ? undefined : next);
}

function assertOrder(body: string, needles: string[], label: string) {
  let prev = -1;
  for (const n of needles) {
    const i = body.indexOf(n);
    assert.ok(i > prev, `${label}: expected "${n}" after previous gate`);
    prev = i;
  }
}

const OWNER_ROUTES: Array<[string, string[]]> = [
  ["app/api/v1/subscription/qpay/route.ts", ["POST", "DELETE"]],
  ["app/api/v1/subscription/qpay/check/route.ts", ["POST"]],
  ["app/api/v1/subscription/quote/route.ts", ["POST"]],
  ["app/api/v1/tenant/qpay/route.ts", ["GET", "PUT", "PATCH", "DELETE"]],
];

for (const [file, methods] of OWNER_ROUTES) {
  test(`${file}: auth first, then owner-only, never subscription-locked`, () => {
    const source = src(file);
    // Багц дууссан үед ч сунгах/тохируулах боломжтой байх ёстой.
    assert.doesNotMatch(source, /requireActiveSubscriptionApi\(/);
    for (const m of methods) {
      const body = handler(source, m);
      assertOrder(
        body,
        ["requireApiUser(req)", "if (auth.response) return auth.response;", "if (!auth.user.isOwner) return jsonForbidden("],
        `${file} ${m}`,
      );
    }
  });
}

test("subscription/tenant paths are outside API_MODULE_PATHS (reachable on every plan)", async () => {
  const { API_MODULE_PATHS, firstDisabledModule } = await import("../lib/plan-modules");
  for (const p of [
    "/api/v1/subscription",
    "/api/v1/subscription/qpay",
    "/api/v1/subscription/qpay/check",
    "/api/v1/subscription/quote",
    "/api/v1/tenant/qpay",
    "/api/v1/branches/b1/schedules",
    "/api/v1/branches/schedules/holiday",
  ]) {
    assert.equal(firstDisabledModule(p, API_MODULE_PATHS, new Set()), null, p);
  }
});

const SCHEDULE_MUTATIONS: Array<[string, string]> = [
  ["app/api/v1/branches/[id]/schedules/route.ts", "POST"],
  ["app/api/v1/branches/[id]/schedules/[scheduleId]/route.ts", "PATCH"],
  ["app/api/v1/branches/[id]/schedules/[scheduleId]/route.ts", "DELETE"],
  ["app/api/v1/branches/schedules/holiday/route.ts", "POST"],
];

for (const [file, method] of SCHEDULE_MUTATIONS) {
  test(`${file} ${method}: auth → branches.edit → subscription lock → command`, () => {
    const body = handler(src(file), method);
    assertOrder(
      body,
      [
        "requireApiUser(req)",
        "if (auth.response) return auth.response;",
        'requirePermission(auth.user, "branches.edit")',
        "if (denied) return denied;",
        "await requireActiveSubscriptionApi(auth.user)",
        "if (locked) return locked;",
      ],
      `${file} ${method}`,
    );
  });
}

test("GET /branches/[id]/schedules requires branches.edit like the web schedule page", () => {
  const body = handler(src("app/api/v1/branches/[id]/schedules/route.ts"), "GET");
  assertOrder(body, ["requireApiUser(req)", 'requirePermission(auth.user, "branches.edit")', "getBranchSchedules("], "GET schedules");
  assert.match(src("app/dashboard/branches/[id]/schedule/page.tsx"), /canEdit\(user, "branches"\)/);
});

// --- web actions delegate to the shared lib (moved, not forked)

test("web subscription payment actions call lib/subscription-payments", () => {
  const s = src("app/_actions/subscription-payments.ts");
  assert.match(s, /createSubscriptionQPayPayment\(user, /);
  assert.match(s, /checkTenantSubscriptionPayment\(\s*user\.tenantId/);
  assert.match(s, /cancelTenantSubscriptionPayment\(user, paymentId\)/);
  assert.doesNotMatch(s, /QPayService\./, "QPay calls live in lib/subscription-payments.ts");
  const create = handler(s, "createSubscriptionPaymentAction");
  assertOrder(create, ["requireUser()", "if (!user.isOwner)", "createSubscriptionQPayPayment("], "web create");
});

test("lib subscription payment create keeps provider errors server-side and stays self-serve only", () => {
  const lib = src("lib/subscription-payments.ts");
  const body = handler(lib, "createSubscriptionQPayPayment");
  assert.match(body, /isSelfServePlan\(price\.plan\)/);
  assert.doesNotMatch(body, /message: inv\.error/);
  assert.match(body, /where: \{ id: planPriceId, isActive: true \}/);
  const cancel = handler(lib, "cancelTenantSubscriptionPayment");
  assert.match(cancel, /tenantId: actor\.tenantId, status: "PENDING"/);
  const check = handler(lib, "checkTenantSubscriptionPayment");
  assert.match(check, /where: \{ id: paymentId, tenantId \}/);
});

test("web quote action and API share parse + save + rate-limit bucket", () => {
  const action = src("app/_actions/quote-requests.ts");
  assert.match(action, /parseQuoteRequestInput\(values\)/);
  assert.match(action, /saveQuoteRequest\(parsed\.data, tenantId\)/);
  assert.match(action, /QUOTE_REQUEST_RATE_BUCKET/);
  const route = src("app/api/v1/subscription/quote/route.ts");
  assertOrder(
    handler(route, "POST"),
    ["enforceRateLimit(req, QUOTE_REQUEST_RATE_BUCKET, QUOTE_REQUEST_RATE_LIMIT)", "parseQuoteRequestInput(", "saveQuoteRequest(parsed.data, auth.user.tenantId)"],
    "quote POST",
  );
  assert.match(src("lib/quote-requests-server.ts"), /setBypassContext\(\);\s*const created = await prisma\.quoteRequest\.create/);
});

test("web tenant QPay actions call lib/tenant-qpay-settings; GET never exposes secrets", () => {
  const action = src("app/_actions/tenant-qpay.ts");
  assert.match(action, /saveTenantQPay\(user, \{/);
  assert.match(action, /deleteTenantQPay\(user\)/);
  assert.match(action, /setTenantQPayEnabled\(user, enabled\)/);
  assert.doesNotMatch(action, /prisma\./);
  const lib = src("lib/tenant-qpay-settings.ts");
  const get = handler(lib, "getTenantQPayConfig");
  assert.match(get, /hasPassword: Boolean\(row\.password\)/);
  assert.doesNotMatch(get, /password: row\.password|accessToken|refreshToken/);
  assert.match(handler(lib, "saveTenantQPay"), /encryptSecret\(password\)/);
  const route = src("app/api/v1/tenant/qpay/route.ts");
  assert.match(route, /getTenantQPayConfig\(tenantId\)/);
  assert.doesNotMatch(route, /tenantQPaySettings/, "route must go through the lib (no raw row)");
});

test("web branch-schedule actions call lib/branch-schedule-commands", () => {
  const action = src("app/_actions/branch-schedules.ts");
  assert.match(action, /upsertBranchScheduleException\(auth\.user, branchId, formData, confirmed\)/);
  assert.match(action, /upsertBranchScheduleSeason\(auth\.user, branchId, formData, confirmed\)/);
  assert.match(action, /deleteBranchScheduleException\(user, branchId, id\)/);
  assert.match(action, /deleteBranchScheduleSeason\(user, branchId, id\)/);
  assert.match(action, /applyHolidayToAllBranches\(user, formData, confirmed\)/);
  assert.doesNotMatch(action, /\$transaction\(/, "transactions live in the lib");
});

test("GET /api/v1/subscription exposes the plan's effective modules and renewal prices", () => {
  const source = src("app/api/v1/subscription/route.ts");
  assert.match(source, /getEnabledModules\(p\)/);
  assert.match(source, /modules: modulesByPlan\[plan\]/);
  assert.match(source, /plan: \{ in: \[\.\.\.SELF_SERVE_PLANS\] \}/);
  assert.match(source, /isOwner\s*\?\s*prisma\.subscriptionPayment\.findFirst/, "pending QR only for the owner");
  assert.doesNotMatch(source, /requireActiveSubscriptionApi\(/);
});

// --- behavioural: no Authorization header → 401 before anything else

test("every new handler answers 401 without a token", async () => {
  const [sub, qpay, check, quote, tqpay, sched, schedItem, holiday] = await Promise.all([
    import("../app/api/v1/subscription/route"),
    import("../app/api/v1/subscription/qpay/route"),
    import("../app/api/v1/subscription/qpay/check/route"),
    import("../app/api/v1/subscription/quote/route"),
    import("../app/api/v1/tenant/qpay/route"),
    import("../app/api/v1/branches/[id]/schedules/route"),
    import("../app/api/v1/branches/[id]/schedules/[scheduleId]/route"),
    import("../app/api/v1/branches/schedules/holiday/route"),
  ]);
  const req = (method: string) =>
    new Request("http://x/api/v1/any", { method, body: method === "GET" ? undefined : "{}" });
  const params = { params: Promise.resolve({ id: "b1", scheduleId: "s1" }) };
  const calls: Array<Promise<Response>> = [
    sub.GET(req("GET")),
    qpay.POST(req("POST")),
    qpay.DELETE(req("DELETE")),
    check.POST(req("POST")),
    quote.POST(req("POST")),
    tqpay.GET(req("GET")),
    tqpay.PUT(req("PUT")),
    tqpay.PATCH(req("PATCH")),
    tqpay.DELETE(req("DELETE")),
    sched.GET(req("GET"), params),
    sched.POST(req("POST"), params),
    schedItem.PATCH(req("PATCH"), params),
    schedItem.DELETE(req("DELETE"), params),
    holiday.POST(req("POST")),
  ];
  for (const res of await Promise.all(calls)) assert.equal(res.status, 401);
});

// --- pure helpers: JSON body → web FormData shape, field error mapping

test("exceptionBodyToFormData maps JSON to the web form fields and merges a base on PATCH", async () => {
  const { exceptionBodyToFormData } = await import("../lib/branch-schedule-commands");
  const fd = exceptionBodyToFormData({ date: "2026-12-31", isOpen: true, openTime: "10:00", closeTime: "14:00", label: "Шинэ жил" });
  assert.equal(fd.get("date"), "2026-12-31");
  assert.equal(fd.get("exception_isOpen"), "on");
  assert.equal(fd.get("exception_openTime"), "10:00");
  assert.equal(fd.get("exception_closeTime"), "14:00");
  assert.equal(fd.get("label"), "Шинэ жил");
  assert.equal(fd.get("exceptionId"), null);

  const closed = exceptionBodyToFormData({ date: "2026-12-31", isOpen: false });
  assert.equal(closed.get("exception_isOpen"), null, "closed day sends no isOpen=on, like an unchecked box");

  const patched = exceptionBodyToFormData(
    { label: "Засварласан" },
    { exceptionId: "e1", base: { date: "2026-01-01", isOpen: true, openTime: "09:00", closeTime: "13:00", label: "Хуучин" } },
  );
  assert.equal(patched.get("exceptionId"), "e1");
  assert.equal(patched.get("date"), "2026-01-01");
  assert.equal(patched.get("exception_isOpen"), "on");
  assert.equal(patched.get("exception_openTime"), "09:00");
  assert.equal(patched.get("label"), "Засварласан");
});

test("seasonBodyToFormData fills every weekday; missing days fall back to the base (or closed)", async () => {
  const { seasonBodyToFormData } = await import("../lib/branch-schedule-commands");
  const fd = seasonBodyToFormData({
    name: "Өвөл",
    startsOn: "2026-12-01",
    endsOn: "2027-03-01",
    days: { MON: { isOpen: true, openTime: "10:00", closeTime: "18:00" } },
  });
  assert.equal(fd.get("name"), "Өвөл");
  assert.equal(fd.get("season_MON_isOpen"), "on");
  assert.equal(fd.get("season_MON_openTime"), "10:00");
  assert.equal(fd.get("season_TUE_isOpen"), null);
  assert.equal(fd.get("season_SUN_openTime"), "");

  const closedDay = { isOpen: false, openTime: null, closeTime: null };
  const base = {
    name: "Зун",
    startsOn: "2026-06-01",
    endsOn: "2026-09-01",
    days: {
      MON: closedDay, TUE: { isOpen: true, openTime: "08:00", closeTime: "20:00" }, WED: closedDay,
      THU: closedDay, FRI: closedDay, SAT: closedDay, SUN: closedDay,
    },
  };
  const patched = seasonBodyToFormData({ days: { MON: { isOpen: true, openTime: "09:00", closeTime: "17:00" } } }, { seasonId: "s1", base });
  assert.equal(patched.get("seasonId"), "s1");
  assert.equal(patched.get("name"), "Зун");
  assert.equal(patched.get("season_MON_openTime"), "09:00");
  assert.equal(patched.get("season_TUE_isOpen"), "on", "untouched day keeps its current hours");
  assert.equal(patched.get("season_TUE_closeTime"), "20:00");
});

test("scheduleFieldErrorsToJson renames web form keys to JSON field names", async () => {
  const { scheduleFieldErrorsToJson } = await import("../lib/branch-schedule-commands");
  assert.deepEqual(
    scheduleFieldErrorsToJson({
      date: "a",
      exception_openTime: "b",
      exception_closeTime: "c",
      season_MON_closeTime: "d",
      startsOn: "e",
    }),
    { date: "a", openTime: "b", closeTime: "c", "days.MON.closeTime": "d", startsOn: "e" },
  );
});
