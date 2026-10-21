// Ангиллын төрөл (Category.kind) + системийн (бүх тенантад нийтлэг, тенант
// засахгүй) сэлбэгийн ангиллууд.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

process.env.DATABASE_URL ??= "postgresql://unused/unused";
process.env.SESSION_SECRET ??= "unit-test-placeholder-secret-value-not-real-00";

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

test("kind rules: typed categories only for their kind, untyped (legacy) for all", async () => {
  const { categoryAllowsKind, categoryKindLabel, categoriesForKindWhere, BOOKABLE_CATEGORY_WHERE } = await import("../lib/categories");
  assert.equal(categoryAllowsKind(null, "GOODS"), true);
  assert.equal(categoryAllowsKind("GOODS", "GOODS"), true);
  assert.equal(categoryAllowsKind("GOODS", "LABOR"), false);
  assert.equal(categoryAllowsKind("DIAGNOSTIC", "LABOR"), false);
  assert.equal(categoryKindLabel(null), "Бүх төрөлд");
  assert.deepEqual(categoriesForKindWhere("t1", "GOODS"), {
    AND: [{ OR: [{ tenantId: "t1" }, { tenantId: null }] }, { OR: [{ kind: "GOODS" }, { kind: null }] }],
  });
  // Онлайн захиалга — зөвхөн ажил үйлчилгээ (эсвэл хуучин бүх төрлийн) ангилал.
  assert.deepEqual(BOOKABLE_CATEGORY_WHERE, { OR: [{ kind: "LABOR" }, { kind: null }] });
});

test("migration seeds 34 unique system GOODS categories and splits read/write RLS", () => {
  const seed = read("prisma/migrations/20261021090000_category_kind_system_goods/migration.sql");
  const rows = [...seed.matchAll(/\('syscat_goods_\d+', '([^']+)', 'GOODS', NOW\(\)\)/g)].map((m) => m[1]!);
  assert.equal(rows.length, 34);
  assert.equal(new Set(rows).size, 34);
  for (const name of ["Амортизатор/Пүрш", "Шүүлтүүр", "Тос тослогоо, шингэн бүтээгдэхүүн", "Түлш холимгийн бүрдэл", "Үйлчилгээний материал"]) {
    assert.ok(rows.includes(name), name);
  }
  assert.ok(!rows.some((n) => /\s{2}/.test(n)), "no double spaces");
  assert.match(seed, /ALTER COLUMN "tenantId" DROP NOT NULL/);
  assert.match(seed, /CREATE UNIQUE INDEX "Category_system_name_key" ON "Category"\("name"\) WHERE "tenantId" IS NULL/);
  const policy = read("prisma/migrations/20261021091000_category_system_read_policy/migration.sql");
  // Тенант зөвхөн өөрийн мөрийг бичнэ/засна/устгана; системийн мөрийг зөвхөн УНШИНА.
  assert.match(policy, /CREATE POLICY tenant_isolation ON "Category"\s+USING \(current_setting\('app\.bypass_rls', true\) = 'on'\s+OR "tenantId" = current_setting\('app\.tenant_id', true\)\)/);
  assert.match(policy, /CREATE POLICY system_category_read ON "Category" FOR SELECT\s+USING \("tenantId" IS NULL\);/);
});

test("online booking surfaces only use bookable (labor) categories", () => {
  for (const f of [
    "lib/discovery-catalog.ts",
    "app/_actions/book.ts",
    "app/(app)/book/branch/[branchId]/page.tsx",
    "app/(app)/org/[slug]/page.tsx",
    "app/(app)/org/[slug]/branch/[branchId]/page.tsx",
    "app/api/v1/app/orgs/[slug]/route.ts",
    "lib/appointment-reservations.ts",
    "lib/appointments/day-availability.ts",
    "lib/appointments/appointment-bulk-commands.ts",
    "app/dashboard/appointments/page.tsx",
  ]) {
    assert.match(read(f), /BOOKABLE_CATEGORY_WHERE/, f);
  }
});

test("service pickers/validation include system categories filtered by kind", () => {
  const form = read("app/dashboard/services/service-form.tsx");
  assert.match(form, /categoryAllowsKind\(c\.kind, type\)/);
  // 41 хүртэл ангилал (34 систем + өөрийн) — шууд бичиж хайна.
  assert.match(form, /searchable\s+searchPlaceholder="Ангиллын нэрээр хайх…"/);
  for (const f of ["app/dashboard/services/new/page.tsx", "app/dashboard/services/[id]/page.tsx"]) {
    assert.match(read(f), /where: \{ OR: \[\{ tenantId: user\.tenantId \}, \{ tenantId: null \}\] \}/, f);
  }
  const cmd = read("lib/services/service-commands.ts");
  assert.match(cmd, /categoryAllowsKind\(cat\.kind, serviceType\)/);
  assert.match(cmd, /mismatched\.has\(plan\.id\)/); // bulk change skips type-mismatched services
  assert.match(read("lib/services/service-create.ts"), /categoriesForKindWhere\(tenantId, kind\)/);
  // Тооллого/нөөцийн тайлан — сэлбэгийн системийн ангилал орно.
  assert.match(read("lib/stock-report.ts"), /OR: \[\{ tenantId \}, \{ tenantId: null \}\]/);
  assert.match(read("lib/stock-counts.ts"), /OR: \[\{ tenantId \}, \{ tenantId: null \}\]/);
});

test("tenants manage only their own categories; kind is validated against usage", () => {
  const actions = read("app/_actions/categories.ts");
  // Засах/устгах нь tenantId-аар — системийн мөр (tenantId null) хэзээ ч таарахгүй.
  assert.match(actions, /where: \{ id, tenantId: user\.tenantId \}/);
  assert.match(actions, /deleteMany\(\{\s*where: \{ id, tenantId: user\.tenantId \}/);
  assert.match(actions, /tenantId: null, name: \{ equals: data\.name, mode: "insensitive" \}/);
  assert.match(actions, /type: \{ not: data\.kind \}/);
  assert.match(actions, /kind: data\.kind,/);
  const section = read("app/dashboard/services/categories-section.tsx");
  assert.match(section, /name="kind"/);
  assert.match(section, /Системийн ангилал/);
});

test("super admin manages system goods categories; never touches tenant rows", () => {
  const actions = read("app/_actions/system-categories.ts");
  for (const fn of ["createSystemCategoryAction", "updateSystemCategoryAction", "deleteSystemCategoryAction"]) {
    const body = actions.slice(actions.indexOf(`export async function ${fn}`));
    assert.match(body.slice(0, 400), /await requireSuperAdmin\(\);/, fn);
  }
  assert.match(actions, /const SYSTEM_GOODS = \{ tenantId: null, kind: "GOODS" as const \};/);
  assert.match(actions, /kind: "GOODS", tenantId: null, systemServiceKeyId: null/);
  assert.match(actions, /updateMany\(\{\s*where: \{ id, \.\.\.SYSTEM_GOODS \}/);
  assert.match(actions, /deleteMany\(\{ where: \{ id, \.\.\.SYSTEM_GOODS \} \}\)/);
  assert.doesNotMatch(actions, /prisma\.category\.(update|delete)\(/);
  assert.match(read("app/_components/system-sidebar.tsx"), /href: "\/system\/system-categories"/);
  assert.match(read("app/system/(authed)/system-categories/page.tsx"), /tenantId: null,\s+kind: "GOODS"/);
});
