import { enforceRateLimit, jsonError, jsonOk, PUBLIC_CATALOG_RATE_LIMIT } from "@/lib/api";
import { getDiscoveryCatalog, parseDiscoveryFilters } from "@/lib/discovery-catalog";
import { setBypassContext } from "@/lib/tenant-context";

/** Internal web discovery adapter. The current web UI receives the complete filtered list. */
export async function GET(request: Request) {
  const limited = enforceRateLimit(request, "public-catalog", PUBLIC_CATALOG_RATE_LIMIT);
  if (limited) return limited;
  setBypassContext();
  const parsed = parseDiscoveryFilters(new URL(request.url).searchParams);
  if (parsed.error || !parsed.filters) return jsonError(400, parsed.error ?? "Шүүлтүүр буруу байна.");
  const catalog = await getDiscoveryCatalog(parsed.filters, { includeNonBookable: true });
  return jsonOk({ orgs: catalog.organizations, facets: catalog.facets });
}
