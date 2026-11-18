import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const code = (rel: string) =>
  readFileSync(resolve(root, rel), "utf8")
    .replace(/\r\n/g, "\n")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

test("migration: TenantPhoto has tenant + branch cascade FKs and an RLS tenant_isolation policy", () => {
  const sql = readFileSync(resolve(root, "prisma/migrations/20261118150000_tenant_photos/migration.sql"), "utf8");
  assert.match(sql, /CREATE TABLE "TenantPhoto"/);
  assert.match(sql, /"TenantPhoto_tenantId_fkey"[\s\S]*ON DELETE CASCADE/);
  assert.match(sql, /"TenantPhoto_branchId_fkey"[\s\S]*ON DELETE CASCADE/);
  assert.match(sql, /ALTER TABLE "TenantPhoto" ENABLE ROW LEVEL SECURITY/);
  assert.match(sql, /ALTER TABLE "TenantPhoto" FORCE ROW LEVEL SECURITY/);
  assert.match(sql, /CREATE POLICY tenant_isolation ON "TenantPhoto"/);
});

test("core: every query is tenant-scoped, files are validated by storage, failures clean up", () => {
  const s = code("lib/tenant-photos.ts");
  assert.match(s, /saveUpload\(file, "gallery"\)/);
  assert.match(s, /findFirst\(\{ where: \{ id: branchId, tenantId: actor\.tenantId \}/);
  assert.match(s, /MAX_PHOTOS_PER_SCOPE/);
  assert.match(s, /deleteUpload\(/);
  // rollback of partially saved files
  assert.match(s, /deleteMany\(\{ where: \{ tenantId: actor\.tenantId, url: \{ in: savedPaths \}/);
  // RLS gotcha: no bare `return prisma…`
  assert.doesNotMatch(s, /return prisma\./);
  // removal can only target the actor's tenant
  assert.match(s, /findFirst\(\{\s*where: \{ id: photoId, tenantId: actor\.tenantId/);
});

test("permissions: org photos = owner only, branch photos = branches.edit (web action + mobile routes)", () => {
  const action = code("app/_actions/tenant-photos.ts");
  assert.match(action, /if \(!user\.isOwner\) throw/);
  assert.match(action, /canEdit\(user, "branches"\)/);
  // delete decides the scope from the DB row, not from client input
  assert.match(action, /tenantPhoto\.findFirst\(\{\s*where: \{ id: photoId, tenantId: user\.tenantId \}/);

  const list = code("app/api/v1/tenant/photos/route.ts");
  assert.match(list, /requireApiUser\(req\)/);
  assert.match(list, /auth\.user\.isOwner/);
  assert.match(list, /requirePermission\(auth\.user, "branches\.edit"\)/);
  const del = code("app/api/v1/tenant/photos/[id]/route.ts");
  assert.match(del, /requireApiUser\(req\)/);
  assert.match(del, /auth\.user\.isOwner/);
  assert.match(del, /requirePermission\(auth\.user, "branches\.edit"\)/);
  assert.match(del, /tenantId: auth\.user\.tenantId/);
});

test("display: public branch/org pages, dashboard and customer API all surface the photos", () => {
  assert.match(code("app/(app)/org/[slug]/branch/[branchId]/page.tsx"), /<PhotoGallery photos=\{photos\}/);
  assert.match(code("app/(app)/org/[slug]/page.tsx"), /<PhotoGallery photos=\{orgPhotos\}/);
  assert.match(code("app/dashboard/branches/[id]/page.tsx"), /<PhotoGalleryManager[\s\S]*branchId=\{branch\.id\}/);
  assert.match(code("app/dashboard/settings/page.tsx"), /<PhotoGalleryManager/);
  const api = code("app/api/v1/app/orgs/[slug]/route.ts");
  assert.match(api, /photos: \{ where: \{ branchId: null \}/);
  assert.match(api, /photos: \{ orderBy: PHOTO_ORDER/);
});
