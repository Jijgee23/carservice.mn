import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";

const src = (rel: string) => readFile(new URL(`../${rel}`, import.meta.url), "utf8").then((s) => s.replace(/\r\n/g, "\n")); // schema.prisma is CRLF

test("schema declares PaymentAccount and the three bankId FKs", async () => {
  const schema = await src("prisma/schema.prisma");
  assert.match(schema, /enum PaymentAccountType\s*\{\s*CASH\s+BANK_ACCOUNT\s+POS\s*\}/);
  assert.match(schema, /model PaymentAccount \{/);
  for (const model of ["OrderPayment", "CashTransaction", "PostpaidSettlement"]) {
    const body = schema.slice(schema.indexOf(`model ${model} {`));
    const block = body.slice(0, body.indexOf("\n}\n"));
    assert.match(block, /bankId\s+String\?/, `${model}.bankId`);
    assert.match(block, /bankAccount\s+PaymentAccount\?\s+@relation\(fields: \[bankId\], references: \[id\], onDelete: Restrict\)/, `${model}.bankAccount`);
  }
  // CashSessionMethodCount keeps its string key (spec §3 exception): no bankId, no relation.
  const mc = schema.slice(schema.indexOf("model CashSessionMethodCount {"));
  assert.doesNotMatch(mc.slice(0, mc.indexOf("\n}\n")), /bankId/);
});

test("migration: CASH type is added in place (enum value only, nothing dropped)", async () => {
  const sql = await src("prisma/migrations/20261014090000_payment_account_cash/migration.sql");
  assert.match(sql, /ALTER TYPE "PaymentAccountType" ADD VALUE IF NOT EXISTS 'CASH'/);
  assert.doesNotMatch(sql, /DROP|DELETE|UPDATE/i);
});

test("migration: one CASH per tenant is a partial unique index (not expressible in Prisma)", async () => {
  const sql = await src("prisma/migrations/20261014120000_payment_account_one_cash/migration.sql");
  assert.match(sql, /CREATE UNIQUE INDEX IF NOT EXISTS "PaymentAccount_one_cash_per_tenant_key" ON "PaymentAccount"\("tenantId"\) WHERE "type" = 'CASH'/);
  assert.doesNotMatch(sql, /DROP|DELETE|UPDATE/i);
  assert.match(await src("prisma/schema.prisma"), /PaymentAccount_one_cash_per_tenant_key/);
});

test("migration: every existing tenant gets one active «Бэлэн» under the RLS bypass, and a miss aborts", async () => {
  const sql = await src("prisma/migrations/20261014130000_payment_account_default_cash/migration.sql");
  assert.match(sql, /SET LOCAL app\.bypass_rls = 'on';/);
  assert.match(sql, /INSERT INTO "PaymentAccount"[\s\S]*'CASH', 'Бэлэн'[\s\S]*WHERE NOT EXISTS[\s\S]*ON CONFLICT DO NOTHING;/);
  assert.match(sql, /RAISE EXCEPTION 'default cash backfill missed a tenant'/);
  assert.doesNotMatch(sql, /DROP|DELETE/i);
});

test("migration: table, RLS, backfill, no destructive statements", async () => {
  const sql = await src("prisma/migrations/20261012100000_payment_accounts/migration.sql");
  assert.match(sql, /CREATE TYPE "PaymentAccountType" AS ENUM \('BANK_ACCOUNT', 'POS'\)/);
  assert.match(sql, /CREATE TABLE "PaymentAccount"/);
  assert.match(sql, /ENABLE ROW LEVEL SECURITY/);
  assert.match(sql, /tenant_isolation/);
  assert.match(sql, /UPDATE "OrderPayment"/);
  assert.match(sql, /UPDATE "CashSessionMethodCount"/);
  assert.doesNotMatch(sql, /DROP TABLE(?!\s+(IF EXISTS\s+)?(pg_temp\.)?_)|DROP COLUMN|DROP INDEX/i, "expand phase must not drop anything");
  assert.match(sql, /SET LOCAL app\.bypass_rls = 'on'/);
  assert.match(sql, /RAISE EXCEPTION/);
  assert.match(sql, /DO \$\$[\s\S]*RAISE EXCEPTION 'PaymentAccount backfill incomplete'[\s\S]*END \$\$;/);
  assert.equal((sql.match(/\$\$/g) ?? []).length % 2, 0, "unbalanced $$ delimiters");
  assert.doesNotMatch(sql, /(?<!\$)\$(?!\$)/, "stray single $");
  assert.doesNotMatch(sql, /ALTER TABLE "Tenant"[^;]*DROP/i);
});
