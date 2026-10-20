// Мобайл аппуудын store холбоос — super admin /system/settings-д хадгална
// (PlatformSetting). Хоосон холбоостой store-ийн товч хаана ч харагдахгүй.
// Client-safe (Prisma импортгүй).

export type StoreLinks = { appStore: string | null; playStore: string | null };
export type AppStoreLinks = { customer: StoreLinks; business: StoreLinks };

export const APP_STORE_HOST = "apps.apple.com";
export const PLAY_STORE_HOST = "play.google.com";

export function hasStoreLinks(links: StoreLinks | null | undefined): boolean {
  return Boolean(links?.appStore || links?.playStore);
}

/**
 * Хоосон утга → null (OK). Үгүй бол https:// бөгөөд тухайн store-ийн домэйн
 * байх ёстой (буруу/фишинг холбоос нийтэд гарахаас сэргийлнэ).
 */
export function validateStoreUrl(
  raw: string,
  store: "appStore" | "playStore",
): { ok: true; value: string | null } | { ok: false; error: string } {
  const v = raw.trim();
  if (!v) return { ok: true, value: null };
  const host = store === "appStore" ? APP_STORE_HOST : PLAY_STORE_HOST;
  let url: URL;
  try {
    url = new URL(v);
  } catch {
    return { ok: false, error: `https://${host}/… хэлбэрийн холбоос оруулна уу.` };
  }
  if (url.protocol !== "https:" || url.hostname !== host) {
    return { ok: false, error: `https://${host}/… хэлбэрийн холбоос оруулна уу.` };
  }
  return { ok: true, value: url.toString() };
}
