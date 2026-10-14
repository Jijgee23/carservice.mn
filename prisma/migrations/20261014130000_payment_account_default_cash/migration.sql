-- Төлбөрийн аргууд: «Бэлэн» байгууллага бүрт автоматаар (тенант өөрөө бүртгэхгүй). Байгаа тенант бүрт нэг мөр нөхнө;
-- шинэ тенантад бүртгэлийн үед (app/_actions/auth.ts → ensureCashAccount) үүснэ. Идемпотент.
-- RLS bypass: PaymentAccount нь FORCE RLS — үгүй бол INSERT нь WITH CHECK-д унана (20261012100000_payment_accounts-тэй ижил).
SET LOCAL app.bypass_rls = 'on';

INSERT INTO "PaymentAccount" ("id", "tenantId", "type", "name", "isActive", "updatedAt")
SELECT 'pa_cash_' || md5(t."id"), t."id", 'CASH', 'Бэлэн', true, CURRENT_TIMESTAMP
FROM "Tenant" t
WHERE NOT EXISTS (SELECT 1 FROM "PaymentAccount" p WHERE p."tenantId" = t."id" AND p."type" = 'CASH')
ON CONFLICT DO NOTHING;

-- Байгаа (идэвхгүй болгосон) Бэлэн мөрийг идэвхжүүлнэ — Бэлэн унтраагддаггүй болсон.
UPDATE "PaymentAccount" SET "isActive" = true, "updatedAt" = CURRENT_TIMESTAMP WHERE "type" = 'CASH' AND "isActive" = false;

-- Нэг ч тенант Бэлэнгүй үлдсэн бол (ж: bypass ажиллаагүй) амжилттай гэж мэдээлэхийн оронд зогсооно.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "Tenant" t WHERE NOT EXISTS (SELECT 1 FROM "PaymentAccount" p WHERE p."tenantId" = t."id" AND p."type" = 'CASH')) THEN
    RAISE EXCEPTION 'default cash backfill missed a tenant';
  END IF;
END $$;
