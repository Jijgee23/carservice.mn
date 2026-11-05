-- AlterTable
ALTER TABLE "CatalogItem" ADD COLUMN     "barcode" TEXT;

-- AlterTable
ALTER TABLE "Service" ADD COLUMN     "barcode" TEXT;

-- CreateIndex
CREATE INDEX "Service_tenantId_barcode_idx" ON "Service"("tenantId", "barcode");


-- Нэгдсэн санд нэг баркод нэг л мөрд (хоосон бол хязгааргүй).
CREATE UNIQUE INDEX "CatalogItem_barcode_key" ON "CatalogItem"("barcode") WHERE "barcode" IS NOT NULL;
