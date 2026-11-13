import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";

process.env.DATABASE_URL ??= "postgresql://unused/unused";
process.env.SESSION_SECRET ??= "unit-test-placeholder-secret-value-not-real-00";

const src = (rel: string) =>
  readFile(new URL(`../${rel}`, import.meta.url), "utf8").then((s) => s.replace(/\r\n/g, "\n"));

test("classifyOtpAttempt: unclaimed attempts map to expired / too_many / invalid; claimed → ok only on match", async () => {
  const { classifyOtpAttempt, OTP_MAX_ATTEMPTS } = await import("../lib/auth/otp");
  assert.equal(classifyOtpAttempt({ claimed: false, expired: true, attemptsBefore: 0, codeMatches: true }), "expired");
  assert.equal(
    classifyOtpAttempt({ claimed: false, expired: false, attemptsBefore: OTP_MAX_ATTEMPTS, codeMatches: true }),
    "too_many_attempts",
  );
  // Lost a race (consumed / filled by a concurrent request) → never ok, even with the right code.
  assert.equal(classifyOtpAttempt({ claimed: false, expired: false, attemptsBefore: 1, codeMatches: true }), "invalid");
  assert.equal(classifyOtpAttempt({ claimed: true, expired: false, attemptsBefore: 0, codeMatches: false }), "invalid");
  assert.equal(classifyOtpAttempt({ claimed: true, expired: false, attemptsBefore: 4, codeMatches: true }), "ok");
});

test("OTP verify claims an attempt and consumes with conditional updateMany", async () => {
  const s = await src("lib/auth/otp.ts");
  assert.match(s, /attempts: \{ lt: OTP_MAX_ATTEMPTS \},\n\s+expiresAt: \{ gt: now \},/);
  assert.match(s, /if \(claim\.count !== 1\)/);
  assert.match(s, /where: \{ id: otp\.id, consumedAt: null \},\n\s+data: \{ consumedAt: now \},\n\s+\}\);\n\s+if \(consumed\.count !== 1\) return "invalid";/);
  // Both verify paths share the atomic helper.
  assert.equal(s.match(/await attemptOtp\(otp, codeHash\)/g)?.length, 2);
  // SIGNUP is keyed by phone, never by email.
  assert.match(s, /if \(type === "SIGNUP"\)/);
});

test("ipFromHeaders: x-real-ip first, then the LAST X-Forwarded-For hop, else unknown", async () => {
  const { ipFromHeaders, ipOrNull } = await import("../lib/rate-limit");
  assert.equal(ipFromHeaders(new Headers({ "x-real-ip": "9.9.9.9", "x-forwarded-for": "1.1.1.1, 2.2.2.2" })), "9.9.9.9");
  assert.equal(ipFromHeaders(new Headers({ "x-forwarded-for": "1.1.1.1, 2.2.2.2" })), "2.2.2.2");
  assert.equal(ipFromHeaders(new Headers({ "x-forwarded-for": "spoofed, 3.3.3.3 ," })), "3.3.3.3");
  assert.equal(ipFromHeaders(new Headers()), "unknown");
  assert.equal(ipOrNull(new Headers()), null);
});

test("account token version: missing tv = 0, bad tv rejected, mismatch rejected", async () => {
  const { parseTokenVersion, tokenVersionMatches } = await import("../lib/auth/account-api-token");
  assert.equal(parseTokenVersion(undefined), 0);
  assert.equal(parseTokenVersion(3), 3);
  assert.equal(parseTokenVersion("3"), null);
  assert.equal(parseTokenVersion(-1), null);
  assert.equal(tokenVersionMatches(0, 0), true);
  assert.equal(tokenVersionMatches(0, 1), false);
});

test("account password set/remove and reactivating login bump tokenVersion; logins sign with it", async () => {
  const pw = await src("lib/auth/account-password.ts");
  assert.equal(pw.match(/tokenVersion: \{ increment: 1 \}/g)?.length, 3);
  assert.match(pw, /where: \{ id: accountId, deactivatedAt: \{ not: null \} \}/);
  for (const rel of ["app/api/v1/app/auth/verify-otp/route.ts", "app/api/v1/app/auth/login-password/route.ts"]) {
    assert.match(await src(rel), /tv: account\.tokenVersion/, rel);
  }
});

test("login lockout, refresh rotation, reset revocation, signup re-check", async () => {
  const lock = await src("lib/auth/login-lockout.ts");
  assert.match(lock, /failedLoginAttempts: \{ increment: 1 \}/);
  assert.match(lock, /where: \{ id: userId, lockedAt: null \}/);
  for (const rel of ["app/_actions/auth.ts", "app/api/v1/auth/login/route.ts"]) {
    const s = await src(rel);
    assert.match(s, /recordFailedLogin\(user\.id/, rel);
    assert.doesNotMatch(s, /failedLoginAttempts \+ 1/, rel);
  }
  const rt = await src("lib/auth/refresh-token.ts");
  assert.match(rt, /where: \{ id: existing\.id, revokedAt: null \}/);
  assert.match(rt, /if \(revoked\.count !== 1\) throw new RotationLostError\(\)/);
  for (const rel of ["app/_actions/auth.ts", "app/api/v1/auth/password/reset/route.ts"]) {
    assert.match(await src(rel), /revokeAllUserSessions\(user\.id\)/, rel);
  }
  const web = await src("app/_actions/auth.ts");
  assert.ok(web.indexOf("lateConflicts") < web.indexOf("await createTenantWithOwner(data)"));
  const api = await src("app/api/v1/auth/signup/route.ts");
  assert.ok(api.indexOf("findTenantSignupConflicts(data)") < api.indexOf("await createTenantWithOwner(data)"));
  assert.doesNotMatch(api, /verifyOtp\(\{ email/);
});

test("staff enumeration-safe OTP endpoints return one shape", async () => {
  for (const rel of ["app/api/v1/auth/password/request-otp/route.ts", "app/api/v1/auth/activate/request-otp/route.ts"]) {
    const s = await src(rel);
    assert.doesNotMatch(s, /maskPhone\(/, rel);
    assert.equal(s.match(/jsonOk\(/g)?.length, 1, rel);
  }
});

test("sameDeviceOwner compares all three owner columns", async () => {
  const { sameDeviceOwner } = await import("../lib/devices");
  const u = { userId: "u1", accountId: null, superAdminId: null };
  assert.equal(sameDeviceOwner(u, { ...u }), true);
  assert.equal(sameDeviceOwner(u, { userId: "u2", accountId: null, superAdminId: null }), false);
  assert.equal(sameDeviceOwner(u, { userId: null, accountId: "a1", superAdminId: null }), false);
});
