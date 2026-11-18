-- System ажилтан (STAFF): мобайл апп-аар нэвтэрч харилцагч бүртгэх/засах. Бүх одоогийн админ ROOT болно
-- (анхдагч), тиймээс зан төлөв өөрчлөгдөхгүй. Глобал хүснэгтүүд тул RLS-гүй.

-- CreateEnum
CREATE TYPE "SuperAdminKind" AS ENUM ('ROOT', 'STAFF');

-- AlterTable
ALTER TABLE "SuperAdmin" ADD COLUMN "kind" "SuperAdminKind" NOT NULL DEFAULT 'ROOT',
ADD COLUMN "failedLoginAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "lockedUntil" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "SuperAdminRefreshToken" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "adminId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "replacedById" TEXT,
    "userAgent" TEXT,
    "ip" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3),

    CONSTRAINT "SuperAdminRefreshToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SystemAuditLog" (
    "id" TEXT NOT NULL,
    "adminId" TEXT NOT NULL,
    "tenantId" TEXT,
    "entity" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "action" "AuditAction" NOT NULL,
    "summary" TEXT,
    "before" JSONB,
    "after" JSONB,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SystemAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SuperAdminRefreshToken_tokenHash_key" ON "SuperAdminRefreshToken"("tokenHash");
CREATE UNIQUE INDEX "SuperAdminRefreshToken_replacedById_key" ON "SuperAdminRefreshToken"("replacedById");
CREATE INDEX "SuperAdminRefreshToken_adminId_idx" ON "SuperAdminRefreshToken"("adminId");
CREATE INDEX "SuperAdminRefreshToken_expiresAt_idx" ON "SuperAdminRefreshToken"("expiresAt");
CREATE INDEX "SystemAuditLog_tenantId_createdAt_idx" ON "SystemAuditLog"("tenantId", "createdAt");
CREATE INDEX "SystemAuditLog_adminId_createdAt_idx" ON "SystemAuditLog"("adminId", "createdAt");

-- AddForeignKey
ALTER TABLE "SuperAdminRefreshToken" ADD CONSTRAINT "SuperAdminRefreshToken_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "SuperAdmin"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SuperAdminRefreshToken" ADD CONSTRAINT "SuperAdminRefreshToken_replacedById_fkey" FOREIGN KEY ("replacedById") REFERENCES "SuperAdminRefreshToken"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SystemAuditLog" ADD CONSTRAINT "SystemAuditLog_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "SuperAdmin"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
