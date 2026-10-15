import { enforceRateLimit, jsonError, jsonOk } from "@/lib/api";
import { signAccountApiToken } from "@/lib/auth/account-api-token";
import { finishAccountLogin, verifyAccountPassword } from "@/lib/auth/account-password";
import { normalizePhone } from "@/lib/phone";
import { LOGIN_WINDOW_MS } from "@/lib/rate-limit";
import { setBypassContext } from "@/lib/tenant-context";

// POST /api/v1/app/auth/login-password  { phone, password } → accessToken (verify-otp-той ижил хариу).
// Нууц үг тохируулсан Account л нэвтэрнэ; шинэ Account үүсгэхгүй (кодоор нэвтрэх нь үүсгэдэг).
export async function POST(req: Request) {
  const limited = enforceRateLimit(req, "app-login-password", { limit: 30, windowMs: LOGIN_WINDOW_MS });
  if (limited) return limited;

  // Нэвтрэхээс өмнө — session/tenant хараахан байхгүй, Account глобал объект.
  setBypassContext();

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError(400, "JSON body шаардлагатай.");
  }
  const b = body as { phone?: unknown; password?: unknown };
  const phone = normalizePhone(typeof b.phone === "string" ? b.phone : "");
  const password = typeof b.password === "string" ? b.password : "";
  if (!phone) return jsonError(400, "Утасны дугаар буруу.");
  if (!password) return jsonError(400, "Нууц үг шаардлагатай.");

  const result = await verifyAccountPassword({ phone, password });
  if (!result.ok) {
    const status = result.reason === "blocked" ? 403 : result.reason === "rate_limited" ? 429 : 401;
    return jsonError(status, result.message, { code: result.reason === "invalid" ? "INVALID_CREDENTIALS" : result.reason === "blocked" ? "ACCOUNT_BLOCKED" : "RATE_LIMITED" });
  }

  const reactivated = Boolean(result.account.deactivatedAt);
  const account = await finishAccountLogin(result.account.id);
  const accessToken = await signAccountApiToken({ accountId: account.id, phone: account.phone });
  return jsonOk({
    accessToken,
    reactivated,
    account: { id: account.id, phone: account.phone, name: account.name, hasPassword: Boolean(account.passwordHash) },
  });
}
