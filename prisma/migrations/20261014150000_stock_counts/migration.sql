-- Сэлбэг барааны тооллого (StockCount) ба мөрүүд (StockCountLine) — schema.prisma-ийн тайлбарыг үз.
-- CreateEnum
CREATE TYPE "StockCountStatus" AS ENUM ('DRAFT', 'COMPLETED', 'CANCELLED');

-- CreateTable
CREATE TABLE "StockCount" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "status" "StockCountStatus" NOT NULL DEFAULT 'DRAFT',
    "note" TEXT,
    "categoryId" TEXT,
    "categoryName" TEXT,
    "createdById" TEXT,
    "completedById" TEXT,
    "completedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "lineCount" INTEGER NOT NULL DEFAULT 0,
    "countedCount" INTEGER NOT NULL DEFAULT 0,
    "diffCount" INTEGER NOT NULL DEFAULT 0,
    "shortageValue" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "surplusValue" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StockCount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockCountLine" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "countId" TEXT NOT NULL,
    "serviceId" TEXT,
    "name" TEXT NOT NULL,
    "code" TEXT,
    "unit" TEXT,
    "costPrice" DECIMAL(12,2),
    "systemQty" DECIMAL(12,3) NOT NULL,
    "countedQty" DECIMAL(12,3),
    "difference" DECIMAL(12,3),
    "note" TEXT,

    CONSTRAINT "StockCountLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StockCount_tenantId_status_createdAt_idx" ON "StockCount"("tenantId", "status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "StockCount_tenantId_number_key" ON "StockCount"("tenantId", "number");

-- CreateIndex
CREATE INDEX "StockCountLine_tenantId_idx" ON "StockCountLine"("tenantId");

-- CreateIndex
CREATE INDEX "StockCountLine_serviceId_idx" ON "StockCountLine"("serviceId");

-- CreateIndex
CREATE UNIQUE INDEX "StockCountLine_countId_serviceId_key" ON "StockCountLine"("countId", "serviceId");

-- AddForeignKey
ALTER TABLE "StockCount" ADD CONSTRAINT "StockCount_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockCount" ADD CONSTRAINT "StockCount_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockCount" ADD CONSTRAINT "StockCount_completedById_fkey" FOREIGN KEY ("completedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockCountLine" ADD CONSTRAINT "StockCountLine_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockCountLine" ADD CONSTRAINT "StockCountLine_countId_fkey" FOREIGN KEY ("countId") REFERENCES "StockCount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockCountLine" ADD CONSTRAINT "StockCountLine_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Нэг тенантад нэг л нээлттэй (DRAFT) тооллого. Prisma schema-д partial unique илэрхийлэгдэхгүй.
CREATE UNIQUE INDEX IF NOT EXISTS "StockCount_one_draft_per_tenant_key" ON "StockCount"("tenantId") WHERE "status" = 'DRAFT';

-- RLS: бусад тенантын хүснэгтүүдтэй ижил (FORCE + tenant_isolation).
ALTER TABLE "StockCount" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "StockCount" FORCE ROW LEVEL SECURITY;
ALTER TABLE "StockCountLine" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "StockCountLine" FORCE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'StockCount' AND policyname = 'tenant_isolation') THEN
    CREATE POLICY tenant_isolation ON "StockCount"
      USING (current_setting('app.bypass_rls', true) = 'on' OR "tenantId" = current_setting('app.tenant_id', true))
      WITH CHECK (current_setting('app.bypass_rls', true) = 'on' OR "tenantId" = current_setting('app.tenant_id', true));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'StockCountLine' AND policyname = 'tenant_isolation') THEN
    CREATE POLICY tenant_isolation ON "StockCountLine"
      USING (current_setting('app.bypass_rls', true) = 'on' OR "tenantId" = current_setting('app.tenant_id', true))
      WITH CHECK (current_setting('app.bypass_rls', true) = 'on' OR "tenantId" = current_setting('app.tenant_id', true));
  END IF;
END $$;
