-- Системийн ангилал (tenantId NULL): тенант зөвхөн УНШИНА. Өмнөх нэг policy-ийн
-- USING нь DELETE/UPDATE-д ч үйлчилдэг тул тусгаарлана — SELECT-д системийн мөр
-- нэмэлт policy-оор харагдана, бичих/засах/устгах нь зөвхөн өөрийн мөрт.
DROP POLICY IF EXISTS tenant_isolation ON "Category";
CREATE POLICY tenant_isolation ON "Category"
  USING (current_setting('app.bypass_rls', true) = 'on'
    OR "tenantId" = current_setting('app.tenant_id', true))
  WITH CHECK (current_setting('app.bypass_rls', true) = 'on'
    OR "tenantId" = current_setting('app.tenant_id', true));
CREATE POLICY system_category_read ON "Category" FOR SELECT
  USING ("tenantId" IS NULL);
