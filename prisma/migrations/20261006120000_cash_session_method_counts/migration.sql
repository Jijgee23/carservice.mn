-- Odoo-style register close: per-(method, bank) expected/counted/difference, frozen at close.
-- bank is NOT NULL DEFAULT '' ('' = no bank) so the composite unique index is effective (NULLs are distinct in Postgres).
CREATE TABLE IF NOT EXISTS "CashSessionMethodCount" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "sessionId" TEXT NOT NULL,
  "method" "OrderPaymentMethod" NOT NULL,
  "bank" TEXT NOT NULL DEFAULT '',
  "expected" DECIMAL(12,2) NOT NULL,
  "counted" DECIMAL(12,2),
  "difference" DECIMAL(12,2),
  CONSTRAINT "CashSessionMethodCount_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CashSessionMethodCount_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "CashSession"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "CashSessionMethodCount_sessionId_method_bank_key" ON "CashSessionMethodCount"("sessionId", "method", "bank");
CREATE INDEX IF NOT EXISTS "CashSessionMethodCount_tenantId_idx" ON "CashSessionMethodCount"("tenantId");

ALTER TABLE "CashSessionMethodCount" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CashSessionMethodCount" FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'CashSessionMethodCount' AND policyname = 'tenant_isolation') THEN
    CREATE POLICY tenant_isolation ON "CashSessionMethodCount"
      USING (current_setting('app.bypass_rls', true) = 'on' OR "tenantId" = current_setting('app.tenant_id', true))
      WITH CHECK (current_setting('app.bypass_rls', true) = 'on' OR "tenantId" = current_setting('app.tenant_id', true));
  END IF;
END $$;
