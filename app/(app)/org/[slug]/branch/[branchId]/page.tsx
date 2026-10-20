import Link from "next/link";
import { notFound } from "next/navigation";
import { distanceKm } from "@/lib/branch-filters";
import {
  businessDateKey,
  resolveEffectiveSchedule,
  scheduleDisplayLabel,
} from "@/lib/branch-effective-schedule";
import { branchScheduleDisplaySelect } from "@/lib/branch-effective-schedule-server";
import {
  branchStatusNow,
  formatAddress,
  weekdayOfDateStr,
  WEEK_DAYS,
} from "@/lib/branches";
import { prisma } from "@/lib/prisma";
import { setBypassContext } from "@/lib/tenant-context";
import { absoluteUrl, branchDescription, branchJsonLd, branchUrl } from "@/lib/seo";
import { JsonLd } from "@/app/_components/json-ld";
import { HoursDisclosure } from "./hours-disclosure";

export const dynamic = "force-dynamic";

async function loadOrg(slug: string) {
  return await prisma.tenant.findFirst({
    where: { slug, acceptsOnlineBooking: true, suspended: false, isTest: false },
    select: { id: true, slug: true, name: true, logoUrl: true, phone1: true },
  });
}

async function loadBranch(tenantId: string, branchId: string) {
  return await prisma.branch.findFirst({
    where: { id: branchId, tenantId, isActive: true },
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
  });
}

