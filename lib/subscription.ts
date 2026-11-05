import type {
  BillingPeriod,
  Plan,
  Subscription,
  SubscriptionPaymentMethod,
  SubscriptionPaymentStatus,
  SubscriptionStatus,
} from "@/app/generated/prisma/client";

export const BILLING_PERIODS: BillingPeriod[] = ["MONTH", "QUARTER", "YEAR"];

export const BILLING_PERIOD_LABEL: Record<BillingPeriod, string> = {
  MONTH: "Сар",
  QUARTER: "Улирал",
  YEAR: "Жил",
};

export const BILLING_PERIOD_MONTHS: Record<BillingPeriod, number> = {
  MONTH: 1,
  QUARTER: 3,
  YEAR: 12,
};

const UB_OFFSET_MS = 8 * 60 * 60 * 1000;

export function periodEndDate(
  start: Date,
  period: BillingPeriod,
): Date {
  const months = BILLING_PERIOD_MONTHS[period];
  // Улаанбаатарын цагаар (UTC+8, DST-гүй) сар нэмнэ. Зорилтот сард тухайн өдөр
  // байхгүй бол (1/31 + 1 сар) сарын сүүлийн өдрөөр хязгаарлана — `setMonth`
  // шиг дараа сар руу (3/3) халихгүй, серверийн цагийн бүсээс ч хамаарахгүй.
  const ub = new Date(start.getTime() + UB_OFFSET_MS);
  const targetMonth = ub.getUTCMonth() + months;
  const lastDay = new Date(Date.UTC(ub.getUTCFullYear(), targetMonth + 1, 0)).getUTCDate();
  const endUb = Date.UTC(
    ub.getUTCFullYear(),
    targetMonth,
    Math.min(ub.getUTCDate(), lastDay),
    ub.getUTCHours(),
    ub.getUTCMinutes(),
    ub.getUTCSeconds(),
    ub.getUTCMilliseconds(),
  );
  return new Date(endUb - UB_OFFSET_MS);
}

// Багцын загвар:
//  - FREE (Энгийн): үргэлж үнэгүй, хугацаагүй. Шинэ бүртгэл шууд FREE-тэй эхэлнэ;
//    төлбөртэй багц дуусахад FREE рүү буцна (түгжигдэхгүй, лимит нь FREE-ийнх).
//  - BUSINESS: тогтсон үнэтэй (PlanPrice), тенант өөрөө QPay-ээр авна.
//  - ENTERPRISE: тогтсон үнэгүй — тохиролцож үнээ гаргаад super admin гараар
//    subscription үүсгэнэ (app/_actions/system-subscriptions.ts).
export const SELF_SERVE_PLANS: readonly Plan[] = ["BUSINESS"];

export function isSelfServePlan(plan: Plan): boolean {
  return SELF_SERVE_PLANS.includes(plan);
}

// Super admin-ий гараар олгох туршилтын (TRIAL) default хугацаа.
export const TRIAL_DAYS = 14;

// Идэвхтэй subscription дуусахад ийм өдрөөс цөөн үлдвэл "удахгүй дуусна"
// сэрэмжлүүлэг харуулна.
export const SUBSCRIPTION_WARN_DAYS = 7;

// Багц дууссан үед mutation (үүсгэх/засах/устгах) хийх гэж оролдвол буцаах мессеж.
export const SUBSCRIPTION_LOCKED_MESSAGE =
  "Таны багцын хугацаа дууссан байна. Үргэлжлүүлэхийн тулд багцаа сунгаж төлбөрөө төлнө үү.";

export const SUBSCRIPTION_STATUS_LABEL: Record<SubscriptionStatus, string> = {
  TRIAL: "Туршилт",
  ACTIVE: "Идэвхтэй",
  EXPIRED: "Дууссан",
  CANCELLED: "Цуцлагдсан",
};

export const SUBSCRIPTION_STATUS_BADGE: Record<SubscriptionStatus, string> = {
  TRIAL:
    "bg-[var(--oc-warn)]/15 text-[var(--oc-warn)] border border-[var(--oc-warn)]/30",
  ACTIVE:
    "bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 light:bg-emerald-100 light:border-emerald-300 light:text-emerald-700",
  EXPIRED:
    "bg-red-500/15 text-red-300 border border-red-500/30 light:bg-red-100 light:border-red-300 light:text-red-700",
  CANCELLED: "bg-white/10 text-white/50 border border-white/15 light:bg-slate-100 light:border-slate-300 light:text-slate-600",
};

