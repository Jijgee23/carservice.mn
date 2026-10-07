-- Cash ledger Phase C1: income/expense ledger (CashTransaction + types),
-- postpaid settlement + cash session tables (used by C2/C3), system/default
-- type seeding, and backfill of existing PAID order payments / completed
-- internal repairs. Idempotent: every statement is IF NOT EXISTS / ON CONFLICT /
-- NOT EXISTS guarded.
--
-- RLS bypass: the seeds and backfills touch every tenant. Non-superuser DB
-- roles are subject to FORCE ROW LEVEL SECURITY, so without the bypass flag
-- they would silently affect 0 rows.
SET LOCAL app.bypass_rls = 'on';

-- Enum -----------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'CashDirection') THEN
    CREATE TYPE "CashDirection" AS ENUM ('INCOME', 'EXPENSE');
  END IF;
END $$;

-- CashTransactionType ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS "CashTransactionType" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "direction" "CashDirection" NOT NULL,
  "name" TEXT NOT NULL,
  "systemKey" TEXT,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CashTransactionType_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CashTransactionType_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "CashTransactionType_tenantId_direction_name_key" ON "CashTransactionType"("tenantId", "direction", "name");
CREATE UNIQUE INDEX IF NOT EXISTS "CashTransactionType_tenantId_systemKey_key" ON "CashTransactionType"("tenantId", "systemKey");

