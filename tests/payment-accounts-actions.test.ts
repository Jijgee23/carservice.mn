import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";

const src = (rel: string) => readFile(new URL(`../${rel}`, import.meta.url), "utf8");

test("actions use the service, revalidate dashboard layout, and never leak raw errors", async () => {
  const s = await src("app/_actions/payment-accounts.ts");
  assert.match(s, /^"use server";/);
  assert.match(s, /createPaymentAccount/);
  assert.match(s, /updatePaymentAccount/);
  assert.match(s, /unstable_rethrow/);
  assert.match(s, /revalidatePath\("\/dashboard", "layout"\)/);
  assert.match(s, /instanceof PaymentAccountError/);
});

test("banks page lists accounts and offers add/edit/toggle; old checkbox form is gone", async () => {
  const page = await src("app/dashboard/payment_methods/page.tsx");
  assert.match(page, /Төлбөрийн аргууд/);
  assert.match(page, /listPaymentAccounts/);
  assert.doesNotMatch(page, /getTenantBanks|BanksForm/);
});

import { createPayloadFromForm, updatePayloadFromForm } from "../lib/payment-account-form";

const form = (entries: Record<string, string>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(entries)) fd.set(k, v);
  return fd;
};

test("actions source wires isTestPresent helper, active toggle, and never reads type on update", async () => {
  const s = await src("app/_actions/payment-accounts.ts");
  assert.match(s, /setPaymentAccountActiveAction/);
  assert.match(s, /updatePayloadFromForm/);
  const helper = await src("lib/payment-account-form.ts");
  assert.match(helper, /isTestPresent/);
  const upd = helper.slice(helper.indexOf("export function updatePayloadFromForm"));
  assert.doesNotMatch(upd, /"type"/);
});

test("page redirects (permission gate) before listing accounts", async () => {
  const page = await src("app/dashboard/payment_methods/page.tsx");
  assert.ok(page.indexOf("redirect(") !== -1 && page.indexOf("redirect(") < page.indexOf("listPaymentAccounts({"));
});

test("dialog keeps typed input on failure via the retained-form hook", async () => {
  const d = await src("app/dashboard/payment_methods/payment-account-dialog.tsx");
  assert.match(d, /useRetainedFormAction/);
  assert.doesNotMatch(d, /<form action=/);
});

test("update payload: unchecked POS test box becomes isTest:false; bank edit sends no POS keys; type ignored", () => {
  const pos = updatePayloadFromForm(form({ id: "a1", name: "X", accountNumber: "123456", terminalId: "T1", merchantId: "", isTestPresent: "1", type: "POS" }));
  assert.equal(pos.id, "a1");
  assert.equal(pos.data.isTest, false);
  assert.equal(pos.data.terminalId, "T1");
  assert.ok(!("type" in pos.data));
  const checked = updatePayloadFromForm(form({ id: "a1", name: "X", accountNumber: "123456", isTestPresent: "1", isTest: "on" }));
  assert.equal(checked.data.isTest, true);
  const bank = updatePayloadFromForm(form({ id: "b1", name: "Y", accountNumber: "123456" }));
  assert.deepEqual(Object.keys(bank.data).sort(), ["accountNumber", "name"]);
});

test("create payload: isTest only when checked", () => {
  assert.equal(createPayloadFromForm(form({ type: "POS", name: "n", accountNumber: "1", isTest: "on" })).isTest, true);
  assert.equal(createPayloadFromForm(form({ type: "POS", name: "n", accountNumber: "1" })).isTest, false);
});

