-- Хэрэглэгч засваргүйгээр ч салбарт үнэлгээ өгч болно (/discover).
ALTER TABLE "Review" ALTER COLUMN "orderId" DROP NOT NULL;

-- Засваргүй үнэлгээ: нэг хэрэглэгч нэг салбарт нэг (дахин өгвөл засна).
CREATE UNIQUE INDEX "Review_accountId_branchId_no_order_key"
  ON "Review" ("accountId", "branchId")
  WHERE "orderId" IS NULL;
