// Contract — POST /api/v1/subscription/trial (багцын үнэгүй туршилт эхлүүлэх)
//
// Эрх: зөвхөн эзэмшигч. Багц тус бүрийг нэг удаа туршина; боломжтой туршилтуудыг
// GET /api/v1/subscription → trialsAvailable: [{ plan, days }] -оос үзнэ.
//
// POST /api/v1/subscription/trial
//   Body: { plan: "BUSINESS" | "ENTERPRISE" }
//   201: { ok: true, plan, days, endsAt: ISO }
//   Алдаа: 400 VALIDATION, 401, 403 (эзэмшигч биш),
//     422 TRIAL_UNAVAILABLE (идэвхгүй / өмнө туршсан / идэвхтэй төлбөртэй багцтай).

import { jsonError, jsonForbidden, jsonOk, requireApiUser } from "@/lib/api";
import { TRIAL_DENY_MESSAGE } from "@/lib/plan-trials";
import { startTenantTrial } from "@/lib/plan-trials-server";
import { TRIALABLE_PLANS } from "@/lib/subscription";
import type { Plan } from "@/app/generated/prisma/enums";

export async function POST(req: Request) {
  const auth = await requireApiUser(req);
  if (auth.response) return auth.response;
  if (!auth.user.isOwner) return jsonForbidden("Зөвхөн админ туршилт эхлүүлнэ.");

  const body = await req.json().catch(() => null);
  const raw = body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>).plan : undefined;
  const plan = typeof raw === "string" ? (raw.trim() as Plan) : undefined;
  if (!plan || !TRIALABLE_PLANS.includes(plan)) {
    return jsonError(400, "plan нь BUSINESS эсвэл ENTERPRISE байх ёстой.", { code: "VALIDATION" });
  }

  const result = await startTenantTrial(auth.user.tenantId, plan);
  if (!result.ok) {
    return jsonError(422, TRIAL_DENY_MESSAGE[result.reason], { code: "TRIAL_UNAVAILABLE" });
  }
  return jsonOk({ ok: true, plan, days: result.days, endsAt: result.endsAt }, { status: 201 });
}
