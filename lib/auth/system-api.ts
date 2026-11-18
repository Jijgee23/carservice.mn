// System realm-ийн мобайл API token + хаалга. Ажилтан (User, tag "api"), эцсийн хэрэглэгч (Account, tag
// "account-api")-ээс tag-аар тусгаарлагдсан тул нэг realm-ийн token нөгөөд хүчингүй.
//  - access token: 1 цаг (exp). Payload: adminId, email, `pv` (нууц үгийн хэшийн хурууны хээ).
//  - `pv`: нууц үг солих/сэргээхэд access token ч шууд хүчингүй болно (refresh token-ыг тусад нь revoke хийнэ).
//  - Эрхийг token-д БИШ, хүсэлт бүрд DB-ээс (isActive + kind) тооцно: идэвхгүй болгосон ажилтан шууд хаагдана.

import { createHash } from "node:crypto";
import { jsonError } from "@/lib/api";
import { createJwtSession } from "@/lib/auth/jwt-session";
import { hasSystemPermission, permissionsForKind, type SystemAdminKind, type SystemPermission } from "@/lib/auth/system-permissions";
import { prisma } from "@/lib/prisma";
import { setBypassContext } from "@/lib/tenant-context";

export const SYSTEM_ACCESS_TOKEN_SECONDS = 60 * 60;

export type SystemApiClaims = { adminId: string; email: string; pv: string };

/** Нууц үгийн хэшийн хурууны хээ — нууц үг өөрчлөгдөхөд token хүчингүй болгоно. Хэшийг өөрийг нь token-д тавихгүй. */
export function passwordFingerprint(passwordHash: string): string {
  return createHash("sha256").update(passwordHash).digest("hex").slice(0, 16);
}

const client = createJwtSession<SystemApiClaims>({
  tag: "system-api",
  secretEnvVars: ["API_TOKEN_SECRET", "SESSION_SECRET"],
  maxAgeSeconds: SYSTEM_ACCESS_TOKEN_SECONDS,
  parse(payload) {
    if (typeof payload.adminId !== "string" || typeof payload.email !== "string" || typeof payload.pv !== "string") return null;
    return { adminId: payload.adminId, email: payload.email, pv: payload.pv };
  },
});

export const signSystemApiToken = client.sign;
export const verifySystemApiToken = client.verify;

export type SystemApiAdmin = {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  kind: SystemAdminKind;
  permissions: SystemPermission[];
};

/** Authorization: Bearer <token> → идэвхтэй admin эсвэл null. Дуудагч bypass context-ийг эндээс авна (глобал объект). */
export async function authenticateSystemApiRequest(req: Request): Promise<SystemApiAdmin | null> {
  setBypassContext();
  const match = (req.headers.get("authorization") ?? "").match(/^Bearer\s+(.+)$/i);
  if (!match) return null;
  const claims = await verifySystemApiToken(match[1]);
  if (!claims) return null;
  const admin = await prisma.superAdmin.findUnique({
    where: { id: claims.adminId },
    select: { id: true, email: true, firstName: true, lastName: true, kind: true, isActive: true, passwordHash: true },
  });
  if (!admin || !admin.isActive) return null;
  if (claims.pv !== passwordFingerprint(admin.passwordHash)) return null;
  return {
    id: admin.id,
    email: admin.email,
    firstName: admin.firstName,
    lastName: admin.lastName,
    kind: admin.kind,
    permissions: permissionsForKind(admin.kind),
  };
}

/**
 * Route-д: token шалгаж, заасан эрх байгаа эсэхийг шалгана. Үр дүн нь requireApiUser-тай ижил хэлбэр:
 *   const auth = await requireSystemApiUser(req, "tenants.view");
 *   if (auth.response) return auth.response;
 */
export async function requireSystemApiUser(
  req: Request,
  permission?: SystemPermission,
): Promise<{ admin: SystemApiAdmin; response?: undefined } | { admin?: undefined; response: Response }> {
  const admin = await authenticateSystemApiRequest(req);
  if (!admin) return { response: jsonError(401, "Нэвтрэх шаардлагатай эсвэл token хүчингүй.") };
  if (permission && !hasSystemPermission(admin.kind, permission)) {
    return { response: jsonError(403, "Танд энэ үйлдэл хийх эрх байхгүй.", { code: "FORBIDDEN" }) };
  }
  return { admin };
}
