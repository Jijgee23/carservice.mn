"use server";

import { revalidatePath } from "next/cache";
import type { Plan } from "@/app/generated/prisma/client";
import { requireUser } from "@/lib/auth";
import { TRIAL_DENY_MESSAGE } from "@/lib/plan-trials";
import { startTenantTrial } from "@/lib/plan-trials-server";

export type StartTrialState = { ok: boolean; message?: string } | null;

/** Байгууллагын эзэн багцын үнэгүй туршилтыг өөрөө эхлүүлнэ. Form: plan. */
export async function startPlanTrialAction(
  _prev: StartTrialState,
  formData: FormData,
): Promise<StartTrialState> {
  const user = await requireUser();
  if (!user.isOwner) return { ok: false, message: "Зөвхөн админ туршилт эхлүүлнэ." };

  const plan = String(formData.get("plan") ?? "") as Plan;
  const result = await startTenantTrial(user.tenantId, plan);
  if (!result.ok) return { ok: false, message: TRIAL_DENY_MESSAGE[result.reason] };

  revalidatePath("/dashboard", "layout");
  return { ok: true, message: `${plan} багцын ${result.days} хоногийн үнэгүй туршилт эхэллээ.` };
}
