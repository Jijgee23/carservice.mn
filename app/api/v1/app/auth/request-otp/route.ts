import { enforceRateLimit, jsonError, jsonOk } from "@/lib/api";
import { issuePhoneOtp } from "@/lib/auth/otp";
import { normalizePhone } from "@/lib/phone";
import { sendOtpSms } from "@/lib/sms";
import { setBypassContext } from "@/lib/tenant-context";
import { ipOrNull } from "@/lib/rate-limit";

// POST /api/v1/app/auth/request-otp  { phone }
// Эцсийн хэрэглэгчийн утсанд нэвтрэх OTP илгээнэ.
export async function POST(req: Request) {
  // Нэвтрэхээс өмнө — session/tenant хараахан байхгүй.
  setBypassContext();

  const limited = enforceRateLimit(req, "app-otp", {
    limit: 5,
    windowMs: 10 * 60_000,
  });
  if (limited) return limited;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError(400, "JSON body шаардлагатай.");
  }
  const phone = normalizePhone(
    typeof (body as { phone?: unknown })?.phone === "string"
      ? ((body as { phone: string }).phone)
      : "",
  );
  if (!phone) return jsonError(400, "Утасны дугаар буруу.");

  const userAgent = req.headers.get("user-agent");
  const ip = ipOrNull(req.headers);

  try {
    const { code } = await issuePhoneOtp({
      phone,
      type: "CONSUMER_LOGIN",
      userAgent,
      ip,
    });
    await sendOtpSms(code, "CONSUMER_LOGIN", phone);
  } catch (e) {
    return jsonError(429, e instanceof Error ? e.message : "Код илгээхэд алдаа.");
  }

  return jsonOk({ ok: true });
}
