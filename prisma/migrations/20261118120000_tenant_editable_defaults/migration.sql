-- Ролийн эрхийг байгууллага өөрчлөх боломж АНХНААСАА НЭЭЛТТЭЙ (жишээ нь засварын хуудсанд
-- ажил, үйлчилгээ, сэлбэгийн үнэ засах orders.itemPrice). Систем админ роль бүр дээр аль
-- эрхийг түгжихээ /system/roles-оос тохируулна. Эмзэг эрхүүд (employees.create, employees.edit, employees.delete, audit.view, cash.manage, orders.closeUnpaidPostpaid, payments.delete)
-- анхнаасаа түгжигдсэн. Жагсаалт нь lib/roles/tenant-editable-defaults.ts-тэй ИЖИЛ байх ёстой
-- (tests/tenant-editable-defaults.test.ts шалгана).
--
-- Зөвхөн «одоогоор юу ч нээгээгүй» (хоосон) ролиудад хэрэглэнэ — админ аль хэдийн тохируулсан
-- ролийг дарж бичихгүй.

UPDATE "Role"
SET "tenantEditablePermissions" = ARRAY['employees.view','branches.view','branches.create','branches.edit','branches.delete','customers.view','customers.create','customers.edit','customers.delete','vehicles.view','vehicles.create','vehicles.edit','vehicles.delete','services.view','services.create','services.edit','services.delete','diagnostics.view','diagnostics.create','diagnostics.edit','diagnostics.delete','orders.view','orders.create','orders.edit','orders.delete','appointments.view','appointments.create','appointments.edit','appointments.delete','payments.view','payments.create','payments.edit','orders.assignable','orders.assign','orders.viewOwn','orders.editOwn','orders.itemStatus','orders.itemPrice','orders.itemHistory','customers.notify','employees.schedule']::TEXT[]
WHERE cardinality("tenantEditablePermissions") = 0;