export const PLAN_LABEL: Record<Plan, string> = {
  FREE: "FREE",
  BUSINESS: "BUSINESS",
  ENTERPRISE: "ENTERPRISE",
};

export const SUBSCRIPTION_PAYMENT_STATUS_LABEL: Record<
  SubscriptionPaymentStatus,
  string
> = {
  PENDING: "Хүлээгдэж буй",
  PAID: "Төлөгдсөн",
  CANCELLED: "Төлөгдөөгүй",
  FAILED: "Амжилтгүй",
};

export const SUBSCRIPTION_PAYMENT_STATUS_BADGE: Record<
  SubscriptionPaymentStatus,
  string
> = {
  PENDING: "bg-[var(--oc-warn)]/15 text-[var(--oc-warn)] border border-[var(--oc-warn)]/30",
  PAID: "bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 light:bg-emerald-100 light:border-emerald-300 light:text-emerald-700",
  CANCELLED:
    "bg-white/10 text-white/50 border border-white/15 light:bg-slate-100 light:border-slate-300 light:text-slate-600",
  FAILED:
    "bg-red-500/15 text-red-300 border border-red-500/30 light:bg-red-100 light:border-red-300 light:text-red-700",
};

export const SUBSCRIPTION_PAYMENT_METHOD_LABEL: Record<
  SubscriptionPaymentMethod,
  string
> = {
  QPAY: "QPay",
  BANK_TRANSFER: "Банкны шилжүүлэг",
  CASH: "Бэлнээр",
  OTHER: "Бусад",
};

export type ActiveSubscriptionInfo = {
  subscription: Pick<
    Subscription,
    "id" | "plan" | "status" | "startsAt" | "endsAt"
  >;
  isTrial: boolean;
  daysLeft: number; // 0 эсвэл сөрөг — дууссан
  expiresAt: Date | null;
};

export function trialEndDate(startsAt: Date = new Date()): Date {
  const end = new Date(startsAt);
  end.setDate(end.getDate() + TRIAL_DAYS);
  return end;
}

/**
 * Тенант идэвхтэй ТӨЛБӨРТЭЙ (FREE-ээс бусад) subscription байгаа эсэхийг
 * тогтооно. Trial хугацаа дууссан subscription-ийг "expired" гэж үзнэ. FREE
 * багц хугацаагүй тул subscription-оор илэрхийлэгдэхгүй — хуучин 14 хоногийн
 * FREE туршилтын мөрүүдийг алгасна (null = тенант FREE дээр байна).
 */
export function resolveActiveSubscription(
  subs: Pick<Subscription, "id" | "plan" | "status" | "startsAt" | "endsAt">[],
  now: Date = new Date(),
): ActiveSubscriptionInfo | null {
  // Хамгийн сүүлд эхэлсэн идэвхтэй (TRIAL/ACTIVE) subscription-г сонгоно
  const candidate = [...subs]
    .filter(
      (s) =>
        s.plan !== "FREE" &&
        (s.status === "TRIAL" || s.status === "ACTIVE") &&
        s.startsAt.getTime() <= now.getTime(),
    )
    .sort((a, b) => b.startsAt.getTime() - a.startsAt.getTime())[0];
  if (!candidate) return null;

  const expiresAt = candidate.endsAt ?? null;
  const daysLeft = expiresAt
    ? Math.ceil((expiresAt.getTime() - now.getTime()) / (24 * 60 * 60 * 1000))
    : Number.POSITIVE_INFINITY;

  return {
    subscription: candidate,
    isTrial: candidate.status === "TRIAL",
    daysLeft: Number.isFinite(daysLeft) ? daysLeft : Number.POSITIVE_INFINITY,
    expiresAt,
  };
}

export function formatDaysLeft(daysLeft: number): string {
  if (daysLeft <= 0) return "өнөөдөр дуусна";
  if (daysLeft === 1) return "маргааш дуусна";
  return `${daysLeft} хоног үлдсэн`;
}
