// P3-B7 — Customer broadcast. One canon "module gate → send → audit"
// sequence shared by the dashboard action
// (`app/_actions/customers.ts`, broadcast action only) and the staff API
// route (`app/api/v1/customers/notify/route.ts`). Mirrors
// `lib/customers/customer-commands.ts`: typed input/output, a
// `CustomerBroadcastError`-style typed error, no `FormData`, `NextResponse`
// or `revalidatePath`. Permission and subscription gates stay with the
// caller — this module assumes the actor has already been authorized, same
// as the customer commands.
//
// The send itself is already extracted and stays untouched:
// `broadcastTenantPromo` in `lib/notifications.ts`.

import { logAudit } from "@/lib/audit";
import { broadcastTenantPromo } from "@/lib/notifications";
import { MODULE_DISABLED_CODE, moduleDisabledMessage } from "@/lib/plan-modules";
import { isModuleEnabled } from "@/lib/plan-modules-server";
import { prisma } from "@/lib/prisma";

export type CustomerBroadcastActor = {
  id: string;
  tenantId: string;
};

export class CustomerBroadcastError extends Error {
  constructor(
    message: string,
    public readonly status = 422,
    public readonly code = "BROADCAST_REJECTED",
  ) {
    super(message);
    this.name = "CustomerBroadcastError";
  }
}

export type CustomerBroadcastInput = {
  title: string;
  body: string;
};

export type CustomerBroadcastResult = {
  notified: number;
};

/**
 * Recipient count for the actor's tenant — account-linked customers only.
 * `accountId: null` rows are walk-ins without an online account and are
 * never recipients, so they must never be counted as such (spec + Security
 * and correctness invariants, TENANT_MOBILE_SLICES.md).
 */
export async function countBroadcastRecipients(
  actor: CustomerBroadcastActor,
): Promise<number> {
  return await prisma.customer.count({
    where: { tenantId: actor.tenantId, accountId: { not: null } },
  });
}

/**
 * КНОН "модулийн хаалт → broadcastTenantPromo → audit" дараалал. Өдрийн
 * илгээлтийн тоон хязгаар устсан (багц модулиар ялгардаг) — audit мөр нь
 * зөвхөн audit trail. 0 хүлээн авагчтай илгээлт ч audit бичнэ.
 */
export async function sendCustomerBroadcast(input: {
  actor: CustomerBroadcastActor;
  data: CustomerBroadcastInput;
}): Promise<CustomerBroadcastResult> {
  const { actor, data } = input;

  // Багцын модуль — API (/api/v1/customers/notify) ба action хоёуланд хамаарна.
  if (!(await isModuleEnabled(actor.tenantId, "enable_customer_broadcast"))) {
    throw new CustomerBroadcastError(
      moduleDisabledMessage("enable_customer_broadcast"),
      403,
      MODULE_DISABLED_CODE,
    );
  }

  const notified = await broadcastTenantPromo({
    tenantId: actor.tenantId,
    title: data.title,
    body: data.body,
  });

  // Audit trail only (no longer a rate-limit counter). A zero-recipient send
  // still writes it.
  await logAudit({
    tenantId: actor.tenantId,
    userId: actor.id,
    entity: "Notification",
    entityId: actor.tenantId,
    action: "OTHER",
    summary: `Үйлчлүүлэгчид зар илгээв: "${data.title}" · ${notified.toLocaleString("mn-MN")} хүлээн авагч`,
  });

  return { notified };
}
