"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { MarkerClusterer } from "@googlemaps/markerclusterer";
import { Select } from "@/app/_components/select";
import { DiscoverReviewModal, type MyBranchReview, type PendingReview, type ReviewTarget } from "./discover-review-modal";

export type DiscoverBranch = {
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
  distanceKm?: number;
  // Бямба/Ням аль нэгэнд ажилладаг эсэх ("Амралтын өдөр ажилладаг" шүүлт).
  weekend: boolean;
  services: string[];
  // Бизнесийн төрлийн шошго (жиш: "Угаалгын газар") — салбар карт дээр шууд
  // харуулна, мөн доор нэг сонголттой шүүлтүүрийн эх сурвалж.
  tags: { id: string; name: string }[];
  // Үйлчлүүлэгчийн үнэлгээний дундаж (Branch.ratingAvg), үнэлгээгүй бол null.
  rating: number | null;
  ratingCount: number;
};

const DEFAULT_CITY = "Улаанбаатар";

export type DiscoverOrg = {
  slug: string;
  name: string;
  logoUrl: string | null;
  phone: string;
  branches: DiscoverBranch[];
};

type Marker = { org: DiscoverOrg; branch: DiscoverBranch };
type MapViewport = { north: number; south: number; east: number; west: number };

type GeoPoint = { lat: number; lng: number };

// Fetch a bit more than what's actually visible so a small pan/zoom-out
// keeps showing already-fetched pins instead of the edge going empty while
// waiting for the next idle-triggered fetch. Clamped to valid lat/lng ranges;
// deliberately not dateline-aware (a 25% pad crossing ±180° is a rare enough
// case that showing a slightly-too-narrow buffer there is an acceptable
// trade-off for keeping this simple).
function padViewport(viewport: MapViewport, factor = 0.25): MapViewport {
  const latPad = (viewport.north - viewport.south) * factor;
  const lngPad = (viewport.east - viewport.west) * factor;
  return {
    north: Math.min(90, viewport.north + latPad),
    south: Math.max(-90, viewport.south - latPad),
    east: Math.min(180, viewport.east + lngPad),
    west: Math.max(-180, viewport.west - lngPad),
  };
}

function distanceLabel(distanceKm: number): string {
  if (distanceKm < 1) {
    return `${Math.max(1, Math.round(distanceKm * 1000))} м`;
  }
  return `${distanceKm.toFixed(1)} км`;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null;
}

/** Merge the API's filtered/sorted branch summary onto the richer SSR payload. */
function mergeFilteredOrgs(
  initialOrgs: DiscoverOrg[],
  payload: unknown,
  { openNow }: { openNow: boolean },
): DiscoverOrg[] {
  const body = asRecord(payload);
  const apiOrgs = body?.orgs;
  if (!Array.isArray(apiOrgs)) throw new Error("Шүүлтүүрийн хариу буруу байна.");

  const initialBySlug = new Map(initialOrgs.map((org) => [org.slug, org]));
  const filtered: DiscoverOrg[] = [];
  for (const rawOrg of apiOrgs) {
    const apiOrg = asRecord(rawOrg);
    const slug = apiOrg?.slug;
    const apiBranches = apiOrg?.branches;
    if (typeof slug !== "string" || !Array.isArray(apiBranches)) continue;

    const initialOrg = initialBySlug.get(slug);
    if (!initialOrg) continue;
    const initialBranches = new Map(
      initialOrg.branches.map((branch) => [branch.id, branch]),
    );
    const branches: DiscoverBranch[] = [];
    for (const rawBranch of apiBranches) {
      const apiBranch = asRecord(rawBranch);
      const id = apiBranch?.id;
      if (typeof id !== "string") continue;
      const initialBranch = initialBranches.get(id);
      if (!initialBranch) continue;
      const rawDistance = apiBranch?.distanceKm;
      branches.push({
        ...initialBranch,
        ...(openNow ? { open: true } : {}),
        ...(typeof rawDistance === "number" && Number.isFinite(rawDistance)
          ? { distanceKm: rawDistance }
          : {}),
      });
    }
    if (branches.length === 0) continue;
    filtered.push({ ...initialOrg, branches });
  }
  return filtered;
}

async function fetchFilteredOrgs({
  initialOrgs,
  location,
  openNow,
  signal,
}: {
  initialOrgs: DiscoverOrg[];
  location: GeoPoint | null;
  openNow: boolean;
  signal: AbortSignal;
}): Promise<DiscoverOrg[]> {
  const params = new URLSearchParams();
  if (location) {
    params.set("lat", String(location.lat));
    params.set("lng", String(location.lng));
  }
  if (openNow) params.set("openNow", "1");
  const query = params.toString();
  const response = await fetch(`/api/web/discovery${query ? `?${query}` : ""}`, {
    signal,
    cache: "no-store",
  });
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) throw new Error("Шүүлтүүрийн үр дүнг ачаалж чадсангүй.");
  return mergeFilteredOrgs(initialOrgs, payload, { openNow });
}

async function fetchMapMarkers({
  initialOrgs,
  viewport,
  query,
  city,
  district,
  tag,
  nearMeLocation,
  openNow,
  weekend,
  signal,
}: {
  initialOrgs: DiscoverOrg[];
  viewport: MapViewport;
  query: string;
  city: string;
  district: string;
  tag: string;
  nearMeLocation: GeoPoint | null;
  openNow: boolean;
  weekend: boolean;
  signal: AbortSignal;
}): Promise<{ markers: Marker[]; truncated: boolean }> {
  const params = new URLSearchParams({
    north: String(viewport.north),
    south: String(viewport.south),
    east: String(viewport.east),
    west: String(viewport.west),
  });
  if (query.trim()) params.set("q", query.trim());
  if (city) params.set("city", city);
  if (district) params.set("district", district);
  if (tag) params.set("tag", tag);
  if (nearMeLocation) {
    params.set("lat", String(nearMeLocation.lat));
    params.set("lng", String(nearMeLocation.lng));
  }
  if (openNow) params.set("openNow", "1");
  if (weekend) params.set("weekend", "1");
  const response = await fetch(`/api/web/discovery/map?${params}`, {
    signal,
    cache: "no-store",
  });
  const body = asRecord(await response.json().catch(() => null));
  if (!response.ok || !Array.isArray(body?.markers)) {
    throw new Error("Газрын зургийн цэгүүдийг ачаалж чадсангүй.");
  }
  const bySlug = new Map(initialOrgs.map((org) => [org.slug, org]));
  const markers: Marker[] = [];
  for (const raw of body.markers) {
    const item = asRecord(raw);
    const slug = item?.orgSlug;
    const branchId = item?.id;
    if (typeof slug !== "string" || typeof branchId !== "string") continue;
    const org = bySlug.get(slug);
    const branch = org?.branches.find((candidate) => candidate.id === branchId);
    if (org && branch) {
      const distanceKm = item?.distanceKm;
      markers.push({
        org,
        branch: {
          ...branch,
          ...(openNow ? { open: true } : {}),
          ...(typeof distanceKm === "number" && Number.isFinite(distanceKm)
            ? { distanceKm }
            : {}),
        },
      });
    }
  }
  return { markers, truncated: body.truncated === true };
}

function requestBrowserLocation(): Promise<GeoPoint> {
  if (typeof navigator === "undefined" || !navigator.geolocation) {
    return Promise.reject(new Error("Энэ browser байршил тогтоохыг дэмжихгүй байна."));
  }
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => resolve({ lat: coords.latitude, lng: coords.longitude }),
      () => reject(new Error("Байршлын зөвшөөрөл олгогдсонгүй.")),
      { enableHighAccuracy: false, maximumAge: 60_000, timeout: 10_000 },
    );
  });
}

