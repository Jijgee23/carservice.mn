import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const read = (rel: string) => readFileSync(new URL(`../${rel}`, import.meta.url), "utf8");

for (const resource of ["branches", "employees"] as const) {
  test(`${resource} Excel export requires ${resource} view permission before querying`, () => {
    const source = read(`app/dashboard/${resource}/export/route.ts`);
    const guard = source.indexOf(`if (!canView(user, "${resource}")) return new Response("Forbidden", { status: 403 });`);
    assert.ok(guard > 0, "canView guard missing");
    assert.ok(guard < source.indexOf("prisma."), "guard must run before any query");
  });
}

test("system QPay page never sends the merchant password to the client", () => {
  const page = read("app/system/(authed)/qpay/page.tsx");
  const form = read("app/system/(authed)/qpay/qpay-form.tsx");
  assert.doesNotMatch(page, /password:\s*decryptSecret/);
  assert.match(page, /hasPassword: Boolean\(decryptSecret\(settings\?\.password\)\)/);
  assert.doesNotMatch(form, /defaultValue=\{initial\.password\}/);
});

test("system QPay save keeps the stored password when the field is left blank", () => {
  const action = read("app/_actions/system-qpay.ts");
  assert.match(action, /const password = passwordInput \|\| decryptSecret\(existing\?\.password\) \|\| "";/);
});

test("postpaid page applies the own-orders read scope to totals and history", () => {
  const page = read("app/dashboard/orders/postpaid/page.tsx");
  const scope = page.slice(page.indexOf("const orderScope"), page.indexOf("const orderScope") + 400);
  assert.match(scope, /\.\.\.orderReadWhere\(user\)/);
  assert.match(page, /ownScoped \? links\.filter\(\(l\) => sumByVehicle\.has\(l\.vehicle\.id\)\) : links/);
});

test("order diagnostics/new page checks view, branch scope and edit access before rendering", () => {
  const page = read("app/dashboard/orders/[id]/diagnostics/new/page.tsx");
  assert.match(page, /if \(!canView\(user, "orders"\)\) redirect\("\/dashboard"\);/);
  assert.match(page, /\.\.\.\(scopeBranchId \? \{ branchId: scopeBranchId \} : \{\}\)/);
  assert.match(page, /if \(!canEditOrder\(user, order\)\) redirect/);
});

test("customer web reschedule accepts the slot picker's ISO timestamp", () => {
  const src = read("app/_actions/appointments.ts");
  const fn = src.slice(src.indexOf("export async function rescheduleAppointmentByAccount("));
  const body = fn.slice(0, fn.indexOf("rescheduleAppointmentByAccountCore("));
  assert.match(body, /const requestedAt = new Date\(requestedRaw\);/);
  assert.doesNotMatch(body, /parseBusinessLocalDateTime/);
  const iso = new Date("2026-09-25T02:00:00.000Z");
  assert.ok(Number.isFinite(new Date(iso.toISOString()).getTime()));
});

test("ConfirmForm surfaces returned or thrown action errors instead of crashing", () => {
  const form = read("app/_components/confirm-form.tsx");
  assert.match(form, /action=\{run\}/);
  assert.match(form, /unstable_rethrow\(error\)/);
  assert.match(form, /result\.error/);
});

