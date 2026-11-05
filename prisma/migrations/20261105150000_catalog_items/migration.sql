-- AlterTable
ALTER TABLE "Service" ADD COLUMN     "catalogItemId" TEXT;

-- CreateTable
CREATE TABLE "CatalogItem" (
    "id" TEXT NOT NULL,
    "type" "ServiceKind" NOT NULL,
    "name" TEXT NOT NULL,
    "nameKey" TEXT NOT NULL,
    "code" TEXT,
    "codeKey" TEXT,
    "unitName" TEXT NOT NULL,
    "durationValue" DECIMAL(12,3),
    "durationUnitName" TEXT,
    "categoryId" TEXT,
    "price" DECIMAL(12,2) NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdByTenantId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CatalogItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CatalogItem_type_isActive_nameKey_idx" ON "CatalogItem"("type", "isActive", "nameKey");

-- CreateIndex
CREATE INDEX "CatalogItem_codeKey_idx" ON "CatalogItem"("codeKey");

-- CreateIndex
CREATE UNIQUE INDEX "Service_tenantId_catalogItemId_key" ON "Service"("tenantId", "catalogItemId");

-- AddForeignKey
ALTER TABLE "Service" ADD CONSTRAINT "Service_catalogItemId_fkey" FOREIGN KEY ("catalogItemId") REFERENCES "CatalogItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CatalogItem" ADD CONSTRAINT "CatalogItem_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Давхардлын хамгаалалт (нэгдсэн сан): кодтой мөр (type, codeKey)-оор,
-- кодгүй мөр (type, nameKey)-ээр давтагдашгүй. Түлхүүрийг app (lib/catalog/
-- normalize.ts) тооцно. Одоогийн service-үүдийг санд оруулах нь
-- scripts/backfill-catalog-items.ts (deploy-ийн дараа нэг удаа).
CREATE UNIQUE INDEX "CatalogItem_type_codeKey_key" ON "CatalogItem"("type", "codeKey") WHERE "codeKey" IS NOT NULL;
CREATE UNIQUE INDEX "CatalogItem_type_nameKey_nocode_key" ON "CatalogItem"("type", "nameKey") WHERE "codeKey" IS NULL;
