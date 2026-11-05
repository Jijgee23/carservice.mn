import { jsonOk, requireApiUser } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { getSubscriptionState } from "@/lib/subscription-server";

/**
 * GET /api/v1/subscription — нэвтэрсэн ажилтны тенантын одоогийн багцын төлөв.
 * Мобайл/гадаад клиент subscription дууссан эсэхийг шалгаж UI-аа тааруулна.
 */
export async function GET(req: Request) {
  const auth = await requireApiUser(req);
  if (auth.response) return auth.response;

  const [state, tenant] = await Promise.all([
    getSubscriptionState(auth.user.tenantId),
    prisma.tenant.findUnique({
      where: { id: auth.user.tenantId },
      select: { plan: true },
    }),
  ]);

  return jsonOk({
    plan: tenant?.plan ?? state.active?.subscription.plan ?? "FREE",
    // Төлбөртэй subscription-гүй = үнэгүй FREE багц, хугацаагүй идэвхтэй.
    status: state.active?.subscription.status ?? "ACTIVE",
    locked: state.locked,
    isTrial: state.active?.isTrial ?? false,
    daysLeft: Number.isFinite(state.active?.daysLeft ?? NaN)
      ? state.active!.daysLeft
      : null,
    expiresAt: state.active?.expiresAt ?? null,
    expiringSoon: state.expiringSoon,
    warnDays: state.warnDays,
    hasPendingPayment: state.hasPendingPayment,
  });
}