const confirmActions: Array<[string, string]> = [
  ["app/_actions/customers.ts", "deleteCustomerAction"],
  ["app/_actions/vehicles.ts", "deleteVehicleAction"],
  ["app/_actions/diagnostic-reports.ts", "deleteReportAction"],
  ["app/_actions/units.ts", "deleteUnitAction"],
  ["app/_actions/branches.ts", "deleteBranchAction"],
  ["app/_actions/branch-schedules.ts", "deleteBranchScheduleExceptionAction"],
  ["app/_actions/branch-schedules.ts", "deleteBranchScheduleSeasonAction"],
  ["app/_actions/employees.ts", "deleteEmployeeAction"],
  ["app/_actions/employees.ts", "resetEmployeePasswordAction"],
  ["app/_actions/roles.ts", "deleteRoleAction"],
  ["app/_actions/system-admins.ts", "setSuperAdminActiveAction"],
  ["app/_actions/system-subscriptions.ts", "extendSubscriptionAction"],
  ["app/_actions/system-subscriptions.ts", "cancelSubscriptionAction"],
];
for (const [file, name] of confirmActions) {
  test(`${name} returns expected errors instead of throwing them`, () => {
    const src = read(file);
    const start = src.indexOf(`export async function ${name}(`);
    assert.ok(start >= 0);
    const next = src.indexOf("\nexport ", start + 1);
    const body = src.slice(start, next === -1 ? undefined : next);
    assert.match(body, /Promise<ConfirmActionResult>/);
    assert.doesNotMatch(body, /throw new Error\(/);
  });
}

test("template duplicate keeps category (tenant-owned only), price and duration", () => {
  const src = read("app/_actions/diagnostic-templates.ts");
  const fn = src.slice(src.indexOf("export async function duplicateTemplateAction"));
  assert.match(fn, /where: \{ id: src\.categoryId, tenantId: user\.tenantId, OR: \[\{ kind: "DIAGNOSTIC" as const \}, \{ kind: null \}\] \}/);
  assert.match(fn, /categoryId,\s*price: src\.price,\s*durationMin: src\.durationMin,/);
});

test("bulk assign is only offered to users who can assign", () => {
  const src = read("app/dashboard/orders/bulk-orders-table.tsx");
  assert.match(src, /\.\.\.\(canAssign\s*\? \[\{\s*label: "Хариуцагч оноох"/);
});

test("booking form shows the branch picker whenever no branch is chosen, and clears a stale slot", () => {
  const src = read("app/(app)/org/[slug]/booking-form.tsx");
  assert.match(src, /branches\.length > 1 && \(categoryIds\.length > 0 \|\| !branchId\)/);
  assert.match(src, /setBranchId\(compatible\.length === 1 \? compatible\[0\]\.id : ""\);\s*\/\/[^\n]*\n\s*setSelectedIso\(""\);/);
});

test("tenant delete asks for confirmation and returns its errors", () => {
  const page = read("app/system/(authed)/tenants/[id]/page.tsx");
  assert.match(page, /<ConfirmForm\s+title="Байгууллагыг бүрмөсөн устгах"[\s\S]*?action=\{deleteTenantAction\}/);
  const action = read("app/_actions/system-tenants.ts");
  const fn = action.slice(action.indexOf("export async function deleteTenantAction"));
  assert.match(fn, /Promise<ConfirmActionResult>/);
  assert.doesNotMatch(fn.slice(0, fn.indexOf("redirect(")), /throw new Error\(/);
});

test("diagnostic fill link is only shown to users who can edit the order", () => {
  const src = read("app/dashboard/orders/[id]/order-items.tsx");
  assert.match(src, /needsReport && !cancelled && orderStarted && canEdit \?/);
});

test("cached auth helpers re-apply the tenant/bypass context on every call (cache hits too)", () => {
  const idx = read("lib/auth/index.ts");
  assert.match(idx, /export async function requireUser\(\) \{\s*const user = await loadCurrentUser\(\);\s*setTenantContext\(user\.tenantId\);/);
  const acc = read("lib/auth/account.ts");
  assert.match(acc, /export async function requireAccount\(\) \{\s*const result = await loadRequiredAccount\(\);\s*setBypassContext\(\);/);
  assert.match(acc, /export async function getAccount\(\) \{\s*const result = await loadOptionalAccount\(\);\s*if \(result\) setBypassContext\(\);/);
  const sys = read("lib/auth/system.ts");
  assert.match(sys, /export async function requireSuperAdmin\(\) \{\s*const result = await loadSuperAdmin\(\);\s*setBypassContext\(\);/);
});

test("ConfirmForm closes its host (row menu) only after the action finished", () => {
  const form = read("app/_components/confirm-form.tsx");
  const submit = form.slice(form.indexOf("function onSubmit("), form.indexOf("function confirm("));
  assert.doesNotMatch(submit, /onSubmitConfirmed/);
  const run = form.slice(form.indexOf("async function run("), form.indexOf("function close("));
  assert.ok(run.indexOf("await action(formData)") < run.indexOf("onSubmitConfirmed?.()"));
});

test("row menu stays open while its portaled confirm dialog is clicked", () => {
  const menu = read("app/_components/row-actions.tsx");
  assert.match(menu, /t\.closest\("\[data-confirm-dialog\]"\)\) return;/);
  const form = read("app/_components/confirm-form.tsx");
  assert.equal((form.match(/data-confirm-dialog/g) ?? []).length, 2);
});

test("branch delete is refused while employees are assigned (count + delete in one locked tx)", () => {
  const src = read("app/_actions/branches.ts");
  const fn = src.slice(src.indexOf("export async function deleteBranchAction"));
  assert.match(fn, /FOR UPDATE/);
  // Tombstoned (deleted) staff don't pin the branch — they only keep order FKs.
  assert.match(fn, /tx\.user\.count\(\{ where: \{ branchId: id, tenantId: user\.tenantId, deletedAt: null \} \}\)/);
  assert.ok(fn.indexOf("tx.user.count") < fn.indexOf("tx.branch.delete"));
  assert.match(fn, /ажилтан бүртгэлтэй/);
});

test("history (web + mobile) shows only fully paid completed orders; unpaid ones stay on the active list with a badge", () => {
  const unpaid = /NOT: \{ status: "COMPLETED", paymentStatus: \{ not: "PAID" \} \}/;
  assert.match(read("app/(app)/account/history/page.tsx"), unpaid);
  const api = read("app/api/v1/app/orders/route.ts");
  assert.equal((api.match(new RegExp(unpaid.source, "g")) ?? []).length, 2);
  const account = read("app/(app)/account/page.tsx");
  assert.match(account, /function outstandingLabel\(/);
  assert.match(account, /o\.status !== "COMPLETED" \|\| o\.paymentStatus === "PAID"/);
});

test("staff appointment responses expose the derived paymentStatus, not raw fee fields", () => {
  for (const file of ["app/api/v1/appointments/route.ts", "app/api/v1/appointments/[id]/route.ts"]) {
    const src = read(file);
    assert.match(src, /payment: \{ select: \{ status: true \} \},\n\} satisfies Prisma\.AppointmentSelect;/);
    assert.match(src, /const \{ feeAmount, feeQpayInvoiceId, feeUnderpaidAmount, payment, \.\.\.rest \} = a;/);
    assert.match(src, /paymentStatus: appointmentBookingPaymentStatus\(/);
  }
});

test("API template duplicate (tenant app) keeps category (tenant-owned only), price and duration", () => {
  const src = read("lib/diagnostics-templates-server.ts");
  const fn = src.slice(src.indexOf("export async function duplicateTemplateCommand"));
  assert.match(fn, /where: \{ id: src\.categoryId, tenantId: actor\.tenantId, OR: \[\{ kind: "DIAGNOSTIC" as const \}, \{ kind: null \}\] \}/);
  assert.match(fn, /categoryId,\s*price: src\.price,\s*durationMin: src\.durationMin,/);
});

test("every pre-login auth route sets the bypass context before touching the DB", () => {
  // lib/prisma.ts throws when no tenant context is set; a route that forgets
  // it 500s on every call (auth/logout did, so tokens were never revoked).
  for (const route of [
    "check-email",
    "login",
    "logout",
    "refresh",
    "activate",
    "activate/request-otp",
    "password/request-otp",
    "password/reset",
  ]) {
    const src = read(`app/api/v1/auth/${route}/route.ts`);
    const body = src.slice(src.indexOf("export async function POST("));
    const bypass = body.indexOf("setBypassContext();");
    assert.ok(bypass >= 0, `${route} must call setBypassContext()`);
    for (const dbCall of ["prisma.", "revokeRefreshToken(", "rotateRefreshToken("]) {
      const use = body.indexOf(dbCall);
      if (use >= 0) assert.ok(bypass < use, `${route}: setBypassContext() must run before ${dbCall}`);
    }
  }
});
