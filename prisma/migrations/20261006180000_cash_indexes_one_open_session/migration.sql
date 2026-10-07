-- PRE-CHECK (run on prod BEFORE applying): the partial unique index below fails if any branch has 2+ OPEN sessions.
--   SELECT "branchId", COUNT(*) AS open_sessions FROM "CashSession" WHERE "closedAt" IS NULL GROUP BY "branchId" HAVING COUNT(*) > 1;
-- If this returns rows, close the duplicate sessions first (keep the newest open one), then apply this migration.

-- Cash section: hot-path indexes + DB-level "one OPEN CashSession per branch".
CREATE INDEX IF NOT EXISTS "CashSession_tenantId_branchId_closedAt_idx" ON "CashSession"("tenantId", "branchId", "closedAt");
CREATE INDEX IF NOT EXISTS "CashSession_tenantId_branchId_openedAt_idx" ON "CashSession"("tenantId", "branchId", "openedAt");
CREATE INDEX IF NOT EXISTS "CashTransaction_settlementId_idx" ON "CashTransaction"("settlementId");
CREATE INDEX IF NOT EXISTS "PostpaidSettlement_tenantId_branchId_createdAt_idx" ON "PostpaidSettlement"("tenantId", "branchId", "createdAt");
CREATE INDEX IF NOT EXISTS "PostpaidSettlement_tenantId_customerId_idx" ON "PostpaidSettlement"("tenantId", "customerId");

-- Partial unique index: Prisma cannot express it, so it exists only here (see comment in schema.prisma, model CashSession).
-- Fails if a branch already has 2+ open sessions; close the duplicates first.
CREATE UNIQUE INDEX IF NOT EXISTS "CashSession_one_open_per_branch_key" ON "CashSession"("branchId") WHERE "closedAt" IS NULL;
