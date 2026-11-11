import { enforceRateLimit, jsonError, jsonOk } from "@/lib/api";
import { getAddressData } from "@/lib/address";
import { resolveAddressFromGeocode } from "@/lib/address-match";
import { reverseGeocode } from "@/lib/reverse-geocode";
import { setBypassContext } from "@/lib/tenant-context";

/**
 * GET /api/v1/auth/signup/address?lat=47.9185&lng=106.9177 — мобайл бүртгэлийн
 * «Байршил» алхам: газрын зураг дээр тэмдэглэсэн цэгийн хаяг.
 *
 * Хариу: `{ city, district, khoroo, address }` — city/district/khoroo нь
 * засаг захиргааны лавлахын нэр (веб бүртгэлийн hidden талбартай ижил), address
 * нь хүнд уншигдах бүтэн хаяг. Олдоогүй хэсэг хоосон string. Эдгээрийг
 * /auth/signup/request-otp ба /auth/signup руу lat/lng-тэй хамт илгээнэ.
 *
 * Нэвтрэлт шаардахгүй (бүртгэлээс өмнө). Хаяг заавал биш тул geocoding
 * амжилтгүй бол 200 + хоосон утга.
 */
export async function GET(req: Request) {
  // Бүртгэлээс өмнө — session/tenant хараахан байхгүй.
  setBypassContext();

  const limited = enforceRateLimit(req, "api-signup-address", { limit: 20, windowMs: 60_000 });
  if (limited) return limited;

  const params = new URL(req.url).searchParams;
  const lat = Number.parseFloat(params.get("lat") ?? "");
  const lng = Number.parseFloat(params.get("lng") ?? "");
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    return jsonError(400, "lat (-90…90), lng (-180…180) шаардлагатай.", { code: "VALIDATION" });
  }

  const parts = await reverseGeocode(lat, lng);
  if (!parts) return jsonOk({ city: "", district: "", khoroo: "", address: "" });

  const resolved = resolveAddressFromGeocode(await getAddressData(), parts);
  return jsonOk({ ...resolved, address: parts.formatted ?? "" });
}
