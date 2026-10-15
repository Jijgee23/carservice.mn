import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";

process.env.DATABASE_URL ??= "postgresql://unused/unused";
process.env.SESSION_SECRET ??= "unit-test-placeholder-secret-value-not-real-00";

const src = (rel: string) => readFile(new URL(`../${rel}`, import.meta.url), "utf8").then((s) => s.replace(/\r\n/g, "\n"));

test("validateAccountPassword: 8–128 chars with a letter (Latin or Cyrillic) and a digit", async () => {
  const { validateAccountPassword } = await import("../lib/auth/account-password");
  for (const ok of ["Test1234", "нууцүг12", "Өглөө2026", `a1${"x".repeat(126)}`]) assert.equal(validateAccountPassword(ok), null, ok);
  for (const bad of ["short1", "12345678", "abcdefgh", "", `a1${"x".repeat(127)}`]) assert.notEqual(validateAccountPassword(bad), null, bad);
});

test("tombstone scrubs the password too", async () => {
  const { accountTombstone } = await import("../lib/account-closure/tombstone");
  const t = accountTombstone("acc1", new Date("2026-10-15T00:00:00Z"));
  assert.equal(t.passwordHash, null);
  assert.equal(t.passwordUpdatedAt, null);
});

test("password login: uniform failure for unknown phone / no password / wrong password, dummy hash on a miss, per-phone limit", async () => {
  const s = await src("lib/auth/account-password.ts");
  assert.match(s, /verifyPassword\(password, hash \?\? \(await getDummyHash\(\)\)\)/);
  assert.match(s, /if \(!account \|\| !hash \|\| !matches\) return \{ ok: false, reason: "invalid", message: INVALID_CREDENTIALS_MESSAGE \}/);
  assert.match(s, /consumeRateLimit\(`account-pw:\$\{phone\}`/);
  // Blocked is only revealed after the password matched.
  assert.ok(s.indexOf('reason: "blocked"') > s.indexOf("!matches"));
  // Set / remove both need a fresh ACCOUNT_PASSWORD code.
  assert.equal(s.match(/await checkCode\(input\.account\.phone, input\.code\.trim\(\)\)/g)?.length, 2);
  assert.match(s, /verifyPhoneOtp\(\{ phone, type: "ACCOUNT_PASSWORD", code \}\)/);
});

test("web: login action has a password mode that never creates an account; set / remove actions need a code", async () => {
  const s = await src("app/_actions/account-auth.ts");
  const pw = s.slice(s.indexOf('if (s(formData, "mode") === "password")'), s.indexOf("// --- 1-р шат: OTP илгээх ---"));
  assert.match(pw, /verifyAccountPassword\(\{ phone, password \}\)/);
  assert.match(pw, /consumeRateLimit\(`account-pw-ip:/);
  assert.doesNotMatch(pw, /account\.create/);
  assert.match(s, /export async function requestAccountPasswordOtpAction/);
  assert.match(s, /type: "ACCOUNT_PASSWORD"/);
  assert.match(s, /setAccountPassword\(\{ account, code: raw\("code"\)/);
  assert.match(s, /removeAccountPassword\(\{ account, code: s\(formData, "code"\) \}\)/);
  const form = await src("app/login/login-form.tsx");
  assert.match(form, /<input type="hidden" name="mode" value="password" \/>/);
  // The security page passes only a boolean to the client.
  const page = await src("app/(app)/account/security/page.tsx");
  assert.match(page, /<PasswordForm hasPassword=\{hasPassword\} \/>/);
  assert.doesNotMatch(page, /passwordHash=\{/);
});

test("mobile: login-password, password GET / PUT / DELETE and request-otp; verify-otp reports hasPassword", async () => {
  const login = await src("app/api/v1/app/auth/login-password/route.ts");
  assert.match(login, /setBypassContext\(\)/);
  assert.match(login, /enforceRateLimit\(req, "app-login-password"/);
  assert.doesNotMatch(login, /account\.create/);
  const pw = await src("app/api/v1/app/account/password/route.ts");
  for (const m of ["GET", "PUT", "DELETE"]) assert.match(pw, new RegExp(`export async function ${m}\\(req: Request\\)`));
  assert.equal(pw.match(/getApiAccountFromRequest\(req\)/g)?.length, 3);
  assert.doesNotMatch(pw, /passwordHash: account\.passwordHash|"passwordHash"/);
  assert.match(await src("app/api/v1/app/account/password/request-otp/route.ts"), /type: "ACCOUNT_PASSWORD"/);
  assert.match(await src("app/api/v1/app/auth/verify-otp/route.ts"), /hasPassword: Boolean\(account\.passwordHash\)/);
});

test("migration adds the nullable columns and the OTP type only", async () => {
  const sql = await src("prisma/migrations/20261015090000_account_password/migration.sql");
  assert.match(sql, /ALTER TYPE "OtpType" ADD VALUE 'ACCOUNT_PASSWORD'/);
  assert.match(sql, /ADD COLUMN\s+"passwordHash" TEXT,/);
  assert.match(sql, /ADD COLUMN\s+"passwordUpdatedAt" TIMESTAMP\(3\)/);
  assert.doesNotMatch(sql, /NOT NULL|DROP\s|DELETE\s+FROM/i);
});
