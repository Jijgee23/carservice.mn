// Contract — POST /api/v1/system/tenants/[id]/owner/activation-code
//
// Бүртгэсэн харилцагчийн эзэнд нууц үг тохируулах SMS код (OTP) илгээнэ/дахин илгээнэ. Эзэн кодоо /api/v1/auth/activate-д
// өөрийн утасны дугаар + код + шинэ нууц үгээр оруулж идэвхжинэ. Эрх: tenants.edit. Rate limit: 10 / 10 мин (админаар);
// мөн код хүсэлтийн дотоод throttle (issueOtp).
// 200: { sent: true, ownerId, maskedPhone }
// 404 { code: "NOT_FOUND" } | 409 { code: "ALREADY_ACTIVE" } (эзэн аль хэдийн идэвхжсэн) | 429 { code: "THROTTLED" } |
// 502 { code: "SMS_FAILED" } | 401 | 403

import { enforceRateLimit, jsonError, jsonOk } from "@/lib/api";
import { requireSystemApiUser } from "@/lib/auth/system-api";
import { sendOwnerActivationCode } from "@/lib/system/owner-activation";
import { ipOrNull } from "@/lib/rate-limit";

const STATUS = { NOT_FOUND: 404, ALREADY_ACTIVE: 409, THROTTLED: 429, SMS_FAILED: 502 } as const;

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireSystemApiUser(req, "tenants.edit");
  if (auth.response) return auth.response;
  const limited = enforceRateLimit(req, "system-api-activation-code", { limit: 10, windowMs: 10 * 60_000 }, auth.admin.id);
  if (limited) return limited;

  const { id } = await ctx.params;
  const result = await sendOwnerActivationCode({ tenantId: id, userAgent: req.headers.get("user-agent"), ip: ipOrNull(req.headers) });
  if (!result.ok) return jsonError(STATUS[result.reason], result.message, { code: result.reason });
  return jsonOk({ sent: true, ownerId: result.ownerId, maskedPhone: result.maskedPhone });
}
