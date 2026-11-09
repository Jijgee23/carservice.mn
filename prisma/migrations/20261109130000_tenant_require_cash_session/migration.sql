-- Төлбөр бүртгэхийн өмнө касс (ээлж) заавал нээх эсэх — анхдагч true (одоогийн зан төлөв хэвээр).
ALTER TABLE "Tenant" ADD COLUMN "requireCashSession" BOOLEAN NOT NULL DEFAULT true;
