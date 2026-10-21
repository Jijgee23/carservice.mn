import { BOOKABLE_CATEGORY_WHERE } from "@/lib/categories";
import "server-only";

import { distanceKm, nowInZone } from "@/lib/branch-filters";
import {
  businessDateKey,
  resolveEffectiveSchedule,
} from "@/lib/branch-effective-schedule";
import { branchScheduleDisplaySelect } from "@/lib/branch-effective-schedule-server";
import {
  branchStatusNow,
  formatAddress,
  timeToMinutes,
  worksEffectiveWeekends,
} from "@/lib/branches";
import { PLAN_LIMIT_CODES } from "@/lib/plan-limits";
import { plansWithFeature } from "@/lib/plan-limits-server";
import { prisma } from "@/lib/prisma";

export const DISCOVERY_MAX_MARKERS = 500;
export const DISCOVERY_MAX_RADIUS_KM = 100;

export type DiscoveryViewport = {
  north: number;
  south: number;
  east: number;
  west: number;
};

export type DiscoveryFilters = {
  query: string;
  city: string;
  district: string;
  lat: number | null;
  lng: number | null;
  radius: number | null;
  openNow: boolean;
  weekend: boolean;
  // "Ямар ажил хийлгэх гэж байна?" — SystemServiceKey.id-аар шүүнэ (аль ч
  // байгууллагад хамаарахгүй, платформ даяарх түлхүүр).
  serviceKey: string;
  // Бизнесийн төрлийн шошго (BranchTag.id) — салбар шууд холбогдоно, Category
  // дундуур дамжихгүй.
  tag: string;
  viewport?: DiscoveryViewport;
};

