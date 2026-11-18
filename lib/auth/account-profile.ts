// Үйлчлүүлэгч (Account) профайлын талбарын шалгалт — mobile PATCH /api/v1/app/me.
// Цэвэр функц (DB-гүй) тул unit тестлэгдэнэ.

export const ACCOUNT_NAME_MAX = 100;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type AccountProfilePatch = { name?: string | null; email?: string | null };

export type AccountProfileResult =
  | { ok: true; data: AccountProfilePatch }
  | { ok: false; fieldErrors: Record<string, string> };

/**
 * Зөвхөн ирсэн талбарыг шалгана (partial update). Хоосон мөр → null (арилгана).
 * Тодорхойгүй түлхүүр үл тооно (phone-г энд солихгүй — OTP шаардана).
 */
export function validateAccountProfileInput(body: unknown): AccountProfileResult {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, fieldErrors: { body: "Body буруу." } };
  }
  const b = body as Record<string, unknown>;
  const data: AccountProfilePatch = {};
  const fieldErrors: Record<string, string> = {};

  if ("name" in b) {
    if (b.name === null) data.name = null;
    else if (typeof b.name !== "string") fieldErrors.name = "Нэр текст байх ёстой.";
    else {
      const name = b.name.trim().replace(/\s+/g, " ");
      if (name.length > ACCOUNT_NAME_MAX) fieldErrors.name = `Нэр ${ACCOUNT_NAME_MAX} тэмдэгтээс хэтрэхгүй.`;
      else data.name = name || null;
    }
  }
  if ("email" in b) {
    if (b.email === null) data.email = null;
    else if (typeof b.email !== "string") fieldErrors.email = "И-мэйл текст байх ёстой.";
    else {
      const email = b.email.trim().toLowerCase();
      if (!email) data.email = null;
      else if (email.length > 254 || !EMAIL_RE.test(email)) fieldErrors.email = "И-мэйл хаяг буруу байна.";
      else data.email = email;
    }
  }
  if (Object.keys(fieldErrors).length) return { ok: false, fieldErrors };
  if (Object.keys(data).length === 0) return { ok: false, fieldErrors: { body: "Өөрчлөх талбар алга." } };
  return { ok: true, data };
}
