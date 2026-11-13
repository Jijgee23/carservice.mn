import { enforceRateLimit, jsonError, jsonOk } from "@/lib/api";
import { issueOtp } from "@/lib/auth/otp";
import {
  IDENTIFIER_ERROR,
  loginIdentifierFromBody,
  loginIdentifierLabel,
  loginIdentifierValue,
} from "@/lib/auth/login-identifier";
import { maskPhone } from "@/lib/phone";
import { prisma } from "@/lib/prisma";
import { sendOtpSms } from "@/lib/sms";
import { setBypassContext } from "@/lib/tenant-context";
import { ipOrNull } from "@/lib/rate-limit";

/**
 * POST /api/v1/auth/check-email  { identifier } → нэвтрэлтийн дараагийн алхам
 *
 * `identifier` — имэйл эсвэл утасны дугаар (хуучин `{ email }` хэвээр ажиллана).
 * Хариуны `identifier` (канон утга)-г дараагийн /auth/login, /auth/activate-д
 * дамжуулна. `email` талбар зөвхөн имэйлээр орсон үед (backward-compat) ирнэ —
 * утсаар орсон клиентэд хэрэглэгчийн имэйлийг ил гаргахгүй.
 *
 * Веб дэх checkLoginEmailAction-ийн мобайл хувилбар. Ажилтны төлөвийг
 * шалгаж дараагийн алхмыг буцаана:
 *   - "password"        : бүртгэлтэй, идэвхжсэн → /auth/login руу нууц үг асууна
 *   - "activate"        : бүртгэлтэй ч идэвхжээгүй → утсанд OTP илгээж, нууц үг
 *                         үүсгүүлэх дэлгэц рүү (otpSent, maskedPhone)
 *   - "not_registered"  : бүртгэлгүй
 *
 * Тэмдэглэл: энэ нь имэйл бүртгэлтэй эсэхийг ил болгодог (enumeration) — веб
 * дэх UX-тэй адилхан зориуд. Идэвхжүүлэх OTP илгээх нь зөвхөн идэвхжээгүй
 * жинхэнэ ажилтанд л ажиллана.
 */
export async function POST(req: Request) {
  // Нэвтрэхээс өмнө — session/tenant хараахан байхгүй.
  setBypassContext();

  const limited = enforceRateLimit(req, "api-check-email", {
    limit: 15,
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
  // Хариунд үргэлж орох талбарууд: identifier (+ имэйлээр орсон бол email).
  const echo = {
    identifier: loginIdentifierValue(id),
    ...("email" in id ? { email: id.email } : {}),
  };

  const user = await prisma.user.findUnique({
    where: id,
    select: { id: true, email: true, verified: true, passwordHash: true, phone: true },
  });

  if (!user) {
    return jsonOk({
      status: "not_registered",
      ...echo,
      message: `Энэ ${loginIdentifierLabel(id)} бүртгэлгүй байна. Байгууллагаа бүртгүүлэх эсвэл админтайгаа холбогдоно уу.`,
    });
  }

  // Идэвхжсэн — нууц үгээр нэвтэрнэ.
  if (user.verified && user.passwordHash) {
    return jsonOk({ status: "password", ...echo });
  }

  // Идэвхжээгүй — анхны нэвтрэлт: утсанд OTP илгээж нууц үг үүсгүүлнэ.
  const maskedPhone = maskPhone(user.phone);
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
    // Код илгээх амжилтгүй (ж: хэт олон хүсэлт) — алхмыг буцааж, шалтгааныг дамжуулна.
    return jsonOk({
      status: "activate",
      ...echo,
      maskedPhone,
      otpSent: false,
      message: e instanceof Error ? e.message : "Код илгээхэд алдаа гарлаа.",
    });
  }

  return jsonOk({
    status: "activate",
    ...echo,
    maskedPhone,
    otpSent: true,
    message: "Бүртгэлтэй утсанд 6 оронтой код илгээлээ.",
  });
}
