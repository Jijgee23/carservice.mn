// Contract — /api/v1/tenant/qpay (байгууллагын өөрийн QPay merchant тохиргоо)
//
// Эрх: бүх method-д зөвхөн эзэмшигч (`auth.user.isOwner`) — вэбийн
// app/_actions/tenant-qpay.ts authorizeOwner()-тэй адил. Модулийн хаалтгүй,
// subscription lock шалгахгүй (вэб action шалгадаггүйтэй адил).
// Логик: lib/tenant-qpay-settings.ts (вэбтэй нэг).
// Нууц (password, token cache) хэзээ ч буцаагдахгүй — зөвхөн `hasPassword`.
//
// GET /api/v1/tenant/qpay
//   200: { configured: boolean,
//          qpay: { username, invoiceCode, callbackUrl: string|null, enabled,
//                  hasPassword: boolean } | null }
//
// PUT /api/v1/tenant/qpay  (нэмэх/шинэчлэх — вэбийн saveTenantQPayAction)
//   Body: { username: string, invoiceCode: string, password?: string,
//           callbackUrl?: string|null, enabled?: boolean (default true) }
//   Бүтэн бичлэг (вэб form шиг): callbackUrl ирээгүй/null бол арилна.
//   password хоосон/ирээгүй бол хуучныг үлдээнэ; анх тохируулахад заавал.
//   200: GET-тэй ижил хэлбэр + created: boolean.
//   Алдаа: 400 VALIDATION { fieldErrors }, 401, 403, 500.
//
// PATCH /api/v1/tenant/qpay  (идэвхтэй/идэвхгүй switch — setTenantQPayEnabledAction)
//   Body: { enabled: boolean }
//   200: GET-тэй ижил хэлбэр. Алдаа: 400 VALIDATION, 401, 403,
//   404 NOT_CONFIGURED (тохиргоо хийгдээгүй).
//
// DELETE /api/v1/tenant/qpay
//   200: { ok: true }. Алдаа: 401, 403, 404 NOT_CONFIGURED.

import { jsonError, jsonForbidden, jsonOk, requireApiUser } from "@/lib/api";
import {
  deleteTenantQPay,
  getTenantQPayConfig,
  saveTenantQPay,
  setTenantQPayEnabled,
  TENANT_QPAY_NOT_CONFIGURED_MESSAGE,
} from "@/lib/tenant-qpay-settings";

const OWNER_ONLY = "Зөвхөн админ QPay тохиргоог удирдана.";

async function configResponse(tenantId: string, extra?: object) {
  const qpay = await getTenantQPayConfig(tenantId);
  return jsonOk({ configured: Boolean(qpay), qpay, ...extra });
}

async function readObject(req: Request): Promise<Record<string, unknown> | null> {
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  return body as Record<string, unknown>;
}

export async function GET(req: Request) {
  const auth = await requireApiUser(req);
  if (auth.response) return auth.response;
  if (!auth.user.isOwner) return jsonForbidden(OWNER_ONLY);
  return await configResponse(auth.user.tenantId);
}

export async function PUT(req: Request) {
  const auth = await requireApiUser(req);
  if (auth.response) return auth.response;
  if (!auth.user.isOwner) return jsonForbidden(OWNER_ONLY);

  const input = await readObject(req);
  if (!input) return jsonError(400, "JSON body шаардлагатай.", { code: "VALIDATION" });

  const typeErrors: Record<string, string> = {};
  for (const key of ["username", "invoiceCode", "password"] as const) {
    if (key in input && input[key] != null && typeof input[key] !== "string") {
      typeErrors[key] = "Текст утга байх ёстой.";
    }
  }
  if ("callbackUrl" in input && input.callbackUrl !== null && typeof input.callbackUrl !== "string") {
    typeErrors.callbackUrl = "Текст эсвэл null байх ёстой.";
  }
  if ("enabled" in input && typeof input.enabled !== "boolean") {
    typeErrors.enabled = "true/false утга байх ёстой.";
  }
  if (Object.keys(typeErrors).length > 0) {
    return jsonError(400, Object.values(typeErrors)[0]!, { code: "VALIDATION", fieldErrors: typeErrors });
  }

  const text = (key: string) => (typeof input[key] === "string" ? (input[key] as string).trim() : "");
  const result = await saveTenantQPay(auth.user, {
    username: text("username"),
    password: text("password"),
    invoiceCode: text("invoiceCode"),
    callbackUrl: text("callbackUrl"),
    // Вэб form: `enabled` "off" биш бол идэвхтэй — default true.
    enabled: input.enabled !== false,
  });
  if (!result.ok) {
    if (result.code === "VALIDATION") {
      return jsonError(400, Object.values(result.fieldErrors)[0] ?? "Өгөгдөл буруу.", {
        code: "VALIDATION",
        fieldErrors: result.fieldErrors,
      });
    }
    console.error("[api/v1/tenant/qpay PUT]", result.message);
    return jsonError(500, "Хадгалахад алдаа гарлаа.");
  }
  return await configResponse(auth.user.tenantId, { created: result.created });
}

export async function PATCH(req: Request) {
  const auth = await requireApiUser(req);
  if (auth.response) return auth.response;
  if (!auth.user.isOwner) return jsonForbidden(OWNER_ONLY);

  const input = await readObject(req);
  if (!input || typeof input.enabled !== "boolean") {
    return jsonError(400, "enabled (true/false) шаардлагатай.", {
      code: "VALIDATION",
      fieldErrors: { enabled: "true/false утга байх ёстой." },
    });
  }
  const result = await setTenantQPayEnabled(auth.user, input.enabled);
  if (!result.ok) return jsonError(404, result.message, { code: result.code });
  return await configResponse(auth.user.tenantId);
}

export async function DELETE(req: Request) {
  const auth = await requireApiUser(req);
  if (auth.response) return auth.response;
  if (!auth.user.isOwner) return jsonForbidden(OWNER_ONLY);

  const { deleted } = await deleteTenantQPay(auth.user);
  if (!deleted) return jsonError(404, TENANT_QPAY_NOT_CONFIGURED_MESSAGE, { code: "NOT_CONFIGURED" });
  return jsonOk({ ok: true });
}
