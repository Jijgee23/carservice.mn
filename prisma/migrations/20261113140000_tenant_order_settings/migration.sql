-- Засварын хуудасны тохиргоо (tenant бүр). Мөр байхгүй = анхдагч (одоогийн
-- хатуу дүрэмтэй адил) — backfill шаардлагагүй. lib/orders/order-settings.ts.

CREATE TABLE "TenantOrderSettings" (
    "tenantId" TEXT NOT NULL,
    "numberPrefix" TEXT NOT NULL DEFAULT '',
    "numberPadding" INTEGER NOT NULL DEFAULT 5,
    "numberIncludeYear" BOOLEAN NOT NULL DEFAULT false,
    "numberNextSeq" INTEGER,
    "numberSeqYear" INTEGER,
    "requireAssignee" BOOLEAN NOT NULL DEFAULT true,
    "requireMileage" BOOLEAN NOT NULL DEFAULT false,
    "requireSignature" BOOLEAN NOT NULL DEFAULT false,
    "minIntakePhotos" INTEGER NOT NULL DEFAULT 0,
    "requireChecklist" BOOLEAN NOT NULL DEFAULT false,
    "intakeChecklist" JSONB NOT NULL DEFAULT '[]',
    "requireDiagnosticsFilled" BOOLEAN NOT NULL DEFAULT true,
    "requireItemsCompleted" BOOLEAN NOT NULL DEFAULT true,
    "allowCloseUnpaid" BOOLEAN NOT NULL DEFAULT false,
    "printFormat" TEXT NOT NULL DEFAULT 'a4',
    "printHeaderNote" TEXT,
    "printFooterNote" TEXT,
    "printSignatureLines" BOOLEAN NOT NULL DEFAULT true,
    "printShowChecklist" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TenantOrderSettings_pkey" PRIMARY KEY ("tenantId")
);

ALTER TABLE "TenantOrderSettings" ADD CONSTRAINT "TenantOrderSettings_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ServiceOrder" ADD COLUMN "intakeChecklist" JSONB;

ALTER TABLE "TenantOrderSettings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "TenantOrderSettings" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "TenantOrderSettings"
  USING (current_setting('app.bypass_rls', true) = 'on' OR "tenantId" = current_setting('app.tenant_id', true))
  WITH CHECK (current_setting('app.bypass_rls', true) = 'on' OR "tenantId" = current_setting('app.tenant_id', true));
