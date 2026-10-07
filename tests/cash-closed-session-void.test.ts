import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

process.env.DATABASE_URL ??= "postgresql://unused/unused";
process.env.SESSION_SECRET ??= "unit-test-placeholder-secret-value-not-real-00";

const read = (p: string) => readFile(new URL(`../${p}`, import.meta.url), "utf8");

test("B1: safeCashActionMessage passes domain errors, hides everything else behind the generic message", async () => {
  const { safeCashActionMessage } = await import("../lib/cash/action-failure");
  const { CashError } = await import("../lib/cash/rules");
  const { PaymentBankError } = await import("../lib/banks");
  const { SUBSCRIPTION_LOCKED_MESSAGE } = await import("../lib/subscription");
  const generic = "Серверийн алдаа гарлаа. Дахин оролдоно уу.";
  const logged: unknown[][] = [];
  const original = console.error;
  console.error = (...a: unknown[]) => { logged.push(a); };
  try {
    assert.equal(safeCashActionMessage("t", new CashError("Касс нээгээгүй.", 409, "CASH_SESSION_CLOSED")), "Касс нээгээгүй.");
    assert.equal(safeCashActionMessage("t", new PaymentBankError("Банк сонгоно уу.", "PAYMENT_BANK_REQUIRED")), "Банк сонгоно уу.");
    assert.equal(safeCashActionMessage("t", new Error(SUBSCRIPTION_LOCKED_MESSAGE)), SUBSCRIPTION_LOCKED_MESSAGE);
    assert.equal(logged.length, 0);
    const leak = new Error('ENOENT: open "C:\\srv\\uploads\\cash\\t1\\x.png" / column "tenantId"');
    assert.equal(safeCashActionMessage("t", leak), generic);
    assert.equal(safeCashActionMessage("t", leak, "Хадгалахад алдаа."), "Хадгалахад алдаа.");
    assert.equal(safeCashActionMessage("t", "boom"), generic);
    assert.ok(!JSON.stringify(logged).includes("ENOENT"), "message is never logged, only the name");
  } finally {
    console.error = original;
  }
});

test("B1/B6: cash actions use the safe helper; order-payment actions assert an active subscription", async () => {
  for (const f of ["app/_actions/cash.ts", "app/_actions/cash-settlements.ts"]) {
    const text = await read(f);
    assert.ok(text.includes("safeCashActionMessage"), f);
    assert.ok(!/message: error\.message \}/.test(text.replace(/if \(error instanceof CashError\)[^\n]*/g, "")), `${f} returns no raw error.message`);
  }
  const op = await read("app/_actions/order-payments.ts");
  for (const fn of ["createOrderQPayInvoiceAction", "checkOrderQPayPaymentAction", "cancelOrderQPayPaymentAction", "recordOrderPaymentAction", "reverseOrderPaymentAction"]) {
    const start = op.indexOf(`export async function ${fn}`);
    const end = op.indexOf("\nexport async function", start + 10);
    assert.match(op.slice(start, end === -1 ? undefined : end), /await assertActiveSubscription\(user\.tenantId\)/, fn);
  }
  assert.match(op, /knownAuthorizationMessage\(error\)/);
});

test("B1: UploadValidationError messages (type/size/empty) pass through the safe helper", async () => {
  const { safeCashActionMessage } = await import("../lib/cash/action-failure");
  const { UploadValidationError, validateUpload } = await import("../lib/storage");
  const big = new File([new Uint8Array(3 * 1024 * 1024)], "a.png", { type: "image/png" });
  assert.throws(() => validateUpload(big), UploadValidationError);
  assert.equal(safeCashActionMessage("t", new UploadValidationError("Файлын хэмжээ 2MB-аас хэтэрсэн байна.")), "Файлын хэмжээ 2MB-аас хэтэрсэн байна.");
});
