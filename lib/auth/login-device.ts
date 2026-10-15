// Ажилтны мобайл нэвтрэлтийн (POST /api/v1/auth/login) төхөөрөмж ба байршил — «хаанаас, ямар төхөөрөмжөөс
// нэвтэрсэн» гэдгийг мэдэхэд. type / fcm / model / os заавал, loc заавал биш. Pure: body in, parsed or error out.

export type LoginDeviceType = "IOS" | "ANDROID";

export type LoginDevice = {
  /** App's own install id (optional). Same id as POST /api/v1/devices so one phone stays one Device row. */
  deviceId: string | null;
  type: LoginDeviceType;
  /** Firebase Cloud Messaging token — push-ийн Device бүртгэлд. */
  fcm: string;
  model: string;
  os: string;
  latitude: number | null;
  longitude: number | null;
};

const MAX_TEXT = 100;
const DEVICE_ID_RE = /^[A-Za-z0-9._:-]{8,128}$/;
const MAX_FCM = 4096;

const text = (v: unknown, max: number): string | null => {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t && t.length <= max ? t : null;
};

const coord = (v: unknown, limit: number): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) && Math.abs(n) <= limit ? n : null;
};

/** Errors are keyed by body field (`type`, `fcm`, `model`, `os`, `loc`). */
export function parseLoginDevice(body: unknown): { ok: true; device: LoginDevice } | { ok: false; fieldErrors: Record<string, string> } {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const fieldErrors: Record<string, string> = {};

  const rawType = typeof b.type === "string" ? b.type.trim().toUpperCase() : "";
  const type = rawType === "IOS" || rawType === "ANDROID" ? (rawType as LoginDeviceType) : null;
  if (!type) fieldErrors.type = "type нь ios эсвэл android байна.";

  const fcm = text(b.fcm, MAX_FCM);
  if (!fcm) fieldErrors.fcm = "fcm (push token) шаардлагатай.";
  const model = text(b.model, MAX_TEXT);
  if (!model) fieldErrors.model = `model шаардлагатай (${MAX_TEXT} хүртэл тэмдэгт).`;
  const os = text(b.os, MAX_TEXT);
  if (!os) fieldErrors.os = `os шаардлагатай (${MAX_TEXT} хүртэл тэмдэгт).`;

  let deviceId: string | null = null;
  if (b.deviceId !== undefined && b.deviceId !== null && b.deviceId !== "") {
    deviceId = typeof b.deviceId === "string" && DEVICE_ID_RE.test(b.deviceId.trim()) ? b.deviceId.trim() : null;
    if (!deviceId) fieldErrors.deviceId = "deviceId нь 8–128 тэмдэгт (үсэг, тоо, . _ : -).";
  }

  let latitude: number | null = null;
  let longitude: number | null = null;
  if (b.loc !== undefined && b.loc !== null) {
    const loc = (typeof b.loc === "object" ? b.loc : {}) as Record<string, unknown>;
    latitude = coord(loc.lat, 90);
    longitude = coord(loc.lng, 180);
    if (latitude == null || longitude == null) {
      fieldErrors.loc = "loc нь { lat: -90…90, lng: -180…180 } байна.";
      latitude = longitude = null;
    }
  }

  if (Object.keys(fieldErrors).length > 0) return { ok: false, fieldErrors };
  return { ok: true, device: { deviceId, type: type!, fcm: fcm!, model: model!, os: os!, latitude, longitude } };
}

/** «iPhone 15 Pro · iOS 18.1» — the session list label for a mobile login. */
export function loginDeviceLabel(d: { deviceModel: string | null; deviceOs: string | null; deviceType?: string | null }): string | null {
  const parts = [d.deviceModel, d.deviceOs ?? (d.deviceType === "IOS" ? "iOS" : d.deviceType === "ANDROID" ? "Android" : null)].filter(Boolean);
  return parts.length ? parts.join(" · ") : null;
}

/** OpenStreetMap link for a login location (no API key needed). */
export function loginLocationUrl(lat: number | null, lng: number | null): string | null {
  if (lat == null || lng == null) return null;
  return `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=16/${lat}/${lng}`;
}
