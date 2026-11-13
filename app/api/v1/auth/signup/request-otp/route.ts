import { enforceRateLimit, jsonError, jsonOk } from "@/lib/api";
import { issueOtp } from "@/lib/auth/otp";
import {
  findTenantSignupConflicts,
  tenantSignupInputFromBody,
  validateTenantSignup,
} from "@/lib/auth/tenant-signup";
import { maskPhone } from "@/lib/phone";
import { ipOrNull } from "@/lib/rate-limit";
import { sendOtpSms } from "@/lib/sms";
import { setBypassContext } from "@/lib/tenant-context";

/**
 * POST /api/v1/auth/signup/request-otp — шинэ засвар (tenant) бүртгэлийн 1-р шат.
 *
 * Body (JSON): {
 *   orgName, registerNumber, phone1 (эсвэл phone), orgEmail?, ownerName (байгууллагад),
 *   password, passwordConfirm?, latitude, longitude, city?, district?, khoroo?, address?
 * }
 *
 * Веб signUpAction-ийн 1-р шаттай ижил: талбаруудыг шалгаж, регистр/имэйл/утас
 * давхцаагүй бол админы утсанд SIGNUP OTP илгээнэ. Дараа нь ижил body + `code`-оор
 * POST /api/v1/auth/signup дуудна. "Код дахин илгээх" мөн энэ endpoint.
 *
 * 400 VALIDATION / 409 CONFLICT → `{ error, code, fieldErrors }`.
 */
export async function POST(req: Request) {
  // Бүртгэлээс өмнө — session/tenant хараахан байхгүй.
  setBypassContext();

  const limited = enforceRateLimit(req, "api-signup-otp", { limit: 5, windowMs: 60_000 });
  if (limited) return limited;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError(400, "Body нь JSON байх ёстой.");
  }

  const validated = validateTenantSignup(tenantSignupInputFromBody(body));
  if (!validated.ok) {
    return jsonError(400, Object.values(validated.fieldErrors)[0], {
      code: "VALIDATION",
      fieldErrors: validated.fieldErrors,
    });
  }
  const data = validated.data;

  const conflicts = await findTenantSignupConflicts(data);
  if (conflicts) {
    return jsonError(409, Object.values(conflicts)[0], { code: "CONFLICT", fieldErrors: conflicts });
  }

  const ip = ipOrNull(req.headers);
  let code: string;
  try {
    // SIGNUP OTP нь утсаар түлхүүрлэгдэнэ (lib/auth/otp.ts) — код очсон утас л 2-р шатанд баталгаажина.
    ({ code } = await issueOtp({
      phone: data.phone,
      type: "SIGNUP",
      userAgent: req.headers.get("user-agent"),
      ip,
    }));
  } catch (e) {
    // issueOtp throttle (хэт олон код хүссэн).
    return jsonError(429, e instanceof Error ? e.message : "Код илгээхэд алдаа гарлаа.");
  }
  const sent = await sendOtpSms(code, "SIGNUP", data.phone);
  if (!sent) {
    return jsonError(502, "Баталгаажуулах код илгээгдсэнгүй. Утсаа шалгаж дахин оролдоно уу.");
  }

  return jsonOk({
    sent: true,
    maskedPhone: maskPhone(data.phone),
    message: `Утас ${maskPhone(data.phone)} руу 6 оронтой код илгээлээ.`,
  });
}
