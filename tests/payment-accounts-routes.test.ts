import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile, access } from "node:fs/promises";

const src = (rel: string) => readFile(new URL(`../${rel}`, import.meta.url), "utf8");
const exists = (rel: string) => access(new URL(`../${rel}`, import.meta.url)).then(() => true, () => false);

test("PUT /banks/enabled is gone; payment-accounts routes exist and are permission + subscription gated", async () => {
  assert.equal(await exists("app/api/v1/banks/enabled/route.ts"), false);
  const list = await src("app/api/v1/payment-accounts/route.ts");
  const item = await src("app/api/v1/payment-accounts/[id]/route.ts");
  for (const s of [list, item]) {
    assert.match(s, /requireApiUser/);
    assert.match(s, /cash\.manage/);
  }
  assert.match(list, /export async function GET/);
  assert.match(list, /export async function POST/);
  assert.match(list, /requireActiveSubscriptionApi/);
  assert.match(item, /export async function PATCH/);
  assert.match(item, /requireActiveSubscriptionApi/);
  assert.doesNotMatch(item, /export async function DELETE/, "no hard delete (spec P7)");
});

test("GET /banks returns accounts plus the legacy compatibility fields", async () => {
  const s = await src("app/api/v1/banks/route.ts");
  assert.match(s, /accounts/);
  assert.match(s, /enabledBanks/);
  assert.match(s, /legacyCode/);
  assert.match(s, /orderBy: \{ legacyCode: "asc" \}/); // deterministic enabledBanks order
  assert.doesNotMatch(s, /from "@\/lib\/tenant-banks"/);
  assert.doesNotMatch(s, /from "@\/lib\/banks"/);
});