export function numberParam(sp: URLSearchParams, key: string): number | null {
  const raw = sp.get(key);
  if (raw == null || raw.trim() === "") return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

export function parseDiscoveryViewport(sp: URLSearchParams):
  | { viewport?: DiscoveryViewport; error?: never }
  | { viewport?: never; error: string } {
  const values = {
    north: numberParam(sp, "north"),
    south: numberParam(sp, "south"),
    east: numberParam(sp, "east"),
    west: numberParam(sp, "west"),
  };
  const present = Object.values(values).some((value) => value != null);
  if (!present) return {};
  if (Object.values(values).some((value) => value == null)) {
    return { error: "north, south, east, west бүгд шаардлагатай." };
  }
  const { north, south, east, west } = values as DiscoveryViewport;
  if (
    north < -90 || north > 90 || south < -90 || south > 90 || south > north ||
    west < -180 || west > 180 || east < -180 || east > 180
  ) {
    return { error: "Газрын зургийн хүрээ буруу байна." };
  }
  return { viewport: { north, south, east, west } };
}

export function parseDiscoveryFilters(sp: URLSearchParams):
  | { filters: DiscoveryFilters; error?: never }
  | { filters?: never; error: string } {
  const parsedViewport = parseDiscoveryViewport(sp);
  if (parsedViewport.error) return { error: parsedViewport.error };
  const latRaw = numberParam(sp, "lat");
  const lngRaw = numberParam(sp, "lng");
  const nearMe =
    latRaw != null && lngRaw != null && Math.abs(latRaw) <= 90 && Math.abs(lngRaw) <= 180;
  const radiusRaw = numberParam(sp, "radius");
  return {
    filters: {
      query: sp.get("q")?.trim() ?? "",
      city: sp.get("city")?.trim() ?? "",
      district: sp.get("district")?.trim() ?? "",
      lat: nearMe ? latRaw : null,
      lng: nearMe ? lngRaw : null,
      radius:
        radiusRaw != null && radiusRaw > 0
          ? Math.min(radiusRaw, DISCOVERY_MAX_RADIUS_KM)
          : null,
      openNow: sp.get("openNow") === "1" || sp.get("openNow") === "true",
      weekend: sp.get("weekend") === "1" || sp.get("weekend") === "true",
      serviceKey: sp.get("serviceKey")?.trim() ?? "",
      tag: sp.get("tag")?.trim() ?? "",
      ...(parsedViewport.viewport ? { viewport: parsedViewport.viewport } : {}),
    },
  };
}

type DiscoveryBranch = {
  id: string;
  name: string;
  phone: string | null;
  city: string | null;
  district: string | null;
  khoroo: string | null;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  openTime: string | null;
  closeTime: string | null;
  schedules: Array<Record<string, unknown>>;
  scheduleExceptions: Array<Record<string, unknown>>;
  scheduleSeasons: Array<Record<string, unknown>>;
  tags: Array<{ id: string; name: string }>;
};

type DiscoveryTenant = {
  slug: string;
  name: string;
  logoUrl: string | null;
  phone1: string;
  branches: DiscoveryBranch[];
  categories: Array<{
    name: string;
    systemServiceKeyId: string | null;
    branches: Array<{ id: string }>;
  }>;
};

export type DiscoveryOrganization = {
  slug: string;
  name: string;
  logoUrl: string | null;
  phone: string;
  branches: Array<{
    id: string;
    name: string;
    phone: string | null;
    address: string;
    city: string | null;
    district: string | null;
    lat: number | null;
    lng: number | null;
    open: boolean;
    hours: string | null;
    weekend: boolean;
    services: string[];
    serviceKeyIds: string[];
    tags: Array<{ id: string; name: string }>;
    distanceKm?: number;
  }>;
};

export type DiscoveryMarker = {
  id: string;
  orgSlug: string;
  orgName: string;
  logoUrl: string | null;
  branchName: string;
  city: string | null;
  district: string | null;
  latitude: number;
  longitude: number;
  serviceKeyIds: string[];
  tagIds: string[];
  distanceKm?: number;
};

export async function getDiscoveryCatalog(
  filters: DiscoveryFilters,
  options?: { includeFacets?: boolean },
) {
  const includeFacets = options?.includeFacets ?? true;
  const allowedPlans = await plansWithFeature(PLAN_LIMIT_CODES.ONLINE_BOOKING);
  const hasCoordinates = filters.lat != null && filters.lng != null;
  const viewportWhere = filters.viewport
    ? filters.viewport.east >= filters.viewport.west
      ? {
          latitude: { gte: filters.viewport.south, lte: filters.viewport.north },
          longitude: { gte: filters.viewport.west, lte: filters.viewport.east },
        }
      : {
          latitude: { gte: filters.viewport.south, lte: filters.viewport.north },
          OR: [
            { longitude: { gte: filters.viewport.west } },
            { longitude: { lte: filters.viewport.east } },
          ],
        }
    : {};
  const branchWhere = {
    isActive: true,
    ...(filters.city ? { city: filters.city } : {}),
    ...(filters.district ? { district: filters.district } : {}),
    ...(hasCoordinates || filters.viewport
      ? { latitude: { not: null }, longitude: { not: null } }
      : {}),
    ...(filters.viewport ? { AND: [viewportWhere] } : {}),
  };
  const searchBranchWhere = filters.query
    ? {
        ...branchWhere,
        OR: [
          { name: { contains: filters.query, mode: "insensitive" as const } },
          { city: { contains: filters.query, mode: "insensitive" as const } },
          { district: { contains: filters.query, mode: "insensitive" as const } },
        ],
      }
    : branchWhere;

  const tenants = (await prisma.tenant.findMany({
    where: {
      acceptsOnlineBooking: true,
      suspended: false,
      isTest: false, // тест/демо тенант олон нийтэд харагдахгүй (lib/tenant-visibility.ts)
      plan: { in: allowedPlans },
      branches: { some: branchWhere },
      ...(filters.query
        ? {
            OR: [
              { name: { contains: filters.query, mode: "insensitive" as const } },
              { branches: { some: searchBranchWhere } },
              { categories: { some: { isActive: true, ...BOOKABLE_CATEGORY_WHERE, name: { contains: filters.query, mode: "insensitive" as const } } } },
            ],
          }
        : {}),
    },
    orderBy: { name: "asc" },
    select: {
      slug: true,
      name: true,
      logoUrl: true,
      phone1: true,
      branches: {
        where: branchWhere,
        orderBy: { isPrimary: "desc" },
        select: {
          id: true,
          name: true,
          phone: true,
          city: true,
          district: true,
          khoroo: true,
          address: true,
          latitude: true,
          longitude: true,
          tags: { select: { id: true, name: true } },
          ...branchScheduleDisplaySelect(),
        },
      },
      categories: {
        where: { isActive: true, ...BOOKABLE_CATEGORY_WHERE },
        orderBy: { name: "asc" },
        select: { name: true, systemServiceKeyId: true, branches: { select: { id: true } } },
      },
    },
  })) as unknown as DiscoveryTenant[];

  const nowDate = new Date();
  const now = filters.openNow ? nowInZone(nowDate) : null;
  const todayKey = businessDateKey(nowDate);
  const normalizedQuery = filters.query.toLocaleLowerCase();
  const filtered: DiscoveryOrganization[] = [];
  const nearestByOrg: number[] = [];
  const markers: DiscoveryMarker[] = [];

  for (const tenant of tenants) {
    const tenantNameMatch =
      normalizedQuery.length > 0 && tenant.name.toLocaleLowerCase().includes(normalizedQuery);
    const categoriesFor = (branchId: string) =>
      tenant.categories.filter(
        (category) => category.branches.length === 0 || category.branches.some((b) => b.id === branchId),
      );
    const servicesFor = (branchId: string) => categoriesFor(branchId).map((category) => category.name);
    const serviceKeyIdsFor = (branchId: string) => [
      ...new Set(
        categoriesFor(branchId)
          .map((category) => category.systemServiceKeyId)
          .filter((id): id is string => Boolean(id)),
      ),
    ];
    const visible: DiscoveryOrganization["branches"] = [];
    let nearest = Number.POSITIVE_INFINITY;
    let weekendMatch = false;

    for (const branch of tenant.branches) {
      const services = servicesFor(branch.id);
      const serviceKeyIds = serviceKeyIdsFor(branch.id);
      const tagIds = branch.tags.map((t) => t.id);
      if (filters.serviceKey && !serviceKeyIds.includes(filters.serviceKey)) continue;
      if (filters.tag && !tagIds.includes(filters.tag)) continue;
      if (
        filters.query &&
        !tenantNameMatch &&
        ![branch.name, branch.city, branch.district, ...services].some((value) =>
          value?.toLocaleLowerCase().includes(normalizedQuery),
        )
      ) continue;
      const scheduleInput = {
        openTime: branch.openTime,
        closeTime: branch.closeTime,
        schedules: branch.schedules,
        scheduleExceptions: branch.scheduleExceptions,
        scheduleSeasons: branch.scheduleSeasons,
      } as Parameters<typeof branchStatusNow>[0];
      if (filters.openNow && now) {
        const schedule = resolveEffectiveSchedule({ dateStr: todayKey, branch: scheduleInput as never });
        const start = timeToMinutes(schedule.openTime);
        const end = timeToMinutes(schedule.closeTime);
        if (!schedule.open || start == null || end == null || end <= start || now.minutes < start || now.minutes >= end) continue;
      }
      let distance: number | undefined;
      if (hasCoordinates) {
        if (branch.latitude == null || branch.longitude == null) continue;
        distance = distanceKm(filters.lat!, filters.lng!, branch.latitude, branch.longitude);
        if (filters.radius != null && distance > filters.radius) continue;
        nearest = Math.min(nearest, distance);
      }
      const worksWeekend = worksEffectiveWeekends(scheduleInput, nowDate);
      if (filters.weekend && worksWeekend) weekendMatch = true;
      const status = branchStatusNow(scheduleInput, nowDate);
      visible.push({
        id: branch.id,
        name: branch.name,
        phone: branch.phone,
        address: formatAddress(branch),
        city: branch.city,
        district: branch.district,
        lat: branch.latitude,
        lng: branch.longitude,
        open: status.open,
        hours: status.hours,
        weekend: worksWeekend,
        services,
        serviceKeyIds,
        tags: branch.tags,
        ...(distance == null ? {} : { distanceKm: Math.round(distance * 10) / 10 }),
      });
    }
    if (visible.length === 0 || (filters.weekend && !weekendMatch)) continue;
    if (hasCoordinates) visible.sort((a, b) => (a.distanceKm ?? 0) - (b.distanceKm ?? 0));
    filtered.push({ slug: tenant.slug, name: tenant.name, logoUrl: tenant.logoUrl, phone: tenant.phone1, branches: visible });
    nearestByOrg.push(nearest);
    for (const branch of visible) {
      if (branch.lat == null || branch.lng == null) continue;
      markers.push({
        id: branch.id,
        orgSlug: tenant.slug,
        orgName: tenant.name,
        logoUrl: tenant.logoUrl,
        branchName: branch.name,
        city: branch.city,
        district: branch.district,
        latitude: branch.lat,
        longitude: branch.lng,
        serviceKeyIds: branch.serviceKeyIds,
        tagIds: branch.tags.map((t) => t.id),
        ...(branch.distanceKm == null ? {} : { distanceKm: branch.distanceKm }),
      });
    }
  }

  if (hasCoordinates) {
    const indexed = filtered.map((organization, index) => ({ organization, distance: nearestByOrg[index] }));
    indexed.sort((a, b) => a.distance - b.distance);
    filtered.splice(0, filtered.length, ...indexed.map((item) => item.organization));
  }

  // Map endpoints only consume `markers`/`markerCount`/`markersTruncated` and
  // never `facets` — skip this nationwide (unscoped by viewport) query there,
  // since otherwise it re-runs on every map pan/zoom for no reason.
  const facetBranches = includeFacets
    ? await prisma.branch.findMany({
        where: { isActive: true, tenant: { acceptsOnlineBooking: true, suspended: false, isTest: false, plan: { in: allowedPlans } } },
        select: { city: true, district: true },
      })
    : [];
  const districts = facetBranches
    .filter((branch) => !filters.city || branch.city === filters.city)
    .map((branch) => branch.district?.trim())
    .filter((value): value is string => Boolean(value));
  return {
    organizations: filtered,
    facets: {
      cities: [...new Set(facetBranches.map((b) => b.city?.trim()).filter((v): v is string => Boolean(v)))].sort(),
      districts: [...new Set(districts)].sort(),
    },
    markers,
    markerCount: markers.length,
    markersTruncated: markers.length > DISCOVERY_MAX_MARKERS,
  };
}
