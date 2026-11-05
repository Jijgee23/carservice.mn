import { PublicReviews } from "@/app/_components/public-reviews";
import { loadPublicReviews } from "@/lib/reviews-public";
import { BOOKABLE_CATEGORY_WHERE } from "@/lib/categories";
import Link from "next/link";
import type { ReactNode } from "react";
import {
  BackLink,
  OpenStatusBadge,
  Panel,
  PlaceHeader,
  RatingPill,
  ServiceChips,
} from "@/app/(app)/_components/consumer-ui";
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
    where: { slug, acceptsOnlineBooking: true, suspended: false, isTest: false, creditHidden: false },
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
      ratingAvg: true,
      ratingCount: true,
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
    where: { tenantId: org.id, isActive: true, ...BOOKABLE_CATEGORY_WHERE },
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

  const reviews = branch.ratingCount > 0 ? await loadPublicReviews(branch.id, 10) : [];

  const distanceText =
    distance == null
      ? null
      : distance < 1
        ? `${Math.max(1, Math.round(distance * 1000))} м`
        : `${distance.toFixed(1)} км`;
  const rating = branch.ratingAvg == null ? null : Number(branch.ratingAvg.toString());

  return (
    <div className="flex flex-col gap-5">
      <JsonLd data={branchJsonLd(org, branch)} />
      <BackLink href="/discover">Бүх газар</BackLink>

      <PlaceHeader
        name={org.name}
        logoUrl={org.logoUrl}
        eyebrow={branch.tags.length > 0 ? branch.tags.map((t) => t.name).join(" · ") : null}
        title={branch.name}
        subtitle={org.name}
        badges={
          <>
            <OpenStatusBadge open={status.open} hours={status.hours} note={todayLabel} />
            <RatingPill rating={rating} count={branch.ratingCount} />
            {distanceText ? (
              <span className="text-xs font-medium text-[var(--oc-accent)]">{distanceText} зайтай</span>
            ) : null}
          </>
        }
        aside={
          <Link
            href={bookingHref}
            className="hidden sm:inline-flex items-center gap-2 rounded-xl bg-[var(--oc-accent)] px-5 py-3 text-sm font-semibold text-[var(--oc-on-accent)] shadow-sm hover:bg-[var(--oc-accent-hi)] transition-colors"
          >
            Цаг захиалах <span aria-hidden>→</span>
          </Link>
        }
      />

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_20rem] items-start">
        <div className="flex flex-col gap-5 min-w-0">
          <Panel title="Мэдээлэл">
            <dl className="flex flex-col divide-y divide-[var(--oc-line2)]">
              <InfoRow
                icon={
                  <>
                    <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
                    <circle cx="12" cy="10" r="3" />
                  </>
                }
                label="Хаяг"
              >
                <span>{formatAddress(branch)}</span>
                <a
                  href={directionsHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-1 inline-flex items-center gap-1 text-xs font-semibold text-[var(--oc-accent)] hover:text-[var(--oc-accent-hi)] transition-colors"
                >
                  Чиглэл харах <span aria-hidden>↗</span>
                </a>
              </InfoRow>
              {branch.phone ? (
                <InfoRow
                  icon={
                    <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z" />
                  }
                  label="Утас"
                >
                  <a href={`tel:${branch.phone}`} className="tabular-nums hover:text-[var(--oc-accent)] transition-colors">
                    {branch.phone}
                  </a>
                </InfoRow>
              ) : null}
              {services.length > 0 ? (
                <InfoRow
                  icon={
                    <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
                  }
                  label="Үйлчилгээ"
                >
                  <div className="mt-1">
                    <ServiceChips services={services} />
                  </div>
                </InfoRow>
              ) : null}
            </dl>
          </Panel>

          <PublicReviews rating={rating} count={branch.ratingCount} reviews={reviews} />
        </div>

        <aside className="flex flex-col gap-5 lg:sticky lg:top-6">
          <Panel title="Цагийн хуваарь">
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
          </Panel>
          <Link
            href={bookingHref}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-[var(--oc-accent)] px-5 py-3.5 text-sm font-semibold text-[var(--oc-on-accent)] shadow-sm hover:bg-[var(--oc-accent-hi)] transition-colors"
          >
            Цаг захиалах <span aria-hidden>→</span>
          </Link>
        </aside>
      </div>
    </div>
  );
}

function InfoRow({ icon, label, children }: { icon: ReactNode; label: string; children: ReactNode }) {
  return (
    <div className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
      <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--oc-panel2)] text-[var(--oc-muted)]">
        <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          {icon}
        </svg>
      </div>
      <div className="min-w-0 flex-1">
        <dt className="text-[11px] font-medium uppercase tracking-wide text-[var(--oc-muted3)]">{label}</dt>
        <dd className="mt-0.5 flex flex-col text-sm text-[var(--oc-ink2)]">{children}</dd>
      </div>
    </div>
  );
}
