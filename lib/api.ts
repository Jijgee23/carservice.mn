import { NextResponse } from "next/server";
import { PublicUpstreamError } from "@/lib/action-errors";
import { type ApiUser, getApiUserFromRequest } from "@/lib/auth/api-token";
import type { PermissionCode } from "@/lib/auth/permissions";
import { hasPermission } from "@/lib/auth/roles";
import { moduleGateForApiPath } from "@/lib/plan-modules-server";
import { clientIp, consumeRateLimit } from "@/lib/rate-limit";

/** HUR/ebarimt алдааг 502 болгоно — зөвхөн PublicUpstreamError-ийн мессежийг ил гаргана. */
export function upstreamErrorResponse(label: string, e: unknown, fallback: string) {
  if (e instanceof PublicUpstreamError) return jsonError(502, e.message);
  console.error(`[${label}]`, e);
  return jsonError(502, fallback);
}

export function jsonError(status: number, message: string, extra?: object) {
  return NextResponse.json({ error: message, ...extra }, { status });
}

export function jsonOk<T>(data: T, init?: ResponseInit) {
  return NextResponse.json(data, init);
}

/**
 * Эрх дутсан үед буцаах 403. `requirePermission` дотроос болон route-уудаас
 * шууд хэрэглэж болно.
 */

export function jsonForbidden(
  message = "Танд энэ үйлдэл хийх эрх байхгүй.",
): NextResponse {
  return jsonError(403, message);
}

/**
 * Authenticated ApiUser тухайн permission-той эсэхийг шалгана. Эрхгүй бол 403
 * Response-г буцаана (route дотор `if (resp) return resp;`), эрхтэй бол null.
 *
 * Жишээ:
 *   const auth = await requireApiUser(req);
 *   if (auth.response) return auth.response;
 *   const denied = requirePermission(auth.user, "orders.create");
 *   if (denied) return denied;
 */

export function requirePermission(
  user: ApiUser,
  code: PermissionCode,
): NextResponse | null {
  return hasPermission(user, code) ? null : jsonForbidden();
}

/**
 * Route handler-уудад хэрэглэх — token шалгаж user-г буцаана.
 * Token байхгүй/буруу бол Response-г шууд буцаана (early return).
 */
export async function requireApiUser(
  req: Request,
): Promise<{ user: ApiUser; response?: undefined } | { user?: undefined; response: NextResponse }> {
  const user = await getApiUserFromRequest(req);
  if (!user) {
    return {
      response: jsonError(401, "Нэвтрэх шаардлагатай эсвэл token хүчингүй."),
    };
  }
  // Багцын модулийн хаалт — замаар нь нэг дор (lib/plan-modules.ts
  // API_MODULE_PATHS). Хаалттай модулийн endpoint 403 MODULE_DISABLED.
  const blocked = await moduleGateForApiPath(new URL(req.url).pathname, user.tenantPlan);
  if (blocked) return { response: blocked };
  return { user };
}

/**
 * Route-д rate limit мөрдүүлнэ. Лимит хэтэрвэл 429 Response, эс бөгөөс null.
 * `id` өгвөл түүгээр (ж: userId), үгүй бол клиентийн IP-аар bucket хийнэ.
 *
 *   const limited = enforceRateLimit(req, "api-login", { limit: 10, windowMs: 60_000 });
 *   if (limited) return limited;
 */
/** Нийтэд нээлттэй catalog/discovery GET-үүдийн IP тутмын хязгаар. */
export const PUBLIC_CATALOG_RATE_LIMIT = { limit: 120, windowMs: 60_000 };

export function enforceRateLimit(
  req: Request,
  bucket: string,
  opts: { limit: number; windowMs: number },
  id?: string,
): NextResponse | null {
  const key = `${bucket}:${id ?? clientIp(req)}`;
  const result = consumeRateLimit(key, opts);
  if (result.ok) return null;
  return NextResponse.json(
    { error: "Хэт олон хүсэлт илгээлээ. Түр хүлээгээд дахин оролдоно уу." },
    { status: 429, headers: { "retry-after": String(result.retryAfterSec) } },
  );
}

export function methodNotAllowed(allowed: string[]) {
  return new NextResponse(JSON.stringify({ error: "Method not allowed" }), {
    status: 405,
    headers: {
      "content-type": "application/json",
      allow: allowed.join(", "),
    },
  });
}