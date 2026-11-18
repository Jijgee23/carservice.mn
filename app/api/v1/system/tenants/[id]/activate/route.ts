
// Contract — POST /api/v1/system/tenants/[id]/activate
//
// Түр хаасан байгууллагыг дахин нээнэ (кредитээр зогссон бол автомат блокоос чөлөөлнө).
// Эрх: tenants.suspend. Rate limit: 60 / 10 мин (админаар). Body шаардахгүй. Аудит: STATUS_CHANGE (before/after).
// 200: { tenant: TenantDetail } (аль хэдийн тэр төлөвт байвал мөн 200, аудит бичигдэхгүй) | 404 { code: "NOT_FOUND" } | 429 | 401 | 403

import { enforceRateLimit, jsonError, jsonOk } from "@/lib/api";
import { requireSystemApiUser } from "@/lib/auth/system-api";
import { logSystemAudit } from "@/lib/system/audit";
import { activateTenant, getTenantDetail } from "@/lib/system/tenants";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireSystemApiUser(req, "tenants.suspend");
  if (auth.response) return auth.response;
  const limited = enforceRateLimit(req, "system-api-tenant-status", { limit: 60, windowMs: 10 * 60_000 }, auth.admin.id);
  if (limited) return limited;
  const { id } = await ctx.params;

  const result = await activateTenant(id);
  if (!result.ok) return jsonError(404, "Байгууллага олдсонгүй.", { code: "NOT_FOUND" });

  if (result.before.suspended !== result.after.suspended) {
    const tenant = await getTenantDetail(id);
    await logSystemAudit({
      adminId: auth.admin.id,
      tenantId: id,
      entity: "Tenant",
      entityId: id,
      action: "STATUS_CHANGE",
      summary: `${tenant?.name ?? id} · дахин нээв (System ажилтан)`,
      before: result.before,
      after: result.after,
      req,
    });
  }
  return jsonOk({ tenant: await getTenantDetail(id) });
}
