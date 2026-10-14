import assert from "node:assert/strict";
import { test } from "node:test";

process.env.DATABASE_URL ??= "postgresql://unused/unused";
process.env.SESSION_SECRET ??= "unit-test-placeholder-secret-value-not-real-00";

const accounts = [
  { id: "a1", type: "BANK_ACCOUNT" as const, name: "Хаан банк", accountNumber: "5012345678", terminalId: null, isTest: false },
  { id: "p1", type: "POS" as const, name: "Голомт POS", accountNumber: "5011111234", terminalId: "TID001", isTest: true },
];

test("rows: BANK_ACCOUNT -> transfer group, POS -> card group, each only once", async () => {
  const { buildPaymentRows } = await import("../app/dashboard/_components/payment-method-modal");
  const rows = buildPaymentRows(accounts, false, false);
  assert.deepEqual(rows.filter((r) => r.group === "transfer").map((r) => r.choice), [{ method: "BANK_TRANSFER", bank: "a1" }]);
  assert.deepEqual(rows.filter((r) => r.group === "card").map((r) => r.choice), [{ method: "CARD", bank: "p1" }]);
  assert.equal(rows.find((r) => r.choice.bank === "p1")?.label.includes("Туршилт"), true);
  assert.equal(rows[0].choice.method, "CASH");
  assert.equal(rows.at(-1)?.choice.method, "OTHER");
});

test("rows: registered CASH methods replace the built-in «Бэлэн» row; account numbers are shown in full", async () => {
  const { buildPaymentRows, choiceBankValue, paymentChoiceSummary } = await import("../app/dashboard/_components/payment-method-modal");
  const withCash = [...accounts, { id: "c1", type: "CASH" as const, name: "Касс 1", accountNumber: null, terminalId: null, isTest: false }];
  const rows = buildPaymentRows(withCash, false, false);
  assert.deepEqual(rows.filter((r) => r.choice.method === "CASH").map((r) => r.choice), [{ method: "CASH", bank: "c1" }]);
  assert.equal(rows.find((r) => r.choice.bank === "a1")?.label, "Хаан банк · 5012345678");
  assert.equal(paymentChoiceSummary({ method: "CASH", bank: "c1" }, withCash), "💵 Касс 1 · Бэлэн");
  assert.equal(choiceBankValue({ method: "CASH", bank: "c1" }), "c1");
  assert.equal(choiceBankValue({ method: "OTHER", bank: "x" }), "");
});

test("empty account list leaves only cash/other (+QPay)", async () => {
  const { buildPaymentRows } = await import("../app/dashboard/_components/payment-method-modal");
  assert.deepEqual(buildPaymentRows([], true, false).map((r) => r.choice.method), ["CASH", "QPAY", "OTHER"]);
});

test("summary resolves the label from the account list", async () => {
  const { paymentChoiceSummary } = await import("../app/dashboard/_components/payment-method-modal");
  assert.equal(paymentChoiceSummary({ method: "CARD", bank: "p1" }, accounts), "💳 Голомт POS · POS");
  assert.equal(paymentChoiceSummary({ method: "BANK_TRANSFER", bank: "a1" }, accounts), "🏦 Хаан банк · Данс");
  assert.equal(paymentChoiceSummary({ method: "BANK_TRANSFER", bank: "gone" }, accounts), "🏦 gone · Данс");
});

// Structural pins: each hop of the canManageAccounts chain, anchored to its own JSX element.
async function source(path: string): Promise<string> {
  const { readFileSync } = await import("node:fs");
  const raw = readFileSync(new URL(`../${path}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");
  // Comments must not satisfy a pin.
  return raw.replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

/** The opening tag of `<Tag ...>`, up to its closing `>` / `/>` (on a line of its own, or inline). */
function openingTag(src: string, tag: string): string {
  const start = src.search(new RegExp(`<${tag}\\b`));
  assert.notEqual(start, -1, `<${tag}> not found`);
  const rest = src.slice(start);
  const end = rest.search(/\n\s*\/?>|\/>/);
  assert.notEqual(end, -1, `<${tag}> has no end`);
  return rest.slice(0, end);
}

const PASSES = /\bcanManageAccounts(=\{[^}]+\}|(?=\s|$))/;
function passes(src: string, tag: string): boolean {
  return PASSES.test(openingTag(src, tag));
}
/** Same source with the prop removed from that one element: the pin must then fail (non-vacuity). */
function withoutHop(src: string, tag: string): string {
  const el = openingTag(src, tag);
  return src.replace(el, el.replace(/\s*\bcanManageAccounts(=\{[^}]+\})?/g, ""));
}

const HOPS: Array<[string, string]> = [
  ["app/dashboard/orders/[id]/page.tsx", "OrderPaymentsList"],
  ["app/dashboard/orders/[id]/order-payments-list.tsx", "PaymentMethodModal"],
  ["app/dashboard/cash/cash-list.tsx", "CashCreateButton"],
  ["app/dashboard/cash/cash-entry-dialog.tsx", "OrderPaymentTab"],
  ["app/dashboard/cash/cash-entry-dialog.tsx", "PaymentMethodModal"],
  ["app/dashboard/cash/order-payment-tab.tsx", "PaymentMethodPanel"],
  ["app/dashboard/orders/postpaid/page.tsx", "SettleButton"],
  ["app/dashboard/orders/postpaid/settle-dialog.tsx", "PaymentMethodModal"],
];

for (const [file, tag] of HOPS) {
  test(`canManageAccounts hop: ${file} <${tag}>`, async () => {
    const src = await source(file);
    assert.equal(passes(src, tag), true);
    assert.equal(passes(withoutHop(src, tag), tag), false, "pin is vacuous: still matches without the hop");
  });
}

test("server pages pass the cash.manage boolean (not a permission object)", async () => {
  const gate = /canManageAccounts=\{hasPermission\(user, "cash\.manage"\)\}/;
  assert.match(openingTag(await source("app/dashboard/orders/[id]/page.tsx"), "OrderPaymentsList"), gate);
  assert.match(openingTag(await source("app/dashboard/cash/cash-list.tsx"), "CashCreateButton"), gate);
});

test("forwarders: CashEntryForm / SettleForm take the prop they forward; SettleButton spreads props into SettleForm", async () => {
  const cash = await source("app/dashboard/cash/cash-entry-dialog.tsx");
  const settle = await source("app/dashboard/orders/postpaid/settle-dialog.tsx");
  assert.match(cash, /function CashEntryForm\(\{[^}]*\bcanManageAccounts\b/);
  assert.match(settle, /function SettleForm\(\{[^}]*\bcanManageAccounts\b/);
  assert.match(openingTag(settle, "SettleForm"), /\{\.\.\.props\}/);
  assert.equal(/\bcanManageAccounts\b/.test(settle.replace(/function SettleForm\(\{[^}]*\}/, "")), true);
});

test("modal gate: the add link renders only when props.canManageAccounts, inside the empty-accounts branch", async () => {
  const src = await source("app/dashboard/_components/payment-method-modal.tsx");
  const re =
    /banks\.length === 0 && !qpayOnly \? \([\s\S]*?PAYMENT_ACCOUNTS_EMPTY[\s\S]*?props\.canManageAccounts \? \([\s\S]*?href="\/dashboard\/payment_methods"[\s\S]*?PAYMENT_ACCOUNTS_ADD_LINK/;
  assert.match(src, re);
  assert.doesNotMatch(src.replace("props.canManageAccounts ?", "true ?"), re);
});