function numberOrNull(raw: string | undefined): number | null {
  if (!raw) return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

function formatDate(d: Date): string {
  return d.toLocaleDateString("mn-MN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string; branchId: string }>;
}) {
  setBypassContext();
  const { slug, branchId } = await params;
  const org = await loadOrg(slug);
  const branch = org ? await loadBranch(org.id, branchId) : null;
  if (!org || !branch) return { title: "Олдсонгүй", robots: { index: false } };
  const title = `${branch.name} — ${org.name}${branch.district ? `, ${branch.district}` : ""}`;
  const description = branchDescription(org, branch);
  return {
    title,
    description,
    alternates: { canonical: branchUrl(org, branch) },
    openGraph: {
      title,
      description,
      url: branchUrl(org, branch),
      type: "website",
      ...(org.logoUrl ? { images: [{ url: absoluteUrl(org.logoUrl), alt: org.name }] } : {}),
    },
  };
}

/**
 * Mobile-ийн `OrganizationDetailScreen`-тэй адил зорилготой "салбарын
 * дэлгэрэнгүй" алхам: discover-ээс салбар дээр дарахад шууд захиалгын
 * маягт руу орохгүй, эхлээд хаяг/цаг/үйлчилгээний мэдээллийг үзээд,
 * дараа нь "Цаг захиалах" товчоор үргэлжлүүлнэ.
 */
export default async function BranchDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string; branchId: string }>;
  searchParams: Promise<{ keys?: string; lat?: string; lng?: string }>;
}) {
  const { slug, branchId } = await params;
  const { keys: keysParam, lat: latParam, lng: lngParam } = await searchParams;
  setBypassContext();
  const org = await loadOrg(slug);
  if (!org) notFound();
  const branch = await loadBranch(org.id, branchId);
  if (!branch) notFound();

  const categoryRows = await prisma.category.findMany({
    where: { tenantId: org.id, isActive: true },
    orderBy: { name: "asc" },
    select: { name: true, branches: { select: { id: true } } },
  });
  const services = categoryRows
    .filter((c) => c.branches.length === 0 || c.branches.some((b) => b.id === branch.id))
    .map((c) => c.name);

  const now = new Date();
  const todayStr = businessDateKey(now);
  const status = branchStatusNow(branch, now);
  const todayEffective = resolveEffectiveSchedule({ dateStr: todayStr, branch });
  const todayLabel = scheduleDisplayLabel(todayEffective);

  const weeklyRows = WEEK_DAYS.map((day) => {
    const rule = branch.schedules.find((s) => s.weekday === day.value);
    const isOpen = rule ? rule.isOpen : Boolean(branch.openTime && branch.closeTime);
    const openTime = rule?.openTime ?? branch.openTime;
    const closeTime = rule?.closeTime ?? branch.closeTime;
    return {
      day,
      isOpen,
      hours: isOpen && openTime && closeTime ? `${openTime}–${closeTime}` : null,
      isToday: day.value === weekdayOfDateStr(todayStr),
    };
  });

  const upcomingExceptions = branch.scheduleExceptions
    .filter((e) => e.date.toISOString().slice(0, 10) >= todayStr)
    .slice(0, 6);
  const upcomingSeasons = branch.scheduleSeasons.filter(
    (s) => s.endsOn.toISOString().slice(0, 10) > todayStr,
  );
  const notices = [
    ...upcomingSeasons.map((s, i) => ({
      key: `season-${i}`,
      text: `${s.name ?? "Улирлын хуваарь"}: ${formatDate(s.startsOn)}–${formatDate(s.endsOn)}`,
    })),
    ...upcomingExceptions.map((e, i) => ({
      key: `exc-${i}`,
      text: `${formatDate(e.date)} — ${
        e.isOpen ? `Нээлттэй ${e.openTime ?? ""}–${e.closeTime ?? ""}` : "Хаалттай"
      }${e.label ? ` (${e.label})` : ""}`,
    })),
  ];

  const lat = numberOrNull(latParam);
  const lng = numberOrNull(lngParam);
  const distance =
    lat != null && lng != null && branch.latitude != null && branch.longitude != null
      ? distanceKm(lat, lng, branch.latitude, branch.longitude)
      : null;

  const directionsHref =
    branch.latitude != null && branch.longitude != null
      ? `https://www.google.com/maps/search/?api=1&query=${branch.latitude},${branch.longitude}`
      : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(formatAddress(branch))}`;

  const bookingHref = keysParam
    ? `/book/branch/${encodeURIComponent(branch.id)}?keys=${encodeURIComponent(keysParam)}`
    : `/org/${org.slug}?branch=${encodeURIComponent(branch.id)}`;

  return (
    <div className="flex flex-col gap-6">
      <JsonLd data={branchJsonLd(org, branch)} />
      <Link
        href="/discover"
        className="text-sm text-white/40 hover:text-white/70 transition-colors"
      >
        ← Бүх газар
      </Link>

      <div className="flex items-center gap-4">
        {org.logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={org.logoUrl}
            alt=""
            className="w-16 h-16 rounded-2xl object-contain bg-white/[0.04] border border-white/[0.06] shrink-0"
          />
        ) : (
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-violet-500/30 to-blue-500/30 border border-white/[0.06] shrink-0 flex items-center justify-center text-xl font-bold text-white/70">
            {org.name.slice(0, 1)}
          </div>
        )}
        <div>
          <h1 className="text-2xl font-bold">{branch.name}</h1>
          <p className="text-white/40 text-sm mt-0.5">
            {org.name} · {org.phone1}
          </p>
        </div>
      </div>

      <div className="glass rounded-2xl p-5 border border-white/[0.08] flex flex-col gap-4">
        <div className="flex items-center justify-between gap-3">
          <span
            className={`inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full border ${status.open
              ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/30"
              : "bg-zinc-500/15 text-zinc-300 border-zinc-500/30"
              }`}
          >
            <span className={`w-1.5 h-1.5 rounded-full ${status.open ? "bg-emerald-400" : "bg-zinc-400"}`} />
            {status.open ? "Нээлттэй" : "Хаалттай"}
            {status.hours ? <span className="opacity-70 tabular-nums">· {status.hours}</span> : null}
            {todayLabel ? <span className="opacity-70">· {todayLabel}</span> : null}
          </span>
          {branch.tags.length > 0 ? (
            <span className="text-xs font-semibold text-violet-300 truncate">
              {branch.tags.map((t) => t.name).join(" · ")}
            </span>
          ) : null}
        </div>

        <div className="flex items-start gap-2.5 text-sm text-white/70">
          <svg className="w-4 h-4 mt-0.5 text-white/35 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
            <circle cx="12" cy="10" r="3" />
          </svg>
          <div className="min-w-0 flex flex-col gap-1">
            <span>{formatAddress(branch)}</span>
            {distance != null ? (
              <span className="text-violet-300">{distance < 1 ? `${Math.max(1, Math.round(distance * 1000))} м` : `${distance.toFixed(1)} км`} зайтай</span>
            ) : null}
            <a
              href={directionsHref}
              target="_blank"
              rel="noopener noreferrer"
              className="text-violet-300 hover:text-violet-200 transition-colors self-start"
            >
              Чиглэл харах →
            </a>
          </div>
        </div>

        {branch.phone ? (
          <a
            href={`tel:${branch.phone}`}
            className="flex items-center gap-2.5 text-sm text-white/70 hover:text-violet-300 transition-colors"
          >
            <svg className="w-4 h-4 text-white/35 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z" />
            </svg>
            <span className="tabular-nums">{branch.phone}</span>
          </a>
        ) : null}

        {services.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {services.map((s) => (
              <span
                key={s}
                className="text-[11px] px-2 py-0.5 rounded-full bg-white/[0.05] text-white/60 border border-white/[0.08]"
              >
                {s}
              </span>
            ))}
          </div>
        ) : null}

        <HoursDisclosure
          weeklyRows={weeklyRows.map(({ day, isOpen, hours, isToday }) => ({
            weekday: day.value,
            label: day.long,
            isOpen,
            hours,
            isToday,
          }))}
          notices={notices}
        />
      </div>

      <Link
        href={bookingHref}
        className="inline-flex items-center justify-center gap-2 bg-violet-600 hover:bg-violet-500 transition-colors px-5 py-3 rounded-2xl text-sm font-semibold"
      >
        Цаг захиалах
        <span aria-hidden>→</span>
      </Link>
    </div>
  );
}
