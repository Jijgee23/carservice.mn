import "server-only";

import { cache } from "react";
import type { NextResponse } from "next/server";
import type { ApiUser } from "@/lib/auth/api-token";
import { jsonError } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import {
  type ActiveSubscriptionInfo,
  SUBSCRIPTION_LOCKED_MESSAGE,
  SUBSCRIPTION_WARN_DAYS,
  resolveActiveSubscription,
} from "@/lib/subscription";

export type SubscriptionState = {
  // Идэвхтэй төлбөртэй (BUSINESS/ENTERPRISE; TRIAL/ACTIVE, эхэлсэн, endsAt
  // хараахан өнгөрөөгүй) subscription. null = тенант үнэгүй FREE багц дээр.
  active: ActiveSubscriptionInfo | null;
  // Read-only (mutation хориглох) горим. FREE багц үргэлж үнэгүй тул төлбөртэй
  // багц дуусахад FREE рүү буцна — одоогоор хэзээ ч true болохгүй. Талбар,
  // guard-ууд нь API/мобайлын нийцлийн тулд үлдсэн.
  locked: boolean;
  // Идэвхтэй ч удахгүй дуусах гэж буй эсэх (daysLeft <= SUBSCRIPTION_WARN_DAYS).
  expiringSoon: boolean;
  warnDays: number;
  // Хүлээгдэж буй (PENDING) QPay төлбөртэй эсэх.
  hasPendingPayment: boolean;
};

/**
 * Тенантын subscription-ийн бодит цагийн төлөв. `resolveActiveSubscription` нь
 * status-аар шүүдэг (cron EXPIRED болгохоос хамаарна) тул энд endsAt-ийг бодит
 * цагаар нь дахин шалгаж, аль хэдийн өнгөрсөн бол locked гэж үзнэ.
 *
 * Нэг хүсэлтийн дотор олон газраас дуудсан ч React `cache` дахин query хийхгүй.
 */
export const getSubscriptionState = cache(
  async (tenantId: string): Promise<SubscriptionState> => {
    const now = new Date();
    const [subs, pendingCount] = await Promise.all([
      prisma.subscription.findMany({
        where: { tenantId },
        orderBy: { startsAt: "desc" },
        select: {
          id: true,
          plan: true,
          status: true,
          startsAt: true,
          endsAt: true,
        },
      }),
      prisma.subscriptionPayment.count({
        where: { tenantId, status: "PENDING" },
      }),
    ]);

    const info = resolveActiveSubscription(subs, now);
    // endsAt-аар бодит цагт дахин шалгана — status хараахан EXPIRED болоогүй ч
    // хугацаа нь өнгөрсөн бол идэвхгүйд тооцно.
    const active =
      info &&
      (info.expiresAt == null || info.expiresAt.getTime() > now.getTime())
        ? info
        : null;

    return {
      active,
      locked: false,
      expiringSoon:
        !!active &&
        active.expiresAt != null &&
        active.daysLeft <= SUBSCRIPTION_WARN_DAYS,
      warnDays: SUBSCRIPTION_WARN_DAYS,
      hasPendingPayment: pendingCount > 0,
    };
  },
);

/**
 * Server action-уудад: багц дууссан бол алдаа шиднэ. authorize() доторх
 * try/catch барьж хэрэглэгчид ойлгомжтой мессеж буцаана.
 */
export async function assertActiveSubscription(tenantId: string): Promise<void> {
  const state = await getSubscriptionState(tenantId);
  if (state.locked) {
    throw new Error(SUBSCRIPTION_LOCKED_MESSAGE);
  }
}

/**
 * API mutation route-уудад: багц дууссан бол 403 Response, эс бөгөөс null.
 *
 *   const auth = await requireApiUser(req);
 *   if (auth.response) return auth.response;
 *   const locked = await requireActiveSubscriptionApi(auth.user);
 *   if (locked) return locked;
 */
export async function requireActiveSubscriptionApi(
  user: ApiUser,
): Promise<NextResponse | null> {
  const state = await getSubscriptionState(user.tenantId);
  if (state.locked) {
    return jsonError(403, SUBSCRIPTION_LOCKED_MESSAGE, {
      code: "SUBSCRIPTION_EXPIRED",
    });
  }
  return null;
}

/**
 * Public-аас хандах boletных суурь URL — QPay callback зэрэгт. Орчны хувьсагчаар
 * тохируулна, байхгүй бол production домэйн.
 */
export function getAppBaseUrl(): string {
  return (
    process.env.APP_URL ??
    process.env.NEXT_PUBLIC_APP_URL ??
    "https://carservice.mn"
  ).replace(/\/+$/, "");
}
