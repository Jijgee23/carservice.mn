import type { Plan, Prisma } from "@/app/generated/prisma/client";
import { TRIALABLE_PLANS, TRIAL_DAYS, trialEndDate } from "@/lib/subscription";

/**
 * Багц бүрийн үнэгүй туршилт.
 *  - Байгууллага багц тус бүрийг НЭГ удаа туршина (BUSINESS-ээ туршсан ч ENTERPRISE-ийг дахин туршина).
 *  - Нэг дор нэг л идэвхтэй багц: шинэ туршилт эхлэхэд өмнөх TRIAL EXPIRED болно.
 *  - Идэвхтэй ТӨЛБӨРТЭЙ (ACTIVE) багцтай байгууллагад туршилт өгөхгүй (хөнгөлөлт болохгүй).
 */

export type TrialSetting = { enabled: boolean; days: number };

export type TrialDenyReason =
  | "not_trialable"
  | "disabled"
  | "already_used"
  | "has_paid_plan";

export const TRIAL_DENY_MESSAGE: Record<TrialDenyReason, string> = {
  not_trialable: "Энэ багцыг туршиж болохгүй.",
  disabled: "Энэ багцын үнэгүй туршилт одоогоор идэвхгүй байна.",
  already_used: "Та энэ багцын үнэгүй туршилтыг аль хэдийн ашигласан байна.",
  has_paid_plan: "Идэвхтэй төлбөртэй багцтай байгууллагад туршилт олгохгүй.",
};

export const MIN_TRIAL_DAYS = 1;
export const MAX_TRIAL_DAYS = 365;

export function isValidTrialDays(days: number): boolean {
  return Number.isInteger(days) && days >= MIN_TRIAL_DAYS && days <= MAX_TRIAL_DAYS;
}

/** Туршилт олгож болох эсэх — pure (тест хийхэд хялбар). */
export function evaluateTrialEligibility(input: {
  plan: Plan;
  setting: TrialSetting | null;
  /** Энэ байгууллага өмнө туршсан багцууд (Subscription.isTrial мөрүүд). */
  usedTrialPlans: readonly Plan[];
  /** Одоо хүчинтэй ТӨЛБӨРТЭЙ (isTrial=false, ACTIVE) subscription байгаа эсэх. */
  hasActivePaid: boolean;
  /** Super admin гараар олгохдоо "аль хэдийн туршсан" ба "унтраасан"-ыг давж болно (төлбөртэй багцыг биш). */
  force?: boolean;
}): { ok: true } | { ok: false; reason: TrialDenyReason } {
  if (!TRIALABLE_PLANS.includes(input.plan)) return { ok: false, reason: "not_trialable" };
  // Төлбөртэй идэвхтэй багцыг туршилтаар хэзээ ч дарахгүй (force ч гэсэн).
  if (input.hasActivePaid) return { ok: false, reason: "has_paid_plan" };
  if (input.force) return { ok: true };
  if (!input.setting?.enabled) return { ok: false, reason: "disabled" };
  if (input.usedTrialPlans.includes(input.plan)) return { ok: false, reason: "already_used" };
  return { ok: true };
}

// Бүтцийн (structural) хамгийн бага интерфэйс — өргөтгөсөн `prisma` client-ийн tx болон
// withBookingTransaction-ий raw tx хоёуланд таардаг (generic Prisma төрлүүд зөрдөг тул).
type TrialSettingDb = {
  planTrialSetting: {
    findMany(): Promise<{ plan: Plan; enabled: boolean; days: number }[]>;
  };
};
type SubRow = { plan: Plan; status: string; isTrial: boolean; endsAt: Date | null };
type Db = TrialSettingDb & {
  subscription: {
    findMany(args: {
      where: { tenantId: string; plan: { not: Plan } };
      select: { plan: true; status: true; isTrial: true; endsAt: true };
    }): Promise<SubRow[]>;
    updateMany(args: {
      where: { tenantId: string; status: { in: ("TRIAL" | "ACTIVE")[] } };
      data: { status: "EXPIRED" };
    }): Promise<unknown>;
    create(args: {
      data: Prisma.SubscriptionUncheckedCreateInput;
      select: { id: true };
    }): Promise<{ id: string }>;
  };
  tenant: {
    update(args: { where: { id: string }; data: { plan: Plan } }): Promise<unknown>;
  };
};

export async function loadTrialSettings(
  db: TrialSettingDb,
): Promise<Record<"BUSINESS" | "ENTERPRISE", TrialSetting>> {
  const rows = await db.planTrialSetting.findMany();
  const byPlan = new Map(rows.map((r) => [r.plan, r]));
  const get = (plan: "BUSINESS" | "ENTERPRISE"): TrialSetting => {
    const r = byPlan.get(plan);
    return r ? { enabled: r.enabled, days: r.days } : { enabled: true, days: TRIAL_DAYS };
  };
  return { BUSINESS: get("BUSINESS"), ENTERPRISE: get("ENTERPRISE") };
}

export type GrantTrialResult =
  | { ok: true; subscriptionId: string; endsAt: Date; days: number }
  | { ok: false; reason: TrialDenyReason };

/**
 * Тенантад `plan`-ы үнэгүй туршилт олгоно: өмнөх идэвхтэй TRIAL-уудыг EXPIRED болгож,
 * isTrial=true Subscription үүсгэн, `tenant.plan`-ыг синк хийнэ (модулийн gating үүнийг уншдаг).
 * Дуудагч transaction (tx) дотор ажиллуулна.
 */
export async function grantTrial(
  tx: Db,
  tenantId: string,
  plan: Plan,
  opts: {
    source: "signup" | "self" | "admin" | "bulk";
    createdById?: string | null;
    /** Тохиргооны хугацааг дарж өөр хоног өгөх (admin). */
    days?: number;
    /** "Аль хэдийн туршсан / унтраасан"-ыг давах (admin). */
    force?: boolean;
    now?: Date;
  },
): Promise<GrantTrialResult> {
  const now = opts.now ?? new Date();
  const setting =
    plan === "BUSINESS" || plan === "ENTERPRISE"
      ? (await loadTrialSettings(tx))[plan]
      : null;

  const subs = await tx.subscription.findMany({
    where: { tenantId, plan: { not: "FREE" } },
    select: { plan: true, status: true, isTrial: true, endsAt: true },
  });
  const usedTrialPlans = subs.filter((s) => s.isTrial).map((s) => s.plan);
  const hasActivePaid = subs.some(
    (s) => !s.isTrial && s.status === "ACTIVE" && (!s.endsAt || s.endsAt.getTime() > now.getTime()),
  );

  const verdict = evaluateTrialEligibility({
    plan,
    setting,
    usedTrialPlans,
    hasActivePaid,
    force: opts.force,
  });
  if (!verdict.ok) return verdict;

  const days = opts.days ?? setting?.days ?? TRIAL_DAYS;
  const endsAt = trialEndDate(now, days);

  await tx.subscription.updateMany({
    where: { tenantId, status: { in: ["TRIAL", "ACTIVE"] } },
    data: { status: "EXPIRED" },
  });
  const sub = await tx.subscription.create({
    data: {
      tenantId,
      plan,
      status: "TRIAL",
      isTrial: true,
      startsAt: now,
      endsAt,
      notes: `Үнэгүй туршилт (${days} хоног, ${opts.source}).`,
      createdById: opts.createdById ?? null,
    },
    select: { id: true },
  });
  await tx.tenant.update({ where: { id: tenantId }, data: { plan } });

  return { ok: true, subscriptionId: sub.id, endsAt, days };
}
