import { enforceRateLimit, jsonError, jsonOk } from "@/lib/api";
import { issueOtp } from "@/lib/auth/otp";
import { IDENTIFIER_ERROR, loginIdentifierFromBody } from "@/lib/auth/login-identifier";
import { prisma } from "@/lib/prisma";
import { ipOrNull } from "@/lib/rate-limit";
import { sendOtpSms } from "@/lib/sms";
import { setBypassContext } from "@/lib/tenant-context";

/**
 * POST /api/v1/auth/password/request-otp  { identifier } → нууц үг сэргээх OTP илгээх
 *
 * `identifier` — имэйл эсвэл утасны дугаар (хуучин `{ email }` хэвээр ажиллана).
 *
 * Веб дэх requestPasswordResetAction-ийн мобайл хувилбар. Бүртгэлтэй ажилтны
 * утсанд RESET_PASSWORD төрлийн 6 оронтой код илгээнэ; дараа нь
 * /auth/password/reset-ээр кодоо шинэ нууц үгтэй хамт илгээнэ. "Код дахин
 * илгээх" товч ч энийг дахин дуудна.
 *
 * Enumeration-safe: бүртгэлтэй эсэхээс үл хамааран ЯГ ИЖИЛ хариу буцаана
 * (`maskedPhone` үргэлж "**" — staff app уг талбарыг уншдаг тул хадгалав).
 * Хэт олон хүсэлтэд issueOtp throttle 429 буцаана.
 */
export async function POST(req: Request) {
  // Нууц үг сэргээхээс өмнө — session/tenant хараахан байхгүй.
  setBypassContext();

  const limited = enforceRateLimit(req, "api-password-otp", {
    limit: 5,
    windowMs: 60_000,
  });
  if (limited) return limited;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError(400, "Body нь JSON байх ёстой.");
  }
  const id = loginIdentifierFromBody(body);
  if (!id) return jsonError(400, IDENTIFIER_ERROR);

  const user = await prisma.user.findUnique({
    where: id,
    select: { id: true, email: true, phone: true },
  });

  if (user) {
    const ip = ipOrNull(req.headers);
    try {
      const { code } = await issueOtp({
        email: user.email,
        phone: user.phone,
        type: "RESET_PASSWORD",
        userId: user.id,
        userAgent: req.headers.get("user-agent"),
        ip,
      });
      await sendOtpSms(code, "RESET_PASSWORD", user.phone);
    } catch (e) {
      return jsonError(
        429,
        e instanceof Error ? e.message : "Код илгээхэд алдаа гарлаа.",
      );
    }
  }

  // Бүртгэлтэй/бүртгэлгүй аль ч үед ижил хариу — enumeration-аас сэргийлнэ.
  return jsonOk({
    sent: true,
    maskedPhone: "**",
    message: "Хэрэв энэ бүртгэлтэй бол утсанд код илгээгдсэн.",
  });
}
