import { enforceRateLimit, jsonError, jsonOk, requireApiUser } from "@/lib/api";
import { ClosureError, deactivateStaffUser } from "@/lib/account-closure/staff";
import { logAudit } from "@/lib/audit";
import { verifyOtp } from "@/lib/auth/otp";

// POST /api/v1/me/deactivate  { code } — зөвхөн auth.user.id дээр ажиллана.
// Тухайн тенантын цорын ганц идэвхтэй owner бол 409 LAST_OWNER.
export async function POST(req: Request) {
  const auth = await requireApiUser(req);
  if (auth.response) return auth.response;

  const limited = enforceRateLimit(req, "me-account-close", { limit: 10, windowMs: 10 * 60_000 });
  if (limited) return limited;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError(400, "JSON body шаардлагатай.");
  }
  const code =
    typeof (body as { code?: unknown })?.code === "string"
      ? (body as { code: string }).code.trim()
      : "";
  if (!/^\d{6}$/.test(code)) {
    return jsonError(400, "6 оронтой код шаардлагатай.");
  }

  const result = await verifyOtp({ email: auth.user.email, phone: auth.user.phone, type: "ACCOUNT_CLOSE", code });
  if (!result.ok) {
    return jsonError(422, "Код буруу эсвэл хугацаа дууссан.", { code: "OTP_INVALID" });
  }

  // Аудитын тайлбарыг (нэрээр нь) lib-ийг дуудахаас өмнө бэлдэнэ — учир нь
  // deactivate-ийн дараа өөрчлөгдөхгүй ч LAST_OWNER алдаа гарвал огт лог
  // бичихгүй байх ёстой (сүүлийн-owner шалгалт нь lib дотор нэг л удаа
  // ажиллана — routes давхар шалгахгүй).
  const summary = `${auth.user.lastName} ${auth.user.firstName} · өөрийн бүртгэлээ идэвхгүй болгов`;

  try {
    await deactivateStaffUser(auth.user.id);
  } catch (e) {
    if (e instanceof ClosureError) {
      return jsonError(409, "Байгууллагын цорын ганц эзэмшигч аккаунтаа хааж болохгүй.", {
        code: "LAST_OWNER",
      });
    }
    throw e;
  }

  await logAudit({
    tenantId: auth.user.tenantId,
    userId: auth.user.id,
    entity: "User",
    entityId: auth.user.id,
    action: "STATUS_CHANGE",
    summary,
  });

  return jsonOk({ ok: true });
}
