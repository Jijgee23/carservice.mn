import { enforceRateLimit, jsonError, jsonOk } from "@/lib/api";
import { getApiAccountFromRequest } from "@/lib/auth/account-api-token";
import { validateAccountProfileInput } from "@/lib/auth/account-profile";
import { prisma } from "@/lib/prisma";

// Үйлчлүүлэгчийн профайл. getApiAccountFromRequest нь bypass context тавина (Account глобал объект).

type AccountRow = {
  id: string;
  phone: string;
  name: string | null;
  email: string | null;
  avatarUrl: string | null;
  passwordHash: string | null;
};

function serialize(a: AccountRow) {
  return {
    id: a.id,
    phone: a.phone,
    name: a.name,
    email: a.email,
    avatarUrl: a.avatarUrl,
    hasPassword: Boolean(a.passwordHash),
  };
}

/** GET → { account: { id, phone, name, email, avatarUrl, hasPassword } } */
export async function GET(req: Request) {
  const account = await getApiAccountFromRequest(req);
  if (!account) return jsonError(401, "Нэвтрэх шаардлагатай.");
  return jsonOk({ account: serialize(account) });
}

/** PATCH { name?, email? } → { account }. Хоосон/null → арилгана. Утас энд солигдохгүй. */
export async function PATCH(req: Request) {
  const account = await getApiAccountFromRequest(req);
  if (!account) return jsonError(401, "Нэвтрэх шаардлагатай.");
  const limited = enforceRateLimit(req, "app-account-profile", { limit: 30, windowMs: 10 * 60_000 }, account.id);
  if (limited) return limited;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError(400, "JSON body шаардлагатай.");
  }
  const parsed = validateAccountProfileInput(body);
  if (!parsed.ok) return jsonError(422, "Хүсэлт буруу.", { fieldErrors: parsed.fieldErrors });

  const updated = await prisma.account.update({ where: { id: account.id }, data: parsed.data });
  return jsonOk({ account: serialize(updated) });
}
