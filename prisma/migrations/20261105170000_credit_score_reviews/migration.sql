-- CreateEnum
CREATE TYPE "CreditBlockMode" AS ENUM ('HIDE', 'SUSPEND');

-- AlterTable
ALTER TABLE "Branch" ADD COLUMN     "ratingAvg" DECIMAL(3,2),
ADD COLUMN     "ratingCount" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "PlatformSetting" ADD COLUMN     "creditAutoBlock" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "creditBlockMode" "CreditBlockMode" NOT NULL DEFAULT 'HIDE',
ADD COLUMN     "creditBlockThreshold" INTEGER NOT NULL DEFAULT 40;

-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN     "creditAdjustment" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "creditAdjustmentNote" TEXT,
ADD COLUMN     "creditBreakdown" JSONB,
ADD COLUMN     "creditExempt" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "creditHidden" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "creditScore" INTEGER,
ADD COLUMN     "creditSuspended" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "creditUpdatedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "Review" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "rating" INTEGER NOT NULL,
    "comment" TEXT,
    "reply" TEXT,
    "repliedAt" TIMESTAMP(3),
    "repliedById" TEXT,
    "hidden" BOOLEAN NOT NULL DEFAULT false,
    "hiddenAt" TIMESTAMP(3),
    "hiddenReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Review_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Review_orderId_key" ON "Review"("orderId");

-- CreateIndex
CREATE INDEX "Review_tenantId_createdAt_idx" ON "Review"("tenantId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "Review_branchId_hidden_idx" ON "Review"("branchId", "hidden");

-- CreateIndex
CREATE INDEX "Review_accountId_idx" ON "Review"("accountId");

-- AddForeignKey
ALTER TABLE "Review" ADD CONSTRAINT "Review_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Review" ADD CONSTRAINT "Review_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Review" ADD CONSTRAINT "Review_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "ServiceOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Review" ADD CONSTRAINT "Review_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Review" ADD CONSTRAINT "Review_repliedById_fkey" FOREIGN KEY ("repliedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- RLS: tenant_isolation (Feedback-тэй адил). Үйлчлүүлэгч (Account) болон нийтийн
-- хуудас bypass context-оор уншина/бичнэ; ажилтан зөвхөн өөрийн тенантынхыг.
ALTER TABLE "Review" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Review" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Review"
  USING (current_setting('app.bypass_rls', true) = 'on' OR "tenantId" = current_setting('app.tenant_id', true))
  WITH CHECK (current_setting('app.bypass_rls', true) = 'on' OR "tenantId" = current_setting('app.tenant_id', true));

-- Үнэлгээ 1..5
ALTER TABLE "Review" ADD CONSTRAINT "Review_rating_range" CHECK ("rating" BETWEEN 1 AND 5);
