-- Order accounting Phase 1: postpaid hardening, vehicle identity snapshots,
-- internal-order flag and organization fields on Customer.

-- isPostpaid columns/index already exist via 20260813110000_add_is_postpaid
-- (and db push on some environments); idempotent so either history applies.
ALTER TABLE "ServiceOrder" ADD COLUMN IF NOT EXISTS "isPostpaid" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "TenantVehicle" ADD COLUMN IF NOT EXISTS "isPostpaid" BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS "ServiceOrder_tenantId_isPostpaid_idx" ON "ServiceOrder"("tenantId", "isPostpaid");

-- ServiceOrder: internal flag + vehicle identity snapshots.
ALTER TABLE "ServiceOrder" ADD COLUMN IF NOT EXISTS "isInternal" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "ServiceOrder" ADD COLUMN IF NOT EXISTS "plateSnapshot" TEXT;
ALTER TABLE "ServiceOrder" ADD COLUMN IF NOT EXISTS "vinSnapshot" TEXT;
CREATE INDEX IF NOT EXISTS "ServiceOrder_tenantId_isInternal_idx" ON "ServiceOrder"("tenantId", "isInternal");
CREATE INDEX IF NOT EXISTS "ServiceOrder_tenantId_plateSnapshot_idx" ON "ServiceOrder"("tenantId", "plateSnapshot");

-- Backfill snapshots from the current vehicle for existing orders.
UPDATE "ServiceOrder" o
SET "plateSnapshot" = v."plate",
    "vinSnapshot" = v."vin"
FROM "Vehicle" v
WHERE v."id" = o."vehicleId"
  AND o."plateSnapshot" IS NULL;

-- Customer: organization fields.
ALTER TABLE "Customer" ADD COLUMN IF NOT EXISTS "isOrganization" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Customer" ADD COLUMN IF NOT EXISTS "orgRegnum" TEXT;
ALTER TABLE "Customer" ADD COLUMN IF NOT EXISTS "orgName" TEXT;
ALTER TABLE "Customer" ADD COLUMN IF NOT EXISTS "orgEmail" TEXT;
CREATE INDEX IF NOT EXISTS "Customer_tenantId_orgRegnum_idx" ON "Customer"("tenantId", "orgRegnum");

-- Internal orders are never postpaid.
ALTER TABLE "ServiceOrder"
  ADD CONSTRAINT "ServiceOrder_internal_not_postpaid" CHECK (NOT ("isInternal" AND "isPostpaid"));
