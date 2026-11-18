// Contract — PUT /api/v1/system/me/password  { currentPassword, newPassword }
// Өөрийн нууц үгийг солино (root-ын тохируулсан анхны нууц үгийг ажилтан солихад). Амжилттай бол бусад бүх төхөөрөмж
// гарна (refresh token revoke + access token-ы `pv` өөрчлөгдөнө), энэ төхөөрөмжид ШИНЭ token хос олгоно.
// 200: { ok: true, ...tokens }  Errors: 400, 401, 422 { code: "PASSWORD_INVALID" | "PASSWORD_UNCHANGED" }, 429 (10/10мин).

import { enforceRateLimit, jsonError, jsonOk } from "@/lib/api";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { requireSystemApiUser } from "@/lib/auth/system-api";
import { issueSystemTokens } from "@/lib/auth/system-session-issue";
import { revokeAllSystemRefreshTokens } from "@/lib/auth/system-refresh-token";
import { prisma } from "@/lib/prisma";

export async function PUT(req: Request) {
  const auth = await requireSystemApiUser(req);
  if (auth.response) return auth.response;
  const limited = enforceRateLimit(req, "system-api-password", { limit: 10, windowMs: 10 * 60_000 }, auth.admin.id);
  if (limited) return limited;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError(400, "JSON body шаардлагатай.");
  }
  const rec = body && typeof body === "object" ? (body as { currentPassword?: unknown; newPassword?: unknown }) : {};
  const current = typeof rec.currentPassword === "string" ? rec.currentPassword : "";
  const next = typeof rec.newPassword === "string" ? rec.newPassword : "";
  if (next.length < 8 || next.length > 200) {
    return jsonError(422, "Шинэ нууц үг хамгийн багадаа 8 тэмдэгт байх ёстой.", { code: "PASSWORD_INVALID", fieldErrors: { newPassword: "Хамгийн багадаа 8 тэмдэгт." } });
  }

  const row = await prisma.superAdmin.findUnique({ where: { id: auth.admin.id }, select: { id: true, email: true, passwordHash: true } });
  if (!row) return jsonError(401, "Нэвтрэх шаардлагатай эсвэл token хүчингүй.");
  if (!(await verifyPassword(current, row.passwordHash))) {
    return jsonError(422, "Одоогийн нууц үг буруу байна.", { code: "PASSWORD_INVALID", fieldErrors: { currentPassword: "Буруу байна." } });
  }
  if (current === next) {
    return jsonError(422, "Шинэ нууц үг одоогийнхоос өөр байх ёстой.", { code: "PASSWORD_UNCHANGED", fieldErrors: { newPassword: "Одоогийнхоос өөр байх ёстой." } });
  }

  const passwordHash = await hashPassword(next);
  await prisma.superAdmin.update({ where: { id: row.id }, data: { passwordHash } });
  await revokeAllSystemRefreshTokens(row.id);
  const tokens = await issueSystemTokens({ id: row.id, email: row.email, passwordHash }, req);
  return jsonOk({ ok: true, ...tokens });
}
