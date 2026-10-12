-- Dry run of prisma/migrations/20261012100000_payment_accounts/migration.sql.
-- Runs the REAL migration inside one transaction, prints the verification results, then ROLLS BACK,
-- so nothing is saved. Run from the carcare.mn folder (the \i path below is relative):
--   psql "<url without ?schema=...>" -v ON_ERROR_STOP=1 -f scripts/payment-accounts-dry-run.sql
-- If the migration or its backfill guard fails, psql stops with the error and the transaction is
-- discarded. The ALTER TABLE statements take short table locks until the ROLLBACK, so prefer a quiet
-- moment on the shared database, or run it against a scratch copy.

BEGIN;

\i prisma/migrations/20261012100000_payment_accounts/migration.sql

\echo
\echo '== Unmapped history rows (every number below must be 0) =='
SELECT 'OrderPayment' AS "table", count(*) AS unmapped FROM "OrderPayment" WHERE bank IS NOT NULL AND bank <> '' AND "bankId" IS NULL
UNION ALL SELECT 'CashTransaction', count(*) FROM "CashTransaction" WHERE bank IS NOT NULL AND bank <> '' AND "bankId" IS NULL
UNION ALL SELECT 'PostpaidSettlement', count(*) FROM "PostpaidSettlement" WHERE bank IS NOT NULL AND bank <> '' AND "bankId" IS NULL
UNION ALL SELECT 'CashSessionMethodCount (bank not an account id)', count(*) FROM "CashSessionMethodCount" m
  WHERE m.bank <> '' AND NOT EXISTS (SELECT 1 FROM "PaymentAccount" p WHERE p.id = m.bank);

\echo
\echo '== Legacy accounts created per tenant (active rows expected: 22 when enabledBanks was empty) =='
SELECT "tenantId", count(*) AS total, count(*) FILTER (WHERE "isActive") AS active,
       count(*) FILTER (WHERE type = 'BANK_ACCOUNT') AS bank_accounts, count(*) FILTER (WHERE type = 'POS') AS pos
FROM "PaymentAccount" GROUP BY "tenantId" ORDER BY "tenantId";

\echo
\echo '== History now linked to an account =='
SELECT 'OrderPayment' AS "table", count(*) AS linked FROM "OrderPayment" WHERE "bankId" IS NOT NULL
UNION ALL SELECT 'CashTransaction', count(*) FROM "CashTransaction" WHERE "bankId" IS NOT NULL
UNION ALL SELECT 'PostpaidSettlement', count(*) FROM "PostpaidSettlement" WHERE "bankId" IS NOT NULL;

ROLLBACK;
\echo
\echo 'Rolled back: nothing was saved.'
