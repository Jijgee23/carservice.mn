import { enforceRateLimit, jsonError, jsonOk } from "@/lib/api";
import { ipOrNull } from "@/lib/rate-limit";
import { getApiAccountFromRequest } from "@/lib/auth/account-api-token";
import { issuePhoneOtp } from "@/lib/auth/otp";
import { maskPhone } from "@/lib/phone";
import { sendOtpSms } from "@/lib/sms";

// POST /api/v1/app/account/close/request-otp  {} — deactivate/delete-д зориулсан
// ACCOUNT_CLOSE OTP-г account-ийн бүртгэлтэй утсанд илгээнэ.
export async function POST(req: Request) {
  const account = await getApiAccountFromRequest(req); // sets bypass context
  if (!account) return jsonError(401, "Нэвтрэх шаардлагатай.");
  const limited = enforceRateLimit(req, "app-account-close-otp", {
    limit: 5,
    windowMs: 10 * 60_000,
  });
  if (limited) return limited;

  const userAgent = req.headers.get("user-agent");
  const ip =
    ipOrNull(req.headers);

  try {
    const { code } = await issuePhoneOtp({
      phone: account.phone,
      type: "ACCOUNT_CLOSE",
      accountId: account.id,
      userAgent,
      ip,
    });
    await sendOtpSms(code, "ACCOUNT_CLOSE", account.phone);
  } catch (e) {
    return jsonError(429, e instanceof Error ? e.message : "Код илгээхэд алдаа.");
  }

  return jsonOk({ ok: true, maskedPhone: maskPhone(account.phone) });
}
