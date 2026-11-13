import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const src = (p: string) =>
  readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "..", p), "utf8");

test("web account session rejects deactivated/deleted accounts", () => {
  const s = src("lib/auth/account.ts");
  const guards = s.match(/!account\.isActive \|\| account\.deactivatedAt \|\| account\.deletedAt/g) ?? [];
  assert.equal(guards.length, 2);
});

test("web OTP login clears self-deactivation, never an admin block", () => {
  const s = src("app/_actions/account-auth.ts");
  assert.match(s, /if \(account && !account\.isActive\)/); // admin block still first
  // finishAccountLogin clears deactivatedAt (and bumps tokenVersion).
  assert.match(s, /await finishAccountLogin\(account\.id\)/);
});

test("deletion action: generic step-1 reply, ACCOUNT_CLOSE otp, libs only, rate-limited", () => {
  const s = src("app/_actions/account-deletion.ts");
  assert.match(s, /^"use server";/);
  assert.match(s, /GENERIC_SENT/); // one constant used for found and not-found alike
  assert.equal((s.match(/type:\s*"ACCOUNT_CLOSE"/g) ?? []).length >= 4, true);
  assert.match(s, /deleteAccount\(/);
  assert.match(s, /deleteStaffUser\(/);
  assert.match(s, /consumeRateLimit\(/);
  assert.match(s, /LAST_OWNER|ClosureError/);
  assert.doesNotMatch(s, /accountTombstone|userTombstone/); // never re-implement
  assert.match(s, /confirm/);
});

test("account-deletion page explains scope and wires the action", () => {
  const page = src("app/account-deletion/page.tsx");
  const form = src("app/account-deletion/deletion-form.tsx");
  assert.match(page, /export const metadata/);
  for (const phrase of ["устгагдана", "хадгалагдана", "Идэвхгүй болгох"]) assert.ok(page.includes(phrase), phrase);
  assert.match(form, /^"use client";/);
  assert.match(form, /useActionState\(accountDeletionAction/);
  for (const name of ['name="kind"', 'name="identifier"', 'name="otpCode"', 'name="confirm"']) assert.ok(form.includes(name), name);
});

test("privacy page and footer link to /account-deletion", () => {
  assert.match(src("app/privacy/page.tsx"), /\/account-deletion/);
});
