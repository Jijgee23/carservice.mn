-- Нэвтрэлт (RefreshToken) → тэр нэвтрэлтээр бүртгэгдсэн push Device. POST /auth/logout уг төхөөрөмжийг устгана.
-- AlterTable
ALTER TABLE "RefreshToken" ADD COLUMN     "pushDeviceId" TEXT;

-- AddForeignKey
ALTER TABLE "RefreshToken" ADD CONSTRAINT "RefreshToken_pushDeviceId_fkey" FOREIGN KEY ("pushDeviceId") REFERENCES "Device"("id") ON DELETE SET NULL ON UPDATE CASCADE;

