-- Ангиллын төрөл (kind) + системийн (бүх тенантад нийтлэг, тенант засахгүй)
-- сэлбэгийн ангиллууд.

-- 1) Төрөл: null = бүх төрөлд (хуучин ангиллууд хэвээр ажиллана).
ALTER TABLE "Category" ADD COLUMN "kind" "ServiceKind";
CREATE INDEX "Category_kind_idx" ON "Category"("kind");

-- 2) Системийн ангилал: tenantId NULL; системийн түлхүүр зөвхөн тенантын ангилалд (app түвшинд) заавал.
ALTER TABLE "Category" ALTER COLUMN "tenantId" DROP NOT NULL;
ALTER TABLE "Category" ALTER COLUMN "systemServiceKeyId" DROP NOT NULL;
-- (tenantId, name) unique нь NULL-д үйлчлэхгүй тул системийн нэрсэд тусдаа.
CREATE UNIQUE INDEX "Category_system_name_key" ON "Category"("name") WHERE "tenantId" IS NULL;

-- 3) RLS: тенант өөрийнхөө + системийн мөрийг УНШИНА, зөвхөн өөрийнхөө мөрийг БИЧНЭ.
DROP POLICY IF EXISTS tenant_isolation ON "Category";
CREATE POLICY tenant_isolation ON "Category"
  USING (current_setting('app.bypass_rls', true) = 'on'
    OR "tenantId" = current_setting('app.tenant_id', true)
    OR "tenantId" IS NULL)
  WITH CHECK (current_setting('app.bypass_rls', true) = 'on'
    OR "tenantId" = current_setting('app.tenant_id', true));

-- 4) Системийн сэлбэгийн 34 ангилал.
INSERT INTO "Category" ("id", "name", "kind", "updatedAt") VALUES
  ('syscat_goods_01', 'Амортизатор/Пүрш', 'GOODS', NOW()),
  ('syscat_goods_02', 'Салхины шил цэвэрлэх систем', 'GOODS', NOW()),
  ('syscat_goods_03', 'Шүүлтүүр', 'GOODS', NOW()),
  ('syscat_goods_04', 'Хөдөлгүүр', 'GOODS', NOW()),
  ('syscat_goods_05', 'Ремень дамжуулга', 'GOODS', NOW()),
  ('syscat_goods_06', 'Явах анги', 'GOODS', NOW()),
  ('syscat_goods_07', 'Ачааны тоноглол', 'GOODS', NOW()),
  ('syscat_goods_08', 'Обуд/Дугуй', 'GOODS', NOW()),
  ('syscat_goods_09', 'Хөтлөх тэнхлэг', 'GOODS', NOW()),
  ('syscat_goods_10', 'Хөргөлтийн систем', 'GOODS', NOW()),
  ('syscat_goods_11', 'Цахилгаан', 'GOODS', NOW()),
  ('syscat_goods_12', 'Тоормосны систем', 'GOODS', NOW()),
  ('syscat_goods_13', 'Дугуйн хөтлөгч', 'GOODS', NOW()),
  ('syscat_goods_14', 'Жолооны механизм', 'GOODS', NOW()),
  ('syscat_goods_15', 'Нэмэлт хэрэгсэл', 'GOODS', NOW()),
  ('syscat_goods_16', 'Очлуур/Халаагч/Катушка', 'GOODS', NOW()),
  ('syscat_goods_17', 'Яндангийн систем', 'GOODS', NOW()),
  ('syscat_goods_18', 'Хайбрид/Цахилгаан хөтлөгч', 'GOODS', NOW()),
  ('syscat_goods_19', 'Авцуулах холбоо/Холбогдох эд анги', 'GOODS', NOW()),
  ('syscat_goods_20', 'Хурдны хайрцаг', 'GOODS', NOW()),
  ('syscat_goods_21', 'Тос тослогоо, шингэн бүтээгдэхүүн', 'GOODS', NOW()),
  ('syscat_goods_22', 'Их бие', 'GOODS', NOW()),
  ('syscat_goods_23', 'Эйр кондейшн', 'GOODS', NOW()),
  ('syscat_goods_24', 'Комфорт систем', 'GOODS', NOW()),
  ('syscat_goods_25', 'Агаарын систем', 'GOODS', NOW()),
  ('syscat_goods_26', 'Түлш холимгийн бүрдэл', 'GOODS', NOW()),
  ('syscat_goods_27', 'Түлш хуваарилах систем', 'GOODS', NOW()),
  ('syscat_goods_28', 'Халаалт/Агааржуулалт', 'GOODS', NOW()),
  ('syscat_goods_29', 'Дотор салооны тоноглол', 'GOODS', NOW()),
  ('syscat_goods_30', 'Цоожны систем', 'GOODS', NOW()),
  ('syscat_goods_31', 'Багаж тоног төхөөрөмж', 'GOODS', NOW()),
  ('syscat_goods_32', 'Аюулгүй байдлын систем', 'GOODS', NOW()),
  ('syscat_goods_33', 'Нэмэлт дамжуулга төхөөрөмж', 'GOODS', NOW()),
  ('syscat_goods_34', 'Үйлчилгээний материал', 'GOODS', NOW())
ON CONFLICT DO NOTHING;
