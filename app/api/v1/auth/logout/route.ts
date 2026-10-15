import { jsonError, jsonOk } from "@/lib/api";
import { revokeRefreshToken } from "@/lib/auth/refresh-token";
import { prisma } from "@/lib/prisma";
import { setBypassContext } from "@/lib/tenant-context";

/**
 * POST /api/v1/auth/logout
 * Body: { refreshToken: string }
 *
 * Тухайн refresh token-ыг revoke хийж, энэ нэвтрэлтээр бүртгэгдсэн push төхөөрөмжийг устгана (тусдаа
 * DELETE /devices/{id} дуудах шаардлагагүй). Төхөөрөмж энэ хооронд өөр хэрэглэгчид шилжсэн бол хөндөхгүй.
 * Access token нь өөрөө богино настай тул эргэлзэхгүйгээр expire-руу үлдэнэ.
 */
export async function POST(req: Request) {
  // No session/tenant yet — the refresh token alone identifies the row.
  // Without a context the Prisma client throws on every query, so logout used to
  // 500 and never actually revoked the token.
  setBypassContext();

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError(400, "Body нь JSON байх ёстой.");
  }

  if (!body || typeof body !== "object") {
    return jsonError(400, "refreshToken шаардлагатай.");
  }
  const { refreshToken } = body as { refreshToken?: unknown };
  if (typeof refreshToken !== "string" || !refreshToken.trim()) {
    return jsonError(400, "refreshToken-ийг текстээр илгээнэ үү.");
  }

  const session = await revokeRefreshToken(refreshToken.trim());
  let deviceRemoved = false;
  if (session?.pushDeviceId) {
    const res = await prisma.device.deleteMany({ where: { id: session.pushDeviceId, userId: session.userId } });
    deviceRemoved = res.count > 0;
  }
  return jsonOk({ ok: true, deviceRemoved });
}