// Google Maps JS API-г нэг л удаа ачаална (module-level promise).
declare global {
  interface Window {
    google?: unknown;
    __gmapsPromise?: Promise<void>;
  }
}
function loadGoogleMaps(apiKey: string): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if ((window as any).google?.maps) return Promise.resolve();
  if (window.__gmapsPromise) return window.__gmapsPromise;
  window.__gmapsPromise = new Promise<void>((resolve, reject) => {
    const s = document.createElement("script");
    s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&libraries=marker&language=mn&region=MN`;
    s.async = true;
    s.defer = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("Google Maps ачаалж чадсангүй."));
    document.head.appendChild(s);
  });
  return window.__gmapsPromise;
}

const UB_CENTER = { lat: 47.918, lng: 106.917 };

// AdvancedMarkerElement-д ашиглах Map ID (vector map шаардлагатай). Бодит
// Map ID байхгүй бол Google-ийн DEMO_MAP_ID ажиллана.
const DEFAULT_MAP_ID = "DEMO_MAP_ID";

function isLightTheme(): boolean {
  return (
    typeof document !== "undefined" &&
    document.documentElement.classList.contains("light")
  );
}

function ringColor(open: boolean, active: boolean): string {
  return active ? "#e74c3c" : open ? "#22c55e" : "#9ca3af";
}

/** Маркерын DOM — логотой дугуй "pin" + доош үзүүртэй. */
function buildPinElement(m: Marker, active: boolean): HTMLElement {
  const wrap = document.createElement("div");
  wrap.style.cssText =
    "position:relative;width:44px;height:54px;cursor:pointer;transition:transform .15s ease;";

  const badge = document.createElement("div");
  badge.dataset.role = "badge";
  badge.style.cssText = `position:absolute;top:0;left:2px;width:40px;height:40px;border-radius:9999px;background:#fff;border:3px solid ${ringColor(
    m.branch.open,
    active,
  )};box-shadow:0 4px 12px rgba(0,0,0,.35);display:flex;align-items:center;justify-content:center;overflow:hidden;`;

  if (m.org.logoUrl) {
    const img = document.createElement("img");
    img.src = m.org.logoUrl;
    img.alt = "";
    img.style.cssText = "width:100%;height:100%;object-fit:contain;";
    badge.appendChild(img);
  } else {
    badge.textContent = m.org.name.slice(0, 1).toUpperCase();
    badge.style.color = "#2c3e50";
    badge.style.fontWeight = "700";
    badge.style.fontSize = "16px";
  }

  // Доош чиглэсэн жижиг үзүүр (pin tail)
  const tail = document.createElement("div");
  tail.dataset.role = "tail";
  tail.style.cssText = `position:absolute;top:36px;left:50%;transform:translateX(-50%);width:0;height:0;border-left:7px solid transparent;border-right:7px solid transparent;border-top:9px solid ${ringColor(
    m.branch.open,
    active,
  )};`;

  wrap.appendChild(badge);
  wrap.appendChild(tail);
  if (active) wrap.style.transform = "scale(1.18)";
  return wrap;
}

function OpenBadge({ open, hours }: { open: boolean; hours: string | null }) {
  return (
    <span
      className={`shrink-0 inline-flex items-center gap-1.5 text-[11px] font-medium px-2 py-0.5 rounded-full border whitespace-nowrap ${open
        ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/30 light:bg-emerald-50 light:text-emerald-700 light:border-emerald-300"
        : "bg-[var(--oc-panel2)] text-[var(--oc-muted)] border-[var(--oc-line)]"
        }`}
    >
      <span
        className={`w-1.5 h-1.5 rounded-full ${open ? "bg-emerald-400" : "bg-[var(--oc-muted4)]"}`}
      />
      {open ? "Нээлттэй" : "Хаалттай"}
      {hours ? <span className="opacity-70 tabular-nums">· {hours}</span> : null}
    </span>
  );
}

// Салбарын үзүүлдэг үйлчилгээний ангиллууд (жагсаалт мөр + map карт хоёуланд).
function ServiceTags({ services }: { services: string[] }) {
  if (services.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {services.map((s) => (
        <span
          key={s}
          className="text-[11px] px-2 py-0.5 rounded-md bg-[var(--oc-panel)] text-[var(--oc-muted)] border border-[var(--oc-line)]"
        >
          {s}
        </span>
      ))}
    </div>
  );
}

// Бизнесийн төрлийн шошго (жиш: "Угаалгын газар") — салбарын нэрийн яг доор,
// хаяг/зайнаас өмнө харуулна (тухайн газар "ямар газар вэ" гэдэг нь хаяг,
// зайнаас илүү тэргүүлэх ач холбогдолтой). Олон шошготой бол ердийн
// текстээр таслалаар нэгтгэнэ — chip биш, гарчгийн мөрийг өнгөлөг/
// түгжрэлтэй болгохоос сэргийлнэ.
function BranchTagLine({ tags }: { tags: { id: string; name: string }[] }) {
  if (tags.length === 0) return null;
  return (
    <div className="mt-0.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--oc-accent)] truncate">
      {tags.map((tag) => tag.name).join(" · ")}
    </div>
  );
}

export function DiscoverClient({
  orgs,
  apiKey,
  mapId,
  pendingReviews = {},
  myReviews = {},
  loggedIn = false,
}: {
  orgs: DiscoverOrg[];
  apiKey: string;
  mapId: string;
  /** Нэвтэрсэн хэрэглэгчийн үнэлээгүй дууссан засварууд (branchId → засварууд). */
  pendingReviews?: Record<string, PendingReview[]>;
  /** Хэрэглэгчийн салбар бүрт өгсөн үнэлгээ. */
  myReviews?: Record<string, MyBranchReview>;
  loggedIn?: boolean;
}) {
  // Үнэлгээ өгөх modal: салбар дээр дарахад АВТОМАТААР гарахгүй — зөвхөн
  // «★ Үнэлгээ өгөх» товчоор (жагсаалтын мөр, газрын зургийн popup) нээгдэнэ.
  // Нэвтрээгүй бол нэвтрэх санал, үнэлсэн бол «засах».
  const [pending, setPending] = useState(pendingReviews);
  // Сервер (refresh-ийн дараа) утга давуу; локал нь «сая үнэлсэн» тэмдэг.
  const [justRated, setJustRated] = useState<Record<string, MyBranchReview>>({});
  const mine = useMemo(() => ({ ...justRated, ...myReviews }), [justRated, myReviews]);
  const [reviewTarget, setReviewTarget] = useState<ReviewTarget | null>(null);
  function openReview(m: { org: DiscoverOrg; branch: DiscoverBranch }, continueHref: string | null) {
    setReviewTarget({
      branchId: m.branch.id,
      orgName: m.org.name,
      branchName: m.branch.name,
      logoUrl: m.org.logoUrl,
      continueHref,
    });
  }
  // Газрын зургийн pin дээр дарахад: зөвхөн popup сонгоно.
  function pickMarker(m: Marker) {
    setSelected(m);
  }
  // Аймаг/хотын жагсаалт (branch-ийн баазын утгаас).
  const cities = useMemo(() => {
    const s = new Set<string>();
    for (const o of orgs)
      for (const b of o.branches) {
        const c = b.city?.trim();
        if (c) s.add(c);
      }
    return [...s].sort((a, b) => a.localeCompare(b, "mn"));
  }, [orgs]);

  // Бизнесийн төрлийн шошгын жагсаалт (branch-ийн баазын утгаас, city/
  // district-тэй ижил зарчим) — нэг сонголттой шүүлтүүр (mobile-тай ижил,
  // харах: carcare_customer_mobile-ийн discovery_screen.dart-ийн _TagFilter).
  const tags = useMemo(() => {
    const byId = new Map<string, string>();
    for (const o of orgs)
      for (const b of o.branches)
        for (const t of b.tags) byId.set(t.id, t.name);
    return [...byId.entries()]
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name, "mn"));
  }, [orgs]);

  // Хотын шүүлтүүр анх ороход ХООСОН (бүх аймаг/хот) — газрын зургийн
  // ЭХНИЙ ХАРАГДАЦ Улаанбаатар руу төвлөрдөг ч (доор `UB_CENTER`) энэ зөвхөн
  // камерын байрлал, "хот" шүүлтүүрийг далд идэвхжүүлдэггүй.
  const [city, setCity] = useState("");
  const [citySelectedByUser, setCitySelectedByUser] = useState(false);
  const [district, setDistrict] = useState("");
  // Бизнесийн төрлийн шошго (жиш: "Угаалгын газар") — нэг дор зөвхөн нэг
  // сонголт.
  const [tag, setTag] = useState("");
  // Засварын (үйлчилгээ) нэр эсвэл салбарын нэрээр хайх — жагсаалт/газрын
  // зураг хоёуланд хамаарна.
  const [query, setQuery] = useState("");
  // "Амралтын өдөр ажилладаг" — байгууллага аль нэг салбар нь Бямба/Ням
  // ажилладаг бол харагдана (city/district-той ижил client-side шүүлт).
  const [weekendOnly, setWeekendOnly] = useState(false);
  const [nearMeOnly, setNearMeOnly] = useState(false);
  const [openNowOnly, setOpenNowOnly] = useState(false);
  const [nearMeLocation, setNearMeLocation] = useState<GeoPoint | null>(null);
  const [locationPending, setLocationPending] = useState(false);
  const [filterLoading, setFilterLoading] = useState(false);
  const [filterError, setFilterError] = useState<string | null>(null);
  const [catalogOrgs, setCatalogOrgs] = useState(orgs);
  const router = useRouter();

  // `orgs` (SSR snapshot) шууд харагдах "Нээлттэй/Хаалттай"-г тодорхойлдог тул
  // хуудсыг эрт нээгээд урт хугацаанд орхивол хуучирна (салбарын ажлын цаг
  // сая өнгөрсөн байж болно). Tab харагдаж байх үед л тогтмол шинэчилнэ —
  // `router.refresh()` server component-ийг дахин ажиллуулж шинэ `orgs`
  // props-ыг авчирна, шүүлтүүрийн state-д хөндлөнгөөс нөлөөлөхгүй.
  useEffect(() => {
    const interval = setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, 5 * 60_000);
    return () => clearInterval(interval);
  }, [router]);

  useEffect(() => {
    const controller = new AbortController();
    if (!nearMeOnly && !openNowOnly) {
      // This effect mirrors the server-filtered catalog when toggles clear.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setCatalogOrgs(orgs);
      setFilterError(null);
      setFilterLoading(false);
      return () => controller.abort();
    }

    setFilterLoading(true);
    setFilterError(null);
    fetchFilteredOrgs({
      initialOrgs: orgs,
      location: nearMeOnly ? nearMeLocation : null,
      openNow: openNowOnly,
      signal: controller.signal,
    })
      .then((filtered) => {
        if (controller.signal.aborted) return;
        setCatalogOrgs(filtered);
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setFilterError(
          error instanceof Error
            ? error.message
            : "Шүүлтүүрийн үр дүнг ачаалж чадсангүй.",
        );
      })
      .finally(() => {
        if (!controller.signal.aborted) setFilterLoading(false);
      });

    return () => controller.abort();
  }, [nearMeLocation, nearMeOnly, openNowOnly, orgs]);

  // Сонгосон хотод хамаарах дүүрэг/сумууд.
  const districts = useMemo(() => {
    const s = new Set<string>();
    for (const o of orgs)
      for (const b of o.branches) {
        if (city && (b.city ?? "").trim() !== city) continue;
        const d = b.district?.trim();
        if (d) s.add(d);
      }
    return [...s].sort((a, b) => a.localeCompare(b, "mn"));
  }, [orgs, city]);

  const q = query.trim().toLowerCase();

  const visibleOrgs = useMemo(() => {
    if (!city && !district && !q && !weekendOnly && !tag) return catalogOrgs;
    return catalogOrgs
      .map((o) => ({
        ...o,
        branches: o.branches.filter(
          (b) =>
            (!city || (b.city ?? "").trim() === city) &&
            (!district || (b.district ?? "").trim() === district) &&
            (!tag || b.tags.some((t) => t.id === tag)) &&
            (!q ||
              b.name.toLowerCase().includes(q) ||
              b.services.some((s) => s.toLowerCase().includes(q))),
        ),
      }))
      .filter((o) => o.branches.length > 0)
      // Org-level шүүлт: аль нэг (дээрх шүүлтийг давсан) салбар нь Бямба/Ням
      // ажилладаг бол ЭНЭ org-ийн БҮХ салбарыг харуулна (зөвхөн weekend
      // салбарыг нь биш) — city/district-ээс ялгаатай зарчим.
      .filter((o) => !weekendOnly || o.branches.some((b) => b.weekend));
  }, [catalogOrgs, city, district, q, weekendOnly, tag]);

  const markers = useMemo<Marker[]>(
    () =>
      visibleOrgs.flatMap((org) =>
        org.branches
          .filter((b) => b.lat != null && b.lng != null)
          .map((branch) => ({ org, branch })),
      ),
    [visibleOrgs],
  );

  function bookingHref(orgSlug: string, branchId: string): string {
    return `/org/${orgSlug}?branch=${encodeURIComponent(branchId)}`;
  }

  // Mobile-ийн адил: салбар дээр дарахад шууд захиалгын маягт руу орохгүй,
  // эхлээд дэлгэрэнгүй (хаяг/цаг/үйлчилгээ) хуудас руу орно. Байршлыг
  // дараагийн алхамд (зайг харуулахад) дамжуулахын тулд query-ээр дамжуулна.
  function branchDetailHref(orgSlug: string, branchId: string): string {
    const params = new URLSearchParams();
    if (nearMeLocation) {
      params.set("lat", String(nearMeLocation.lat));
      params.set("lng", String(nearMeLocation.lng));
    }
    const qs = params.toString();
    return `/org/${orgSlug}/branch/${encodeURIComponent(branchId)}${qs ? `?${qs}` : ""}`;
  }

  // Газрын зураг ТОХИРУУЛАГДСАН эсэх (apiKey байгаа эсэх) — тогтмол, шүүлтийн
  // үр дүнгээс хамаардаггүй тул "Газрын зураг" tab/товч шүүлтийн улмаас 0
  // илэрцтэй болоход алга болохгүй (үр дүнгүй үед доорхи "Энэ хайлтаар газар
  // олдсонгүй" мессеж харагдана, товч биш алга болно).
  const mapConfigured = Boolean(apiKey);
  // The map endpoint is viewport-scoped, so its first response is not known
  // from the SSR/list page. Keep the map available whenever configured.
  const hasMap = mapConfigured;
  const [view, setView] = useState<"map" | "list">(hasMap ? "map" : "list");
  const [selected, setSelected] = useState<Marker | null>(null);
  const [mapError, setMapError] = useState(false);
  const [light, setLight] = useState(false);
  const [mapMarkers, setMapMarkers] = useState<Marker[] | null>(null);
  const [mapTruncated, setMapTruncated] = useState(false);
  const mapRequestKeyRef = useRef<string | null>(null);
  const mapRequestGenerationRef = useRef(0);
  const mapRequestAbortRef = useRef<AbortController | null>(null);
  const mapRequestTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scheduleMapFetchRef = useRef<(viewport: MapViewport) => void>(() => {});
  // Panning back to a viewport/filter combo already fetched this session
  // shouldn't hit the network again — cap it so a long session doesn't grow
  // this unbounded, evicting the oldest entry (simple insertion-order LRU;
  // re-inserting on a hit keeps it "recently used").
  const mapCacheRef = useRef<Map<string, { markers: Marker[]; truncated: boolean }>>(new Map());
  const MAP_CACHE_LIMIT = 50;

  const scheduleMapFetch = (viewport: MapViewport) => {
    const generation = mapRequestGenerationRef.current;
    const key = JSON.stringify({
      viewport,
      query: query.trim(),
      city,
      district,
      tag,
      nearMeLocation,
      openNowOnly,
      weekendOnly,
    });
    if (mapRequestKeyRef.current === key) return;

    const cached = mapCacheRef.current.get(key);
    if (cached) {
      // Refresh recency, then serve straight from cache — no debounce/fetch.
      mapCacheRef.current.delete(key);
      mapCacheRef.current.set(key, cached);
      if (mapRequestTimerRef.current) clearTimeout(mapRequestTimerRef.current);
      mapRequestAbortRef.current?.abort();
      mapRequestKeyRef.current = key;
      setMapError(false);
      setMapMarkers(cached.markers);
      setMapTruncated(cached.truncated);
      return;
    }

    if (mapRequestTimerRef.current) clearTimeout(mapRequestTimerRef.current);
    mapRequestTimerRef.current = setTimeout(() => {
      mapRequestAbortRef.current?.abort();
      const controller = new AbortController();
      mapRequestAbortRef.current = controller;
      fetchMapMarkers({
        initialOrgs: orgs,
        viewport,
        query,
        city,
        district,
        tag,
        nearMeLocation,
        openNow: openNowOnly,
        weekend: weekendOnly,
        signal: controller.signal,
      })
        .then((result) => {
          if (controller.signal.aborted || generation !== mapRequestGenerationRef.current) return;
          mapRequestKeyRef.current = key;
          const cache = mapCacheRef.current;
          cache.set(key, result);
          if (cache.size > MAP_CACHE_LIMIT) {
            const oldest = cache.keys().next().value;
            if (oldest !== undefined) cache.delete(oldest);
          }
          setMapError(false);
          setMapMarkers(result.markers);
          setMapTruncated(result.truncated);
        })
        .catch(() => {
          if (controller.signal.aborted || generation !== mapRequestGenerationRef.current) return;
          setMapError(true);
        });
    }, 250);
  };
  // The map lifecycle intentionally does not depend on filter state. Keep the
  // one idle listener pointed at the latest filter-aware callback instead.
  useEffect(() => {
    scheduleMapFetchRef.current = scheduleMapFetch;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, city, district, tag, nearMeLocation, openNowOnly, weekendOnly, orgs]);

  // `orgs` gets a fresh reference from the periodic `router.refresh()` below
  // (open/hours can go stale on a long-open tab) — cached markers point at
  // the old `orgs`' branch objects, so drop the cache whenever it changes,
  // rather than serving now-outdated open/closed status from a cache hit.
  useEffect(() => {
    mapCacheRef.current.clear();
  }, [orgs]);

  useEffect(() => {
    mapRequestGenerationRef.current += 1;
    mapRequestAbortRef.current?.abort();
    mapRequestKeyRef.current = null;
    if (mapRequestTimerRef.current) clearTimeout(mapRequestTimerRef.current);
    // Clear marker data immediately so a new filter never renders an old
    // viewport response while its debounced request is pending.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMapMarkers(null);
    setMapTruncated(false);
  }, [query, city, district, tag, nearMeLocation, openNowOnly, weekendOnly]);

  const markersForMap = mapMarkers ?? markers;

  const toggleNearMe = async () => {
    setSelected(null);
    if (nearMeOnly) {
      setNearMeOnly(false);
      return;
    }
    setLocationPending(true);
    setFilterError(null);
    try {
      const location = nearMeLocation ?? (await requestBrowserLocation());
      // Ulaanbaatar is only a presentation default. Do not let that implicit
      // city filter hide nearby branches when the user's location is elsewhere;
      // preserve a city the user explicitly chose.
      if (!citySelectedByUser && city === DEFAULT_CITY) {
        setCity("");
        setDistrict("");
      }
      setNearMeLocation(location);
      setNearMeOnly(true);
    } catch (error: unknown) {
      setFilterError(
        error instanceof Error
          ? error.message
          : "Байршил авах боломжгүй байна.",
      );
    } finally {
      setLocationPending(false);
    }
  };

  const mapRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mapInstanceRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const markersRef = useRef<{ marker: any; m: Marker }[]>([]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const userMarkerRef = useRef<any>(null);
  const mapClustererRef = useRef<MarkerClusterer | null>(null);
  // Google Maps listener handles are intentionally opaque to TypeScript.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mapIdleListenerRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mapClickListenerRef = useRef<any>(null);
  const [mapReady, setMapReady] = useState(false);
  // Хамгийн эхний `mapReady`-д fitBounds-г алгасахад ашиглана — доорх
  // fitBounds effect-ийг харах. Компонентын БҮХ насны туршид нэг л удаа
  // true болно (map/list харагдац сэлгэж дахин mount хийгдвэл дахин fit хийж
  // болно — зөвхөн ХАМГИЙН АНХНЫ ачаалалтыг статик Улаанбаатар харагдацтай
  // үлдээхийг л зорьсон).
  const hasCenteredInitiallyRef = useRef(false);

  // Аппын theme-г ажиглаж state-д тусгана — өөрчлөгдөхөд газрын зургийг
  // тохирох colorScheme-тэйгээр дахин үүсгэнэ.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLight(isLightTheme());
    const observer = new MutationObserver(() => setLight(isLightTheme()));
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });
    return () => observer.disconnect();
  }, []);

  // Map lifecycle depends only on stable view/configuration. Marker updates
  // are handled by the following effect so viewport responses never recenter
  // or add another idle listener.
  useEffect(() => {
    if (view !== "map" || !hasMap) return;
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMapError(false);
    loadGoogleMaps(apiKey)
      .then(() => {
        if (cancelled || !mapRef.current) return;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const g = (window as any).google;
        if (!g?.maps) return;
        const userPosition = nearMeLocation
          ? { lat: nearMeLocation.lat, lng: nearMeLocation.lng }
          : null;
        const map = new g.maps.Map(mapRef.current, {
          center: userPosition ?? UB_CENTER,
          zoom: userPosition ? 13 : 12,
          mapId: mapId || DEFAULT_MAP_ID,
          colorScheme: light ? "LIGHT" : "DARK",
          mapTypeControl: false,
          streetViewControl: false,
          zoomControl: false,
          fullscreenControl: true,
          clickableIcons: false,
          gestureHandling: "greedy",
          tilt: 0,
          rotateControl: false,
          tiltInteractionEnabled: false,
          headingInteractionEnabled: false,
        });
        mapInstanceRef.current = map;
        if (userPosition) {
          userMarkerRef.current = new g.maps.Marker({
            map,
            position: userPosition,
            title: "Таны байршил",
            zIndex: 2000,
            icon: {
              path: g.maps.SymbolPath.CIRCLE,
              scale: 9,
              fillColor: "#2563eb",
              fillOpacity: 1,
              strokeColor: "#ffffff",
              strokeWeight: 3,
            },
          });
        }
        mapClickListenerRef.current = map.addListener("click", () =>
          setSelected(null),
        );
        mapIdleListenerRef.current = map.addListener("idle", () => {
          const bounds = map.getBounds();
          if (!bounds) return;
          scheduleMapFetchRef.current(
            padViewport({
              north: bounds.getNorthEast().lat(),
              south: bounds.getSouthWest().lat(),
              east: bounds.getNorthEast().lng(),
              west: bounds.getSouthWest().lng(),
            }),
          );
        });
        setMapReady(true);
      })
      .catch(() => {
        if (!cancelled) setMapError(true);
      });
    return () => {
      cancelled = true;
      mapIdleListenerRef.current?.remove?.();
      mapClickListenerRef.current?.remove?.();
      mapIdleListenerRef.current = null;
      mapClickListenerRef.current = null;
      mapClustererRef.current?.clearMarkers();
      mapClustererRef.current = null;
      for (const entry of markersRef.current) {
        entry.marker.setMap?.(null);
        entry.marker.map = null;
      }
      markersRef.current = [];
      if (userMarkerRef.current?.setMap) userMarkerRef.current.setMap(null);
      userMarkerRef.current = null;
      mapInstanceRef.current = null;
      setMapReady(false);
    };
  }, [view, hasMap, apiKey, mapId, light, nearMeLocation]);

  const selectedBranchId = selected?.branch.id;
  const selectedLatitude = selected?.branch.lat;
  const selectedLongitude = selected?.branch.lng;
  /* eslint-disable react-hooks/exhaustive-deps -- selection styling is updated below. */
  useEffect(() => {
    if (!mapReady || !mapInstanceRef.current) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const g = (window as any).google;
    if (!g?.maps) return;
    mapClustererRef.current?.clearMarkers();
    for (const entry of markersRef.current) {
      entry.marker.setMap?.(null);
      // eslint-disable-next-line react-hooks/immutability
      entry.marker.map = null;
    }
    markersRef.current = [];
    const Advanced = g.maps.marker?.AdvancedMarkerElement;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const createdMarkers: any[] = [];
    for (const m of markersForMap) {
      const position = { lat: m.branch.lat as number, lng: m.branch.lng as number };
      const active = selectedBranchId === m.branch.id;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let marker: any;
      if (Advanced) {
        const content = buildPinElement(m, active);
        marker = new Advanced({
          map: mapInstanceRef.current,
          position,
          content,
          title: `${m.org.name} — ${m.branch.name}`,
          zIndex: active ? 999 : 1,
          gmpClickable: true,
        });
        marker.addListener("gmp-click", () => pickMarker(m));
        marker.addListener("click", () => pickMarker(m));
        content.style.pointerEvents = "auto";
        content.addEventListener("click", () => pickMarker(m));
      } else {
        marker = new g.maps.Marker({
          position,
          map: mapInstanceRef.current,
          title: `${m.org.name} — ${m.branch.name}`,
          icon: {
            path: g.maps.SymbolPath.CIRCLE,
            scale: active ? 12 : 9,
            fillColor: ringColor(m.branch.open, active),
            fillOpacity: 1,
            strokeColor: "#ffffff",
            strokeWeight: 2,
          },
        });
        marker.addListener("click", () => pickMarker(m));
      }
      markersRef.current.push({ marker, m });
      createdMarkers.push(marker);
    }
    mapClustererRef.current = new MarkerClusterer({
      map: mapInstanceRef.current,
      markers: createdMarkers,
    });
  }, [mapReady, markersForMap]);
  /* eslint-enable react-hooks/exhaustive-deps */

  // Шүүлтүүр (хот/дүүрэг/ажлын түрхлэг/хайлт/амралтын өдөр/одоо нээлттэй/
  // "надад ойр") өөрчлөгдөхөд шинэ үр дүн одоогийн харагдац (viewport)-аас
  // гадна байвал хэрэглэгч хоосон газрын зураг л хараад үлдэнэ (харах:
  // өмнөх "map goes blank" алдаатай төөрөгдөж болзошгүй). Тиймээс шинэ
  // ЛОКАЛ (viewport-аас үл хамаарсан) `markers`-т fitBounds хийнэ — гар
  // аргаар pan/zoom хийсэн (idle listener-ийн `mapMarkers` refresh) үед биш,
  // зөвхөн шүүлт өөрчлөгдсөн үед. Ганц цэг бол zoom хэт томроход (fitBounds
  // цэг дээр extreme нарийвчлал руу очдог) panTo+тогтмол zoom ашиглана.
  //
  // ХАМГИЙН ЭХНИЙ `mapReady`-д (шүүлтгүй, шинэ хуудас ачаалагдах мөч) ЗОРИУДЛАН
  // fitBounds хийхгүй — газрын зургийн анхны харагдац `UB_CENTER`-ээр статик
  // Улаанбаатар руу төвлөрсөн хэвээр үлдэнэ (доорх map init effect-ийг
  // харах). Үүний дараа ямар ч шүүлт өөрчлөгдвөл, эсвэл харагдац (map/list)
  // сэлгэж дахин mount хийгдвэл идэвхтэй шүүлтэд тохирсон fitBounds ажиллана.
  useEffect(() => {
    if (!mapReady || !mapInstanceRef.current) return;
    if (!hasCenteredInitiallyRef.current) {
      hasCenteredInitiallyRef.current = true;
      return;
    }
    if (markers.length === 0) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const g = (window as any).google;
    if (!g?.maps) return;
    const map = mapInstanceRef.current;
    if (markers.length === 1) {
      const only = markers[0].branch;
      map.panTo({ lat: only.lat, lng: only.lng });
      map.setZoom(14);
      return;
    }
    const bounds = new g.maps.LatLngBounds();
    for (const m of markers) {
      bounds.extend({ lat: m.branch.lat, lng: m.branch.lng });
    }
    map.fitBounds(bounds, 48);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapReady, city, district, tag, query, weekendOnly, openNowOnly, nearMeOnly]);

  // Сонгосон маркерыг тодруулж (ягаан + том), түүн рүү зөөлөн төвлөрнө.
  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const g = (window as any).google;
    if (!g?.maps || markersRef.current.length === 0) return;
    for (const entry of markersRef.current) {
      const active = selectedBranchId === entry.m.branch.id;
      if ("content" in entry.marker) {
        // AdvancedMarkerElement — контентыг дахин зурна.
        const el = buildPinElement(entry.m, active);
        el.addEventListener("click", () => pickMarker(entry.m));
        // eslint-disable-next-line react-hooks/immutability
        entry.marker.content = el;
        entry.marker.zIndex = active ? 999 : 1;
      } else if (entry.marker.setIcon) {
        entry.marker.setIcon({
          path: g.maps.SymbolPath.CIRCLE,
          scale: active ? 12 : 9,
          fillColor: ringColor(entry.m.branch.open, active),
          fillOpacity: 1,
          strokeColor: "#ffffff",
          strokeWeight: 2,
        });
        entry.marker.setZIndex(active ? 999 : 1);
      }
    }
    if (
      mapInstanceRef.current &&
      selectedLatitude != null &&
      selectedLongitude != null
    ) {
      mapInstanceRef.current.panTo({
        lat: selectedLatitude,
        lng: selectedLongitude,
      });
    }
  }, [selectedBranchId, selectedLatitude, selectedLongitude]);

  return (
    <div className="flex flex-col gap-4">
      {/* Хайлт + шүүлтүүд — нэг самбар */}
      <div className="rounded-2xl border border-[var(--oc-line)] bg-[var(--oc-panel)] p-3 sm:p-4 flex flex-col gap-3 shadow-sm">
        <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
          <div className="relative flex-1 min-w-0">
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--oc-muted3)] pointer-events-none"
            >
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              type="search"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setSelected(null);
              }}
              placeholder="Засвар, үйлчилгээ, газрын нэрээр хайх..."
              className="auth-input !h-11 !py-0 !pl-10 !text-sm !rounded-xl"
            />
          </div>

          <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap lg:flex-nowrap">
            {tags.length > 0 ? (
              <div className="discover-filter-select col-span-2 sm:w-52 shrink-0">
                <Select
                  name="discover-tag"
                  value={tag}
                  placeholder="Салбарын төрөл"
                  onChange={(v) => {
                    setTag(v);
                    setSelected(null);
                  }}
                  options={tags.map((t) => ({ value: t.id, label: t.name }))}
                />
              </div>
            ) : null}

            {cities.length > 0 ? (
              <div className="discover-filter-select sm:w-40 shrink-0">
                <Select
                  name="discover-city"
                  value={city}
                  placeholder="Аймаг/хот"
                  onChange={(v) => {
                    setCitySelectedByUser(true);
                    setCity(v);
                    setDistrict("");
                    setSelected(null);
                  }}
                  options={cities.map((c) => ({ value: c, label: c }))}
                />
              </div>
            ) : null}

            {districts.length > 0 ? (
              <div className="discover-filter-select sm:w-40 shrink-0">
                <Select
                  name="discover-district"
                  value={district}
                  placeholder="Сум/дүүрэг"
                  onChange={(v) => {
                    setDistrict(v);
                    setSelected(null);
                  }}
                  options={districts.map((d) => ({ value: d, label: d }))}
                />
              </div>
            ) : null}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <FilterChip
            active={nearMeOnly}
            busy={locationPending}
            onClick={toggleNearMe}
            icon={
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <polygon points="3 11 22 2 13 21 11 13 3 11" />
              </svg>
            }
          >
            {locationPending ? "Байршил авч байна…" : "Надад ойр"}
          </FilterChip>
          <FilterChip
            active={openNowOnly}
            onClick={() => {
              setOpenNowOnly((value) => !value);
              setSelected(null);
            }}
            icon={<span className="w-2 h-2 rounded-full bg-emerald-500" aria-hidden />}
          >
            Одоо нээлттэй
          </FilterChip>
          <FilterChip
            active={weekendOnly}
            onClick={() => {
              setWeekendOnly((v) => !v);
              setSelected(null);
            }}
            icon={
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <rect x="3" y="4" width="18" height="18" rx="2" />
                <line x1="16" y1="2" x2="16" y2="6" />
                <line x1="8" y1="2" x2="8" y2="6" />
                <line x1="3" y1="10" x2="21" y2="10" />
              </svg>
            }
          >
            Амралтын өдөр
          </FilterChip>

          <div className="ml-auto flex items-center gap-3">
            <span className="hidden sm:inline text-xs text-[var(--oc-muted3)] tabular-nums">
              <b className="font-semibold text-[var(--oc-ink2)]">{visibleOrgs.length}</b> газар ·{" "}
              <b className="font-semibold text-[var(--oc-ink2)]">{markers.length}</b> салбар
            </span>
            <div className="inline-flex items-center rounded-xl border border-[var(--oc-line)] p-0.5 bg-[var(--oc-panel2)] shrink-0">
              {mapConfigured ? (
                <button
                  type="button"
                  onClick={() => setView("map")}
                  aria-pressed={view === "map"}
                  className={`h-8 flex items-center gap-1.5 px-3 rounded-lg text-xs font-semibold transition-colors ${view === "map"
                    ? "bg-[var(--oc-panel)] text-[var(--oc-ink)] shadow-sm"
                    : "text-[var(--oc-muted)] hover:text-[var(--oc-ink)]"
                    }`}
                >
                  <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6" />
                    <line x1="8" y1="2" x2="8" y2="18" />
                    <line x1="16" y1="6" x2="16" y2="22" />
                  </svg>
                  Газрын зураг
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => setView("list")}
                aria-pressed={view === "list" || !mapConfigured}
                className={`h-8 flex items-center gap-1.5 px-3 rounded-lg text-xs font-semibold transition-colors ${view === "list" || !mapConfigured
                  ? "bg-[var(--oc-panel)] text-[var(--oc-ink)] shadow-sm"
                  : "text-[var(--oc-muted)] hover:text-[var(--oc-ink)]"
                  }`}
              >
                <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <line x1="8" y1="6" x2="21" y2="6" />
                  <line x1="8" y1="12" x2="21" y2="12" />
                  <line x1="8" y1="18" x2="21" y2="18" />
                  <line x1="3" y1="6" x2="3.01" y2="6" />
                  <line x1="3" y1="12" x2="3.01" y2="12" />
                  <line x1="3" y1="18" x2="3.01" y2="18" />
                </svg>
                Жагсаалт
              </button>
            </div>
          </div>

          {filterError ? (
            <div className="basis-full text-xs text-[var(--oc-warn)]">
              {filterError}
            </div>
          ) : null}
        </div>
      </div>

      {orgs.length === 0 ? (
        <EmptyState>Одоогоор онлайн цаг захиалга нээсэн газар алга.</EmptyState>
      ) : view === "map" && hasMap ? (
        // Шүүлтийн үр дүн хоосон болсон ч (`visibleOrgs.length === 0`) энэ
        // `<div ref={mapRef}>`-г ЗААВАЛ mount хэвээр үлдээнэ (доор overlay-аар
        // мессеж харуулна, бүтэн салгахгүй) — өмнө нь визгэл шүүлтийг сонгоод
        // буцаж ирэхэд газрын зураг ЯГ ЭНЭ div дээр биш, шинэ (хоосон) div дээр
        // дахин mount хийгддэг байсан бол Google Map instance хуучин, DOM-оос
        // тасарсан node-той холбоотой хэвээр үлдэж, шинэ div дээр юу ч
        // зурагдахгүй ("газрын зураг хоосон харагдах") алдаа гарч байсан —
        // учир нь газрын зураг үүсгэх useEffect-ийн dependency array
        // (`[view, hasMap, apiKey, mapId, light, nearMeLocation]`) энэ
        // unmount/remount мөчид ДАХИН ажиллахгүй.
        <div className="relative">
          <div
            ref={mapRef}
            className="h-[70vh] min-h-[24rem] w-full rounded-2xl overflow-hidden border border-[var(--oc-line)] bg-[var(--oc-panel2)] shadow-sm"
          />
          <div className="absolute top-3 right-3 z-10 flex flex-col items-end gap-2">
            <div className="overflow-hidden rounded-xl border bg-[var(--oc-panel)] text-[var(--oc-ink2)] border-[var(--oc-line)] shadow-lg">
              <button
                type="button"
                onClick={() => {
                  const map = mapInstanceRef.current;
                  if (map) map.setZoom((map.getZoom() ?? 12) + 1);
                }}
                aria-label="Газрын зургийг томруулах"
                title="Томруулах"
                className="flex h-10 w-10 items-center justify-center text-xl font-medium transition-colors hover:bg-[var(--oc-panel2)] hover:text-[var(--oc-ink)]"
              >
                +
              </button>
              <div className="h-px bg-[var(--oc-line)]" />
              <button
                type="button"
                onClick={() => {
                  const map = mapInstanceRef.current;
                  if (map) map.setZoom((map.getZoom() ?? 12) - 1);
                }}
                aria-label="Газрын зургийг жижигрүүлэх"
                title="Жижигрүүлэх"
                className="flex h-10 w-10 items-center justify-center text-xl font-medium transition-colors hover:bg-[var(--oc-panel2)] hover:text-[var(--oc-ink)]"
              >
                −
              </button>
            </div>
            <button
              type="button"
              onClick={() => {
                const map = mapInstanceRef.current;
                if (map && nearMeLocation) {
                  map.panTo({
                    lat: nearMeLocation.lat,
                    lng: nearMeLocation.lng,
                  });
                  map.setZoom(Math.max(map.getZoom() ?? 13, 14));
                } else {
                  void toggleNearMe();
                }
              }}
              aria-label="Миний байршил руу очих"
              title="Миний байршил"
              className={`flex h-10 w-10 items-center justify-center rounded-xl border shadow-lg transition-colors ${
                nearMeLocation
                  ? "border-[var(--oc-accent)] bg-[var(--oc-accent)] text-[var(--oc-on-accent)] hover:bg-[var(--oc-accent-hi)]"
                  : "bg-[var(--oc-panel)] text-[var(--oc-ink2)] border-[var(--oc-line)] hover:bg-[var(--oc-panel2)]"
              }`}
            >
              <span className="text-lg leading-none" aria-hidden>
                ◎
              </span>
            </button>
          </div>
          {mapError ? (
            <div className="absolute inset-0 flex items-center justify-center text-sm text-[var(--oc-muted)] bg-[var(--oc-panel2)] rounded-2xl">
              Газрын зураг ачаалж чадсангүй.
            </div>
          ) : null}
          {mapTruncated ? (
            <div className="absolute bottom-3 left-3 rounded-lg border border-[var(--oc-line)] bg-[var(--oc-panel)] px-3 py-2 text-xs text-[var(--oc-muted)] shadow-lg">
              Зарим цэгийг нуусан. Газрын зургийг томруулж үзнэ үү.
            </div>
          ) : null}

          {visibleOrgs.length === 0 ? (
            <div className="absolute inset-0 flex items-center justify-center rounded-2xl bg-[var(--oc-carbon)]/80 backdrop-blur-sm p-4">
              <EmptyState />
            </div>
          ) : null}

          {filterLoading ? (
            <div
              role="status"
              aria-live="polite"
              aria-label="Шүүлтүүрийн үр дүн шинэчлэгдэж байна"
              className="absolute left-3 top-3 z-20 flex h-10 w-10 items-center justify-center rounded-xl border bg-[var(--oc-panel)] text-[var(--oc-ink2)] border-[var(--oc-line)] shadow-lg"
            >
              <svg
                aria-hidden="true"
                className="h-5 w-5 animate-spin"
                viewBox="0 0 24 24"
                fill="none"
              >
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="9"
                  stroke="currentColor"
                  strokeWidth="3"
                />
                <path
                  className="opacity-90"
                  d="M21 12a9 9 0 0 0-9-9"
                  stroke="currentColor"
                  strokeWidth="3"
                  strokeLinecap="round"
                />
              </svg>
            </div>
          ) : null}

          {/* Сонгосон салбарын мэдээлэл — том, ойлгомжтой карт */}
          {selected ? (
            <div className="absolute left-3 right-3 bottom-3 sm:left-4 sm:right-auto sm:bottom-4 sm:w-[28rem]">
              <div className="bg-[var(--oc-panel)] rounded-2xl border border-[var(--oc-line)] shadow-2xl overflow-hidden">
                {/* Толгой — лого + газрын нэр */}
                <div className="flex items-center gap-3.5 p-5 pb-4">
                  <OrgLogo name={selected.org.name} logoUrl={selected.org.logoUrl} size="lg" />
                  <div className="min-w-0 flex-1">
                    <div className="text-lg font-bold text-[var(--oc-ink)] truncate">
                      {selected.org.name}
                    </div>
                    <div className="text-sm text-[var(--oc-muted)] truncate">
                      {selected.branch.name}
                    </div>
                    <BranchTagLine tags={selected.branch.tags} />
                  </div>
                  <button
                    type="button"
                    onClick={() => setSelected(null)}
                    aria-label="Хаах"
                    className="shrink-0 text-[var(--oc-muted3)] hover:text-[var(--oc-ink)] hover:bg-[var(--oc-panel2)] rounded-full w-8 h-8 flex items-center justify-center transition-colors"
                  >
                    ✕
                  </button>
                </div>

                {/* Төлөв + мэдээлэл */}
                <div className="px-5 pb-5 flex flex-col gap-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <OpenBadge
                      open={selected.branch.open}
                      hours={selected.branch.hours}
                    />
                    <RatingBadge rating={selected.branch.rating} count={selected.branch.ratingCount} />
                  </div>

                  {selected.branch.distanceKm != null ? (
                    <div className="flex items-center gap-2.5 text-sm font-medium text-[var(--oc-accent)]">
                      <span aria-hidden>⌖</span>
                      <span>
                        {distanceLabel(selected.branch.distanceKm)} зайтай
                      </span>
                    </div>
                  ) : null}

                  <div className="flex items-start gap-2.5 text-sm text-[var(--oc-ink2)]">
                    <svg className="w-4 h-4 mt-0.5 text-[var(--oc-muted3)] shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
                      <circle cx="12" cy="10" r="3" />
                    </svg>
                    <span className="min-w-0">{selected.branch.address}</span>
                  </div>

                  {selected.branch.phone ? (
                    <a
                      href={`tel:${selected.branch.phone}`}
                      className="flex items-center gap-2.5 text-sm text-[var(--oc-ink2)] hover:text-[var(--oc-accent)] transition-colors"
                    >
                      <svg className="w-4 h-4 text-[var(--oc-muted3)] shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z" />
                      </svg>
                      <span className="tabular-nums">{selected.branch.phone}</span>
                    </a>
                  ) : null}

                  <ServiceTags services={selected.branch.services} />

                  <button
                    type="button"
                    onClick={() => openReview(selected, null)}
                    className="mt-1 inline-flex w-full items-center justify-center gap-2 rounded-xl border border-amber-400/50 bg-amber-400/10 px-4 py-2.5 text-sm font-semibold text-amber-500 light:text-amber-700 transition-colors hover:bg-amber-400/20"
                  >
                    ★{" "}
                    {mine[selected.branch.id] && !pending[selected.branch.id]?.length
                      ? `Таны үнэлгээ${mine[selected.branch.id].rating ? ` ${mine[selected.branch.id].rating}` : ""} — засах`
                      : "Үнэлгээ өгөх"}
                  </button>
                  <Link
                    href={branchDetailHref(selected.org.slug, selected.branch.id)}
                    className="inline-flex w-full items-center justify-center gap-2 bg-[var(--oc-accent)] text-[var(--oc-on-accent)] hover:bg-[var(--oc-accent-hi)] transition-colors px-4 py-3 rounded-xl text-sm font-semibold"
                  >
                    Дэлгэрэнгүй
                    <span aria-hidden>→</span>
                  </Link>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      ) : visibleOrgs.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3 items-start">
          {visibleOrgs.map((org) => (
            <div
              key={org.slug}
              className="group/card rounded-2xl border border-[var(--oc-line)] bg-[var(--oc-panel)] overflow-hidden shadow-sm transition-all hover:shadow-lg hover:border-[var(--oc-muted4)]"
            >
              <Link
                href={bookingHref(org.slug, org.branches[0].id)}
                className="flex items-center gap-3 px-4 pt-4 pb-3"
              >
                <OrgLogo name={org.name} logoUrl={org.logoUrl} size="md" />
                <div className="min-w-0 flex-1">
                  <div className="font-semibold text-[var(--oc-ink)] truncate group-hover/card:text-[var(--oc-accent)] transition-colors">
                    {org.name}
                  </div>
                  <div className="mt-0.5 flex items-center gap-1.5 text-xs text-[var(--oc-muted3)]">
                    <span>{org.branches.length} салбар</span>
                    {org.branches[0].distanceKm != null ? (
                      <>
                        <span aria-hidden>·</span>
                        <span className="font-medium text-[var(--oc-accent)]">
                          {distanceLabel(org.branches[0].distanceKm)}
                        </span>
                      </>
                    ) : null}
                  </div>
                </div>
                <span
                  aria-hidden
                  className="shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-[var(--oc-muted3)] transition-colors group-hover/card:bg-[var(--oc-accent)] group-hover/card:text-[var(--oc-on-accent)]"
                >
                  →
                </span>
              </Link>

              <ul className="flex flex-col gap-2 px-3 pb-3">
                {org.branches.map((b) => (
                  <li key={b.id}>
                    <Link
                      href={branchDetailHref(org.slug, b.id)}
                      className="group/branch block rounded-xl border border-[var(--oc-line2)] bg-[var(--oc-panel2)] px-3.5 py-3 transition-colors hover:border-[var(--oc-accent)]/50"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="text-sm font-medium text-[var(--oc-ink)] truncate">{b.name}</div>
                          <BranchTagLine tags={b.tags} />
                        </div>
                        <OpenBadge open={b.open} hours={b.hours} />
                      </div>
                      <div className="mt-1.5 flex items-start gap-1.5 text-xs text-[var(--oc-muted)]">
                        <svg className="w-3.5 h-3.5 mt-px shrink-0 text-[var(--oc-muted3)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                          <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
                          <circle cx="12" cy="10" r="3" />
                        </svg>
                        <span className="min-w-0 truncate">{b.address}</span>
                      </div>
                      {b.services.length > 0 ? (
                        <div className="mt-2">
                          <ServiceTags services={b.services} />
                        </div>
                      ) : null}
                      <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1.5">
                        <RatingBadge rating={b.rating} count={b.ratingCount} />
                        <span
                          role="button"
                          tabIndex={0}
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            openReview({ org, branch: b }, null);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              e.stopPropagation();
                              openReview({ org, branch: b }, null);
                            }
                          }}
                          className={`inline-flex cursor-pointer items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold transition-colors ${
                            pending[b.id]?.length
                              ? "border-amber-400/50 bg-amber-400/10 text-amber-500 light:text-amber-700 hover:bg-amber-400/20"
                              : mine[b.id]
                                ? "border-[var(--oc-line)] text-[var(--oc-muted)] hover:border-amber-400/50"
                                : "border-[var(--oc-line)] text-[var(--oc-muted)] hover:border-amber-400/50 hover:text-amber-500"
                          }`}
                        >
                          {mine[b.id] && !pending[b.id]?.length ? (
                            <>
                              <span className="text-amber-400">★</span> Таны үнэлгээ{mine[b.id].rating ? ` ${mine[b.id].rating}` : ""}
                            </>
                          ) : (
                            "★ Үнэлгээ өгөх"
                          )}
                        </span>
                        {b.distanceKm != null ? (
                          <span className="text-xs font-medium text-[var(--oc-accent)]">
                            {distanceLabel(b.distanceKm)} зайтай
                          </span>
                        ) : null}
                        <span className="ml-auto inline-flex items-center gap-1 rounded-lg border border-[var(--oc-accent)]/40 px-3 py-1.5 text-xs font-semibold text-[var(--oc-accent)] transition-colors group-hover/branch:border-[var(--oc-accent)] group-hover/branch:bg-[var(--oc-accent)] group-hover/branch:text-[var(--oc-on-accent)]">
                          Цаг авах <span aria-hidden>→</span>
                        </span>
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}

      <DiscoverReviewModal
        target={reviewTarget}
        loggedIn={loggedIn}
        orders={reviewTarget ? (pending[reviewTarget.branchId] ?? []) : []}
        mine={reviewTarget ? (mine[reviewTarget.branchId] ?? null) : null}
        onClose={() => {
          setReviewTarget(null);
        }}
        onRated={(orderId) => {
          if (!reviewTarget) return;
          const bid = reviewTarget.branchId;
          if (orderId) {
            setPending((p) => ({ ...p, [bid]: (p[bid] ?? []).filter((o) => o.orderId !== orderId) }));
          }
          // «Үнэлсэн» гэж тэмдэглэнэ — дараагийн дарахад дахин асуухгүй; нарийвчилсан утгыг refresh авчирна.
          setJustRated((m) => ({ ...m, [bid]: { rating: 0, comment: null, reply: null, editable: orderId == null } }));
          router.refresh();
        }}
      />
    </div>
  );
}

function FilterChip({
  active,
  busy = false,
  onClick,
  icon,
  children,
}: {
  active: boolean;
  busy?: boolean;
  onClick: () => void;
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      aria-pressed={active}
      aria-busy={busy}
      className={`shrink-0 inline-flex items-center gap-1.5 h-8 px-3 rounded-full border text-xs font-medium transition-colors disabled:opacity-60 disabled:cursor-wait ${
        active
          ? "border-[var(--oc-accent)] bg-[var(--oc-accent)]/10 text-[var(--oc-accent)]"
          : "border-[var(--oc-line)] bg-[var(--oc-panel)] text-[var(--oc-ink2)] hover:border-[var(--oc-muted4)] hover:bg-[var(--oc-panel2)]"
      }`}
    >
      {icon}
      {children}
      {active ? <span aria-hidden className="ml-0.5">✓</span> : null}
    </button>
  );
}

function OrgLogo({ name, logoUrl, size }: { name: string; logoUrl: string | null; size: "md" | "lg" }) {
  const box = size === "lg" ? "w-14 h-14 rounded-2xl text-xl" : "w-12 h-12 rounded-xl text-lg";
  if (logoUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={logoUrl}
        alt=""
        className={`${box} object-contain bg-[#fff] border border-[var(--oc-line)] shrink-0`}
      />
    );
  }
  return (
    <div
      className={`${box} shrink-0 flex items-center justify-center font-bold bg-[var(--oc-accent)]/10 text-[var(--oc-accent)] border border-[var(--oc-accent)]/20`}
    >
      {name.slice(0, 1).toUpperCase()}
    </div>
  );
}

