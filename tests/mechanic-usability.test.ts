// Засварчны (orders.viewOwn/editOwn, *.view) өдөр тутмын саадуудыг засав:
// дэлгэрэнгүй хуудас харах эрхээр, оноолтын мэдэгдэл, оношилгооны зураг шахах,
// товч засварын хуудас (цуцлахгүй), touch дэлгэцэд шалтгааныг бичгээр.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

test("vehicle/customer/service detail pages open with .view and gate editing on .edit", () => {
  for (const [file, resource] of [
    ["app/dashboard/vehicles/[id]/page.tsx", "vehicles"],
    ["app/dashboard/customers/[id]/page.tsx", "customers"],
    ["app/dashboard/services/[id]/page.tsx", "services"],
  ] as const) {
    const src = read(file);
    assert.match(src, new RegExp(`if \\(!canView\\(user, "${resource}"\\)\\) redirect`), file);
    assert.doesNotMatch(src, new RegExp(`if \\(!canEdit\\(user, "${resource}"\\)\\) redirect`), file);
    assert.match(src, new RegExp(`const editable = canEdit\\(user, "${resource}"\\);`), file);
    assert.match(src, /<ReadOnlyDetails/, file);
    assert.match(src, /\{editable \? \(\s*<Btn type="submit"/, file);
  }
  // Засах эрхгүйд сэлбэгийн өртөг, нөөц тохируулга харагдахгүй.
  const svc = read("app/dashboard/services/[id]/page.tsx");
  assert.match(svc, /\{editable \? \(\s*<div>\s*<dt className="text-xs text-\[var\(--oc-muted3\)\]">Өртөг/);
  assert.match(svc, /\{isGoods && editable \? \(/);
});

test("order_assigned notifies only the assignee, never the actor", async () => {
  const { NOTIFICATION_REGISTRY, NOTIFICATION_TYPES } = await import("../lib/notifications");
  assert.ok((NOTIFICATION_TYPES as readonly string[]).includes("order_assigned"));
  const def = NOTIFICATION_REGISTRY.order_assigned;
  assert.equal(def.realm, "staff");
  const built = def.build({ orderId: "o1", number: "ЗХ-12", vehicle: "1234УБА Toyota Prius", customer: "Бат" });
  assert.match(built.title, /Танд засвар оноогдлоо №ЗХ-12/);
  assert.equal(built.body, "1234УБА Toyota Prius · Бат");
  assert.equal(def.href(built.data), "/dashboard/orders/o1");

  const cmd = read("lib/orders/order-commands.ts");
  assert.match(cmd, /if \(!order\?\.assignedToId \|\| order\.assignedToId === actorId\) return;/);
  assert.match(cmd, /if \(input\.assignedToId && input\.assignedToId !== result\.previousAssignedToId\) \{\s*await notifyOrderAssigned\(orderId, actor\.id\);/);
  assert.match(read("lib/orders/order-create-command.ts"), /await notifyOrderAssigned\(createdOrder\.id, input\.actorId\);/);
});

test("diagnostic photos are compressed client-side with the shared intake helper", () => {
  const form = read("app/dashboard/orders/[id]/diagnostics/diagnostic-form.tsx");
  assert.match(form, /await compressFormDataImages\(fd\);/);
  assert.match(read("app/dashboard/orders/intake-section.tsx"), /from "@\/lib\/client\/compress-image"/);
  const lib = read("lib/client/compress-image.ts");
  assert.match(lib, /export const MAX_IMAGE_EDGE = 1600;/);
  assert.match(lib, /ctx\.fillStyle = "#ffffff";/); // тунгалаг PNG → хар дэвсгэр болохгүй
});

test("own-scope editors (mechanics) cannot cancel the whole order and get a compact view", () => {
  const cmd = read("lib/orders/order-commands.ts");
  assert.match(cmd, /if \(nextStatus === "CANCELLED" && orderEditScope\(actor\) === "own"\) \{/);
  assert.match(cmd, /"ORDER_CANCEL_FORBIDDEN"/);
  assert.doesNotMatch(cmd, /Зөвхөн orders\.assign эрхтэй/);
  assert.doesNotMatch(read("app/_actions/orders.ts"), /Зөвхөн orders\.assign эрхтэй/);

  const page = read("app/dashboard/orders/[id]/page.tsx");
  assert.match(page, /const fullOrderEditor = orderEditScope\(user\) === "branch";/);
  assert.match(page, /\.filter\(\(t\) => t !== "CANCELLED"\)/);
  assert.match(page, /\{isEditable && canEditOrder && fullOrderEditor \? \(/);
  assert.match(page, /order-first lg:order-none/);
});

test("item status disabled reasons are visible as text on touch screens", () => {
  const items = read("app/dashboard/orders/[id]/order-items.tsx");
  assert.match(items, /\{disabledReason \? \(\s*<span className="w-\[9\.5rem\] text-\[10\.5px\]/);
  assert.match(items, /!py-2 !px-2 !text-\[13px\] sm:!py-1/);
  assert.match(items, /Эхлүүлсний дараа бөглөнө/);
});
