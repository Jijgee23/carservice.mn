import { enforceRateLimit, jsonError, jsonOk } from "@/lib/api";
import { issueOtp } from "@/lib/auth/otp";
import { IDENTIFIER_ERROR, loginIdentifierFromBody } from "@/lib/auth/login-identifier";
import { prisma } from "@/lib/prisma";
import { ipOrNull } from "@/lib/rate-limit";
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
 * илгээгдэнэ. Хариу нь бүх тохиолдолд ЯГ ИЖИЛ (`maskedPhone` үргэлж "**" —
 * staff app уг талбарыг уншдаг тул хадгалав). Хэт олон хүсэлтэд issueOtp
 * throttle 429 буцаана.
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
    const ip = ipOrNull(req.headers);
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
  }

  // Бүх тохиолдолд ижил хариу — enumeration-аас сэргийлнэ.
  return jsonOk({
    sent: true,
    maskedPhone: "**",
    message: "Хэрэв энэ идэвхжээгүй бүртгэлтэй бол утсанд код илгээгдсэн.",
  });
}
