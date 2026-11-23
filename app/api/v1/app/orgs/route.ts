import { enforceRateLimit, jsonError, jsonOk, PUBLIC_CATALOG_RATE_LIMIT } from "@/lib/api";
import { getDiscoveryCatalog, parseDiscoveryFilters } from "@/lib/discovery-catalog";
import { buildMeta, getApiPageInfo } from "@/lib/pagination";
import { setBypassContext } from "@/lib/tenant-context";

/** Mobile discovery contract: server-filtered, organization-paginated catalog. */
export async function GET(request: Request) {
  const limited = enforceRateLimit(request, "public-catalog", PUBLIC_CATALOG_RATE_LIMIT);
  if (limited) return limited;
  setBypassContext();
  const searchParams = new URL(request.url).searchParams;
  const parsed = parseDiscoveryFilters(searchParams);
  if (parsed.error || !parsed.filters) return jsonError(400, parsed.error ?? "Шүүлтүүр буруу байна.");
  const { page, pageSize, skip, take } = getApiPageInfo(searchParams, { defaultSize: 20 });
  // Вэбийн /discover-тэй адил бүх нийтийн газрыг буцаана; апп `bookable`-ээр
  // «Цаг захиалах»-ыг нуудаг.
  const catalog = await getDiscoveryCatalog(parsed.filters, { includeNonBookable: true });
  const orgs = catalog.organizations.map((organization) => ({
    slug: organization.slug,
    bookable: organization.bookable,
    name: organization.name,
    logoUrl: organization.logoUrl,
    branches: organization.branches.map((branch) => ({
      id: branch.id,
      name: branch.name,
      city: branch.city,
      district: branch.district,
      latitude: branch.lat,
      longitude: branch.lng,
      serviceKeyIds: branch.serviceKeyIds,
      tags: branch.tags,
      // Вэбийн /discover, /book-ийн картуудтай адил: одоо нээлттэй эсэх
      // (Asia/Ulaanbaatar), өнөөдрийн цаг, утас (салбарын, эс бөгөөс байгууллагын).
      open: branch.open,
      hours: branch.hours,
      phone: branch.phone ?? organization.phone ?? null,
      // Бүтэн хаяг (хот, дүүрэг, хороо, гудамж) — вэбийн /book картын адил.
      address: branch.address,
      ...(branch.distanceKm == null ? {} : { distanceKm: branch.distanceKm }),
    })),
  }));
  return jsonOk({
    orgs: orgs.slice(skip, skip + take),
    pagination: buildMeta(orgs.length, page, pageSize),
    facets: catalog.facets,
  });
}
