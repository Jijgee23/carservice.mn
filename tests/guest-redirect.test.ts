import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

test("safeNext keeps same-site paths and rejects open-redirect shapes", async () => {
  const { safeNext } = await import("../lib/safe-redirect");
  assert.equal(safeNext("/dashboard/orders?x=1", "/dashboard"), "/dashboard/orders?x=1");
  for (const bad of [
    "//evil.com",
    "/\\evil.com",
    "/\\/evil.com",
    "https://evil.com",
    "javascript:alert(1)",
    "evil.com",
    "/ok\nSet-Cookie: a=b",
    "/ok\tx",
    "",
    null,
    undefined,
  ]) {
    assert.equal(safeNext(bad as string | null | undefined, "/fb"), "/fb", String(bad));
  }
});

test("safeNextWithin only allows paths inside the realm", async () => {
  const { safeNextWithin } = await import("../lib/safe-redirect");
  const f = "/dashboard";
  assert.equal(safeNextWithin("/dashboard", f, "/dashboard"), "/dashboard");
  assert.equal(safeNextWithin("/dashboard/orders/1?tab=a#x", f, "/dashboard"), "/dashboard/orders/1?tab=a#x");
  assert.equal(safeNextWithin("/dashboard?x=1", f, "/dashboard"), "/dashboard?x=1");
  // Өөр realm, угтвар төстэй зам, гадаад URL — бүгд fallback.
  assert.equal(safeNextWithin("/system/admins", f, "/dashboard"), f);
  assert.equal(safeNextWithin("/dashboard-evil", f, "/dashboard"), f);
  assert.equal(safeNextWithin("/dashboardx/a", f, "/dashboard"), f);
  assert.equal(safeNextWithin("//dashboard", f, "/dashboard"), f);
  assert.equal(safeNextWithin(undefined, f, "/dashboard"), f);
});

test("every guest auth page redirects signed-in users via the shared guard", () => {
  // Lexical guard: DB-backed shared helper-ийг дууддаг, JWT-ээр ганц realm
  // шалгадаг хуучин хэв маяг руу буцахаас сэргийлнэ.
  const pages: Array<[string, string]> = [
    ["app/login/page.tsx", "account"],
    ["app/page/login/page.tsx", "tenant"],
    ["app/system/login/page.tsx", "system"],
    ["app/page/signup/page.tsx", "tenant"],
    ["app/page/forgot/page.tsx", "tenant"],
  ];
  for (const [file, realm] of pages) {
    const src = fs.readFileSync(file, "utf8");
    assert.match(src, /redirectIfSignedIn\(/, `${file} must call redirectIfSignedIn`);
    assert.match(src, new RegExp(`prefer: "${realm}"`), `${file} must prefer ${realm}`);
    assert.doesNotMatch(src, /hasActive(User|System)Session\(/, `${file} must not check one realm only`);
  }
});

test("proxy and guard share the realm home map", () => {
  const proxy = fs.readFileSync("proxy.ts", "utf8");
  assert.match(proxy, /from "@\/lib\/auth\/realm"/);
  assert.doesNotMatch(proxy, /const REALM_HOME/);
});
