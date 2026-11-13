import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { checkUserActive } from "../lib/auth/active";

function src(relPath: string): string {
  return readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "..", relPath), "utf8");
}

test("self-deactivated staff is blocked for bearer/session use", () => {
  const r = checkUserActive({ isActive: true, activeUntil: null, deactivatedAt: new Date() });
  assert.equal(r.ok, false);
  assert.equal(!r.ok && r.reason, "DEACTIVATED");
});

test("admin block still wins and is not cleared by login", () => {
  const r = checkUserActive({ isActive: false, activeUntil: null, deactivatedAt: new Date() });
  assert.equal(!r.ok && r.reason, "INACTIVE");
  const login = src("app/api/v1/auth/login/route.ts");
  assert.match(login, /deactivatedAt:\s*null/);
  assert.match(login, /reactivated/);
});

test("customer bearer rejects deactivated/deleted; verify-otp reactivates", () => {
  assert.match(src("lib/auth/account-api-token.ts"), /account\.deactivatedAt\s*\|\|\s*account\.deletedAt/);
  const v = src("app/api/v1/app/auth/verify-otp/route.ts");
  // Reactivation goes through finishAccountLogin (clears deactivatedAt + bumps tokenVersion).
  assert.match(v, /finishAccountLogin\(found\.id/);
  assert.match(src("lib/auth/account-password.ts"), /deactivatedAt:\s*null/);
  assert.match(v, /reactivated/);
});

test("staff refresh rejects self-deactivated users without clearing the flag", () => {
  const r = src("app/api/v1/auth/refresh/route.ts");
  assert.match(r, /deactivatedAt:\s*user\.deactivatedAt/);
  assert.doesNotMatch(r, /deactivatedAt:\s*null/);
});

test("web staff login and activation clear self-deactivation", () => {
  const a = src("app/_actions/auth.ts");
  assert.match(a, /deactivatedAt:\s*user\.deactivatedAt/);
  assert.ok((a.match(/deactivatedAt:\s*null/g) ?? []).length >= 2);
  assert.match(src("app/api/v1/auth/activate/route.ts"), /deactivatedAt:\s*null/);
});
