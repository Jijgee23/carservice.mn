import { enforceRateLimit, jsonError, jsonOk } from "@/lib/api";
import { getApiAccountFromRequest } from "@/lib/auth/account-api-token";
import { issuePhoneOtp } from "@/lib/auth/otp";
import { maskPhone } from "@/lib/phone";
import { sendOtpSms } from "@/lib/sms";

// POST /api/v1/app/account/password/request-otp  {} — нууц үг тохируулах/солих/устгахад зориулсан
// ACCOUNT_PASSWORD кодыг account-ийн бүртгэлтэй утсанд илгээнэ.
export async function POST(req: Request) {
  const account = await getApiAccountFromRequest(req); // sets bypass context
  if (!account) return jsonError(401, "Нэвтрэх шаардлагатай.");
  const limited = enforceRateLimit(req, "app-account-password-otp", { limit: 5, windowMs: 10 * 60_000 });
  if (limited) return limited;

  try {
    const { code } = await issuePhoneOtp({
      phone: account.phone,
      type: "ACCOUNT_PASSWORD",
      accountId: account.id,
      userAgent: req.headers.get("user-agent"),
      ip: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || null,
    });
    await sendOtpSms(code, "ACCOUNT_PASSWORD", account.phone);
  } catch (e) {
    return jsonError(429, e instanceof Error ? e.message : "Код илгээхэд алдаа.");
  }
  return jsonOk({ ok: true, maskedPhone: maskPhone(account.phone) });
}
