import type { Plan } from "@/app/generated/prisma/client";
import {
  type GrantTrialResult,
  evaluateTrialEligibility,
  grantTrial,
  loadTrialSettings,
} from "@/lib/plan-trials";
import { prisma, withBookingTransaction } from "@/lib/prisma";
import { setBypassContext } from "@/lib/tenant-context";
import { TRIALABLE_PLANS } from "@/lib/subscription";

/** Тенантын одоо эхлүүлж болох үнэгүй туршилтууд (багц бүр нэг удаа). */
export async function getAvailableTrials(tenantId: string): Promise<{ plan: Plan; days: number }[]> {
  const now = new Date();
  const [settings, subs] = await Promise.all([
    loadTrialSettings(prisma),
    prisma.subscription.findMany({
      where: { tenantId, plan: { not: "FREE" } },
      select: { plan: true, status: true, isTrial: true, endsAt: true },
    }),
  ]);
  const usedTrialPlans = subs.filter((s) => s.isTrial).map((s) => s.plan);
  const hasActivePaid = subs.some(
    (s) => !s.isTrial && s.status === "ACTIVE" && (!s.endsAt || s.endsAt.getTime() > now.getTime()),
  );
  return TRIALABLE_PLANS.filter(
    (plan) =>
      evaluateTrialEligibility({
        plan,
        setting: settings[plan as "BUSINESS" | "ENTERPRISE"],
        usedTrialPlans,
        hasActivePaid,
      }).ok,
  ).map((plan) => ({ plan, days: settings[plan as "BUSINESS" | "ENTERPRISE"].days }));
}

/** Байгууллага өөрөө `plan`-ы үнэгүй туршилтыг эхлүүлнэ (бодит transaction). */
export async function startTenantTrial(tenantId: string, plan: Plan): Promise<GrantTrialResult> {
  return withBookingTransaction(tenantId, (tx) => grantTrial(tx, tenantId, plan, { source: "self" }));
}

/** Super admin-ий тохиргооны хуудсанд (PlanTrialSetting/PlatformSetting глобал мөр). */
export async function getTrialSettingsForAdmin(): Promise<{
  plans: Record<"BUSINESS" | "ENTERPRISE", { enabled: boolean; days: number }>;
  signupEnabled: boolean;
  signupPlan: "BUSINESS" | "ENTERPRISE";
}> {
  setBypassContext();
  const [plans, platform] = await Promise.all([
    loadTrialSettings(prisma),
    prisma.platformSetting.findUnique({
      where: { id: "default" },
      select: { signupTrialEnabled: true, signupTrialPlan: true },
    }),
  ]);
  const signupPlan: Plan = platform?.signupTrialPlan ?? "BUSINESS";
  return {
    plans,
    signupEnabled: platform?.signupTrialEnabled ?? true,
    signupPlan: signupPlan === "ENTERPRISE" ? "ENTERPRISE" : "BUSINESS",
  };
}
