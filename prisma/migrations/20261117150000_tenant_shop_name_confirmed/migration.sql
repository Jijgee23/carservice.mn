-- Засварын (харагдах) нэрээ эзэн баталгаажуулсан огноо. Хувь хүний регистрээр
-- бүртгүүлсэн байгууллагын нэр нь эзний овог нэр байдаг тул эзэн dashboard-д
-- нэвтрэхэд засварын нэрээ заавал оруулна.

-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN     "shopNameConfirmedAt" TIMESTAMP(3);

-- Backfill: хувь хүн БИШ (байгууллага: 7 оронтой регистр г.м.) бүртгэл
-- «Засварын нэр»-ээ бүртгэлийн үед оруулсан → баталгаажсан. Хувь хүн
-- (2 кирилл үсэг + 8 цифр, lib/tenant-regno.ts PERSON_RE) null хэвээр.
UPDATE "Tenant"
SET "shopNameConfirmedAt" = CURRENT_TIMESTAMP
WHERE NOT ("registerNumber" ~ '^[А-ЯЁӨҮ]{2}[0-9]{8}$');
