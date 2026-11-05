import { NextResponse } from "next/server";
import { verifyCronSecret } from "@/lib/cron-auth";
import { createNotification } from "@/lib/notifications";
import { prisma } from "@/lib/prisma";
import { SUBSCRIPTION_WARN_DAYS, formatDaysLeft } from "@/lib/subscription";
import { setBypassContext } from "@/lib/tenant-context";

/**
 * Удахгүй (SUBSCRIPTION_WARN_DAYS хоногийн дотор) дуусах TRIAL/ACTIVE багцуудад
 * сунгалтын сануулга илгээнэ — тенант бүрийн OWNER-уудад (тэд л төлбөр төлж
 * сунгана). Давхар илгээхгүйн тулд Subscription.reminderSentAt-аар тэмдэглэнэ.
 *
 * Cron гадуурх (crontab, cron-job.org) дуудна — `CRON_SECRET`-ээр хамгаална
 * (Bearer header эсвэл `?secret=`). Өдөрт нэг удаа ажиллуулахад тохиромжтой.
 */
export async function POST(req: Request) {
  return run(req);
}

export async function GET(req: Request) {
  return run(req);
}

const MAX_BATCH = 200;
const DAY_MS = 24 * 60 * 60 * 1000;

function formatDate(d: Date): string {
  return d.toLocaleDateString("mn-MN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}

async function run(req: Request) {
  const denied = verifyCronSecret(req);
  if (denied) return denied;
  // Бүх tenant дундуур scan хийдэг cron тул RLS-г тойрч гарна.
  setBypassContext();

  const now = new Date();
  const until = new Date(now.getTime() + SUBSCRIPTION_WARN_DAYS * DAY_MS);

  // Идэвхтэй/туршилтын, дуусах хугацаатай (endsAt != null), удахгүй дуусах гэж буй,
  // сануулга хараахан илгээгээгүй ТӨЛБӨРТЭЙ багцууд (FREE үргэлж үнэгүй —
  // хуучин FREE туршилтын мөрүүдэд сануулга явуулахгүй).
  const due = await prisma.subscription.findMany({
    where: {
      plan: { not: "FREE" },
      status: { in: ["TRIAL", "ACTIVE"] },
      reminderSentAt: null,
      endsAt: { gte: now, lte: until },
    },
    orderBy: { endsAt: "asc" },
    take: MAX_BATCH,
    select: {
      id: true,
      tenantId: true,
      endsAt: true,
      tenant: { select: { name: true } },
    },
  });

  let remindedSubs = 0;
  let notified = 0;
  for (const sub of due) {
    if (!sub.endsAt) continue;

    // Илгээхээс ӨМНӨ атомаар "claim" хийнэ — давхцсан/дахин ажилласан cron
    // хоёулаа ижил мөрийг уншсан ч зөвхөн нэг нь илгээнэ (бусад reminder
    // cron-той ижил загвар).
    let claimed: { count: number };
    try {
      claimed = await prisma.subscription.updateMany({
        where: { id: sub.id, reminderSentAt: null },
        data: { reminderSentAt: now },
      });
    } catch (e) {
      console.warn("[cron] subscription-reminders claim failed:", sub.id, e);
      continue;
    }
    if (claimed.count !== 1) continue;

    // Тухайн тенантын төлбөр төлж чадах эзэд (идэвхтэй).
    const owners = await prisma.user.findMany({
      where: { tenantId: sub.tenantId, isOwner: true, isActive: true },
      select: { id: true },
    });

    const daysLeft = Math.max(
      0,
      Math.ceil((sub.endsAt.getTime() - now.getTime()) / DAY_MS),
    );
    const body = `${sub.tenant.name}: багцын хугацаа ${formatDaysLeft(daysLeft)} (${formatDate(sub.endsAt)}). Сунгаагүй бол үнэгүй FREE багц руу шилжиж, лимит нь багасна.`;

    for (const owner of owners) {
      try {
        await createNotification({
          type: "subscription_expiring",
          recipient: { userId: owner.id },
          tenantId: sub.tenantId,
          input: { subscriptionId: sub.id, body },
        });
        notified++;
      } catch (e) {
        console.warn("[notify] subscription_expiring:", e);
      }
    }

    remindedSubs++;
  }

  return NextResponse.json({
    ok: true,
    candidates: due.length,
    remindedSubscriptions: remindedSubs,
    ownersNotified: notified,
    ranAt: now.toISOString(),
  });
}
