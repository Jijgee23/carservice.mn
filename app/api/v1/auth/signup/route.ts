import { enforceRateLimit, jsonError, jsonOk } from "@/lib/api";
import { buildApiLoginResponse } from "@/lib/auth/api-login";
import { parseLoginDevice } from "@/lib/auth/login-device";
import { revokeAllOtps, verifyOtp } from "@/lib/auth/otp";
import {
  createTenantWithOwner,
  tenantSignupInputFromBody,
  validateTenantSignup,
} from "@/lib/auth/tenant-signup";
import { logAudit } from "@/lib/audit";
import { notifySuperAdmins } from "@/lib/notifications";
import { prisma } from "@/lib/prisma";
import { setBypassContext } from "@/lib/tenant-context";

/**
 * POST /api/v1/auth/signup — шинэ засвар (tenant) бүртгэлийн 2-р шат.
 *
 * Body (JSON): /auth/signup/request-otp-тэй ижил талбарууд + `code` (6 оронтой OTP)
 * + /auth/login-ийн төхөөрөмжийн талбарууд (fcm, deviceId, type, model, os, ...).
 *
 * OTP зөв бол Tenant + «Үндсэн салбар» + OWNER хэрэглэгчийг үүсгэж (веб
 * signUpAction-тэй ижил transaction), шууд нэвтрүүлнэ — хариу нь /auth/login-тэй
 * ижил (access + refresh token + user). Шинэ tenant FREE багцтай эхэлнэ.
 *
 * 400 VALIDATION / 401 OTP буруу / 409 CONFLICT → `{ error, code?, fieldErrors? }`.
 */
export async function POST(req: Request) {
  // Бүртгэлээс өмнө — session/tenant хараахан байхгүй.
  setBypassContext();

  const limited = enforceRateLimit(req, "api-signup", { limit: 10, windowMs: 60_000 });
  if (limited) return limited;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError(400, "Body нь JSON байх ёстой.");
  }

  const validated = validateTenantSignup(tenantSignupInputFromBody(body));
  if (!validated.ok) {
    return jsonError(400, Object.values(validated.fieldErrors)[0], {
      code: "VALIDATION",
      fieldErrors: validated.fieldErrors,
    });
  }
  const data = validated.data;

  const rawCode = (body as { code?: unknown; otpCode?: unknown }).code ??
    (body as { otpCode?: unknown }).otpCode;
  const otpCode = typeof rawCode === "string" ? rawCode.trim() : "";
  if (!/^\d{6}$/.test(otpCode)) {
    return jsonError(400, "6 оронтой код шаардлагатай.", {
      code: "VALIDATION",
      fieldErrors: { code: "6 оронтой код оруулна уу." },
    });
  }

  const parsedDevice = parseLoginDevice(body);
  if (!parsedDevice.ok) {
    return jsonError(400, Object.values(parsedDevice.fieldErrors)[0], {
      code: "VALIDATION",
      fieldErrors: parsedDevice.fieldErrors,
    });
  }

  const otp = await verifyOtp({ email: data.adminEmail, phone: data.phone, type: "SIGNUP", code: otpCode });
  if (!otp.ok) {
    const msg =
      otp.reason === "expired"
        ? "Кодны хугацаа дууссан. Шинээр код илгээнэ үү."
        : otp.reason === "too_many_attempts"
          ? "Хэт олон удаа буруу оролдсон. Шинээр код илгээнэ үү."
          : "Код буруу байна.";
    return jsonError(401, msg, { code: "OTP_INVALID", fieldErrors: { code: msg } });
  }

  const result = await createTenantWithOwner(data);
  if (!result.ok) {
    if ("fieldErrors" in result) {
      return jsonError(409, Object.values(result.fieldErrors)[0], {
        code: "CONFLICT",
        fieldErrors: result.fieldErrors,
      });
    }
    return jsonError(500, result.message);
  }
  const { userId, tenantId } = result.created;
  await revokeAllOtps({ email: data.adminEmail, phone: data.phone }, "SIGNUP");

  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    include: {
      tenant: { select: { id: true, name: true } },
      role: { select: { id: true, name: true, permissions: true } },
    },
  });

  await logAudit({
    tenantId,
    userId,
    entity: "Tenant",
    entityId: tenantId,
    action: "CREATE",
    summary: `${data.orgName} · засвар бүртгүүлэв (mobile)`,
  });

  try {
    await notifySuperAdmins({ type: "tenant_created", input: { tenantId, tenantName: data.orgName } });
  } catch (err) {
    console.warn("[notify] tenant_created:", err);
  }

  return jsonOk(await buildApiLoginResponse(user, req, parsedDevice.device), { status: 201 });
}
