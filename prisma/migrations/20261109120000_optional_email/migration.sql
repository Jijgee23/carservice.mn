-- Бүртгэлд имэйл заавал биш: имэйлгүй тенант/хэрэглэгч утсаар нэвтэрнэ.
-- Unique хэвээр (Postgres олон NULL-ийг зөвшөөрнө).
ALTER TABLE "Tenant" ALTER COLUMN "email" DROP NOT NULL;
ALTER TABLE "User" ALTER COLUMN "email" DROP NOT NULL;