test("I1: every action asserts an active subscription after requireUser and before the service call; known messages pass through", async () => {
  const s = await src("app/_actions/payment-accounts.ts");
  assert.match(s, /import \{ assertActiveSubscription \} from "@\/lib\/subscription-server";/);
  assert.match(s, /knownAuthorizationMessage\(error\)/);
  // Failure order: domain error, then known subscription/authorization message, then the generic fallback.
  assert.ok(s.indexOf("knownAuthorizationMessage(error)") < s.indexOf("Хадгалахад алдаа гарлаа."));
  const stripped = s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  for (const [name, call] of [
    ["createPaymentAccountAction", "createPaymentAccount("],
    ["updatePaymentAccountAction", "updatePaymentAccount("],
    ["setPaymentAccountActiveAction", "updatePaymentAccount("],
  ] as const) {
    const start = stripped.indexOf(`export async function ${name}`);
    assert.ok(start !== -1, name);
    const next = stripped.indexOf("export async function", start + 1);
    const body = stripped.slice(start, next === -1 ? undefined : next);
    const iUser = body.indexOf("requireUser()");
    const iSub = body.indexOf("assertActiveSubscription(user.tenantId)");
    const iCall = body.indexOf(call);
    assert.ok(iUser !== -1 && iSub > iUser && iCall > iSub, `${name}: requireUser -> assertActiveSubscription -> service`);
    // Mutation check: dropping the assertion must break the ordering predicate.
    const mutated = body.replace("assertActiveSubscription(user.tenantId)", "");
    assert.ok(!(mutated.indexOf("assertActiveSubscription(user.tenantId)") > mutated.indexOf("requireUser()")), `${name} mutation`);
  }
});

test("«Бэлэн» has no filter tab, is never offered in «Нэмэх», and has no on/off switch", async () => {
  const list = await src("app/dashboard/payment_methods/payment-accounts-list.tsx");
  assert.match(list, /PAYMENT_ACCOUNT_TYPES\.filter\(\(t\): t is Exclude<AccountType, "CASH"> => t !== "CASH"\)/);
  assert.match(list, /a\.type === "CASH" \? \(\s*<span[^>]*>\s*Үндсэн/);
  const dialog = await src("app/dashboard/payment_methods/payment-account-dialog.tsx");
  assert.match(dialog, /account\?\.type === "CASH" \? o\.value === "CASH" : o\.value !== "CASH"/);
});

test("signup creates the new tenant's «Бэлэн» in the same transaction", async () => {
  const auth = (await src("app/_actions/auth.ts")).replace(/\r\n/g, "\n");
  const tx = auth.slice(auth.indexOf("const tenant = await tx.tenant.create("));
  assert.match(tx.slice(0, 2000), /await ensureCashAccount\(tx, tenant\.id\)/);
});

test("QPay row: page reads TenantQPaySettings, switch is owner-only and flips the same enabled flag", async () => {
  const page = await src("app/dashboard/payment_methods/page.tsx");
  assert.match(page, /tenantQPaySettings\.findUnique/);
  assert.match(page, /canManageQpay=\{user\.isOwner\}/);
  // The stored password never reaches the client: only whether one exists, and only for the owner.
  assert.match(page, /hasPassword: Boolean\(qpay\.password\)/);
  assert.match(page, /qpay && user\.isOwner/);
  assert.doesNotMatch(page, /password: qpay\.password/);
  const list = await src("app/dashboard/payment_methods/payment-accounts-list.tsx");
  assert.match(list, /setTenantQPayEnabledAction/);
  assert.match(list, /canManageQpay \? <QPayDialog/);
  const dialog = await src("app/dashboard/payment_methods/qpay-dialog.tsx");
  assert.match(dialog, /saveTenantQPayAction/);
  assert.match(dialog, /deleteTenantQPayAction/);
  assert.doesNotMatch(dialog, /defaultValue=\{initial\.password\}/);
  // The old settings page only redirects to the payment methods page.
  const old = await src("app/dashboard/settings/qpay/page.tsx");
  assert.match(old, /redirect\("\/dashboard\/payment_methods"\)/);
  // Legacy /dashboard/banks only redirects to the new route.
  assert.match(await src("app/dashboard/banks/page.tsx"), /redirect\("\/dashboard\/payment_methods"\)/);
  assert.doesNotMatch(await src("app/_components/admin-sidebar.tsx"), /\/dashboard\/settings\/qpay/);
  const action = (await src("app/_actions/tenant-qpay.ts")).replace(/\r\n/g, "\n");
  const body = action.slice(action.indexOf("export async function setTenantQPayEnabledAction"));
  assert.match(body, /authorizeOwner\(\)/);
  assert.match(body, /tenantQPaySettings\.update\(\{ where: \{ tenantId: user\.tenantId \}, data: \{ enabled \} \}\)/);
  assert.match(body, /logAudit/);
  assert.match(body, /revalidatePath\("\/dashboard\/payment_methods"\)/);
});
