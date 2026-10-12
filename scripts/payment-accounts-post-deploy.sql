-- Payment accounts: post-deploy catch-up (I3).
--
-- WHEN TO RUN: once, right after the release containing migration 20261012100000_payment_accounts is live
-- (scripts/deploy.sh runs `prisma migrate deploy`, then builds, then restarts). During the build window the
-- OLD code is still serving traffic and writes rows with `bank` set but `bankId` NULL; the migration backfill
-- has already run, so those rows are not mapped. This script maps them. It is idempotent: every UPDATE only
-- touches rows that are still unmapped, so running it again is harmless.
--
-- Usage: psql "$DATABASE_URL" -f scripts/payment-accounts-post-deploy.sql
-- The final SELECT is read-only verification; every count should be 0.

BEGIN;
SET LOCAL app.bypass_rls = 'on';

UPDATE "OrderPayment" o SET "bankId" = pa.id
FROM "PaymentAccount" pa
WHERE o.bank IS NOT NULL AND o.bank <> '' AND o."bankId" IS NULL AND pa."tenantId" = o."tenantId" AND pa."legacyCode" = o.bank
  AND pa."type" = (CASE WHEN o.method = 'CARD' THEN 'POS' ELSE 'BANK_ACCOUNT' END)::"PaymentAccountType";

UPDATE "CashTransaction" o SET "bankId" = pa.id
FROM "PaymentAccount" pa
WHERE o.bank IS NOT NULL AND o.bank <> '' AND o."bankId" IS NULL AND pa."tenantId" = o."tenantId" AND pa."legacyCode" = o.bank
  AND pa."type" = (CASE WHEN o.method = 'CARD' THEN 'POS' ELSE 'BANK_ACCOUNT' END)::"PaymentAccountType";

UPDATE "PostpaidSettlement" o SET "bankId" = pa.id
FROM "PaymentAccount" pa
WHERE o.bank IS NOT NULL AND o.bank <> '' AND o."bankId" IS NULL AND pa."tenantId" = o."tenantId" AND pa."legacyCode" = o.bank
  AND pa."type" = (CASE WHEN o.method = 'CARD' THEN 'POS' ELSE 'BANK_ACCOUNT' END)::"PaymentAccountType";

-- Method counts keep their column: rewrite code -> account id, only where `bank` still holds a legacy code.
UPDATE "CashSessionMethodCount" m SET "bank" = pa.id
FROM "PaymentAccount" pa
WHERE m.bank <> '' AND NOT EXISTS (SELECT 1 FROM "PaymentAccount" x WHERE x."id" = m.bank)
  AND pa."tenantId" = m."tenantId" AND pa."legacyCode" = m.bank
  AND pa."type" = (CASE WHEN m.method = 'CARD' THEN 'POS' ELSE 'BANK_ACCOUNT' END)::"PaymentAccountType";

-- Verification (read-only): rows that still have a legacy bank but no account.
SELECT 'OrderPayment' AS "table", count(*) AS unmapped FROM "OrderPayment" WHERE bank IS NOT NULL AND bank <> '' AND "bankId" IS NULL
UNION ALL
SELECT 'CashTransaction', count(*) FROM "CashTransaction" WHERE bank IS NOT NULL AND bank <> '' AND "bankId" IS NULL
UNION ALL
SELECT 'PostpaidSettlement', count(*) FROM "PostpaidSettlement" WHERE bank IS NOT NULL AND bank <> '' AND "bankId" IS NULL
UNION ALL
SELECT 'CashSessionMethodCount', count(*) FROM "CashSessionMethodCount" m
  WHERE m.bank <> '' AND NOT EXISTS (SELECT 1 FROM "PaymentAccount" x WHERE x."id" = m.bank);

COMMIT;
