import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";

process.env.DATABASE_URL ??= "postgresql://unused/unused";
process.env.SESSION_SECRET ??= "unit-test-placeholder-secret-value-not-real-00";

const src = (rel: string) => readFile(new URL(`../${rel}`, import.meta.url), "utf8").then((s) => s.replace(/\r\n/g, "\n"));
const full = { type: "ios", fcm: "token-1", model: "iPhone 15 Pro", os: "iOS 18.1" };

test("parseLoginDevice: type / fcm / model / os required, loc optional", async () => {
  const { parseLoginDevice } = await import("../lib/auth/login-device");
  assert.deepEqual(parseLoginDevice(full), {
    ok: true,
    device: { deviceId: null, type: "IOS", fcm: "token-1", model: "iPhone 15 Pro", os: "iOS 18.1", latitude: null, longitude: null },
  });
  const withLoc = parseLoginDevice({ ...full, type: "Android", loc: { lat: 47.9184, lng: "106.9177" } });
  assert.ok(withLoc.ok && withLoc.device.type === "ANDROID" && withLoc.device.latitude === 47.9184 && withLoc.device.longitude === 106.9177);
  const missing = parseLoginDevice({});
  assert.ok(!missing.ok);
  assert.deepEqual(Object.keys(missing.fieldErrors).sort(), ["fcm", "model", "os", "type"]);
  const withId = parseLoginDevice({ ...full, deviceId: "a1b2c3d4e5f60718293a4b5c6d7e8f90" });
  assert.ok(withId.ok && withId.device.deviceId === "a1b2c3d4e5f60718293a4b5c6d7e8f90");
  for (const bad of [{ deviceId: "short" }, { deviceId: "has space in it" }, { type: "windows" }, { fcm: "  " }, { model: "x".repeat(101) }, { loc: { lat: 91, lng: 0 } }, { loc: { lat: 1 } }, { loc: "47,106" }]) {
    assert.equal(parseLoginDevice({ ...full, ...bad }).ok, false, JSON.stringify(bad));
  }
});

test("labels: device label and map link", async () => {
  const { loginDeviceLabel, loginLocationUrl } = await import("../lib/auth/login-device");
  assert.equal(loginDeviceLabel({ deviceModel: "SM-S918B", deviceOs: "Android 14" }), "SM-S918B · Android 14");
  assert.equal(loginDeviceLabel({ deviceModel: null, deviceOs: null, deviceType: "IOS" }), "iOS");
  assert.equal(loginDeviceLabel({ deviceModel: null, deviceOs: null }), null);
  assert.equal(loginLocationUrl(47.9, 106.9), "https://www.openstreetmap.org/?mlat=47.9&mlon=106.9#map=16/47.9/106.9");
  assert.equal(loginLocationUrl(null, 1), null);
});

test("wiring: login validates the device, the session keeps it across rotation, FCM is registered, list exposes it", async () => {
  const route = await src("app/api/v1/auth/login/route.ts");
  assert.ok(route.indexOf("parseLoginDevice(body)") < route.indexOf("prisma.user.findUnique"), "validate before the DB lookup");
  assert.match(route, /buildApiLoginResponse\(user, req, parsedDevice\.device\)/);
  const rt = await src("lib/auth/refresh-token.ts");
  assert.match(rt, /deviceType: existing\.deviceType,\s*deviceModel: existing\.deviceModel,\s*deviceOs: existing\.deviceOs,\s*latitude: existing\.latitude,\s*longitude: existing\.longitude,/);
  const api = await src("lib/auth/api-login.ts");
  assert.match(api, /registerDevice\(\{ userId \}, \{ deviceId, platform: device\.type, firebaseToken: device\.fcm/);
  const sessions = await src("lib/account/sessions.ts");
  assert.match(sessions, /loginDeviceLabel\(\{ deviceModel: row\.deviceModel/);
  assert.match(sessions, /mapUrl: loginLocationUrl\(row\.latitude, row\.longitude\)/);
  const sql = await src("prisma/migrations/20261015120000_refresh_token_device/migration.sql");
  for (const col of ["deviceType", "deviceModel", "deviceOs", "latitude", "longitude"]) assert.match(sql, new RegExp(`ADD COLUMN\\s+"${col}"`));
  assert.doesNotMatch(sql, /NOT NULL/);
});

test("one call each: login links the session to the push device; logout revokes and drops that device (only if still the user's)", async () => {
  const api = await src("lib/auth/api-login.ts");
  assert.match(api, /pushDeviceId: await registerLoginDevice\(user\.id, device\)/);
  assert.match(api, /const deviceId = device\.deviceId \?\? existing\?\.deviceId \?\? `fcm-/);
  assert.match(await src("lib/auth/refresh-token.ts"), /pushDeviceId: existing\.pushDeviceId,/);
  const logout = await src("app/api/v1/auth/logout/route.ts");
  assert.match(logout, /prisma\.device\.deleteMany\(\{ where: \{ id: session\.pushDeviceId, userId: session\.userId \} \}\)/);
  const activate = await src("app/api/v1/auth/activate/route.ts");
  assert.match(activate, /buildApiLoginResponse\(user, req, parsedDevice\.device\)/);
  assert.match(await src("prisma/migrations/20261015130000_refresh_token_push_device/migration.sql"), /ON DELETE SET NULL/);
});
