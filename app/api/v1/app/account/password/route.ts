import { enforceRateLimit, jsonError, jsonOk } from "@/lib/api";
import { getApiAccountFromRequest } from "@/lib/auth/account-api-token";
import { removeAccountPassword, setAccountPassword } from "@/lib/auth/account-password";

// Үйлчлүүлэгчийн нууц үг. PUT / DELETE нь POST /account/password/request-otp-оор авсан шинэ кодыг шаардана.

/** GET → { hasPassword, updatedAt } */
export async function GET(req: Request) {
  const account = await getApiAccountFromRequest(req); // sets bypass context
  if (!account) return jsonError(401, "Нэвтрэх шаардлагатай.");
  return jsonOk({ hasPassword: Boolean(account.passwordHash), updatedAt: account.passwordUpdatedAt?.toISOString() ?? null });
}

async function readBody(req: Request): Promise<Record<string, unknown> | null> {
  try {
    const b = await req.json();
    return b && typeof b === "object" ? (b as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

const str = (v: unknown) => (typeof v === "string" ? v : "");

/** PUT { code, password } → тохируулах / солих. */
export async function PUT(req: Request) {
  const account = await getApiAccountFromRequest(req);
  if (!account) return jsonError(401, "Нэвтрэх шаардлагатай.");
  const limited = enforceRateLimit(req, "app-account-password", { limit: 10, windowMs: 10 * 60_000 });
  if (limited) return limited;
  const body = await readBody(req);
  if (!body) return jsonError(400, "JSON body шаардлагатай.");

  const r = await setAccountPassword({ account, code: str(body.code), password: str(body.password) });
  if (!r.ok) return jsonError(422, r.message, { code: r.field === "code" ? "OTP_INVALID" : "PASSWORD_INVALID", fieldErrors: { [r.field]: r.message } });
  return jsonOk({ ok: true, hasPassword: true });
}

/** DELETE { code } → нууц үг устгаж зөвхөн кодоор нэвтрэх горимд буцна. */
export async function DELETE(req: Request) {
  const account = await getApiAccountFromRequest(req);
  if (!account) return jsonError(401, "Нэвтрэх шаардлагатай.");
  const limited = enforceRateLimit(req, "app-account-password", { limit: 10, windowMs: 10 * 60_000 });
  if (limited) return limited;
  const body = await readBody(req);
  if (!body) return jsonError(400, "JSON body шаардлагатай.");

  const r = await removeAccountPassword({ account, code: str(body.code) });
  if (!r.ok) return jsonError(422, r.message, { code: "OTP_INVALID", fieldErrors: { code: r.message } });
  return jsonOk({ ok: true, hasPassword: false });
}
