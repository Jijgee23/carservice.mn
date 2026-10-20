-- Мобайл аппуудын (хэрэглэгч / засварын газар) App Store, Google Play холбоос.
ALTER TABLE "PlatformSetting" ADD COLUMN "customerAppStoreUrl" TEXT;
ALTER TABLE "PlatformSetting" ADD COLUMN "customerPlayStoreUrl" TEXT;
ALTER TABLE "PlatformSetting" ADD COLUMN "businessAppStoreUrl" TEXT;
ALTER TABLE "PlatformSetting" ADD COLUMN "businessPlayStoreUrl" TEXT;
