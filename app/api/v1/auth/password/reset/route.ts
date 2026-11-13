import { enforceRateLimit, jsonError, jsonOk } from "@/lib/api";
import { IDENTIFIER_ERROR, loginIdentifierFromBody } from "@/lib/auth/login-identifier";
import { revokeAllOtps, verifyOtp } from "@/lib/auth/otp";
import { hashPassword } from "@/lib/auth/password";
import { revokeAllForUser } from "@/lib/auth/refresh-token";
import { revokeAllUserSessions } from "@/lib/auth/login-lockout";
import { logAudit } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import { setBypassContext } from "@/lib/tenant-context";

/**
 * POST /api/v1/auth/password/reset  { identifier, code, password } → { ok, message }
 *
 * `identifier` — имэйл эсвэл утасны дугаар (хуучин `{ email }` хэвээр ажиллана).
 *
 * Веб дэх resetPasswordAction-ийн мобайл хувилбар. OTP зөв бол шинэ нууц үгийг
 * тогтоож, аккаунтыг unlock хийнэ (failedLoginAttempts=0, lockedAt=null) —
 * утсаараа баталгаажуулсан тул verified=true. Дараа нь бүх refresh token
 * болон үлдсэн RESET_PASSWORD кодуудыг хүчингүй болгоно (бүх төхөөрөмжөөс
 * гаргана). Token буцаахгүй — клиент шинэ нууц үгээрээ /auth/login хийнэ
 * (вебтэй ижил), тиймээс түр зогссон байгууллага / идэвхгүй ажилтны шалгалт
 * login дээрээ хэвээр үйлчилнэ.
 */
export async function POST(req: Request) {
  // Нууц үг сэргээхээс өмнө — session/tenant хараахан байхгүй.
  setBypassContext();

  const limited = enforceRateLimit(req, "api-password-reset", {
    limit: 10,
    windowMs: 60_000,
  });
  if (limited) return limited;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError(400, "Body нь JSON байх ёстой.");
  }
  const { code, password } = (body ?? {}) as {
    code?: unknown;
    password?: unknown;
  };

  const id = loginIdentifierFromBody(body);
  const otpCode = typeof code === "string" ? code.trim() : "";
  const pwd = typeof password === "string" ? password : "";

  if (!id) return jsonError(400, IDENTIFIER_ERROR);
  if (!/^\d{6}$/.test(otpCode)) {
    return jsonError(400, "6 оронтой код шаардлагатай.");
  }
  if (pwd.length < 8) {
    return jsonError(400, "Нууц үг хамгийн багадаа 8 тэмдэгт байх ёстой.");
  }

  const user = await prisma.user.findUnique({
    where: id,
    select: { id: true, email: true, phone: true, tenantId: true },
  });
  // Бүртгэлгүй нэвтрэх нэрийг "код буруу"-тай адил харуулна (enumeration-аас сэргийлнэ).
  if (!user) {
    return jsonError(401, "Код буруу байна.");
  }

  const otp = await verifyOtp({
    email: user.email,
    phone: user.phone,
    type: "RESET_PASSWORD",
    code: otpCode,
  });
  if (!otp.ok) {
    const msg =
      otp.reason === "expired"
        ? "Кодны хугацаа дууссан. Шинээр код илгээнэ үү."
        : otp.reason === "too_many_attempts"
          ? "Хэт олон удаа буруу оролдсон. Шинээр код илгээнэ үү."
          : "Код буруу байна.";
    return jsonError(401, msg);
  }

  const passwordHash = await hashPassword(pwd);
  await prisma.user.update({
    where: { id: user.id },
    data: {
      passwordHash,
      // Утсаараа OTP баталгаажуулсан тул аккаунт идэвхтэй гэж үзнэ.
      verified: true,
      failedLoginAttempts: 0,
      lockedAt: null,
    },
  });
  await logAudit({
    tenantId: user.tenantId,
    userId: user.id,
    entity: "User",
    entityId: user.id,
    action: "UPDATE",
    summary: "Нууц үг сэргээв (OTP-ээр баталгаажуулсан, mobile)",
  });
  // Refresh token + web session (UserSession) бүгдийг цуцална — бүх төхөөрөмжөөс гаргана.
  await Promise.all([
    revokeAllForUser(user.id),
    revokeAllUserSessions(user.id),
    revokeAllOtps({ email: user.email, phone: user.phone }, "RESET_PASSWORD"),
  ]);

  return jsonOk({
    ok: true,
    message: "Нууц үг шинэчлэгдлээ. Шинэ нууц үгээрээ нэвтэрнэ үү.",
  });
}
