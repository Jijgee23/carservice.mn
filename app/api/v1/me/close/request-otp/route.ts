import { assertNoOpenOrders, ClosureError } from "@/lib/account-closure/staff";
import { ipOrNull } from "@/lib/rate-limit";
import { enforceRateLimit, jsonError, jsonOk, requireApiUser } from "@/lib/api";
import { issueOtp } from "@/lib/auth/otp";
import { maskPhone } from "@/lib/phone";
import { sendOtpSms } from "@/lib/sms";

// POST /api/v1/me/close/request-otp  { purpose?: "delete" } — deactivate/delete-д зориулсан
// ACCOUNT_CLOSE OTP-г auth.user.email-ээр (имэйл-keyed) үүсгэж, ажилтны
// бүртгэлтэй утсанд SMS-ээр илгээнэ (app/api/v1/auth/activate/request-otp
// шиг). Зөвхөн auth.user.id дээр ажиллана. purpose="delete" бол нээлттэй
// захиалгатай ажилтанд код илгээхээс ӨМНӨ 409 OPEN_ORDERS буцаана (SMS/OTP
// дэмий зарцуулахгүй). deleteStaffUser мөн дахин шалгана (хуучин клиент, race).
export async function POST(req: Request) {
  const auth = await requireApiUser(req);
  if (auth.response) return auth.response;

  const limited = enforceRateLimit(req, "me-account-close-otp", {
    limit: 5,
    windowMs: 10 * 60_000,
  });
  if (limited) return limited;

  let purpose: unknown;
  try {
    purpose = ((await req.json()) as { purpose?: unknown } | null)?.purpose;
  } catch {
    purpose = undefined; // хоосон body — хуучин клиент
  }
  if (purpose === "delete") {
    try {
      await assertNoOpenOrders(auth.user.id);
    } catch (e) {
      if (e instanceof ClosureError && e.code === "OPEN_ORDERS") {
        return jsonError(
          409,
          `Танд ${e.openOrders} нээлттэй захиалга хуваарилагдсан байна. Эхлээд админаар өөр ажилтанд шилжүүлүүлнэ үү.`,
          { code: "OPEN_ORDERS" },
        );
      }
      throw e;
    }
  }

  const userAgent = req.headers.get("user-agent");
  const ip =
    ipOrNull(req.headers);

  try {
    const { code } = await issueOtp({
      email: auth.user.email,
      phone: auth.user.phone,
      type: "ACCOUNT_CLOSE",
      userId: auth.user.id,
      userAgent,
      ip,
    });
    await sendOtpSms(code, "ACCOUNT_CLOSE", auth.user.phone);
  } catch (e) {
    return jsonError(429, e instanceof Error ? e.message : "Код илгээхэд алдаа.");
  }

  return jsonOk({ ok: true, maskedPhone: maskPhone(auth.user.phone) });
}
