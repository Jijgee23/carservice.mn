-- Ролийн эрхийн 3 давхарга: систем админ (өөрчилж болох эрх) → байгууллага (роль override)
-- → ажилтан (хязгаарлалт). Бүх шинэ утга хоосон = одоогийн зан төлөв өөрчлөгдөхгүй,
-- тиймээс backfill шаардлагагүй. lib/auth/effective-permissions.ts.

-- AlterTable
ALTER TABLE "Role" ADD COLUMN "tenantEditablePermissions" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "User" ADD COLUMN "deniedPermissions" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateTable
CREATE TABLE "TenantRoleOverride" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "addPermissions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "removePermissions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TenantRoleOverride_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TenantRoleOverride_tenantId_roleId_key" ON "TenantRoleOverride"("tenantId", "roleId");
CREATE INDEX "TenantRoleOverride_roleId_idx" ON "TenantRoleOverride"("roleId");

-- AddForeignKey
ALTER TABLE "TenantRoleOverride" ADD CONSTRAINT "TenantRoleOverride_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TenantRoleOverride" ADD CONSTRAINT "TenantRoleOverride_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Tenant RLS
ALTER TABLE "TenantRoleOverride" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "TenantRoleOverride" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "TenantRoleOverride"
  USING (current_setting('app.bypass_rls', true) = 'on' OR "tenantId" = current_setting('app.tenant_id', true))
  WITH CHECK (current_setting('app.bypass_rls', true) = 'on' OR "tenantId" = current_setting('app.tenant_id', true));
