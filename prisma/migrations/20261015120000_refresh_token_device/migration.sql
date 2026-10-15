-- Ажилтны мобайл нэвтрэлт: ямар төхөөрөмж (төрөл, загвар, OS) болон хаанаас (lat/lng) нэвтэрснийг хадгална.
-- AlterTable
ALTER TABLE "RefreshToken" ADD COLUMN     "deviceModel" TEXT,
ADD COLUMN     "deviceOs" TEXT,
ADD COLUMN     "deviceType" "DevicePlatform",
ADD COLUMN     "latitude" DOUBLE PRECISION,
ADD COLUMN     "longitude" DOUBLE PRECISION;

