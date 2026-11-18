// System ажилтан/админ харилцагч (tenant) БҮРТГЭХ цөм. Өөрөө бүртгүүлэхтэй (lib/auth/tenant-signup.ts) ижил
// шалгалт, давхцал, үүсгэх логик — ялгаа нь: нууц үг, OTP, session ШААРДАХГҮЙ. Эзэн `passwordHash: null`,
// `verified: false`-тай үүсч, өөрөө утсандаа ирсэн SMS кодоор /api/v1/auth/activate-аар нууц үгээ тохируулна —
// ажилтан эзний нууц үгийг хэзээ ч мэдэхгүй, эзний session-д ч нэвтрэхгүй.
// Дуудагч эрхийг (tenants.create) өөрөө шалгасан байх ёстой. Хамаарлыг (deps) дамжуулдаг тул fake-ээр тестлэнэ.

import {
  createTenantWithOwner,
  findTenantSignupConflicts,
  tenantSignupInputFromBody,
  validateTenantSignup,
  type CreatedTenant,
  type FieldErrors,
  type TenantSignupData,
} from "@/lib/auth/tenant-signup";
import { notifySuperAdmins } from "@/lib/notifications";
import { logSystemAudit } from "@/lib/system/audit";

export type RegisterDeps = {
  validate: typeof validateTenantSignup;
  findConflicts: typeof findTenantSignupConflicts;
  create: typeof createTenantWithOwner;
  audit: typeof logSystemAudit;
  notify: typeof notifySuperAdmins;
};

const defaultDeps: RegisterDeps = {
  validate: validateTenantSignup,
  findConflicts: findTenantSignupConflicts,
  create: createTenantWithOwner,
  audit: logSystemAudit,
  notify: notifySuperAdmins,
};

export type RegisterResult =
  | { ok: true; created: CreatedTenant; data: TenantSignupData }
  | { ok: false; status: 422 | 409 | 500; message: string; code: "VALIDATION" | "CONFLICT" | "SERVER_ERROR"; fieldErrors?: FieldErrors };

const firstMessage = (fe: FieldErrors) => Object.values(fe)[0] ?? "Оруулсан мэдээлэл буруу.";

export async function registerTenantBySystem(
  input: { body: unknown; adminId: string; req?: Request },
  deps: RegisterDeps = defaultDeps,
): Promise<RegisterResult> {
  // Нууц үг шаардахгүй; client нууц үг илгээсэн ч validateTenantSignup (requirePassword:false) уншихгүй.
  const validated = deps.validate(tenantSignupInputFromBody(input.body), { requirePassword: false });
  if (!validated.ok) {
    return { ok: false, status: 422, code: "VALIDATION", message: firstMessage(validated.fieldErrors), fieldErrors: validated.fieldErrors };
  }
  const data = validated.data;

  const conflicts = await deps.findConflicts(data);
  if (conflicts) return { ok: false, status: 409, code: "CONFLICT", message: firstMessage(conflicts), fieldErrors: conflicts };

  const result = await deps.create(data, { ownerActivation: true });
  if (!result.ok) {
    if ("fieldErrors" in result) {
      return { ok: false, status: 409, code: "CONFLICT", message: firstMessage(result.fieldErrors), fieldErrors: result.fieldErrors };
    }
    return { ok: false, status: 500, code: "SERVER_ERROR", message: result.message };
  }

  const { tenantId, userId } = result.created;
  await deps.audit({
    adminId: input.adminId,
    tenantId,
    entity: "Tenant",
    entityId: tenantId,
    action: "CREATE",
    summary: `${data.orgName} · харилцагч бүртгэв (System ажилтан)`,
    after: { name: data.orgName, registerNumber: data.registerNumber, phone: data.phone, email: data.adminEmail, ownerUserId: userId, ownerActivation: true },
    req: input.req,
  });
  try {
    await deps.notify({ type: "tenant_created", input: { tenantId, tenantName: data.orgName } });
  } catch (err) {
    console.warn("[notify] tenant_created:", err instanceof Error ? err.name : err);
  }
  return { ok: true, created: result.created, data };
}
