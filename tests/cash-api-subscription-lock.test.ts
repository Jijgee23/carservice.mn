import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";

// Every mutating cash API handler must enforce the subscription lock AFTER the permission check
// (requireCashApiUser = auth + cash.manage), matching order-payment / qpay routes.
const MUTATING = [
  "app/api/v1/cash/attachments/route.ts",
  "app/api/v1/cash/entries/route.ts",
  "app/api/v1/cash/entries/[id]/void/route.ts",
  "app/api/v1/cash/sessions/route.ts",
  "app/api/v1/cash/sessions/[id]/close/route.ts",
  "app/api/v1/cash/settlements/route.ts",
  "app/api/v1/cash/settlements/[id]/void/route.ts",
  "app/api/v1/cash/types/route.ts",
  "app/api/v1/cash/types/[id]/route.ts",
];

test("mutating cash API routes lock on subscription after permission", async () => {
  for (const file of MUTATING) {
    const text = await readFile(file, "utf8");
    const perm = text.indexOf("requireCashApiUser(req)");
    const lock = text.indexOf("await requireActiveSubscriptionApi(auth.user)");
    assert.ok(perm >= 0 && lock > perm, file);
    assert.match(text, /if \(locked\) return locked;/, file);
  }
});

test("no unlisted cash API route exports a mutating handler", async () => {
  const entries = await readdir("app/api/v1/cash", { recursive: true });
  const routes = entries.map((e) => `app/api/v1/cash/${e.replaceAll("\\", "/")}`).filter((e) => e.endsWith("/route.ts"));
  assert.ok(routes.length >= MUTATING.length);
  for (const f of routes) {
    const text = await readFile(f, "utf8");
    if (/export async function (POST|PATCH|PUT|DELETE)|async function handle/.test(text)) {
      assert.ok(MUTATING.includes(f.replaceAll("\\", "/")), `unlisted mutating route ${f}`);
    }
  }
});
