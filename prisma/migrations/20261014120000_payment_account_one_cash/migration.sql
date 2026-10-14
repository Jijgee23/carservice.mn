-- Төлбөрийн аргууд: «Бэлэн» (CASH) тенант бүрт нэг л бүртгэгдэнэ (идэвхгүй мөр ч тооцогдоно).
-- Prisma schema-д partial unique илэрхийлэгдэхгүй тул энд raw SQL-ээр (CashSession_one_open_per_branch_key-тэй ижил).
CREATE UNIQUE INDEX IF NOT EXISTS "PaymentAccount_one_cash_per_tenant_key" ON "PaymentAccount"("tenantId") WHERE "type" = 'CASH';
