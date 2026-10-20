// SEO туслах: үндсэн домэйн, бүрэн URL, байгууллага/салбарын schema.org
// (JSON-LD `AutoRepair`) бүтэц. Google-ийн байршлын хайлт (local SEO) энэ
// өгөгдлөөр хаяг, байршил, ажлын цаг, утсыг шууд уншина.

import { formatAddress } from "@/lib/branches";

export const SITE_URL = "https://carservice.mn";
export const SITE_NAME = "carservice.mn";

export function absoluteUrl(pathOrUrl: string): string {
  if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl;
  return `${SITE_URL}${pathOrUrl.startsWith("/") ? "" : "/"}${pathOrUrl}`;
}

const SCHEMA_DAY: Record<string, string> = {
  MON: "Monday",
  TUE: "Tuesday",
  WED: "Wednesday",
  THU: "Thursday",
  FRI: "Friday",
  SAT: "Saturday",
  SUN: "Sunday",
};

const HHMM = /^\d{2}:\d{2}$/;

type ScheduleRow = { weekday: string; isOpen: boolean; openTime: string | null; closeTime: string | null };

/** Долоо хоногийн үндсэн хувиар → schema.org OpeningHoursSpecification (улирлын/онцгой өдөр орохгүй). */
export function openingHoursSpecification(branch: {
  openTime?: string | null;
  closeTime?: string | null;
  schedules?: readonly ScheduleRow[];
}) {
  const out: Array<{ "@type": "OpeningHoursSpecification"; dayOfWeek: string; opens: string; closes: string }> = [];
  for (const row of branch.schedules ?? []) {
    if (!row.isOpen) continue;
    const opens = row.openTime ?? branch.openTime ?? null;
    const closes = row.closeTime ?? branch.closeTime ?? null;
    const day = SCHEMA_DAY[row.weekday];
    if (!day || !opens || !closes || !HHMM.test(opens) || !HHMM.test(closes)) continue;
    out.push({ "@type": "OpeningHoursSpecification", dayOfWeek: day, opens, closes });
  }
  return out;
}

export type SeoBranch = {
  id: string;
  name: string;
  phone?: string | null;
  city?: string | null;
  district?: string | null;
  khoroo?: string | null;
  address?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  openTime?: string | null;
  closeTime?: string | null;
  schedules?: readonly ScheduleRow[];
};

export type SeoOrg = { slug: string; name: string; logoUrl?: string | null; phone1?: string | null };

export function orgUrl(org: { slug: string }): string {
  return absoluteUrl(`/org/${encodeURIComponent(org.slug)}`);
}

export function branchUrl(org: { slug: string }, branch: { id: string }): string {
  return absoluteUrl(`/org/${encodeURIComponent(org.slug)}/branch/${encodeURIComponent(branch.id)}`);
}

function compact<T extends Record<string, unknown>>(obj: T): T {
  return Object.fromEntries(
    Object.entries(obj).filter(([, v]) => v !== null && v !== undefined && !(Array.isArray(v) && v.length === 0) && v !== ""),
  ) as T;
}

/** Нэг салбарын `AutoRepair` (LocalBusiness) JSON-LD. */
export function branchJsonLd(org: SeoOrg, branch: SeoBranch) {
  const street = [branch.khoroo, branch.address].map((s) => s?.trim()).filter(Boolean).join(", ");
  return compact({
    "@context": "https://schema.org",
    "@type": "AutoRepair",
    "@id": `${branchUrl(org, branch)}#business`,
    name: branch.name && branch.name !== org.name ? `${org.name} — ${branch.name}` : org.name,
    url: branchUrl(org, branch),
    image: org.logoUrl ? absoluteUrl(org.logoUrl) : undefined,
    logo: org.logoUrl ? absoluteUrl(org.logoUrl) : undefined,
    telephone: branch.phone || org.phone1 || undefined,
    address: compact({
      "@type": "PostalAddress",
      streetAddress: street || undefined,
      addressLocality: branch.district?.trim() || undefined,
      addressRegion: branch.city?.trim() || undefined,
      addressCountry: "MN",
    }),
    geo:
      branch.latitude != null && branch.longitude != null
        ? { "@type": "GeoCoordinates", latitude: branch.latitude, longitude: branch.longitude }
        : undefined,
    openingHoursSpecification: openingHoursSpecification(branch),
    parentOrganization: { "@type": "Organization", name: org.name, url: orgUrl(org) },
  });
}

/** Байгууллагын хуудасны JSON-LD — салбар бүр `department`. */
export function orgJsonLd(org: SeoOrg, branches: readonly SeoBranch[]) {
  return compact({
    "@context": "https://schema.org",
    "@type": "AutoRepair",
    "@id": `${orgUrl(org)}#business`,
    name: org.name,
    url: orgUrl(org),
    image: org.logoUrl ? absoluteUrl(org.logoUrl) : undefined,
    logo: org.logoUrl ? absoluteUrl(org.logoUrl) : undefined,
    telephone: org.phone1 || undefined,
    department: branches.map((b) => {
      const { ["@context"]: _ctx, ...rest } = branchJsonLd(org, b);
      void _ctx;
      return rest;
    }),
  });
}

/** Хайлтын үр дүнгийн тайлбар: «{Нэр} — Баянзүрх, Сүхбаатар. Авто засвар… Онлайнаар цаг захиалаарай.» */
export function orgDescription(org: { name: string }, branches: readonly SeoBranch[]): string {
  const places = [...new Set(branches.map((b) => b.district?.trim() || b.city?.trim()).filter(Boolean))].slice(0, 4);
  const where = places.length ? ` — ${places.join(", ")}` : "";
  return `${org.name}${where}. Автозасвар, автосервис, оношилгоо, засвар үйлчилгээ. carservice.mn-ээр онлайнаар цаг захиалаарай.`;
}

export function branchDescription(org: { name: string }, branch: SeoBranch): string {
  const addr = formatAddress(branch);
  return `${org.name}${branch.name && branch.name !== org.name ? ` (${branch.name})` : ""} — автозасвар, автосервис${addr ? `, ${addr}` : ""}. Ажлын цаг, байршил, онлайн цаг захиалга.`;
}

/** `<script type="application/ld+json">`-д аюулгүй JSON (`</script>` тасалдахгүй). */
export function jsonLdString(data: unknown): string {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}
