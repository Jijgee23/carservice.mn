// P3-B7 — Customer broadcast. One canon "enforce daily limit → send →
// audit" sequence shared by the dashboard action
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
import { PLAN_LIMIT_CODES } from "@/lib/plan-limits";
import { enforceCountLimit } from "@/lib/plan-limits-server";
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
 * КНОН "daily limit → broadcastTenantPromo → audit" дараалал.
 *
 * ЗОРИУДЫН ГАЖИГ (design wart) — өөрчлөхгүйгээр өвлүүлж байна: доорх ганц
 * `logAudit` мөр нэгэн зэрэг (a) audit trail-ийн бичлэг ба (b) өдрийн
 * илгээлтийн хязгаарлагчийн тоолуур хоёрын үүрэг гүйцэтгэнэ, `entityId`
 * нь бодит мэдэгдлийн id биш `actor.tenantId` байна. Иймд `enforceCountLimit`
 * "тухайн өдөр ХЭДЭН УДАА илгээх товч дарсан" тоог хязгаарлаж байгаа болохоос
 * "хэдэн хүлээн авагчид хүрсэн" тоог хязгаарлахгүй, тул 0 хүлээн авагчтай
 * илгээлт ч энэ өдрийн нэг "илгээлт"-ийг зарцуулна.
 *
 * Энэ зан төлөвийг ЭНЭ slice дотор ӨӨРЧЛӨХГҮЙ (D-151/D-152-ийн зарчмын дагуу
 * — mobile slice дотор бүтээгдэхүүний шийдвэр гаргахгүй, зөвхөн тэмдэглэнэ).
 * Санал болгож буй засвар: `AuditLog`-аас тусдаа, зөвхөн энэ зорилгод
 * зориулсан тоолуур мөр/хүснэгт (жишээ нь `entity: "NotificationSendCounter"`
 * эсвэл огноогоор түлхүүрлэсэн counter row) нэвтрүүлж, audit trail-ийг
 * бодит илгээлт бүрийн үр дүнгээс (жишээ нь хүлээн авагчийн тоо) тусад нь
 * бичих. Энэ бол бүтээгдэхүүний шийдвэр тул хэрэглэгчид зориулж энд
 * тэмдэглэж байгаа болохоос энд шийдэхгүй.
 */
export async function sendCustomerBroadcast(input: {
  actor: CustomerBroadcastActor;
  data: CustomerBroadcastInput;
}): Promise<CustomerBroadcastResult> {
  const { actor, data } = input;

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const dailyLimit = await enforceCountLimit(
    actor.tenantId,
    PLAN_LIMIT_CODES.DAILY_CUSTOMER_NOTIFICATIONS,
    () =>
      prisma.auditLog.count({
        where: { tenantId: actor.tenantId, entity: "Notification", createdAt: { gte: todayStart } },
      }),
  );
  if (!dailyLimit.allowed) {
    throw new CustomerBroadcastError(
      dailyLimit.message ?? "Өдрийн зар илгээх хязгаарт хүрсэн байна.",
      422,
      "DAILY_LIMIT_REACHED",
    );
  }

  const notified = await broadcastTenantPromo({
    tenantId: actor.tenantId,
    title: data.title,
    body: data.body,
  });

  // See the wart comment above: this row is simultaneously the audit entry
  // and tomorrow's (today's) rate-limit counter. A zero-recipient send still
  // writes it, so it still consumes one of the day's sends — preserved
  // exactly as the pre-extraction inline logic behaved.
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
