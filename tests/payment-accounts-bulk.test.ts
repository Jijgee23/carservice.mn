import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";

process.env.DATABASE_URL ??= "postgresql://unused/unused";
process.env.SESSION_SECRET ??= "unit-test-placeholder-secret-value-not-real-00";

const src = (rel: string) => readFile(new URL(`../${rel}`, import.meta.url), "utf8").then((s) => s.replace(/\r\n/g, "\n"));

test("bulk delete only removes unreferenced accounts; «Бэлэн» and in-use ones are reported, not deleted", async () => {
  const s = await src("lib/payment-account-service.ts");
  const fn = s.slice(s.indexOf("export async function deletePaymentAccounts"), s.indexOf("export async function setPaymentAccountsActive"));
  assert.match(fn, /assertManage\(input\.actor\)/);
  assert.match(fn, /if \(row\.type === "CASH"\) return \{ id, name: row\.name, status: "cash"/);
  for (const model of ["orderPayment", "cashTransaction", "postpaidSettlement"]) {
    assert.match(fn, new RegExp(`tx\\.${model}\\.count\\(\\{ where: \\{ tenantId, bankId: id \\} \\}\\)`), model);
  }
  assert.ok(fn.indexOf("if (usage > 0)") < fn.indexOf("tx.paymentAccount.delete("), "usage check before delete");
  assert.match(fn, /action: "DELETE"/);
  // A payment that lands between the count and the delete hits the Restrict FK.
  assert.match(fn, /code === "P2003"/);
});

test("bulk ids: deduped, non-empty, capped", async () => {
  const s = await src("lib/payment-account-service.ts");
  assert.match(s, /export const PAYMENT_ACCOUNT_BULK_MAX = 200;/);
  assert.match(s, /\[\.\.\.new Set\(ids\.filter/);
});

test("UI: shared row selection (checkbox, mouse drag, right-click menu); «Бэлэн» not selectable; delete is confirmed", async () => {
  const ui = await src("app/dashboard/payment_methods/payment-accounts-list.tsx");
  assert.match(ui, /const selectable = \(a: PaymentAccountDto\) => a\.type !== "CASH";/);
  // Same building blocks as the orders / employees / appointments bulk tables.
  assert.match(ui, /const selection = useRowSelection\(rows\.filter\(selectable\)\);/);
  assert.match(ui, /<SelectionActions selection=\{selection\} noun="төлбөрийн арга" actions=\{bulkActions\} \/>/);
  assert.match(ui, /<SelectAllCell selection=\{selection\}/);
  assert.match(ui, /<SelectRowCell selection=\{selection\} id=\{a\.id\}/);
  assert.match(ui, /<tbody \{\.\.\.selection\.dragArea\}>/);
  assert.match(ui, /\{ label: "Устгах", onSelect: \(\) => setConfirmDelete\(true\)/);
  assert.match(ui, /bulkDeletePaymentAccountsAction\(ids\)/);
  assert.match(ui, /bulkSetPaymentAccountsActiveAction\(ids, op === "activate"\)/);
});

test("API: DELETE maps in-use to 409 PAYMENT_ACCOUNT_IN_USE", async () => {
  const route = await src("app/api/v1/payment-accounts/[id]/route.ts");
  assert.match(route, /export async function DELETE\(/);
  assert.match(route, /hasPermission\(auth\.user, "cash\.manage"\)/);
  assert.match(route, /jsonError\(409, [^)]*code: "PAYMENT_ACCOUNT_IN_USE"/);
});
