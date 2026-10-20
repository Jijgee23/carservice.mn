// /system/subscriptions — бүх тенантын эрх (Subscription) болон багцын төлбөр
// (SubscriptionPayment)-ийн түүх. Шүүлтүүрийг хуудас болон Excel export
// хуваалцана (нэг л газар тодорхойлогдоно).

import type { Prisma } from "@/app/generated/prisma/client";

export type SubscriptionHistoryTab = "subscriptions" | "payments";

export type SubscriptionHistoryFilters = {
  tab: SubscriptionHistoryTab;
  q: string;
  plan: "" | "FREE" | "BUSINESS" | "ENTERPRISE";
  status: string;
  from: string; // YYYY-MM-DD (Улаанбаатар)
  to: string;
};

const PLANS = ["FREE", "BUSINESS", "ENTERPRISE"] as const;
export const SUBSCRIPTION_STATUSES = ["TRIAL", "ACTIVE", "EXPIRED", "CANCELLED"] as const;
export const PAYMENT_STATUSES = ["PENDING", "PAID", "CANCELLED", "FAILED"] as const;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function parseSubscriptionHistoryFilters(
  sp: Record<string, string | string[] | undefined>,
): SubscriptionHistoryFilters {
  const one = (k: string) => {
    const v = sp[k];
    return (Array.isArray(v) ? v[0] : v)?.trim() ?? "";
  };
  const tab: SubscriptionHistoryTab = one("tab") === "payments" ? "payments" : "subscriptions";
  const planRaw = one("plan");
  const plan = (PLANS as readonly string[]).includes(planRaw) ? (planRaw as SubscriptionHistoryFilters["plan"]) : "";
  const allowed: readonly string[] = tab === "payments" ? PAYMENT_STATUSES : SUBSCRIPTION_STATUSES;
  const statusRaw = one("status");
  return {
    tab,
    q: one("q").slice(0, 100),
    plan,
    status: allowed.includes(statusRaw) ? statusRaw : "",
    from: DATE_RE.test(one("from")) ? one("from") : "",
    to: DATE_RE.test(one("to")) ? one("to") : "",
  };
}

/** Огнооны шүүлтүүр — Улаанбаатарын өдрийн хил (+08:00), `to` өдрийг оролцуулна. */
export function dateRange(f: Pick<SubscriptionHistoryFilters, "from" | "to">): { gte?: Date; lt?: Date } | undefined {
  if (!f.from && !f.to) return undefined;
  const range: { gte?: Date; lt?: Date } = {};
  if (f.from) range.gte = new Date(`${f.from}T00:00:00+08:00`);
  if (f.to) range.lt = new Date(new Date(`${f.to}T00:00:00+08:00`).getTime() + 86_400_000);
  return range;
}

function tenantSearch(q: string): Prisma.TenantWhereInput | undefined {
  if (!q) return undefined;
  return {
    OR: [
      { name: { contains: q, mode: "insensitive" } },
      { registerNumber: { contains: q } },
      { email: { contains: q, mode: "insensitive" } },
    ],
  };
}

export function subscriptionWhere(f: SubscriptionHistoryFilters): Prisma.SubscriptionWhereInput {
  const created = dateRange(f);
  const tenant = tenantSearch(f.q);
  return {
    ...(f.plan ? { plan: f.plan } : {}),
    ...(f.status ? { status: f.status as (typeof SUBSCRIPTION_STATUSES)[number] } : {}),
    ...(created ? { createdAt: created } : {}),
    ...(tenant ? { tenant } : {}),
  };
}

export function paymentWhere(f: SubscriptionHistoryFilters): Prisma.SubscriptionPaymentWhereInput {
  const created = dateRange(f);
  const tenant = tenantSearch(f.q);
  return {
    ...(f.plan ? { plan: f.plan } : {}),
    ...(f.status ? { status: f.status as (typeof PAYMENT_STATUSES)[number] } : {}),
    ...(created ? { createdAt: created } : {}),
    ...(tenant ? { tenant } : {}),
  };
}

/** URL query (хуудаслалт/export холбоосонд) — хоосон утгыг орхино. */
export function filtersToParams(f: SubscriptionHistoryFilters): Record<string, string> {
  return Object.fromEntries(
    Object.entries({ tab: f.tab, q: f.q, plan: f.plan, status: f.status, from: f.from, to: f.to }).filter(([, v]) => v),
  );
}
