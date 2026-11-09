import { enforceRateLimit, jsonError, jsonOk } from "@/lib/api";
import { issueOtp } from "@/lib/auth/otp";
import { IDENTIFIER_ERROR, loginIdentifierFromBody } from "@/lib/auth/login-identifier";
import { maskPhone } from "@/lib/phone";
import { prisma } from "@/lib/prisma";
import { sendOtpSms } from "@/lib/sms";
import { setBypassContext } from "@/lib/tenant-context";

/**
 * POST /api/v1/auth/activate/request-otp  { identifier } → идэвхжүүлэх OTP дахин илгээх
 *
 * `identifier` — имэйл эсвэл утасны дугаар (хуучин `{ email }` хэвээр ажиллана).
 *
 * Веб дэх requestActivationAction-ийн мобайл хувилбар. Идэвхжүүлэх дэлгэц дэх
 * "Код дахин илгээх" товчинд зориулсан.
 *
 * Enumeration-safe: бүртгэлгүй / аль хэдийн идэвхжсэн нэвтрэх нэрд ч ерөнхий
 * "илгээгдсэн" хариу буцаана. OTP нь зөвхөн идэвхжээгүй жинхэнэ ажилтанд л
 * илгээгдэнэ. Хэт олон хүсэлтэд issueOtp throttle 429 буцаана.
 */
export async function POST(req: Request) {
  // Нэвтрэхээс өмнө — session/tenant хараахан байхгүй.
  setBypassContext();

  const limited = enforceRateLimit(req, "api-activate-otp", {
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
    select: { id: true, email: true, phone: true, verified: true },
  });

  if (user && !user.verified) {
    const ip =
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      req.headers.get("x-real-ip") ||
      null;
    try {
      const { code } = await issueOtp({
        email: user.email,
        phone: user.phone,
        type: "SET_PASSWORD",
        userId: user.id,
        userAgent: req.headers.get("user-agent"),
        ip,
      });
      await sendOtpSms(code, "SET_PASSWORD", user.phone);
    } catch (e) {
      return jsonError(
        429,
        e instanceof Error ? e.message : "Код илгээхэд алдаа гарлаа.",
      );
    }
    return jsonOk({
      sent: true,
      maskedPhone: maskPhone(user.phone),
      message: "Бүртгэлтэй утсанд 6 оронтой код илгээлээ.",
    });
  }

  // Бүртгэлгүй эсвэл аль хэдийн идэвхжсэн — enumeration-аас сэргийлж ерөнхий хариу.
  return jsonOk({
    sent: true,
    maskedPhone: "**",
    message: "Хэрэв энэ идэвхжээгүй бүртгэлтэй бол утсанд код илгээгдсэн.",
  });
}
