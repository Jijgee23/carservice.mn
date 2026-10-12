import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";

const load = () => readFile(new URL("../scripts/payment-accounts-post-deploy.sql", import.meta.url), "utf8");
const stripComments = (sql: string) => sql.replace(/^\s*--.*$/gm, "");

test("post-deploy catch-up SQL is a bypass-RLS transaction, idempotent and non-destructive", async () => {
  const sql = stripComments(await load());
  assert.match(sql, /^\s*BEGIN;/);
  assert.match(sql, /COMMIT;\s*$/);
  assert.match(sql, /SET LOCAL app\.bypass_rls = 'on';/);
  assert.equal((sql.match(/\$\$/g) ?? []).length % 2, 0, "balanced $$ delimiters");
  assert.doesNotMatch(sql, /\b(DROP|DELETE|TRUNCATE)\b/i);
  const updates = sql.split(/;/).filter((stmt) => /^\s*UPDATE\b/i.test(stmt));
  assert.equal(updates.length, 4);
  for (const stmt of updates) {
    if (/"CashSessionMethodCount"/.test(stmt)) {
      assert.match(stmt, /NOT EXISTS \(SELECT 1 FROM "PaymentAccount" x WHERE x\."id" = m\.bank\)/);
      assert.match(stmt, /m\.bank <> ''/);
    } else {
      assert.match(stmt, /"bankId" IS NULL/);
    }
  }
  for (const table of ["OrderPayment", "CashTransaction", "PostpaidSettlement"]) {
    assert.match(sql, new RegExp(`UPDATE "${table}" o SET "bankId" = pa\.id`));
  }
});
