-- CreateEnum
CREATE TYPE "QuoteRequestStatus" AS ENUM ('NEW', 'CONTACTED', 'CLOSED');

-- CreateEnum
CREATE TYPE "QuoteReplyChannel" AS ENUM ('SMS', 'EMAIL');

-- CreateTable
CREATE TABLE "QuoteRequest" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "orgName" TEXT NOT NULL,
    "contactName" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "email" TEXT,
    "branchCount" INTEGER,
    "modules" TEXT[],
    "message" TEXT,
    "status" "QuoteRequestStatus" NOT NULL DEFAULT 'NEW',
    "adminNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QuoteRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuoteRequestReply" (
    "id" TEXT NOT NULL,
    "quoteRequestId" TEXT NOT NULL,
    "channel" "QuoteReplyChannel" NOT NULL,
    "recipient" TEXT NOT NULL,
    "subject" TEXT,
    "body" TEXT NOT NULL,
    "ok" BOOLEAN NOT NULL,
    "error" TEXT,
    "sentById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QuoteRequestReply_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "QuoteRequest_status_createdAt_idx" ON "QuoteRequest"("status", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "QuoteRequest_tenantId_idx" ON "QuoteRequest"("tenantId");

-- CreateIndex
CREATE INDEX "QuoteRequestReply_quoteRequestId_createdAt_idx" ON "QuoteRequestReply"("quoteRequestId", "createdAt");

-- AddForeignKey
ALTER TABLE "QuoteRequest" ADD CONSTRAINT "QuoteRequest_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuoteRequestReply" ADD CONSTRAINT "QuoteRequestReply_quoteRequestId_fkey" FOREIGN KEY ("quoteRequestId") REFERENCES "QuoteRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuoteRequestReply" ADD CONSTRAINT "QuoteRequestReply_sentById_fkey" FOREIGN KEY ("sentById") REFERENCES "SuperAdmin"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- RLS: tenant_isolation (Feedback-тэй адил) — нүүр хуудаснаас ирсэн мөрд
-- tenantId NULL тул зөвхөн app.bypass_rls='on' (систем админ, public action) үед.
ALTER TABLE "QuoteRequest" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "QuoteRequest" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "QuoteRequest"
  USING (current_setting('app.bypass_rls', true) = 'on' OR "tenantId" = current_setting('app.tenant_id', true))
  WITH CHECK (current_setting('app.bypass_rls', true) = 'on' OR "tenantId" = current_setting('app.tenant_id', true));
