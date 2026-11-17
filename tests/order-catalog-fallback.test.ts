import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

// Засварын хуудасны «мөр нэмэх»: эхлээд байгууллагын өөрийн ажил/сэлбэгээс,
// олдохгүй бол нэгдсэн сангаас хайна; сангаас сонгосныг байгууллагын
// ажил/сэлбэгт ЯГ ашигласан нэр, үнээр нэмнэ. Server-only import-ийн
// хаалтын улмаас source-pattern шалгалт (tests/order-appointment-audit-fixes.test.ts-тэй ижил).

const read = (p: string) => readFileSync(p, "utf8");

test("order page no longer preloads the whole shared catalog", () => {
  const page = read("app/dashboard/orders/[id]/page.tsx");
  assert.doesNotMatch(page, /catalogItem\.findMany/);
  assert.doesNotMatch(page, /catalogItems=/);
});

test("add-item form searches own list first, then offers an on-demand catalog search", () => {
  const form = read("app/dashboard/orders/[id]/add-item-form.tsx");
  assert.match(form, /searchOrderCatalogAction\(type, trimmed\)/);
  assert.match(form, /creatable=\{catalogCreatable\}/);
  assert.match(form, /мэдээллийн сангаас хайх/);
  // Сангаас сонгосон үед нэр засагдах талбар нь description нэрээр илгээгдэнэ.
  assert.match(form, /name="catalogItemId" value=\{catalogPick\?\.id \?\? ""\}/);
});

test("catalog search action is gated on order edit access, not services.create", () => {
  const src = read("app/_actions/catalog.ts");
  const fn = src.slice(src.indexOf("export async function searchOrderCatalogAction"));
  assert.match(fn, /if \(!canEdit\(user, "orders"\) \|\| !isCatalogKind\(type\)\) return \[\];/);
});

test("web action and mobile route adopt with the used name and (permitted) price", () => {
  const action = read("app/_actions/orders.ts");
  assert.match(action, /adoptCatalogItemForTenant\(user, catalogItemId, \{\s*name: s\(formData, "description"\),\s*price: canSetPrice \? unitPrice : null,/);
  const route = read("app/api/v1/orders/[id]/items/route.ts");
  assert.match(route, /adoptCatalogItemForTenant\(auth\.user, catalogItemId, \{\s*name: description,\s*price: canSetPrice \? unitPrice : null,/);
});

test("adopt stores override name/price and reuses a same-name own service", () => {
  const src = read("lib/services/catalog-adopt.ts");
  assert.match(src, /const name = overrideName \?\? item\.name;/);
  assert.match(src, /const price = overridePrice \?\? item\.price;/);
  assert.match(src, /name: \{ equals: name, mode: "insensitive" \}/);
  assert.match(src, /^\s+name,\r?\n\s+code: item\.code,/m);
  assert.match(src, /^\s+price,\r?\n\s+costPrice: null,/m);
});
