-- Байгууллага (Tenant) ямар үйлчилгээний төрөл (SystemServiceKey) үзүүлдэг вэ —
-- /book, /discover-ийн «ямар ажил хийлгэх вэ?» хайлтад. Эзэн dashboard-д
-- нэвтрэхэд serviceKeysConfirmedAt null бол заавал сонгуулна.

-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN     "serviceKeysConfirmedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "_TenantServiceKeys" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,
    CONSTRAINT "_TenantServiceKeys_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE INDEX "_TenantServiceKeys_B_index" ON "_TenantServiceKeys"("B");

-- AddForeignKey
ALTER TABLE "_TenantServiceKeys" ADD CONSTRAINT "_TenantServiceKeys_A_fkey" FOREIGN KEY ("A") REFERENCES "SystemServiceKey"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_TenantServiceKeys" ADD CONSTRAINT "_TenantServiceKeys_B_fkey" FOREIGN KEY ("B") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: тенантын идэвхтэй ангилалд аль хэдийн холбогдсон төрлүүдийг урьдчилан
-- сонгоно (сонголтын хуудас хоосон биш эхэлнэ). confirmedAt null хэвээр — эзэн
-- заавал хянаж баталгаажуулна.
INSERT INTO "_TenantServiceKeys" ("A", "B")
SELECT DISTINCT c."systemServiceKeyId", c."tenantId"
FROM "Category" c
JOIN "SystemServiceKey" k ON k."id" = c."systemServiceKeyId"
WHERE c."isActive" AND c."tenantId" IS NOT NULL AND c."systemServiceKeyId" IS NOT NULL
ON CONFLICT DO NOTHING;
