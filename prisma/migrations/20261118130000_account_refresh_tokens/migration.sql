-- Эцсийн хэрэглэгчийн (Account) мобайл refresh token. Одоогийн хугацаагүй access token-ууд хэвээр ажиллана
-- (апп refresh горимыг өөрөө сонгож авна), тиймээс backfill шаардлагагүй. Account глобал тул RLS-гүй.

-- CreateTable
CREATE TABLE "AccountRefreshToken" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "tokenVersion" INTEGER NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "replacedById" TEXT,
    "userAgent" TEXT,
    "ip" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3),

    CONSTRAINT "AccountRefreshToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AccountRefreshToken_tokenHash_key" ON "AccountRefreshToken"("tokenHash");
CREATE UNIQUE INDEX "AccountRefreshToken_replacedById_key" ON "AccountRefreshToken"("replacedById");
CREATE INDEX "AccountRefreshToken_accountId_idx" ON "AccountRefreshToken"("accountId");
CREATE INDEX "AccountRefreshToken_expiresAt_idx" ON "AccountRefreshToken"("expiresAt");

-- AddForeignKey
ALTER TABLE "AccountRefreshToken" ADD CONSTRAINT "AccountRefreshToken_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AccountRefreshToken" ADD CONSTRAINT "AccountRefreshToken_replacedById_fkey" FOREIGN KEY ("replacedById") REFERENCES "AccountRefreshToken"("id") ON DELETE SET NULL ON UPDATE CASCADE;
