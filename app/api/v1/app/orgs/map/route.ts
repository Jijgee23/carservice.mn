import { enforceRateLimit, jsonError, jsonOk, PUBLIC_CATALOG_RATE_LIMIT } from "@/lib/api";
import { DISCOVERY_MAX_MARKERS, getDiscoveryCatalog, parseDiscoveryFilters } from "@/lib/discovery-catalog";
import { setBypassContext } from "@/lib/tenant-context";

/** Mobile discovery map contract: lightweight viewport-scoped branch markers. */
export async function GET(request: Request) {
  const limited = enforceRateLimit(request, "public-catalog", PUBLIC_CATALOG_RATE_LIMIT);
  if (limited) return limited;
  setBypassContext();
  const parsed = parseDiscoveryFilters(new URL(request.url).searchParams);
  if (parsed.error || !parsed.filters) return jsonError(400, parsed.error ?? "Шүүлтүүр буруу байна.");
  // Вэбтэй адил бүх нийтийн газар; marker бүр `bookable` агуулна.
  const catalog = await getDiscoveryCatalog(parsed.filters, { includeFacets: false, includeNonBookable: true });
  return jsonOk({
    markers: catalog.markers.slice(0, DISCOVERY_MAX_MARKERS),
    count: catalog.markerCount,
    truncated: catalog.markersTruncated,
    max: DISCOVERY_MAX_MARKERS,
  });
}
