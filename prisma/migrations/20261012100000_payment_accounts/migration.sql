-- Payment accounts: tenant-defined receiving accounts / POS terminals (expand phase).
-- Does NOT drop the old "bank" string columns or Tenant."enabledBanks" (contract migration later).
-- Pre-check (run manually, expect 0 after this migration):
--   SELECT count(*) FROM "OrderPayment" WHERE bank IS NOT NULL AND bank <> '' AND "bankId" IS NULL;
--   (same for "CashTransaction" and "PostpaidSettlement")

CREATE TYPE "PaymentAccountType" AS ENUM ('BANK_ACCOUNT', 'POS');

CREATE TABLE "PaymentAccount" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "type" "PaymentAccountType" NOT NULL,
  "name" TEXT NOT NULL,
  "accountNumber" TEXT,
  "terminalId" TEXT,
  "merchantId" TEXT,
  "isTest" BOOLEAN NOT NULL DEFAULT false,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "legacyCode" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PaymentAccount_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PaymentAccount_tenantId_type_accountNumber_key" ON "PaymentAccount"("tenantId", "type", "accountNumber");
CREATE UNIQUE INDEX "PaymentAccount_tenantId_type_legacyCode_key" ON "PaymentAccount"("tenantId", "type", "legacyCode");
CREATE INDEX "PaymentAccount_tenantId_isActive_idx" ON "PaymentAccount"("tenantId", "isActive");
ALTER TABLE "PaymentAccount" ADD CONSTRAINT "PaymentAccount_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RLS (same form as 20261006120000_cash_session_method_counts).
ALTER TABLE "PaymentAccount" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PaymentAccount" FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'PaymentAccount' AND policyname = 'tenant_isolation') THEN
    CREATE POLICY tenant_isolation ON "PaymentAccount"
      USING (current_setting('app.bypass_rls', true) = 'on' OR "tenantId" = current_setting('app.tenant_id', true))
      WITH CHECK (current_setting('app.bypass_rls', true) = 'on' OR "tenantId" = current_setting('app.tenant_id', true));
  END IF;
END $$;

ALTER TABLE "OrderPayment" ADD COLUMN "bankId" TEXT;
ALTER TABLE "CashTransaction" ADD COLUMN "bankId" TEXT;
ALTER TABLE "PostpaidSettlement" ADD COLUMN "bankId" TEXT;
ALTER TABLE "OrderPayment" ADD CONSTRAINT "OrderPayment_bankId_fkey" FOREIGN KEY ("bankId") REFERENCES "PaymentAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CashTransaction" ADD CONSTRAINT "CashTransaction_bankId_fkey" FOREIGN KEY ("bankId") REFERENCES "PaymentAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PostpaidSettlement" ADD CONSTRAINT "PostpaidSettlement_bankId_fkey" FOREIGN KEY ("bankId") REFERENCES "PaymentAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "OrderPayment_tenantId_bankId_idx" ON "OrderPayment"("tenantId", "bankId");
CREATE INDEX "CashTransaction_tenantId_bankId_idx" ON "CashTransaction"("tenantId", "bankId");
CREATE INDEX "PostpaidSettlement_tenantId_bankId_idx" ON "PostpaidSettlement"("tenantId", "bankId");

-- ---- Backfill -------------------------------------------------------------
-- RLS bypass required: all tables here are FORCE RLS; without it the INSERT fails its WITH CHECK and the
-- history UPDATEs silently match 0 rows (see 20260914070000_category_system_key_required).
SET LOCAL app.bypass_rls = 'on';

-- Catalog (mirrors the old lib/banks.ts).
CREATE TEMP TABLE _bank_catalog (code TEXT PRIMARY KEY, label TEXT NOT NULL);
INSERT INTO _bank_catalog (code, label) VALUES
  ('KHAN','Хаан банк'),('GOLOMT','Голомт банк'),('TDB','Худалдаа хөгжлийн банк'),('STATE','Төрийн банк'),
  ('XAC','Хас банк'),('CAPITRON','Капитрон банк'),('ARIG','Ариг банк'),('BOGD','Богд банк'),
  ('TRANS','Тээвэр хөгжлийн банк'),('NIBANK','Үндэсний хөрөнгө оруулалтын банк'),('CHINGGIS','Чингис хаан банк');

-- (tenant, code) pairs that are ACTIVE: the tenant's enabledBanks, or all 11 when it has none that we know.
CREATE TEMP TABLE _active_pairs AS
SELECT t.id AS "tenantId", c.code
FROM "Tenant" t
JOIN _bank_catalog c
  ON c.code = ANY (t."enabledBanks")
  OR NOT EXISTS (SELECT 1 FROM _bank_catalog k WHERE k.code = ANY (t."enabledBanks"));

