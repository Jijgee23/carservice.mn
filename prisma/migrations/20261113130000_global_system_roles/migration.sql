-- DataMigration
-- Роль tenant бүрт тусдаа байхаа больж СИСТЕМИЙН (глобал) болно. Супер админ
-- /system/roles-оос удирдана; tenant зөвхөн эдгээрээс сонгож ажилтанд онооно.
-- Үндсэн 5 роль (key-тэй) — анхдагч эрхүүд нь lib/roles/system-roles.ts-тэй ижил.
-- Хуучин tenant ролиудыг нэрээр нь (alias-тай) тааруулж шилжүүлнэ; таарахгүй бол
-- ажилтны roleId = NULL (tenant-admin дахин онооно).

-- User дээр FORCE RLS байгаа тул энэ session-д bypass.
SELECT set_config('app.bypass_rls', 'on', false);

-- 1. Role глобал хүснэгт болно — RLS-гүй.
DROP POLICY IF EXISTS tenant_isolation ON "Role";
ALTER TABLE "Role" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "Role" DISABLE ROW LEVEL SECURITY;

-- 2. Шинэ баганууд, tenantId түр nullable.
ALTER TABLE "Role" ADD COLUMN "key" TEXT;
ALTER TABLE "Role" ADD COLUMN "sortOrder" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Role" ALTER COLUMN "tenantId" DROP NOT NULL;

-- 3. Үндсэн 5 роль.
INSERT INTO "Role" ("id", "key", "name", "description", "permissions", "isActive", "sortOrder", "tenantId", "createdAt", "updatedAt") VALUES
  ('sysrole_mechanic', 'MECHANIC', 'Засварчин', 'Өөрт оноогдсон засварыг гүйцэтгэж, оношилгоо хийнэ.',
    ARRAY['orders.viewOwn','orders.editOwn','orders.assignable','orders.itemStatus','orders.itemHistory','diagnostics.view','diagnostics.create','diagnostics.edit','vehicles.view','customers.view','services.view'],
    true, 10, NULL, NOW(), NOW()),
  ('sysrole_engineer', 'ENGINEER', 'Инженер', 'Засвар хүлээн авч, хуваарилж, үнэ болон оношилгоог хариуцна.',
    ARRAY['orders.view','orders.create','orders.edit','orders.assign','orders.assignable','orders.itemStatus','orders.itemPrice','orders.itemHistory','diagnostics.view','diagnostics.create','diagnostics.edit','vehicles.view','vehicles.create','vehicles.edit','customers.view','customers.create','customers.edit','services.view','appointments.view','appointments.create','appointments.edit','employees.view'],
    true, 20, NULL, NOW(), NOW()),
  ('sysrole_accountant', 'ACCOUNTANT', 'Нягтлан', 'Төлбөр, касс, тооцоо болон санхүүгийн хяналт.',
    ARRAY['payments.view','payments.create','payments.edit','orders.view','orders.itemHistory','orders.closeUnpaidPostpaid','cash.manage','customers.view','vehicles.view','services.view','audit.view'],
    true, 30, NULL, NOW(), NOW()),
  ('sysrole_cashier', 'CASHIER', 'Кассын нярав', 'Төлбөр хүлээн авч, кассын гүйлгээ хөтөлнө.',
    ARRAY['payments.view','payments.create','cash.manage','orders.view','customers.view','vehicles.view','services.view'],
    true, 40, NULL, NOW(), NOW()),
  ('sysrole_manager', 'MANAGER', 'Менежер', 'Бүх мэдээллийг зөвхөн харна (засах эрхгүй).',
    ARRAY['employees.view','branches.view','customers.view','vehicles.view','services.view','diagnostics.view','orders.view','appointments.view','payments.view','audit.view','orders.itemHistory'],
    true, 50, NULL, NOW(), NOW());

-- 4. Ажилтнуудыг хуучин ролийн нэрээр системийн рольд шилжүүлнэ.
UPDATE "User" u
SET "roleId" = CASE
    WHEN lower(btrim(r."name")) IN ('засварчин', 'механик', 'засварчин механик', 'мастер', 'засварын мастер', 'туслах', 'туслах засварчин', 'ажилчин', 'ажилтан') THEN 'sysrole_mechanic'
    WHEN lower(btrim(r."name")) IN ('инженер', 'ахлах инженер', 'сервис инженер', 'засварын инженер', 'салбарын мастер', 'ахлах мастер') THEN 'sysrole_engineer'
    WHEN lower(btrim(r."name")) IN ('нягтлан', 'нягтлан бодогч', 'ня-бо', 'нябо') THEN 'sysrole_accountant'
    WHEN lower(btrim(r."name")) IN ('кассын нярав', 'касс', 'кассчин', 'нярав', 'кассир') THEN 'sysrole_cashier'
    WHEN lower(btrim(r."name")) IN ('менежер', 'сервис менежер', 'менежир') THEN 'sysrole_manager'
    ELSE NULL
  END
FROM "Role" r
WHERE u."roleId" = r."id" AND r."tenantId" IS NOT NULL;

-- 5. Хуучин tenant ролиуд устна.
DELETE FROM "Role" WHERE "tenantId" IS NOT NULL;

-- 6. tenantId багана, хуучин index/constraint.
ALTER TABLE "Role" DROP CONSTRAINT IF EXISTS "Role_tenantId_fkey";
DROP INDEX IF EXISTS "Role_tenantId_name_key";
DROP INDEX IF EXISTS "Role_tenantId_isActive_idx";
ALTER TABLE "Role" DROP COLUMN "tenantId";

CREATE UNIQUE INDEX "Role_key_key" ON "Role"("key");
CREATE UNIQUE INDEX "Role_name_key" ON "Role"("name");
CREATE INDEX "Role_isActive_idx" ON "Role"("isActive");
