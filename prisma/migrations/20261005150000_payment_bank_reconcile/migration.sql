-- Cash ledger Phase B: receiving bank on transfer/card payments, reconciliation
-- tick («Дансанд орсон») and per-tenant enabled bank list.

ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "enabledBanks" TEXT[] DEFAULT ARRAY[]::TEXT[];

ALTER TABLE "OrderPayment" ADD COLUMN IF NOT EXISTS "bank" TEXT;
ALTER TABLE "OrderPayment" ADD COLUMN IF NOT EXISTS "reconciledAt" TIMESTAMP(3);
ALTER TABLE "OrderPayment" ADD COLUMN IF NOT EXISTS "reconciledById" TEXT;

CREATE INDEX IF NOT EXISTS "OrderPayment_tenantId_bank_idx" ON "OrderPayment"("tenantId", "bank");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'OrderPayment_reconciledById_fkey') THEN
    ALTER TABLE "OrderPayment"
      ADD CONSTRAINT "OrderPayment_reconciledById_fkey" FOREIGN KEY ("reconciledById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
