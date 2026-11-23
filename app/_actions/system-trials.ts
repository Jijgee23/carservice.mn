"use server";

import { revalidatePath } from "next/cache";
import type { Plan } from "@/app/generated/prisma/client";
import { requireSuperAdmin } from "@/lib/auth/system";
import { grantTrial, isValidTrialDays, MAX_TRIAL_DAYS, MIN_TRIAL_DAYS } from "@/lib/plan-trials";
import { prisma } from "@/lib/prisma";
import { TRIALABLE_PLANS } from "@/lib/subscription";
import { logSystemAudit } from "@/lib/system/audit";

export type TrialSettingsState = {
  ok: boolean;
  message?: string;
  fieldErrors?: Record<string, string>;
} | null;

function s(fd: FormData, key: string): string {
  const v = fd.get(key);
  return typeof v === "string" ? v.trim() : "";
}

/** Багц бүрийн үнэгүй туршилтын тохиргоо + бүртгэлийн автомат туршилт. */
export async function saveTrialSettingsAction(
  _prev: TrialSettingsState,
  formData: FormData,
): Promise<TrialSettingsState> {
  const admin = await requireSuperAdmin();

  const fieldErrors: Record<string, string> = {};
  const rows: { plan: Plan; enabled: boolean; days: number }[] = [];
  for (const plan of TRIALABLE_PLANS) {
    const days = Number.parseInt(s(formData, `days_${plan}`), 10);
    if (!isValidTrialDays(days)) {
      fieldErrors[`days_${plan}`] = `${MIN_TRIAL_DAYS}–${MAX_TRIAL_DAYS} хоног оруулна уу.`;
    }
    rows.push({ plan, enabled: formData.get(`enabled_${plan}`) === "on", days });
  }

  const signupTrialEnabled = formData.get("signupTrialEnabled") === "on";
  const signupTrialPlan = s(formData, "signupTrialPlan") as Plan;
  if (!TRIALABLE_PLANS.includes(signupTrialPlan)) fieldErrors.signupTrialPlan = "Багц буруу.";
  if (Object.keys(fieldErrors).length > 0) return { ok: false, fieldErrors };

  const before = await prisma.planTrialSetting.findMany();
  await prisma.$transaction(async (tx) => {
    for (const r of rows) {
      await tx.planTrialSetting.upsert({
        where: { plan: r.plan },
        create: r,
        update: { enabled: r.enabled, days: r.days },
      });
    }
    await tx.platformSetting.upsert({
      where: { id: "default" },
      create: { id: "default", signupTrialEnabled, signupTrialPlan },
      update: { signupTrialEnabled, signupTrialPlan },
    });
  });

  await logSystemAudit({
    adminId: admin.id,
    entity: "PlanTrialSetting",
    entityId: "default",
    action: "UPDATE",
    summary: "Үнэгүй туршилтын тохиргоо өөрчлөв",
    before: before.map((b) => ({ plan: b.plan, enabled: b.enabled, days: b.days })),
    after: { rows, signupTrialEnabled, signupTrialPlan },
  });

  revalidatePath("/system/settings");
  revalidatePath("/dashboard/settings/subscription");
  return { ok: true, message: "Хадгалагдлаа." };
}

/** `plan`-ыг өмнө туршаагүй, идэвхтэй төлбөртэй багцгүй (түдгэлзүүлээгүй) байгууллагуудын id. */
async function eligibleTenantIds(plan: Plan, now: Date): Promise<string[]> {
  const tenants = await prisma.tenant.findMany({
    where: {
      suspended: false,
      subscriptions: { none: { plan, isTrial: true } },
      NOT: {
        subscriptions: {
          some: {
            isTrial: false,
            status: "ACTIVE",
            plan: { not: "FREE" },
            OR: [{ endsAt: null }, { endsAt: { gt: now } }],
          },
        },
      },
    },
    select: { id: true },
  });
  return tenants.map((t) => t.id);
}

export type BulkTrialResult = { ok: boolean; message: string; count?: number };

/** Урьдчилан харах: хэдэн байгууллагад олгогдохыг тоолно (өөрчлөлтгүй). */
export async function previewBulkTrialAction(plan: Plan): Promise<BulkTrialResult> {
  await requireSuperAdmin();
  if (!TRIALABLE_PLANS.includes(plan)) return { ok: false, message: "Багц буруу." };
  const ids = await eligibleTenantIds(plan, new Date());
  return { ok: true, count: ids.length, message: `${ids.length} байгууллагад олгогдоно.` };
}

/** Одоогийн бүх хамааралтай байгууллагад `plan`-ы туршилтыг олгоно (байгууллага бүр тусдаа transaction). */
export async function grantBulkTrialAction(plan: Plan): Promise<BulkTrialResult> {
  const admin = await requireSuperAdmin();
  if (!TRIALABLE_PLANS.includes(plan)) return { ok: false, message: "Багц буруу." };

  const now = new Date();
  const ids = await eligibleTenantIds(plan, now);
  let granted = 0;
  let skipped = 0;
  for (const id of ids) {
    try {
      const r = await prisma.$transaction((tx) =>
        grantTrial(tx, id, plan, { source: "bulk", createdById: admin.id, now }),
      );
      if (r.ok) granted += 1;
      else skipped += 1;
    } catch (err) {
      skipped += 1;
      console.warn("[bulk-trial] failed:", id, err instanceof Error ? err.name : err);
    }
  }

  await logSystemAudit({
    adminId: admin.id,
    entity: "Subscription",
    entityId: `bulk-trial-${plan}`,
    action: "CREATE",
    summary: `${plan} туршилтыг бөөнөөр олгов: ${granted} олгосон, ${skipped} алгассан`,
    after: { plan, granted, skipped },
  });

  revalidatePath("/system/settings");
  revalidatePath("/system/subscriptions");
  return {
    ok: true,
    count: granted,
    message: `${granted} байгууллагад олголоо${skipped ? `, ${skipped} алгасав` : ""}.`,
  };
}
