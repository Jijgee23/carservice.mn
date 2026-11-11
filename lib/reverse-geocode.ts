import type { GeocodeParts } from "@/lib/address-match";

/**
 * Сервер талын reverse geocoding — мобайл бүртгэлийн газрын зурагт (веб нь
 * Google Maps JS-ийн Geocoder-ийг browser дээр ашигладаг; түүний key нь
 * browser-т зориулагдсан тул сервер OpenStreetMap Nominatim-ийг дуудна).
 *
 * Nominatim-ийн нөхцөл: таних User-Agent, секундэд ≤1 хүсэлт — дуудагч
 * route IP-ээр throttle хийж, апп газрын зураг зогссоны дараа л дуудна.
 *
 * Env: NOMINATIM_BASE_URL — анхдагч https://nominatim.openstreetmap.org
 */

type NominatimAddress = Partial<
  Record<
    | "house_number"
    | "road"
    | "neighbourhood"
    | "quarter"
    | "residential"
    | "suburb"
    | "city_district"
    | "county"
    | "city"
    | "town"
    | "village"
    | "state",
    string
  >
>;

function baseUrl(): string {
  return process.env.NOMINATIM_BASE_URL ?? "https://nominatim.openstreetmap.org";
}

/**
 * OSM-ийн хаягийн түвшнүүдийг `resolveAddressFromGeocode`-ийн хүлээдэг
 * хэлбэрт буулгана. Улаанбаатарт state байхгүй (city = хот, city_district =
 * дүүрэг); аймагт state = аймаг, county эсвэл city = сум.
 */
export function partsFromNominatim(a: NominatimAddress): GeocodeParts {
  const locality = a.city ?? a.town ?? a.village;
  const street = [a.road, a.house_number].filter(Boolean).join(" ");
  const district = a.city_district ?? a.county;
  // Бага → их: гудамж, хороолол, дүүрэг/сум, хот, аймаг (давхардлыг хасна).
  const formatted = [
    street,
    a.suburb ?? a.residential ?? a.neighbourhood,
    district,
    locality,
    a.state,
  ].filter((p, i, all): p is string => Boolean(p) && all.indexOf(p) === i);
  return {
    adminLevel1: a.state,
    adminLevel2: district,
    adminLevel3: a.quarter ?? a.neighbourhood,
    locality,
    sublocality: a.suburb,
    formatted: formatted.length ? formatted.join(", ") : undefined,
  };
}

/** Цэгийн хаяг. Олдоогүй эсвэл үйлчилгээ алдаа өгвөл null (хаяг заавал биш). */
export async function reverseGeocode(lat: number, lng: number): Promise<GeocodeParts | null> {
  const url = new URL("/reverse", baseUrl());
  url.search = new URLSearchParams({
    format: "jsonv2",
    lat: lat.toFixed(6),
    lon: lng.toFixed(6),
    zoom: "18",
    addressdetails: "1",
    "accept-language": "mn",
  }).toString();
  try {
    const res = await fetch(url, {
      headers: {
        Accept: "application/json",
        "User-Agent": "carservice.mn (+https://carservice.mn)",
      },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      console.warn(`[reverse-geocode] ${res.status}`);
      return null;
    }
    const data = (await res.json()) as { address?: NominatimAddress; error?: string };
    if (!data.address) return null;
    return partsFromNominatim(data.address);
  } catch (e) {
    console.warn("[reverse-geocode]", e);
    return null;
  }
}
