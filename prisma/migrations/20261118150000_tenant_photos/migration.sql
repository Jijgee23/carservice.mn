-- Байгууллага / салбарын зургийн сан. branchId NULL = байгууллагын нийтлэг зураг. lib/tenant-photos.ts.

CREATE TABLE "TenantPhoto" (
    "id" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "tenantId" TEXT NOT NULL,
    "branchId" TEXT,

    CONSTRAINT "TenantPhoto_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "TenantPhoto_tenantId_branchId_sortOrder_idx" ON "TenantPhoto"("tenantId", "branchId", "sortOrder");

ALTER TABLE "TenantPhoto" ADD CONSTRAINT "TenantPhoto_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TenantPhoto" ADD CONSTRAINT "TenantPhoto_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TenantPhoto" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "TenantPhoto" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "TenantPhoto"
  USING (current_setting('app.bypass_rls', true) = 'on' OR "tenantId" = current_setting('app.tenant_id', true))
  WITH CHECK (current_setting('app.bypass_rls', true) = 'on' OR "tenantId" = current_setting('app.tenant_id', true));