function EmptyState({ children = "Энэ хайлтаар газар олдсонгүй." }: { children?: ReactNode }) {
  return (
    <div className="rounded-2xl border border-dashed border-[var(--oc-line)] bg-[var(--oc-panel)] px-6 py-12 text-center">
      <div className="mx-auto mb-3 w-12 h-12 rounded-full bg-[var(--oc-panel2)] flex items-center justify-center text-[var(--oc-muted3)]">
        <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <circle cx="11" cy="11" r="8" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
      </div>
      <div className="text-sm font-medium text-[var(--oc-ink2)]">{children}</div>
      <div className="mt-1 text-xs text-[var(--oc-muted3)]">Шүүлтүүрээ өөрчилж эсвэл өөр үгээр хайж үзнэ үү.</div>
    </div>
  );
}

/** Салбарын үйлчлүүлэгчийн үнэлгээ (★ дундаж + тоо); үнэлгээгүй бол юу ч харуулахгүй. */
function RatingBadge({ rating, count }: { rating: number | null; count: number }) {
  if (rating == null || count === 0) return null;
  return (
    <span className="inline-flex items-center gap-1 text-xs text-[var(--oc-muted2)]" aria-label={`${rating.toFixed(1)} од, ${count} үнэлгээ`}>
      <span className="text-amber-400">★</span>
      <span className="font-plex-mono text-[var(--oc-ink2)]">{rating.toFixed(1)}</span>
      <span className="text-[var(--oc-muted3)]">({count})</span>
    </span>
  );
}
