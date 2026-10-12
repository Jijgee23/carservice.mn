import { jsonError, jsonOk, requireApiUser } from "@/lib/api";
import { hasPermission } from "@/lib/auth/roles";
import { createPaymentAccount, listPaymentAccounts } from "@/lib/payment-account-service";
import { PaymentAccountError } from "@/lib/payment-accounts";
import { requireActiveSubscriptionApi } from "@/lib/subscription-server";

const forbidden = () => jsonError(403, "Танд кассыг удирдах эрх байхгүй.", { code: "CASH_MANAGE_FORBIDDEN" });

function failure(tag: string, error: unknown) {
  if (error instanceof PaymentAccountError) {
    return jsonError(error.status, error.message, { code: error.code, fieldErrors: error.fieldErrors });
  }
  console.error(`[payment-accounts] ${tag} failed`);
  return jsonError(500, "Серверийн алдаа гарлаа. Дахин оролдоно уу.");
}

// GET /api/v1/payment-accounts?includeInactive=1 -> { accounts: PaymentAccountDto[] } — permission: cash.manage (full number).
export async function GET(req: Request) {
  const auth = await requireApiUser(req);
  if (auth.response) return auth.response;
  if (!hasPermission(auth.user, "cash.manage")) return forbidden();
  try {
    const includeInactive = new URL(req.url).searchParams.get("includeInactive") === "1";
    return jsonOk({ accounts: await listPaymentAccounts({ actor: auth.user, includeInactive }) });
  } catch (error) {
    return failure("list", error);
  }
}

// POST /api/v1/payment-accounts { type, name, accountNumber, terminalId?, merchantId?, isTest? } -> 201 { account } — cash.manage.
export async function POST(req: Request) {
  const auth = await requireApiUser(req);
  if (auth.response) return auth.response;
  if (!hasPermission(auth.user, "cash.manage")) return forbidden();
  const locked = await requireActiveSubscriptionApi(auth.user);
  if (locked) return locked;
  let body: unknown;
  try { body = await req.json(); } catch { return jsonError(400, "JSON body шаардлагатай."); }
  if (body == null || typeof body !== "object" || Array.isArray(body)) return jsonError(400, "JSON object шаардлагатай.");
  try {
    const account = await createPaymentAccount({ actor: auth.user, data: body });
    return jsonOk({ account }, { status: 201 });
  } catch (error) {
    return failure("create", error);
  }
}