-- PostpaidSettlement (Phase C2 uses it) ---------------------------------------
CREATE TABLE IF NOT EXISTS "PostpaidSettlement" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "branchId" TEXT NOT NULL,
  "customerId" TEXT NOT NULL,
  "amount" DECIMAL(12,2) NOT NULL,
  "method" "OrderPaymentMethod" NOT NULL,
  "bank" TEXT,
  "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "voidedAt" TIMESTAMP(3),
  "voidedById" TEXT,
  "voidReason" TEXT,
  CONSTRAINT "PostpaidSettlement_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PostpaidSettlement_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "PostpaidSettlement_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "PostpaidSettlement_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "PostpaidSettlement_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "PostpaidSettlement_voidedById_fkey" FOREIGN KEY ("voidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CashSession (Phase C3 uses it) -----------------------------------------------
CREATE TABLE IF NOT EXISTS "CashSession" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "branchId" TEXT NOT NULL,
  "openedById" TEXT NOT NULL,
  "openedAt" TIMESTAMP(3) NOT NULL,
  "openingCash" DECIMAL(12,2) NOT NULL,
  "closedById" TEXT,
  "closedAt" TIMESTAMP(3),
  "countedCash" DECIMAL(12,2),
  "expectedCash" DECIMAL(12,2),
  "difference" DECIMAL(12,2),
  "note" TEXT,
  CONSTRAINT "CashSession_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CashSession_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "CashSession_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "CashSession_openedById_fkey" FOREIGN KEY ("openedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "CashSession_closedById_fkey" FOREIGN KEY ("closedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CashTransaction --------------------------------------------------------------
-- orderPaymentId / orderId are deliberately NOT foreign keys: a financial entry
-- must survive deletion of a cancelled payment / the order itself.
CREATE TABLE IF NOT EXISTS "CashTransaction" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "branchId" TEXT NOT NULL,
  "direction" "CashDirection" NOT NULL,
  "typeId" TEXT NOT NULL,
  "amount" DECIMAL(12,2) NOT NULL,
  "method" "OrderPaymentMethod" NOT NULL,
  "bank" TEXT,
  "occurredAt" TIMESTAMP(3) NOT NULL,
  "note" TEXT,
  "attachmentPath" TEXT,
  "taxIncluded" DECIMAL(12,2),
  "customerId" TEXT,
  "counterparty" TEXT,
  "orderPaymentId" TEXT,
  "orderId" TEXT,
  "settlementId" TEXT,
  "sessionId" TEXT,
  "reconciledAt" TIMESTAMP(3),
  "reconciledById" TEXT,
  "createdById" TEXT NOT NULL,
  "voidedAt" TIMESTAMP(3),
  "voidedById" TEXT,
  "voidReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CashTransaction_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CashTransaction_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "CashTransaction_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "CashTransaction_typeId_fkey" FOREIGN KEY ("typeId") REFERENCES "CashTransactionType"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "CashTransaction_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "CashTransaction_settlementId_fkey" FOREIGN KEY ("settlementId") REFERENCES "PostpaidSettlement"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "CashTransaction_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "CashSession"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "CashTransaction_reconciledById_fkey" FOREIGN KEY ("reconciledById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "CashTransaction_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "CashTransaction_voidedById_fkey" FOREIGN KEY ("voidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "CashTransaction_orderPaymentId_key" ON "CashTransaction"("orderPaymentId");
CREATE INDEX IF NOT EXISTS "CashTransaction_tenantId_branchId_occurredAt_idx" ON "CashTransaction"("tenantId", "branchId", "occurredAt");
CREATE INDEX IF NOT EXISTS "CashTransaction_tenantId_direction_typeId_idx" ON "CashTransaction"("tenantId", "direction", "typeId");
CREATE INDEX IF NOT EXISTS "CashTransaction_sessionId_idx" ON "CashTransaction"("sessionId");
CREATE INDEX IF NOT EXISTS "CashTransaction_orderId_idx" ON "CashTransaction"("orderId");

-- OrderPayment.settlementId (Phase C2) -----------------------------------------
ALTER TABLE "OrderPayment" ADD COLUMN IF NOT EXISTS "settlementId" TEXT;
CREATE INDEX IF NOT EXISTS "OrderPayment_settlementId_idx" ON "OrderPayment"("settlementId");
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'OrderPayment_settlementId_fkey') THEN
    ALTER TABLE "OrderPayment"
      ADD CONSTRAINT "OrderPayment_settlementId_fkey" FOREIGN KEY ("settlementId") REFERENCES "PostpaidSettlement"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- Row level security (same policy as the other tenant tables) ---------------------
ALTER TABLE "CashTransactionType" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CashTransactionType" FORCE ROW LEVEL SECURITY;
ALTER TABLE "CashTransaction" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CashTransaction" FORCE ROW LEVEL SECURITY;
ALTER TABLE "PostpaidSettlement" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PostpaidSettlement" FORCE ROW LEVEL SECURITY;
ALTER TABLE "CashSession" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CashSession" FORCE ROW LEVEL SECURITY;

DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['CashTransactionType', 'CashTransaction', 'PostpaidSettlement', 'CashSession'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = t AND policyname = 'tenant_isolation') THEN
      EXECUTE format(
        'CREATE POLICY tenant_isolation ON %I USING (current_setting(''app.bypass_rls'', true) = ''on'' OR "tenantId" = current_setting(''app.tenant_id'', true)) WITH CHECK (current_setting(''app.bypass_rls'', true) = ''on'' OR "tenantId" = current_setting(''app.tenant_id'', true))',
        t
      );
    END IF;
  END LOOP;
END $$;

-- Adopt: a pre-existing editable type with the same tenant/direction/name as a system
-- type becomes that system type (else the unique key would block seeding).
UPDATE "CashTransactionType" ct
SET "systemKey" = v.system_key, "isActive" = true, "updatedAt" = NOW()
FROM (VALUES
  ('INCOME',  'Засварын орлого',        'ORDER_PAYMENT'),
  ('INCOME',  'Дараа тооцоо',           'POSTPAID_SETTLEMENT'),
  ('EXPENSE', 'Дотоод засварын зардал', 'INTERNAL_REPAIR')
) AS v(direction, name, system_key)
WHERE ct."systemKey" IS NULL
  AND ct."direction" = v.direction::"CashDirection"
  AND ct."name" = v.name
  AND NOT EXISTS (SELECT 1 FROM "CashTransactionType" x WHERE x."tenantId" = ct."tenantId" AND x."systemKey" = v.system_key);

-- Seed system + default types for every existing tenant ---------------------------
-- (new tenants are seeded lazily by lib/cash/types.ts ensureSystemTypes).
INSERT INTO "CashTransactionType" ("id", "tenantId", "direction", "name", "systemKey", "isActive", "createdAt", "updatedAt")
SELECT 'c' || substr(md5(random()::text || clock_timestamp()::text || t."id" || v.name), 1, 24),
       t."id", v.direction::"CashDirection", v.name, v.system_key, true, NOW(), NOW()
FROM "Tenant" t
CROSS JOIN (VALUES
  ('INCOME',  'Засварын орлого',          'ORDER_PAYMENT'),
  ('INCOME',  'Дараа тооцоо',             'POSTPAID_SETTLEMENT'),
  ('EXPENSE', 'Дотоод засварын зардал',   'INTERNAL_REPAIR'),
  ('INCOME',  'Бусад орлого',             NULL),
  ('INCOME',  'Сэлбэг худалдаа',          NULL),
  ('EXPENSE', 'Сэлбэг худалдан авалт',    NULL),
  ('EXPENSE', 'Цалин, урьдчилгаа',        NULL),
  ('EXPENSE', 'Түрээс',                   NULL),
  ('EXPENSE', 'Ашиглалтын зардал',        NULL),
  ('EXPENSE', 'Бусад зардал',             NULL)
) AS v(direction, name, system_key)
ON CONFLICT DO NOTHING;

-- Backfill: every PAID order payment -> one income entry ----------------------------
-- createdById: the tenant's owner (User.isOwner = true, oldest first); if a
-- tenant has no owner row, its oldest non-deleted user, then oldest user.
-- Tenants with no user at all are skipped (createdById is NOT NULL).
-- Payments already attached to a postpaid settlement are skipped (C2 posts one
-- lump entry). occurredAt = COALESCE(paidAt, updatedAt).
INSERT INTO "CashTransaction" (
  "id", "tenantId", "branchId", "direction", "typeId", "amount", "method", "bank", "occurredAt",
  "customerId", "orderPaymentId", "orderId", "reconciledAt", "reconciledById", "createdById", "createdAt"
)
SELECT 'c' || substr(md5(random()::text || clock_timestamp()::text || p."id"), 1, 24),
       p."tenantId", o."branchId", 'INCOME'::"CashDirection", ty."id", p."amount", p."method", p."bank",
       COALESCE(p."paidAt", p."updatedAt"),
       o."customerId", p."id", p."orderId", p."reconciledAt", p."reconciledById", owner."id", NOW()
FROM "OrderPayment" p
JOIN "ServiceOrder" o ON o."id" = p."orderId"
JOIN "CashTransactionType" ty ON ty."tenantId" = p."tenantId" AND ty."systemKey" = 'ORDER_PAYMENT'
JOIN LATERAL (
  SELECT u."id" FROM "User" u
  WHERE u."tenantId" = p."tenantId"
  ORDER BY u."isOwner" DESC, (u."deletedAt" IS NULL) DESC, u."createdAt" ASC, u."id" ASC
  LIMIT 1
) owner ON true
WHERE p."status" = 'PAID'
  AND p."settlementId" IS NULL
  AND NOT EXISTS (SELECT 1 FROM "CashTransaction" c WHERE c."orderPaymentId" = p."id");

-- Backfill: COMPLETED internal repairs -> one INTERNAL_REPAIR expense -------------------
-- amount = order total (zero-total orders are skipped), method OTHER,
-- occurredAt = COALESCE(completedAt, updatedAt).
INSERT INTO "CashTransaction" (
  "id", "tenantId", "branchId", "direction", "typeId", "amount", "method", "occurredAt",
  "orderId", "createdById", "createdAt"
)
SELECT 'c' || substr(md5(random()::text || clock_timestamp()::text || o."id"), 1, 24),
       o."tenantId", o."branchId", 'EXPENSE'::"CashDirection", ty."id", o."totalAmount", 'OTHER'::"OrderPaymentMethod",
       COALESCE(o."completedAt", o."updatedAt"),
       o."id", owner."id", NOW()
FROM "ServiceOrder" o
JOIN "CashTransactionType" ty ON ty."tenantId" = o."tenantId" AND ty."systemKey" = 'INTERNAL_REPAIR'
JOIN LATERAL (
  SELECT u."id" FROM "User" u
  WHERE u."tenantId" = o."tenantId"
  ORDER BY u."isOwner" DESC, (u."deletedAt" IS NULL) DESC, u."createdAt" ASC, u."id" ASC
  LIMIT 1
) owner ON true
WHERE o."isInternal" = true
  AND o."status" = 'COMPLETED'
  AND COALESCE(o."totalAmount", 0) > 0
  AND NOT EXISTS (
    SELECT 1 FROM "CashTransaction" c
    WHERE c."orderId" = o."id" AND c."typeId" = ty."id" AND c."voidedAt" IS NULL
  );