-- (tenant, code) pairs found on history that are not active -> inactive legacy rows.
CREATE TEMP TABLE _used_pairs AS
SELECT DISTINCT "tenantId", bank AS code FROM "OrderPayment" WHERE bank IS NOT NULL AND bank <> ''
UNION SELECT DISTINCT "tenantId", bank FROM "CashTransaction" WHERE bank IS NOT NULL AND bank <> ''
UNION SELECT DISTINCT "tenantId", bank FROM "PostpaidSettlement" WHERE bank IS NOT NULL AND bank <> ''
UNION SELECT DISTINCT "tenantId", bank FROM "CashSessionMethodCount" WHERE bank <> '';

CREATE TEMP TABLE _legacy_rows AS
SELECT p."tenantId", p.code, true AS active FROM _active_pairs p
UNION
SELECT u."tenantId", u.code, false FROM _used_pairs u
WHERE NOT EXISTS (SELECT 1 FROM _active_pairs a WHERE a."tenantId" = u."tenantId" AND a.code = u.code);

-- One BANK_ACCOUNT and one POS legacy row per pair (every old bank was valid for both methods).
INSERT INTO "PaymentAccount" ("id","tenantId","type","name","legacyCode","isActive","updatedAt")
SELECT 'pa_' || md5(r."tenantId" || ':' || r.code || ':' || ty.t), r."tenantId", ty.t::"PaymentAccountType",
       COALESCE(c.label, r.code), r.code, r.active, CURRENT_TIMESTAMP
FROM _legacy_rows r
CROSS JOIN (VALUES ('BANK_ACCOUNT'), ('POS')) AS ty(t)
LEFT JOIN _bank_catalog c ON c.code = r.code;

-- bankId on history: CARD -> POS row, everything else with a bank -> BANK_ACCOUNT row.
UPDATE "OrderPayment" o SET "bankId" = pa."id"
FROM "PaymentAccount" pa
WHERE o.bank IS NOT NULL AND o.bank <> '' AND pa."tenantId" = o."tenantId" AND pa."legacyCode" = o.bank
  AND pa."type" = (CASE WHEN o.method = 'CARD' THEN 'POS' ELSE 'BANK_ACCOUNT' END)::"PaymentAccountType";
UPDATE "CashTransaction" o SET "bankId" = pa."id"
FROM "PaymentAccount" pa
WHERE o.bank IS NOT NULL AND o.bank <> '' AND pa."tenantId" = o."tenantId" AND pa."legacyCode" = o.bank
  AND pa."type" = (CASE WHEN o.method = 'CARD' THEN 'POS' ELSE 'BANK_ACCOUNT' END)::"PaymentAccountType";
UPDATE "PostpaidSettlement" o SET "bankId" = pa."id"
FROM "PaymentAccount" pa
WHERE o.bank IS NOT NULL AND o.bank <> '' AND pa."tenantId" = o."tenantId" AND pa."legacyCode" = o.bank
  AND pa."type" = (CASE WHEN o.method = 'CARD' THEN 'POS' ELSE 'BANK_ACCOUNT' END)::"PaymentAccountType";

-- Method counts keep their column and unique key: rewrite code -> account id in place ('' stays).
UPDATE "CashSessionMethodCount" m SET "bank" = pa."id"
FROM "PaymentAccount" pa
WHERE m.bank <> '' AND pa."tenantId" = m."tenantId" AND pa."legacyCode" = m.bank
  AND pa."type" = (CASE WHEN m.method = 'CARD' THEN 'POS' ELSE 'BANK_ACCOUNT' END)::"PaymentAccountType";

DROP TABLE IF EXISTS pg_temp._bank_catalog; DROP TABLE IF EXISTS pg_temp._active_pairs; DROP TABLE IF EXISTS pg_temp._used_pairs; DROP TABLE IF EXISTS pg_temp._legacy_rows;

-- Abort (instead of reporting success) if the backfill missed any row, e.g. a bypass failure.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "OrderPayment" WHERE bank IS NOT NULL AND bank <> '' AND "bankId" IS NULL)
     OR EXISTS (SELECT 1 FROM "CashTransaction" WHERE bank IS NOT NULL AND bank <> '' AND "bankId" IS NULL)
     OR EXISTS (SELECT 1 FROM "PostpaidSettlement" WHERE bank IS NOT NULL AND bank <> '' AND "bankId" IS NULL)
  THEN
    RAISE EXCEPTION 'PaymentAccount backfill incomplete';
  END IF;
END $$;
